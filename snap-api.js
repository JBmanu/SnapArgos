/**
 * snap-api.js — Snap! Cloud API (browser)
 * LOCAL -> /snap-api/*  |  PROD -> corsproxy.io -> snap.berkeley.edu/api/v1
 */

const IS_LOCAL  = ['localhost','127.0.0.1'].includes(location.hostname);
const PROD_BASE = 'https://corsproxy.io/?https://snap.berkeley.edu/api/v1';

export const state = { username: null, sessionId: null, cookie: null };

// ── Core HTTP ─────────────────────────────────────────────────────────────────
async function req(method, path, { body, wantsRaw = false } = {}) {
    const headers = { 'Content-Type': 'application/json; charset=utf-8' };
    const url = IS_LOCAL ? `/snap-api${path}` : PROD_BASE + path;
    if (IS_LOCAL  && state.sessionId) headers['x-session-id'] = state.sessionId;
    if (!IS_LOCAL && state.cookie)    headers['Cookie']        = state.cookie;
    const res = await fetch(url, {
        method, headers,
        credentials: IS_LOCAL ? 'same-origin' : 'omit',
        body: body == null ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    if (IS_LOCAL) { const s = res.headers.get('x-session-id'); if (s) state.sessionId = s; }
    else          { const s = res.headers.get('set-cookie');    if (s) state.cookie = s.split(';')[0]; }
    const text = await res.text();
    if (!text) throw new Error(`Empty response ${method} ${path} (${res.status})`);
    if (!wantsRaw || text.startsWith('{"error')) {
        let j; try { j = JSON.parse(text); } catch { throw new Error(text); }
        if (j.errors) throw new Error(j.errors[0]);
        if (j.error)  throw new Error(j.error);
        return j.message !== undefined ? j.message : j;
    }
    return text;
}

// ── Auth ──────────────────────────────────────────────────────────────────────
export async function login(username, password) {
    if (IS_LOCAL) {
        const r = await req('POST', '/login', { body: { username, password } });
        state.username = r.username; state.sessionId = r.sessionId;
    } else {
        await req('POST', `/users/${enc(username.toLowerCase())}/login?persist=true`, { body: await sha512(password) });
        state.username = (await req('GET', '/users/c')).username;
    }
    return state.username;
}

// ── Projects ──────────────────────────────────────────────────────────────────
export async function getProjectList() {
    assertLoggedIn();
    if (IS_LOCAL) return req('GET', '/projects');
    const r = await req('GET', `/projects/${enc(state.username)}?updatingnotes=true`);
    return Array.isArray(r) ? r : (r?.projects ?? []);
}

export async function getProject(projectName) {
    assertLoggedIn();
    const raw = await (IS_LOCAL
        ? req('GET', `/project/${enc(projectName)}`, { wantsRaw: true })
        : req('GET', `/projects/${enc(state.username)}/${enc(projectName)}`, { wantsRaw: true }));
    return {
        projectXml: extractTag(raw, 'project'),
        mediaXml:   extractTag(raw, 'media') || '<media></media>',
    };
}

export async function saveProject(projectName, projectXml, mediaXml, notes = '') {
    assertLoggedIn();
    const body = { xml: projectXml, media: mediaXml, thumbnail: BLANK_PNG, notes, remixID: null };
    if (JSON.stringify(body).length > 10*1024*1024) throw new Error('Project exceeds 10 MB limit');
    return IS_LOCAL
        ? req('POST', `/project/${enc(projectName)}`, { body })
        : req('POST', `/projects/${enc(state.username)}/${enc(projectName)}`, { body });
}

// ── File type helpers ─────────────────────────────────────────────────────────
export const EXTS_IMG   = ['png','jpg','jpeg','gif','svg'];
export const EXTS_AUDIO = ['mp3','wav','ogg'];
export function fileExt(file)  { return file.name.split('.').pop().toLowerCase(); }
export function fileBase(file) { return file.name.replace(/\.[^.]+$/, ''); }

export async function detectXmlType(file) {
    const s = (await file.slice(0, 300).text()).trimStart();
    if (s.startsWith('<sprites'))               return 'sprite';
    if (s.startsWith('<blocks'))                return 'blocks';
    if (s.startsWith('<scripts'))               return 'scripts';   // Snap! script export wrapper
    if (s.startsWith('<script ') || s.startsWith('<script>')) return 'script';  // single script node
    if (s.startsWith('<block-definition'))      return 'blockdef';
    return 'unknown';
}

// project mode: only sprite/blocks xml
// sprite  mode: only img / audio / script xml (NO blocks)
export function isFileAccepted(file, selMode, xmlType = null) {
    const e = fileExt(file);
    if (selMode === 'projects') {
        if (e !== 'xml') return false;
        if (xmlType && !['sprite','blocks'].includes(xmlType)) return false;
        return true;
    }
    if (selMode === 'sprites') {
        if (EXTS_IMG.includes(e) || EXTS_AUDIO.includes(e)) return true;
        if (e === 'xml') {
            if (xmlType && !['script','scripts'].includes(xmlType)) return false;
            return true;
        }
    }
    return false;
}

export function getSpritesFromXml(projectXml) {
    const list = [{ name: 'Stage', type: 'stage' }];
    for (const m of projectXml.matchAll(/<sprite[^>]+name="([^"]+)"/g))
        list.push({ name: m[1], type: 'sprite' });
    return list;
}

// ── XML mutations ─────────────────────────────────────────────────────────────

export function importSpriteXml(projectXml, mediaXml, xmlString) {
    if (!xmlString.trimStart().startsWith('<sprites')) throw new Error('Expected <sprites>');
    const nodes    = extractAllTags(xmlString, 'sprite');
    if (!nodes.length) throw new Error('No <sprite> nodes found');
    const existing = xmlAttrAll(projectXml, 'sprite', 'name');
    const skipped  = [];
    let pxml = projectXml;
    for (let node of nodes) {
        const name = node.match(/name="([^"]+)"/)?.[1];
        if (name && existing.includes(name)) { skipped.push(name); continue; }
        if (name) existing.push(name);
        pxml = pxml.replace('</sprites>', node + '</sprites>');
    }
    const spMedia = extractTag(xmlString, 'media');
    if (spMedia) {
        const inner = spMedia.replace(/^<media[^>]*>/, '').replace(/<\/media>$/, '').trim();
        if (inner) mediaXml = mediaXml.replace('</media>', inner + '</media>');
    }
    return { projectXml: pxml, mediaXml, skipped };
}

export function importCustomBlocks(projectXml, mediaXml, xmlString) {
    if (!xmlString.trimStart().startsWith('<blocks')) throw new Error('Expected <blocks>');
    const existingNames = [...projectXml.matchAll(/<block-definition[^>]+s="([^"]+)"/g)].map(m => m[1]);
    const defs    = extractAllTags(xmlString, 'block-definition');
    const skipped = [];
    let toAdd     = '';
    if (defs.length) {
        for (const def of defs) {
            const name = def.match(/s="([^"]+)"/)?.[1] || def.match(/name="([^"]+)"/)?.[1];
            if (name && existingNames.includes(name)) { skipped.push(name); continue; }
            if (name) existingNames.push(name);
            toAdd += def;
        }
    } else {
        toAdd = xmlString.replace(/^<blocks[^>]*>/, '').replace(/<\/blocks>\s*$/, '').trim();
    }
    if (!toAdd) return { projectXml, mediaXml, skipped };
    if (!projectXml.includes('</blocks>')) throw new Error('</blocks> not found in project XML');
    return { projectXml: projectXml.replace('</blocks>', toAdd + '</blocks>'), mediaXml, skipped };
}

// ── Stage/Sprite asset injection ─────────────────────────────────────────────
//
// Snap! 11 XML structure (confirmed from real project XML):
//
//   <project>
//     <scenes><scene>
//       <blocks>...</blocks>          ← global custom blocks
//       <stage name="Stage" ...>
//         <costumes><list id="N">...</list></costumes>
//         <sounds><list id="N">...</list></sounds>
//         <scripts>...</scripts>
//         <sprites select="1">
//           <sprite name="Sprite1" ...>
//             <costumes><list id="N">...</list></costumes>
//             <sounds><list id="N">...</list></sounds>
//             <scripts><script x="N" y="N">...</script></scripts>
//           </sprite>
//         </sprites>
//       </stage>
//     </scene></scenes>
//   </project>
//
// Images/sounds are stored INLINE (base64 in the image/sound attribute).
// No separate <media> section in Snap! 11.
// Scripts are DIRECT children of <scripts> — never inside <list>.
// Empty lists may have struct="atomic": <list struct="atomic" id="N"></list>

/**
 * Find the start index of the target block in projectXml.
 * For 'Stage': finds <stage ...> (NOT a sprite)
 * For others:  finds <sprite name="NAME" ...>
 */
function findTargetStart(projectXml, targetName) {
    if (targetName === 'Stage') {
        const m = projectXml.match(/<stage[\s]/);
        if (!m) throw new Error('Stage not found in project XML');
        return projectXml.indexOf(m[0]);
    }
    const re = new RegExp(`<sprite[^>]+name="${escRe(targetName)}"[^>]*>`);
    const m  = projectXml.match(re);
    if (!m) throw new Error(`Sprite "${targetName}" not found in project XML`);
    return projectXml.indexOf(m[0]);
}

/**
 * Extract the outer tag name for the target ('stage' or 'sprite').
 */
function targetTag(targetName) {
    return targetName === 'Stage' ? 'stage' : 'sprite';
}

/**
 * Get existing asset names (costume/sound) for duplicate detection.
 */
function getAssetNames(projectXml, targetName, assetTag) {
    try {
        const start   = findTargetStart(projectXml, targetName);
        const tag     = targetTag(targetName);
        const blockXml = extractTag(projectXml.slice(start), tag);
        if (!blockXml) return [];
        return [...blockXml.matchAll(new RegExp(`<${assetTag}[^>]+name="([^"]+)"`, 'g'))].map(m => m[1]);
    } catch { return []; }
}

/**
 * Inject an asset <item> node into the <list> inside costumes/sounds of a target.
 * Works for both Stage (<stage>) and sprites (<sprite>).
 *
 * Uses the same approach as the working snap_headless.js:
 * - Extract sprite/stage block
 * - Extract section (costumes/sounds) within it
 * - Extract list within section
 * - String-replace list to inject item before </list>
 * - Reconstruct projectXml
 */
function injectAssetItem(projectXml, targetName, section, itemXml) {
    const start    = findTargetStart(projectXml, targetName);
    const tag      = targetTag(targetName);
    const blockXml = extractTag(projectXml.slice(start), tag);
    if (!blockXml) throw new Error(`Cannot extract <${tag}> for "${targetName}"`);

    const sectionXml = extractTag(blockXml, section);
    if (!sectionXml) throw new Error(`<${section}> not found in "${targetName}"`);

    const listXml = extractTag(sectionXml, 'list');
    if (!listXml) throw new Error(`<list> not found in <${section}> of "${targetName}"`);

    // Inject before </list>.
    // CRITICAL: Remove struct="atomic" if present — it marks an EMPTY list in Snap! 11.
    // Snap! ignores items inside a struct="atomic" list, so we must strip it.
    const cleanList  = listXml.replace(/\s*struct="atomic"/, '');
    const newList    = cleanList.replace('</list>', itemXml + '</list>');
    const newSection = sectionXml.replace(listXml, newList);
    const newBlock   = blockXml.replace(sectionXml, newSection);

    return projectXml.slice(0, start) + newBlock + projectXml.slice(start + blockXml.length);
}

export async function uploadImageToSprite(projectXml, mediaXml, targetName, file) {
    const { dataURL, name } = await readFile(file);
    const existing = getAssetNames(projectXml, targetName, 'costume');
    if (existing.includes(name))
        return { projectXml, mediaXml, skipped: name };
    const item = `<item><costume name="${xa(name)}" center-x="0" center-y="0" image="${xa(dataURL)}" id="${rndId()}"/></item>`;
    let newXml = injectAssetItem(projectXml, targetName, 'costumes', item);
    // Set the sprite/stage to display the newly added costume (1-based index)
    newXml = setActiveCostume(newXml, targetName, existing.length + 1);
    return { projectXml: newXml, mediaXml, skipped: null };
}

export async function uploadAudioToSprite(projectXml, mediaXml, targetName, file) {
    const { dataURL, name } = await readFile(file);
    if (getAssetNames(projectXml, targetName, 'sound').includes(name))
        return { projectXml, mediaXml, skipped: name };
    const item = `<item><sound name="${xa(name)}" sound="${xa(dataURL)}" id="${rndId()}"/></item>`;
    return { projectXml: injectAssetItem(projectXml, targetName, 'sounds', item), mediaXml, skipped: null };
}

/**
 * Import a <script> or <scripts> into a sprite/stage.
 * Snap! 11: scripts are DIRECT children of <scripts>, never inside <list>.
 * Each <script> MUST have x and y numeric attributes.
 */
export function importScriptXml(projectXml, mediaXml, targetName, xmlString) {
    const trimmed = xmlString.trimStart();
    const isScriptsContainer = trimmed.startsWith('<scripts');
    const isScriptFile = trimmed.startsWith('<script ') || trimmed.startsWith('<script>');
    if (!isScriptsContainer && !isScriptFile)
        throw new Error('Expected <script> or <scripts>');

    // Extract the script nodes to inject
    let nodesToInject;
    if (isScriptsContainer) {
        // <scripts>...</scripts> container — strip outer wrapper, inject inner content
        nodesToInject = trimmed.replace(/^<scripts[^>]*>/, '').replace(/<\/scripts>\s*$/, '').trim();
        if (!nodesToInject) return { projectXml, mediaXml };
    } else {
        // Single <script> node.
        // Snap! 11 exports scripts wrapped in an outer: <script app="Snap!..." version="2">
        //   <script>...</script>
        // </script>
        // We must strip the outer wrapper and inject only the inner <script> node(s).
        let node = trimmed.trimEnd();
        if (/^<script[^>]+app=/.test(node)) {
            // It's a file-export wrapper — extract the inner content
            node = node.replace(/^<script[^>]*>/, '').replace(/<\/script>\s*$/, '').trim();
            if (!node) return { projectXml, mediaXml };
        }
        // Ensure x/y coordinates exist on each top-level <script> tag
        node = node.replace(/^(<script(?![^>]*\bx=")[^>]*>)/m,
                            (m) => m.replace('<script', '<script x="10"'));
        node = node.replace(/^(<script(?![^>]*\by=")[^>]*>)/m,
                            (m) => m.replace('<script', '<script y="10"'));
        nodesToInject = node;
    }

    const start    = findTargetStart(projectXml, targetName);
    const tag      = targetTag(targetName);
    const blockXml = extractTag(projectXml.slice(start), tag);
    if (!blockXml) throw new Error(`Cannot extract <${tag}> for "${targetName}"`);

    const scriptsXml = extractTag(blockXml, 'scripts');
    let newBlock;
    if (scriptsXml) {
        // Insert before </scripts>
        const newScripts = scriptsXml.replace('</scripts>', nodesToInject + '</scripts>');
        newBlock = blockXml.replace(scriptsXml, newScripts);
    } else {
        newBlock = blockXml.replace(`</${tag}>`, `<scripts>${nodesToInject}</scripts></${tag}>`);
    }

    return {
        projectXml: projectXml.slice(0, start) + newBlock + projectXml.slice(start + blockXml.length),
        mediaXml,
    };
}

/**
 * Update the costume="N" attribute on a sprite/stage tag so the newly added
 * costume becomes the active (displayed) one immediately.
 * N is 1-based: costume="1" = first costume, costume="0" = none.
 */
function setActiveCostume(projectXml, targetName, costumeIndex) {
    // Update costume="N" attribute on the sprite/stage opening tag
    if (targetName === 'Stage') {
        return projectXml.replace(
            /(<stage[^>]+costume=")(\d+)(")/,
            `$1${costumeIndex}$3`
        );
    }
    // For sprites: find the specific sprite's opening tag and update its costume attr
    const spriteTagRe = new RegExp(`(<sprite[^>]+name="${escRe(targetName)}"[^>]*costume=")(\d+)(")`);
    return projectXml.replace(spriteTagRe, `$1${costumeIndex}$3`);
}

// ── XML helpers ───────────────────────────────────────────────────────────────

/**
 * Extract the first complete occurrence of <tag ...>...</tag> from xml.
 * Handles nesting and self-closing tags.
 */
export function extractTag(xml, tag) {
    if (!xml) return null;
    // Match opening tag (with attributes or self-closing)
    const startIdx = xml.search(new RegExp(`<${tag}(\\s|>|/)`));
    if (startIdx === -1) return null;
    let depth = 0, i = startIdx;
    while (i < xml.length) {
        if (xml[i] !== '<') { i++; continue; }
        // Closing tag </tag>
        if (xml.startsWith(`</${tag}>`, i)) {
            depth--;
            if (depth === 0) return xml.slice(startIdx, i + tag.length + 3);
            i++;
            continue;
        }
        // Opening tag <tag or <tagName (must be exact tag name)
        if (xml.startsWith(`<${tag}`, i)) {
            const afterTag = xml[i + tag.length + 1] ?? '';
            if (/[\s>/]/.test(afterTag)) {
                // Self-closing?
                const closeAngle = xml.indexOf('>', i);
                if (closeAngle === -1) { i++; continue; }
                if (xml[closeAngle - 1] === '/') {
                    if (depth === 0) return xml.slice(i, closeAngle + 1);
                    // self-closing nested — ignore, don't change depth
                    i = closeAngle + 1;
                    continue;
                }
                depth++;
            }
        }
        i++;
    }
    return null;
}

function extractAllTags(xml, tag) {
    const out = []; let rem = xml;
    for (;;) {
        const c = extractTag(rem, tag);
        if (!c) break;
        out.push(c);
        rem = rem.slice(rem.indexOf(c) + c.length);
    }
    return out;
}

function xmlAttrAll(xml, tag, attr) {
    return [...xml.matchAll(new RegExp(`<${tag}[^>]+${attr}="([^"]+)"`, 'g'))].map(m => m[1]);
}

// ── Utilities ─────────────────────────────────────────────────────────────────

async function readFile(file) {
    const dataURL = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.onerror = rej;
        r.readAsDataURL(file);
    });
    return { dataURL, name: file.name.replace(/\.[^.]+$/, '') };
}

async function sha512(str) {
    const buf = new TextEncoder().encode(str);
    const h   = await crypto.subtle.digest('SHA-512', buf);
    return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2,'0')).join('');
}

function enc(s)   { return encodeURIComponent(s); }
function xa(s)    { return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }
function rndId()  { return String(Math.floor(Math.random()*9e6+1e6)); }
function assertLoggedIn() { if (!state.username) throw new Error('Not logged in'); }

export const VERSION = '5';

/**
 * Download the modified projectXml as a local .xml file (wrapped in snapdata)
 * so the user can load it directly in Snap! for testing.
 */
export function downloadProjectXml(projectName, projectXml, mediaXml) {
    const snapdata = `<snapdata>${projectXml}${mediaXml}</snapdata>`;
    const blob = new Blob([snapdata], { type: 'application/xml' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `${projectName}_modified.xml`;
    a.click();
    URL.revokeObjectURL(url);
}
 // bump when snap-api.js changes
const BLANK_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
