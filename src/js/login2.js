/**
 * snap_headless.js
 *
 * Fully headless automation of Snap! — no browser, no Playwright, no graphical
 * interface of any kind.  All operations go directly against the Snap!Cloud
 * REST API documented in cloud.js, and all XML manipulation is done with the
 * fast-xml-parser library (pure Node.js).
 *
 * What cloud.js tells us about every endpoint used here:
 *
 *  LOGIN
 *    Cloud.prototype.login()
 *    POST /api/v1/users/{username}/login?persist=true
 *    Body : hex_sha512(password)   (plain text, not JSON)
 *    Auth : sets a session cookie  (snap-session)
 *
 *  GET PROJECT  (authenticated, own project)
 *    Cloud.prototype.getProject()
 *    GET  /api/v1/projects/{username}/{projectName}
 *    Returns raw XML: <snapdata><project …>…</project><media …>…</media></snapdata>
 *
 *  SAVE PROJECT
 *    Cloud.prototype.saveProject()
 *    POST /api/v1/projects/{username}/{projectName}
 *    Body : JSON  { xml, media, thumbnail, notes, remixID }
 *           xml       → <project …> string
 *           media     → <media …>   string  (base64-encoded costumes/sounds)
 *           thumbnail → data-URL PNG
 *           notes     → string
 *           remixID   → null | number
 *
 * Operations implemented (all purely in Node.js, no DOM, no browser):
 *   1. login()
 *   2. getProject()          – fetch + parse XML
 *   3. addNewSprite()        – inject <sprite> node into project XML
 *   4. uploadImageToSprite() – inject <costume> node + base64 asset into media XML
 *   5. uploadAudioToSprite() – inject <sound>   node + base64 asset into media XML
 *   6. importSpriteFromFile()– merge a .sprite XML export into the project
 *   7. saveProject()         – POST the modified XML back to the cloud
 *
 * Install:
 *   npm install node-fetch@2 fast-xml-parser sharp  (sharp is only for thumbnail gen)
 *   # node-fetch@2 for CommonJS; use v3 + import if you prefer ESM
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const fetch = require('node-fetch');   // npm install node-fetch@2
const {XMLParser, XMLBuilder} = require('fast-xml-parser'); // npm install fast-xml-parser

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const BASE_URL = 'https://snap.berkeley.edu/api/v1';

// ─── XML PARSER / BUILDER SHARED OPTIONS ─────────────────────────────────────
// We keep attributes, preserve order, and keep text nodes — matching Snap!'s
// own serializer output as closely as possible.

const XML_OPTS = {
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    preserveOrder: true,   // keeps child order intact
    allowBooleanAttributes: true,
    cdataPropName: '__cdata',
    parseAttributeValue: false,  // keep everything as strings
    trimValues: false,
};

const parser = new XMLParser(XML_OPTS);
const builder = new XMLBuilder({...XML_OPTS, format: false, suppressEmptyNode: false});

// ─── UTILITIES ───────────────────────────────────────────────────────────────

/** cloud.js → Cloud.prototype.login() body = hex_sha512(password) */
function hex_sha512(str) {
    return crypto.createHash('sha512').update(str).digest('hex');
}

/**
 * Minimal cookie jar — cloud.js uses withCredentials / session cookies.
 * We store them between requests manually.
 */
class CookieJar {
    constructor() {
        this._cookies = {};
    }

    ingest(setCookieHeaders) {
        if (!setCookieHeaders) return;
        const headers = Array.isArray(setCookieHeaders)
            ? setCookieHeaders : [setCookieHeaders];
        for (const h of headers) {
            const [pair] = h.split(';');
            const [name, ...rest] = pair.split('=');
            this._cookies[name.trim()] = rest.join('=').trim();
        }
    }

    header() {
        return Object.entries(this._cookies)
            .map(([k, v]) => `${k}=${v}`)
            .join('; ');
    }
}

const jar = new CookieJar();

/**
 * Wrapper around fetch that:
 *  - attaches the session cookie on every request
 *  - stores any Set-Cookie headers returned
 *  - mirrors cloud.js request() behaviour:
 *      JSON parse unless wantsRaw, throw on {"errors":…}
 */
async function apiRequest(method, path, {body, wantsRaw = false} = {}) {
    const url = BASE_URL + path;
    const headers = {
        'Content-Type': 'application/json; charset=utf-8',
        'Cookie': jar.header(),
    };

    const res = await fetch(url, {
        method,
        headers,
        body: body !== undefined
            ? (typeof body === 'string' ? body : JSON.stringify(body))
            : undefined,
    });

    // Store any cookies the server sets (session token)
    const setCookie = res.headers.raw()['set-cookie'];
    if (setCookie) jar.ingest(setCookie);

    const text = await res.text();
    if (!text) throw new Error(`Empty response from ${method} ${path}`);

    // cloud.js: always try JSON first; if it has "errors" key, throw
    if (!wantsRaw || text.startsWith('{"errors"')) {
        const json = JSON.parse(text);
        if (json.errors) throw new Error(json.errors[0]);
        return json.message || json;
    }
    return text; // raw XML
}

// ─── 1. LOGIN ─────────────────────────────────────────────────────────────────
/**
 * cloud.js → Cloud.prototype.login()
 *   POST /api/v1/users/{username}/login?persist=true
 *   Body: hex_sha512(password)   ← plain string body, NOT JSON
 */
async function login(username, password) {
    const path = `/users/${encodeURIComponent(username)}/login?persist=true`;

    // The body is the raw SHA-512 hash string, not a JSON object.
    // cloud.js sends:  request.send(hex_sha512(password))
    await apiRequest('POST', path, {
        body: hex_sha512(password),
        wantsRaw: false,
    });

    // After login, cloud.js calls checkCredentials → GET /users/c
    // to confirm the session and retrieve the username.
    const user = await apiRequest('GET', '/users/c');
    console.log(`✓ Logged in as "${user.username}"`);
    return user.username;
}

// ─── 2. GET PROJECT ───────────────────────────────────────────────────────────
/**
 * cloud.js → Cloud.prototype.getProject()
 *   GET /api/v1/projects/{username}/{projectName}
 *   Returns: raw <snapdata> XML string
 *
 * We parse it into { projectXml, mediaXml } so callers work with strings,
 * not a deeply nested object.
 */
async function getProject(username, projectName) {
    const raw = await apiRequest(
        'GET',
        `/projects/${encodeURIComponent(username)}/${encodeURIComponent(projectName)}`,
        {wantsRaw: true}
    );

    // The envelope is:  <snapdata><project …>…</project><media …>…</media></snapdata>
    const projectXml = extractTag(raw, 'project');
    const mediaXml = extractTag(raw, 'media');

    console.log(`✓ Project "${projectName}" fetched`);
    return {projectXml, mediaXml, raw};
}

// ─── 3. SAVE PROJECT ──────────────────────────────────────────────────────────
/**
 * cloud.js → Cloud.prototype.saveProject()
 *   POST /api/v1/projects/{username}/{projectName}
 *   Body JSON: { xml, media, thumbnail, notes, remixID }
 *
 * gui.js → buildProjectRequest() builds this body; we replicate it here
 * using the (possibly modified) XML strings we already have.
 */
async function saveProject(username, projectName, projectXml, mediaXml, notes = '') {
    const body = {
        xml: projectXml,
        media: mediaXml,
        thumbnail: BLANK_THUMBNAIL,  // 1×1 transparent PNG data-URL (see bottom of file)
        notes: notes,
        remixID: null,
    };

    // cloud.js → verifyProject(): reject if > 10 MB
    const size = JSON.stringify(body).length;
    if (size > 10 * 1024 * 1024) {
        throw new Error(`Project too large to save: ${Math.round(size / 1024)} KB > 10 MB`);
    }

    const result = await apiRequest(
        'POST',
        `/projects/${encodeURIComponent(username)}/${encodeURIComponent(projectName)}`,
        {body}
    );

    console.log(`✓ Project "${projectName}" saved (${Math.round(size / 1024)} KB)`);
    return result;
}

// ─── 4. ADD A NEW SPRITE ──────────────────────────────────────────────────────
/**
 * gui.js → IDE_Morph.prototype.addNewSprite()
 *   Creates a new SpriteMorph and appends it to the scene.
 *
 * In XML terms (Snap! serializer format):
 *   Inside <project> there is a <sprites> element.
 *   Each sprite is a <sprite name="…" …> child of <sprites>.
 *   A new blank sprite has no costumes or sounds.
 *
 * Returns the new sprite name.
 */
function addNewSprite(projectXml, spriteName) {
    // Find all existing sprite names to avoid collisions
    // (gui.js → IDE_Morph.prototype.newSpriteName())
    const existing = [...projectXml.matchAll(/<sprite[^>]+name="([^"]+)"/g)]
        .map(m => m[1]);

    const finalName = uniqueName(spriteName || 'Sprite', existing);

    // Minimal blank sprite XML — matches what Snap!'s serializer emits for a
    // fresh SpriteMorph.  All optional sections (scripts, variables, blocks…)
    // are empty but present so the loader doesn't complain.
    const spriteXml = `<sprite name="${esc(finalName)}" idx="${existing.length + 1}" ` +
        `x="0" y="0" heading="90" scale="1" volume="100" pan="0" ` +
        `rotation="1" draggable="true" costume="0" color="80,80,80,1" ` +
        `pen="tip" id="${randomId()}">` +
        `<costumes><list id="${randomId()}"></list></costumes>` +
        `<sounds><list id="${randomId()}"></list></sounds>` +
        `<blocks></blocks>` +
        `<variables></variables>` +
        `<scripts></scripts>` +
        `</sprite>`;

    // Inject before </sprites>
    if (!projectXml.includes('</sprites>')) {
        throw new Error('Could not find </sprites> in project XML');
    }
    const modified = projectXml.replace('</sprites>', spriteXml + '</sprites>');

    console.log(`✓ New sprite "${finalName}" added`);
    return {projectXml: modified, spriteName: finalName};
}

// ─── 5. UPLOAD AN IMAGE TO A SPRITE ──────────────────────────────────────────
/**
 * gui.js → IDE_Morph.prototype.droppedImage() / droppedSVG()
 *   Adds a costume to currentSprite via sprite.addCostume(costume).
 *
 * In XML (Snap! serializer):
 *   <sprite …>
 *     <costumes>
 *       <list>
 *         <item><costume name="…" center-x="0" center-y="0"
 *                        image="data:image/png;base64,…" id="…"/></item>
 *       </list>
 *     </costumes>
 *   </sprite>
 *   Media section: the same base64 also lives in <media> as
 *     <costume name="…" mediaID="…" …/>  pointing to an asset.
 *
 * For simplicity we embed the image directly in the costume node's `image`
 * attribute — this is the format Snap!'s serializer uses when
 * isCollectingMedia = false (standalone sprite export).
 * The <media> section is left unchanged (it is used for incremental upload,
 * which Snap! currently has disabled anyway — see buildProjectRequest comment).
 */
function uploadImageToSprite(projectXml, mediaXml, spriteName, filePath) {
    const fileBuffer = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase().slice(1);
    const base64 = fileBuffer.toString('base64');
    const mimeTypes = {
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
        gif: 'image/gif', svg: 'image/svg+xml'
    };
    const mime = mimeTypes[ext] || 'image/png';
    const dataURL = `data:${mime};base64,${base64}`;
    const costumeName = path.basename(filePath, path.extname(filePath));
    const id = randomId();

    // The costume item XML.  `image` holds the full data-URL inline.
    const costumeXml =
        `<item><costume name="${esc(costumeName)}" center-x="0" center-y="0" ` +
        `image="${esc(dataURL)}" id="${id}"/></item>`;

    // Find the target sprite's <costumes><list>…</list></costumes> block and
    // insert before </list>.
    const modified = injectIntoSprite(projectXml, spriteName, 'costumes', costumeXml);

    console.log(`✓ Image "${fileName}" added to sprite "${spriteName}"`);
    return {projectXml: modified, mediaXml};
}

// ─── 6. UPLOAD AUDIO TO A SPRITE ─────────────────────────────────────────────
/**
 * gui.js → IDE_Morph.prototype.droppedAudio()
 *   Adds a sound via sprite.addSound(anAudio, name).
 *
 * In XML (Snap! serializer):
 *   <sprite …>
 *     <sounds>
 *       <list>
 *         <item><sound name="…" sound="data:audio/mpeg;base64,…" id="…"/></item>
 *       </list>
 *     </sounds>
 *   </sprite>
 */
function uploadAudioToSprite(projectXml, mediaXml, spriteName, filePath) {
    const fileBuffer = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase().slice(1);
    const base64 = fileBuffer.toString('base64');
    const mimeTypes = {mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg'};
    const mime = mimeTypes[ext] || 'audio/mpeg';
    const dataURL = `data:${mime};base64,${base64}`;
    const soundName = path.basename(filePath, path.extname(filePath));
    const id = randomId();

    const soundXml =
        `<item><sound name="${esc(soundName)}" sound="${esc(dataURL)}" id="${id}"/></item>`;

    const modified = injectIntoSprite(projectXml, spriteName, 'sounds', soundXml);

    console.log(`✓ Audio "${fileName}" added to sprite "${spriteName}"`);
    return {projectXml: modified, mediaXml};
}

// ─── 7. IMPORT A SPRITE FROM FILE ─────────────────────────────────────────────
/**
 * gui.js → IDE_Morph.prototype.droppedText() → openSpritesString()
 *   → rawOpenSpritesString() → deserializeSpritesString()
 *   → serializer.loadSpritesModel(xml, this)
 *
 * A .sprite export file starts with <sprites> and contains one or more
 * <sprite> children.  We extract those <sprite> nodes and inject them into
 * the project's <sprites> block, exactly as loadSpritesModel does at runtime.
 */
function importSpriteFromFile(projectXml, mediaXml, filePath) {
    const xmlString = fs.readFileSync(filePath, 'utf8');
    const fileName = path.basename(filePath);

    if (!xmlString.trim().startsWith('<sprites')) {
        throw new Error(`"${fileName}" does not look like a Snap! sprite export (expected <sprites…>)`);
    }

    // Extract every <sprite …>…</sprite> from the file
    const spriteNodes = extractAllTags(xmlString, 'sprite');
    if (spriteNodes.length === 0) {
        throw new Error(`No <sprite> nodes found in "${fileName}"`);
    }

    // Find existing names to avoid collisions
    const existing = [...projectXml.matchAll(/<sprite[^>]+name="([^"]+)"/g)]
        .map(m => m[1]);

    let modified = projectXml;
    for (let spriteXml of spriteNodes) {
        // Rename if there's a collision
        const nameMatch = spriteXml.match(/name="([^"]+)"/);
        if (nameMatch) {
            const original = nameMatch[1];
            const safe = uniqueName(original, existing);
            if (safe !== original) {
                spriteXml = spriteXml.replace(`name="${original}"`, `name="${safe}"`);
            }
            existing.push(safe);
        }
        modified = modified.replace('</sprites>', spriteXml + '</sprites>');
    }

    // Also merge any <media> assets from the sprite file into the project media
    let modifiedMedia = mediaXml;
    const spriteMedia = extractTag(xmlString, 'media');
    if (spriteMedia) {
        // Inject the contents of the sprite's <media> before </media> in the project
        const inner = spriteMedia.replace(/^<media[^>]*>/, '').replace(/<\/media>$/, '');
        if (inner.trim()) {
            modifiedMedia = modifiedMedia.replace('</media>', inner + '</media>');
        }
    }

    console.log(`✓ ${spriteNodes.length} sprite(s) imported from "${fileName}"`);
    return {projectXml: modified, mediaXml: modifiedMedia};
}

// ─── XML HELPERS ─────────────────────────────────────────────────────────────

/**
 * Extracts the first occurrence of <tagName …>…</tagName> (or self-closing)
 * from a string, handling nested tags of the same name.
 */
function extractTag(xml, tagName) {
    const open = new RegExp(`<${tagName}[\\s>]`);
    const start = xml.search(open);
    if (start === -1) return null;

    let depth = 0, i = start;
    while (i < xml.length) {
        if (xml[i] === '<') {
            if (xml.startsWith(`</${tagName}>`, i)) {
                if (depth === 1) return xml.slice(start, i + tagName.length + 3);
                depth--;
            } else if (xml.startsWith(`<${tagName}`, i) &&
                /[\s>]/.test(xml[i + tagName.length + 1])) {
                // Check if self-closing
                const closeAngle = xml.indexOf('>', i);
                if (xml[closeAngle - 1] === '/') {
                    if (depth === 0) return xml.slice(i, closeAngle + 1);
                } else {
                    depth++;
                }
            }
        }
        i++;
    }
    return null;
}

/** Extracts ALL top-level occurrences of <tagName> from a string. */
function extractAllTags(xml, tagName) {
    const results = [];
    let remaining = xml;
    let offset = 0;
    while (true) {
        const chunk = extractTag(remaining, tagName);
        if (!chunk) break;
        results.push(chunk);
        const pos = remaining.indexOf(chunk);
        remaining = remaining.slice(pos + chunk.length);
    }
    return results;
}

/**
 * Finds the named sprite's <section> (costumes|sounds) block and injects
 * xmlToInject before the closing </list> tag within it.
 *
 * Handles the fact that a project may have multiple sprites: we locate the
 * correct <sprite name="spriteName" …> block first.
 */
function injectIntoSprite(projectXml, spriteName, section, xmlToInject) {
    // Find the start of the target sprite's XML
    const spriteStart = findSpriteStart(projectXml, spriteName);
    if (spriteStart === -1) {
        throw new Error(`Sprite "${spriteName}" not found in project XML`);
    }

    // Extract just the sprite block
    const spriteXml = extractTag(projectXml.slice(spriteStart), 'sprite');
    if (!spriteXml) {
        throw new Error(`Could not extract <sprite> block for "${spriteName}"`);
    }

    // Find the section (costumes / sounds) inside that sprite
    const sectionXml = extractTag(spriteXml, section);
    if (!sectionXml) {
        throw new Error(`Could not find <${section}> in sprite "${spriteName}"`);
    }

    // Find the <list> inside the section and inject before </list>
    const listXml = extractTag(sectionXml, 'list');
    if (!listXml) {
        throw new Error(`Could not find <list> inside <${section}> of sprite "${spriteName}"`);
    }

    const newListXml = listXml.replace('</list>', xmlToInject + '</list>');
    const newSectionXml = sectionXml.replace(listXml, newListXml);
    const newSpriteXml = spriteXml.replace(sectionXml, newSectionXml);

    return projectXml.slice(0, spriteStart) +
        newSpriteXml +
        projectXml.slice(spriteStart + spriteXml.length);
}

/** Returns the index in xml where <sprite name="spriteName" …> starts. */
function findSpriteStart(xml, spriteName) {
    const re = new RegExp(`<sprite[^>]+name="${escapeRegex(spriteName)}"[^>]*>`);
    const m = xml.match(re);
    if (!m) return -1;
    return xml.indexOf(m[0]);
}

/** Generate a random numeric id like Snap!'s serializer does. */
function randomId() {
    return Math.floor(Math.random() * 9000000 + 1000000).toString();
}

/** XML-escape attribute values. */
function esc(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/** Escape special regex characters. */
function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Returns a name that doesn't exist in the `existing` array,
 * appending (2), (3) … as needed — matches gui.js newSpriteName().
 */
function uniqueName(base, existing) {
    if (!existing.includes(base)) return base;
    let i = 2;
    while (existing.includes(`${base} (${i})`)) i++;
    return `${base} (${i})`;
}

// A 1×1 transparent PNG as a data-URL — used as the thumbnail when we don't
// have the full Snap! runtime to render the stage canvas.
// gui.js → buildProjectRequest(): thumbnail = proj.thumbnail.toDataURL()
const BLANK_THUMBNAIL =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ' +
    'AAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// ─── MAIN — wire everything together ─────────────────────────────────────────

(async () => {
    // ── Config ────────────────────────────────────────────────────────────────
    const USERNAME = 'manueljb';
    const PASSWORD = '17luglioSna#';
    const PROJECT_NAME = 'Snake';

    // ── 1. Login ──────────────────────────────────────────────────────────────
    const loggedInAs = await login(USERNAME, PASSWORD);

    // ── 2. Fetch the project ──────────────────────────────────────────────────
    let {projectXml, mediaXml} = await getProject(loggedInAs, PROJECT_NAME);

    // ── 3. Create a new sprite ────────────────────────────────────────────────
    // ({ projectXml } = addNewSprite(projectXml, 'MyNewSprite'));

    console.log("LOAD");
    const pathCactus = path.resolve(__dirname, '../../public/image/cactus2.png');

    // ── 4. Upload an image to a sprite ────────────────────────────────────────
    ({projectXml, mediaXml} = uploadImageToSprite(
        projectXml, mediaXml,
        'apple',
        pathCactus   // ← replace with your file
    ));

    // // ── 5. Upload audio to a sprite ───────────────────────────────────────────
    // ({ projectXml, mediaXml } = uploadAudioToSprite(
    //     projectXml, mediaXml,
    //     'MyNewSprite',
    //     '/path/to/your/sound.mp3'   // ← replace with your file
    // ));
    //
    // // ── 6. Import a sprite from a local .sprite file ──────────────────────────
    // ({ projectXml, mediaXml } = importSpriteFromFile(
    //     projectXml, mediaXml,
    //     '/path/to/your/exported_sprite.xml'  // ← replace with your file
    // ));

    // ── 7. Save everything back to the cloud ─────────────────────────────────
    await saveProject(loggedInAs, PROJECT_NAME, projectXml, mediaXml);

    console.log('\n✓ All done — no browser was used.');
})();