/**
 * snap-api.js — Browser API layer
 *
 * In locale   : chiama /snap-api/* sul proxy Node (che fa le richieste reali
 *               a Snap! server-side, esattamente come login2.js)
 * In produzione: chiama corsproxy.io → snap.berkeley.edu direttamente
 *
 * Il sessionId (locale) viene passato come header x-session-id su ogni
 * richiesta al proxy, così Node mantiene il proprio cookie jar per sessione.
 */

const IS_LOCAL = location.hostname === 'localhost' || location.hostname === '127.0.0.1';

export const state = {
    username  : null,
    sessionId : null,   // solo in locale: id del jar Node
    cookie    : null,   // solo in produzione: cookie Snap! manuale
};

// ─── Low-level request ────────────────────────────────────────────────────────
async function req(method, path, { body, wantsRaw = false } = {}) {
    let url, headers = { 'Content-Type': 'application/json; charset=utf-8' };

    if (IS_LOCAL) {
        // Chiama il bridge Node — nessun problema CORS, nessun cookie browser
        url = `/snap-api${path}`;
        if (state.sessionId) headers['x-session-id'] = state.sessionId;
    } else {
        // Produzione: chiama direttamente Snap! attraverso corsproxy.io
        url = `https://corsproxy.io/?https://snap.berkeley.edu/api/v1${path}`;
        if (state.cookie) {
            headers['Cookie'] = state.cookie;
            headers['x-requested-with'] = 'XMLHttpRequest';
        }
    }

    const res = await fetch(url, {
        method,
        headers,
        credentials: IS_LOCAL ? 'same-origin' : 'omit',
        body: body !== undefined
            ? (typeof body === 'string' ? body : JSON.stringify(body))
            : undefined,
    });

    // In produzione: salva cookie manualmente
    if (!IS_LOCAL) {
        const sc = res.headers.get('set-cookie');
        if (sc) state.cookie = sc.split(';')[0];
    }

    // Leggi sessionId dal bridge locale
    if (IS_LOCAL) {
        const sid = res.headers.get('x-session-id');
        if (sid) state.sessionId = sid;
    }

    const text = await res.text();
    if (!text) throw new Error(`Empty response ${method} ${path}`);

    if (!wantsRaw || text.startsWith('{"errors"') || text.startsWith('{"error"')) {
        let json;
        try { json = JSON.parse(text); } catch { throw new Error(text); }
        if (json.errors) throw new Error(json.errors[0]);
        if (json.error)  throw new Error(json.error);
        return json.message !== undefined ? json.message : json;
    }
    return text;
}

// ─── 1. LOGIN ─────────────────────────────────────────────────────────────────
/**
 * Locale   : POST /snap-api/login  { username, password }
 *            → Node fa sha512 + chiamata reale (come login2.js)
 * Produzione: POST diretto a Snap! con sha512 browser
 */
export async function login(username, password) {
    if (IS_LOCAL) {
        // Il proxy Node gestisce tutto — password in chiaro, ci pensa Node a fare sha512
        const result = await req('POST', '/login', { body: { username, password } });
        state.username  = result.username;
        state.sessionId = result.sessionId;
        return result.username;
    } else {
        // Produzione: sha512 nel browser, chiamata diretta
        const hashed = await sha512(password);
        await req('POST',
            `/users/${encodeURIComponent(username.toLowerCase())}/login?persist=true`,
            { body: hashed }
        );
        const user = await req('GET', '/users/c');
        state.username = user.username;
        return user.username;
    }
}

// ─── 2. GET PROJECT LIST ──────────────────────────────────────────────────────
/**
 * cloud.js → Cloud.prototype.getProjectList()
 * GET /projects/{username}?updatingnotes=true
 */
export async function getProjectList() {
    assertLoggedIn();
    if (IS_LOCAL) {
        return req('GET', '/projects');
    } else {
        return req('GET', `/users/${enc(state.username)}/projects?updatingnotes=true`);
    }
}

// ─── 3. GET PROJECT ───────────────────────────────────────────────────────────
/**
 * cloud.js → Cloud.prototype.getProject()
 * GET /projects/{username}/{name}  → raw XML
 */
export async function getProject(projectName) {
    assertLoggedIn();
    let raw;
    if (IS_LOCAL) {
        raw = await req('GET', `/project/${enc(projectName)}`, { wantsRaw: true });
    } else {
        raw = await req('GET',
            `/projects/${enc(state.username)}/${enc(projectName)}`,
            { wantsRaw: true }
        );
    }
    return {
        projectXml : extractTag(raw, 'project'),
        mediaXml   : extractTag(raw, 'media') || '<media></media>',
        raw,
    };
}

// ─── 4. SAVE PROJECT ──────────────────────────────────────────────────────────
/**
 * cloud.js → Cloud.prototype.saveProject()
 * POST /projects/{username}/{name}  body: { xml, media, thumbnail, notes, remixID }
 */
export async function saveProject(projectName, projectXml, mediaXml, notes = '') {
    assertLoggedIn();
    const body = {
        xml      : projectXml,
        media    : mediaXml,
        thumbnail: BLANK_THUMBNAIL,
        notes,
        remixID  : null,
    };
    const size = JSON.stringify(body).length;
    if (size > 10 * 1024 * 1024) throw new Error(`Project too large: ${Math.round(size/1024)} KB`);

    if (IS_LOCAL) {
        return req('POST', `/project/${enc(projectName)}`, { body });
    } else {
        return req('POST',
            `/projects/${enc(state.username)}/${enc(projectName)}`,
            { body }
        );
    }
}

// ─── 5. GET SPRITES FROM XML ──────────────────────────────────────────────────
export function getSpritesFromXml(projectXml) {
    const names = [{ name: 'Stage', type: 'stage' }];
    for (const m of projectXml.matchAll(/<sprite[^>]+name="([^"]+)"/g)) {
        names.push({ name: m[1], type: 'sprite' });
    }
    return names;
}

// ─── 6. ADD SPRITE ────────────────────────────────────────────────────────────
export function addNewSprite(projectXml, spriteName = 'Sprite') {
    const existing = [...projectXml.matchAll(/<sprite[^>]+name="([^"]+)"/g)].map(m => m[1]);
    const name     = uniqueName(spriteName, existing);
    const xml =
        `<sprite name="${esc(name)}" idx="${existing.length + 1}" ` +
        `x="0" y="0" heading="90" scale="1" volume="100" pan="0" ` +
        `rotation="1" draggable="true" costume="0" color="80,80,80,1" ` +
        `pen="tip" id="${rndId()}">` +
        `<costumes><list id="${rndId()}"></list></costumes>` +
        `<sounds><list id="${rndId()}"></list></sounds>` +
        `<blocks></blocks><variables></variables><scripts></scripts>` +
        `</sprite>`;
    if (!projectXml.includes('</sprites>')) throw new Error('</sprites> not found');
    return { projectXml: projectXml.replace('</sprites>', xml + '</sprites>'), spriteName: name };
}

// ─── 7. UPLOAD IMAGE ──────────────────────────────────────────────────────────
export async function uploadImageToSprite(projectXml, mediaXml, spriteName, file) {
    const { dataURL, name } = await fileToDataURL(file);
    const cosXml = `<item><costume name="${esc(name)}" center-x="0" center-y="0" image="${esc(dataURL)}" id="${rndId()}"/></item>`;
    return { projectXml: injectIntoSprite(projectXml, spriteName, 'costumes', cosXml), mediaXml };
}

// ─── 8. UPLOAD AUDIO ──────────────────────────────────────────────────────────
export async function uploadAudioToSprite(projectXml, mediaXml, spriteName, file) {
    const { dataURL, name } = await fileToDataURL(file);
    const sndXml = `<item><sound name="${esc(name)}" sound="${esc(dataURL)}" id="${rndId()}"/></item>`;
    return { projectXml: injectIntoSprite(projectXml, spriteName, 'sounds', sndXml), mediaXml };
}

// ─── 9. CUSTOM BLOCKS ─────────────────────────────────────────────────────────
export function uploadCustomBlocks(projectXml, mediaXml, xmlString) {
    if (!xmlString.trim().startsWith('<blocks')) throw new Error('Expected <blocks…>');
    const inner = xmlString.replace(/^<blocks[^>]*>/, '').replace(/<\/blocks>\s*$/, '').trim();
    if (!inner) return { projectXml, mediaXml };
    if (!projectXml.includes('</blocks>')) throw new Error('</blocks> not found');
    return { projectXml: projectXml.replace('</blocks>', inner + '</blocks>'), mediaXml };
}

// ─── 10. IMPORT SPRITE XML ────────────────────────────────────────────────────
export function importSpriteXml(projectXml, mediaXml, xmlString) {
    if (!xmlString.trim().startsWith('<sprites')) throw new Error('Expected <sprites…>');
    const nodes    = extractAllTags(xmlString, 'sprite');
    if (!nodes.length) throw new Error('No <sprite> nodes found');
    const existing = [...projectXml.matchAll(/<sprite[^>]+name="([^"]+)"/g)].map(m => m[1]);
    let mod = projectXml;
    for (let node of nodes) {
        const m = node.match(/name="([^"]+)"/);
        if (m) {
            const safe = uniqueName(m[1], existing);
            if (safe !== m[1]) node = node.replace(`name="${m[1]}"`, `name="${safe}"`);
            existing.push(safe);
        }
        mod = mod.replace('</sprites>', node + '</sprites>');
    }
    let modMedia = mediaXml;
    const spMedia = extractTag(xmlString, 'media');
    if (spMedia) {
        const inner = spMedia.replace(/^<media[^>]*>/, '').replace(/<\/media>$/, '').trim();
        if (inner) modMedia = modMedia.replace('</media>', inner + '</media>');
    }
    return { projectXml: mod, mediaXml: modMedia };
}

// ─── XML helpers ──────────────────────────────────────────────────────────────
export function extractTag(xml, tag) {
    const re    = new RegExp(`<${tag}[\\s>]`);
    const start = xml ? xml.search(re) : -1;
    if (start === -1) return null;
    let depth = 0, i = start;
    while (i < xml.length) {
        if (xml[i] === '<') {
            if (xml.startsWith(`</${tag}>`, i)) {
                if (depth === 1) return xml.slice(start, i + tag.length + 3);
                depth--;
            } else if (xml.startsWith(`<${tag}`, i) && /[\s>]/.test(xml[i + tag.length + 1] || '')) {
                const ca = xml.indexOf('>', i);
                if (xml[ca - 1] === '/') { if (depth === 0) return xml.slice(i, ca + 1); }
                else depth++;
            }
        }
        i++;
    }
    return null;
}

function extractAllTags(xml, tag) {
    const results = []; let rem = xml;
    while (true) { const c = extractTag(rem, tag); if (!c) break; results.push(c); rem = rem.slice(rem.indexOf(c) + c.length); }
    return results;
}

function injectIntoSprite(projectXml, spriteName, section, xml) {
    const re = new RegExp(`<sprite[^>]+name="${escRe(spriteName)}"[^>]*>`);
    const m  = projectXml.match(re);
    if (!m) throw new Error(`Sprite "${spriteName}" not found`);
    const start     = projectXml.indexOf(m[0]);
    const spriteXml = extractTag(projectXml.slice(start), 'sprite');
    if (!spriteXml) throw new Error(`Cannot extract sprite "${spriteName}"`);
    const secXml  = extractTag(spriteXml, section);
    if (!secXml)   throw new Error(`<${section}> not found in "${spriteName}"`);
    const listXml = extractTag(secXml, 'list');
    if (!listXml)  throw new Error(`<list> not found in <${section}>`);
    const newSpr = spriteXml.replace(secXml, secXml.replace(listXml, listXml.replace('</list>', xml + '</list>')));
    return projectXml.slice(0, start) + newSpr + projectXml.slice(start + spriteXml.length);
}

// ─── Misc helpers ─────────────────────────────────────────────────────────────
async function fileToDataURL(file) {
    const dataURL = await new Promise((res, rej) => {
        const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file);
    });
    return { dataURL, name: file.name.replace(/\.[^.]+$/, '') };
}

async function sha512(str) {
    const buf  = new TextEncoder().encode(str);
    const hash = await crypto.subtle.digest('SHA-512', buf);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function enc(s)   { return encodeURIComponent(s); }
function esc(s)   { return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function rndId()  { return Math.floor(Math.random() * 9e6 + 1e6).toString(); }
function assertLoggedIn() { if (!state.username) throw new Error('Not logged in'); }
function uniqueName(base, existing) {
    if (!existing.includes(base)) return base;
    let i = 2; while (existing.includes(`${base} (${i})`)) i++; return `${base} (${i})`;
}

const BLANK_THUMBNAIL =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ' +
    'AAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
