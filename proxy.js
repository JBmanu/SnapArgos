/**
 * proxy.js — Development server + API bridge
 *
 * Invece di fare da semplice proxy HTTP (con tutti i problemi di cookie/CORS),
 * questo server esegue le chiamate a Snap! DIRETTAMENTE in Node.js,
 * esattamente come fa snap_headless.js (login2.js) che funziona.
 *
 * Il browser chiama localhost:3000/snap-api/* → Node fa la chiamata reale
 * a snap.berkeley.edu e restituisce la risposta. Nessun problema di cookie,
 * SameSite, Secure o CORS perché è Node → Snap!, non browser → Snap!.
 */

'use strict';

const express  = require('express');
const fetch    = require('node-fetch');
const crypto   = require('crypto');
const cors     = require('cors');
const path     = require('path');

const PORT      = 3000;
const SNAP_BASE = 'https://snap.berkeley.edu/api/v1';
const app       = express();

app.use(cors({ origin: 'http://localhost:3000', credentials: true }));
app.use(express.json({ limit: '20mb' }));
app.use(express.text({ limit: '20mb' }));
app.use(express.static(path.join(__dirname)));

// ─── Cookie jar per sessione Node ────────────────────────────────────────────
// Ogni sessione browser ha il proprio jar identificato da un sessionId
const sessions = new Map(); // sessionId → { cookies: {}, username: null }

function getJar(sessionId) {
    if (!sessions.has(sessionId)) sessions.set(sessionId, { cookies: {}, username: null });
    return sessions.get(sessionId);
}

function ingestCookies(jar, setCookieHeader) {
    if (!setCookieHeader) return;
    const headers = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
    for (const h of headers) {
        const [pair] = h.split(';');
        const eq = pair.indexOf('=');
        if (eq === -1) continue;
        const name = pair.slice(0, eq).trim();
        const val  = pair.slice(eq + 1).trim();
        jar.cookies[name] = val;
    }
}

function cookieHeader(jar) {
    return Object.entries(jar.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
}

// ─── Helper: chiama Snap! da Node (come login2.js) ───────────────────────────
async function snapRequest(jar, method, apiPath, { body, wantsRaw = false } = {}) {
    const url = SNAP_BASE + apiPath;
    const headers = {
        'Content-Type': 'application/json; charset=utf-8',
        'Cookie':        cookieHeader(jar),
        'Origin':        'https://snap.berkeley.edu',
        'Referer':       'https://snap.berkeley.edu/',
    };

    const res = await fetch(url, {
        method,
        headers,
        body: body !== undefined
            ? (typeof body === 'string' ? body : JSON.stringify(body))
            : undefined,
    });

    // Salva i cookie ricevuti nel jar Node
    const sc = res.headers.raw()['set-cookie'];
    if (sc) ingestCookies(jar, sc);

    const text = await res.text();
    if (!text) throw new Error(`Empty response from ${method} ${apiPath}`);

    if (!wantsRaw || text.startsWith('{"errors"')) {
        let json;
        try { json = JSON.parse(text); } catch { throw new Error(text); }
        if (json.errors) throw new Error(json.errors[0]);
        return json.message !== undefined ? json.message : json;
    }
    return text;
}

function sha512(str) {
    return crypto.createHash('sha512').update(str).digest('hex');
}

// ─── Middleware: legge/crea sessionId dal cookie del browser ─────────────────
app.use('/snap-api', (req, res, next) => {
    let sid = req.headers['x-session-id'] || req.query._sid;
    if (!sid) {
        sid = crypto.randomUUID();
    }
    req.sid = sid;
    res.setHeader('x-session-id', sid);
    next();
});

// ─── POST /snap-api/login ─────────────────────────────────────────────────────
// Body JSON: { username, password }  (password in chiaro, hashing fatto qui)
app.post('/snap-api/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });

    const jar = getJar(req.sid);
    try {
        // Esattamente come login2.js: POST con hash SHA-512 come body raw
        await snapRequest(jar, 'POST',
            `/users/${encodeURIComponent(username.toLowerCase())}/login?persist=true`,
            { body: sha512(password), wantsRaw: false }
        );
        // Verifica sessione → GET /users/c
        const user = await snapRequest(jar, 'GET', '/users/c');
        jar.username = user.username;
        console.log(`[snap-api] login OK → ${user.username}  (sid: ${req.sid.slice(0,8)})`);
        res.json({ username: user.username, sessionId: req.sid });
    } catch(e) {
        console.error('[snap-api] login error:', e.message);
        res.status(401).json({ error: e.message });
    }
});

// ─── GET /snap-api/projects ───────────────────────────────────────────────────
// Restituisce la lista progetti dell'utente loggato
app.get('/snap-api/projects', async (req, res) => {
    const jar = getJar(req.sid);
    if (!jar.username) return res.status(401).json({ error: 'Not logged in' });

    try {
        // cloud.js → getProjectList(): GET /projects/%username?updatingnotes=true
        const list = await snapRequest(jar, 'GET',
            `/projects/${encodeURIComponent(jar.username)}?updatingnotes=true`
        );
        const arr = Array.isArray(list) ? list : (list && list.projects ? list.projects : []);
        console.log(`[snap-api] projects → ${arr.length} items (sid: ${req.sid.slice(0,8)})`);
        res.json(arr);
    } catch(e) {
        console.error('[snap-api] projects error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// ─── GET /snap-api/project/:name ─────────────────────────────────────────────
// Restituisce il raw XML del progetto
app.get('/snap-api/project/:name', async (req, res) => {
    const jar = getJar(req.sid);
    if (!jar.username) return res.status(401).json({ error: 'Not logged in' });

    try {
        // cloud.js → getProject(): GET /projects/{username}/{name}  wantsRaw=true
        const xml = await snapRequest(jar, 'GET',
            `/projects/${encodeURIComponent(jar.username)}/${encodeURIComponent(req.params.name)}`,
            { wantsRaw: true }
        );
        res.setHeader('Content-Type', 'application/xml');
        res.send(xml);
    } catch(e) {
        console.error('[snap-api] project error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// ─── POST /snap-api/project/:name ────────────────────────────────────────────
// Salva il progetto — body JSON: { xml, media, thumbnail, notes, remixID }
app.post('/snap-api/project/:name', async (req, res) => {
    const jar = getJar(req.sid);
    if (!jar.username) return res.status(401).json({ error: 'Not logged in' });

    try {
        // cloud.js → saveProject(): POST /projects/{username}/{name}
        const body = req.body;
        // Debug: log what we're saving
        const strip = s => s ? s.replace(/(image|sound)="data:[^"]{0,60}[^"]*"/g, '$1="data:...[BASE64,len="+s.match(/(image|sound)="(data:[^"]*)"/)?.[2]?.length+"]"') : null;
        const xmlSnippet = body.xml ? body.xml.slice(0, 300) : 'NO XML';
        const costumeCount = (body.xml || '').match(/<costume/g)?.length || 0;
        const soundCount   = (body.xml || '').match(/<sound[^s]/g)?.length || 0;
        console.log(`[snap-api] SAVING "${req.params.name}": xml=${body.xml?.length}B media=${body.media?.length}B costumes=${costumeCount} sounds=${soundCount}`);
        console.log(`[snap-api] XML start: ${xmlSnippet.replace(/\n/g,' ')}`);
        const result = await snapRequest(jar, 'POST',
            `/projects/${encodeURIComponent(jar.username)}/${encodeURIComponent(req.params.name)}`,
            { body }
        );
        console.log(`[snap-api] saved "${req.params.name}" OK (sid: ${req.sid.slice(0,8)})`);
        res.json({ ok: true, message: result });
    } catch(e) {
        console.error('[snap-api] save error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// ─── DEBUG: show raw + parsed XML ────────────────────────────────────────────
app.get('/snap-api/debug-project/:name', async (req, res) => {
    const jar = getJar(req.sid);
    if (!jar.username) return res.status(401).json({ error: 'Not logged in' });
    try {
        const raw = await snapRequest(jar, 'GET',
            `/projects/${encodeURIComponent(jar.username)}/${encodeURIComponent(req.params.name)}`,
            { wantsRaw: true }
        );
        // Parse like snap-api.js does
        const extractTag = (xml, tag) => {
            const start = xml.search(new RegExp(`<${tag}[\\s>/]`));
            if (start === -1) return null;
            let depth = 0, i = start;
            while (i < xml.length) {
                if (xml[i] === '<') {
                    if (xml.startsWith(`</${tag}>`, i)) { if (--depth === 0) return xml.slice(start, i+tag.length+3); }
                    else if (xml.startsWith(`<${tag}`, i) && /[\s>/]/.test(xml[i+tag.length+1]||'')) {
                        const ca = xml.indexOf('>', i);
                        if (xml[ca-1] === '/') { if (depth===0) return xml.slice(i,ca+1); }
                        else depth++;
                    }
                }
                i++;
            }
            return null;
        };
        const projectXml = extractTag(raw, 'project');
        const mediaXml   = extractTag(raw, 'media');
        
        // Strip base64 for readability
        const strip = s => s ? s.replace(/(image|sound|pentrails|thumbnail)="data:[^"]{0,80}[^"]*"/g, '$1="data:...[BASE64]..."') : null;
        
        res.json({
            rawLength: raw.length,
            rawStart: raw.slice(0, 200),
            hasSnapdata: raw.includes('<snapdata'),
            hasMedia: raw.includes('<media'),
            hasProject: raw.includes('<project'),
            projectXmlLength: projectXml ? projectXml.length : 0,
            mediaXmlLength: mediaXml ? mediaXml.length : 0,
            projectXmlStart: strip(projectXml ? projectXml.slice(0, 500) : null),
            mediaXmlFull: strip(mediaXml),
            spriteNames: [...raw.matchAll(/<sprite[^>]+name="([^"]+)"/g)].map(m=>m[1]),
            stageStart: raw.slice(raw.search(/<stage[\s]/), raw.search(/<stage[\s]/)+300).replace(/(image|pentrails)="data:[^"]{0,30}[^"]*"/g,'$1="..."'),
        });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

app.listen(PORT, () => {
    console.log(`\n  ✦ Snap! Uploader  →  http://localhost:${PORT}`);
    console.log(`  ✦ API bridge      →  /snap-api/* → ${SNAP_BASE}\n`);
});

// ─── DEBUG: dump costumes+sounds per sprite ────────────────────────────────────
app.get('/snap-api/debug-assets/:name', async (req, res) => {
    const jar = getJar(req.sid);
    if (!jar.username) return res.status(401).json({ error: 'Not logged in' });
    try {
        const raw = await snapRequest(jar, 'GET',
            `/projects/${encodeURIComponent(jar.username)}/${encodeURIComponent(req.params.name)}`,
            { wantsRaw: true }
        );

        // Inline versions of parsing helpers
        function exTag(xml, tag) {
            if (!xml) return null;
            const startIdx = xml.search(new RegExp(`<${tag}(\\s|>|/)`));
            if (startIdx === -1) return null;
            let depth = 0, i = startIdx;
            while (i < xml.length) {
                const next = xml.indexOf('<', i);
                if (next === -1) break;
                i = next;
                if (xml.startsWith(`</${tag}>`, i)) {
                    depth--;
                    if (depth === 0) return xml.slice(startIdx, i + tag.length + 3);
                    i++; continue;
                }
                if (xml.startsWith(`<${tag}`, i)) {
                    const afterTag = xml[i + tag.length + 1] ?? '';
                    if (/[\s>/]/.test(afterTag)) {
                        let j = i + 1, inQ = null;
                        while (j < xml.length) {
                            const c = xml[j];
                            if (inQ) {
                                const ci = xml.indexOf(inQ, j + 1);
                                if (ci === -1) { j = xml.length; break; }
                                j = ci + 1; inQ = null; continue;
                            }
                            if (c === '"' || c === "'") { inQ = c; j++; continue; }
                            if (c === '>') break;
                            j++;
                        }
                        if (j >= xml.length) { i++; continue; }
                        if (xml[j - 1] === '/') { if (depth === 0) return xml.slice(i, j + 1); i = j + 1; continue; }
                        depth++;
                        i = j + 1; continue;
                    }
                }
                i++;
            }
            return null;
        }

        function exAllAttrs(xml, tagName) {
            const results = [];
            const re = new RegExp(`<${tagName}[\\s>]`, 'g');
            let m;
            while ((m = re.exec(xml)) !== null) {
                let start = m.index, i = start + tagName.length + 1, inQ = null;
                // Find end of opening tag using indexOf for quoted values
                while (i < xml.length) {
                    const c = xml[i];
                    if (inQ) {
                        const ci = xml.indexOf(inQ, i + 1);
                        if (ci === -1) { i = xml.length; break; }
                        i = ci + 1; inQ = null; continue;
                    }
                    if (c === '"' || c === "'") { inQ = c; i++; continue; }
                    if (c === '>') break;
                    i++;
                }
                const tagStr = xml.slice(start, i + 1);
                // Parse attributes using indexOf-based approach (safe with huge values)
                const attrs = {};
                let p = tagStr.indexOf(' ');
                if (p === -1) { results.push(attrs); re.lastIndex = i + 1; continue; }
                while (p < tagStr.length) {
                    while (p < tagStr.length && /\s/.test(tagStr[p])) p++;
                    if (tagStr[p] === '>' || tagStr[p] === '/' || p >= tagStr.length) break;
                    let ns = p;
                    while (p < tagStr.length && tagStr[p] !== '=' && tagStr[p] !== '>' && !/\s/.test(tagStr[p])) p++;
                    const aName = tagStr.slice(ns, p).trim();
                    if (!aName) { p++; continue; }
                    while (p < tagStr.length && /\s/.test(tagStr[p])) p++;
                    if (tagStr[p] !== '=') { attrs[aName] = ''; continue; }
                    p++; // skip '='
                    while (p < tagStr.length && /\s/.test(tagStr[p])) p++;
                    if (tagStr[p] === '"' || tagStr[p] === "'") {
                        const q = tagStr[p++];
                        const ci = tagStr.indexOf(q, p);
                        if (ci === -1) break;
                        attrs[aName] = tagStr.slice(p, ci);
                        p = ci + 1;
                    } else {
                        let vs = p;
                        while (p < tagStr.length && !/[\s>]/.test(tagStr[p])) p++;
                        attrs[aName] = tagStr.slice(vs, p);
                    }
                }
                results.push(attrs);
                re.lastIndex = i + 1;
            }
            return results;
        }

        const projectXml = exTag(raw, 'project');
        const mediaXml = exTag(raw, 'media');

        // Build media map
        const mediaMap = {};
        const mediaCostumes = [];
        const mediaSounds = [];
        if (mediaXml) {
            for (const a of exAllAttrs(mediaXml, 'costume')) {
                const entry = { name: a.name, id: a.id, hasImage: !!a.image, allAttrs: Object.keys(a) };
                if (a.id) mediaMap[a.id] = { type: 'image', hasData: !!a.image, name: a.name };
                mediaCostumes.push(entry);
            }
            for (const a of exAllAttrs(mediaXml, 'sound')) {
                const entry = { name: a.name, id: a.id, hasSound: !!a.sound, allAttrs: Object.keys(a) };
                if (a.id) mediaMap[a.id] = { type: 'audio', hasData: !!a.sound, name: a.name };
                mediaSounds.push(entry);
            }
        }

        // Collect sprites and stages
        const targets = [];
        // stage
        const stageBlock = exTag(projectXml, 'stage');
        if (stageBlock) {
            const spritesIdx = stageBlock.indexOf('<sprites');
            const stageOnly = spritesIdx !== -1 ? stageBlock.slice(0, spritesIdx) + '</stage>' : stageBlock;
            const stageName = stageBlock.match(/name="([^"]+)"/)?.[1] || 'Stage';
            const cXml = exTag(stageOnly, 'costumes');
            const sXml = exTag(stageOnly, 'sounds');
            targets.push({
                type: 'stage', name: stageName,
                costumes: (exAllAttrs(cXml || '', 'costume')).map(a => ({
                    name: a.name, hasImage: !!a.image, mediaID: a.mediaID, id: a.id,
                    allAttrs: Object.keys(a),
                    resolvedInMedia: !!(a.mediaID && mediaMap[a.mediaID]) || !!(a.id && mediaMap[a.id])
                })),
                sounds: (exAllAttrs(sXml || '', 'sound')).map(a => ({
                    name: a.name, hasSound: !!a.sound, mediaID: a.mediaID, id: a.id,
                    allAttrs: Object.keys(a),
                    resolvedInMedia: !!(a.mediaID && mediaMap[a.mediaID]) || !!(a.id && mediaMap[a.id])
                })),
                rawCostumeTag: cXml ? cXml.replace(/(image|pentrails)="data:[^"]{0,30}[^"]*"/g, '$1="..."').slice(0, 400) : null,
            });
        }
        // sprites
        for (const sm of (projectXml || '').matchAll(/<sprite\s[^>]*>/g)) {
            const spName = sm[0].match(/name="([^"]+)"/)?.[1];
            if (!spName) continue;
            const start = projectXml.indexOf(sm[0]);
            const block = exTag(projectXml.slice(start), 'sprite');
            const cXml = block ? exTag(block, 'costumes') : null;
            const sXml = block ? exTag(block, 'sounds') : null;
            targets.push({
                type: 'sprite', name: spName,
                costumes: (exAllAttrs(cXml || '', 'costume')).map(a => ({
                    name: a.name, hasImage: !!a.image, mediaID: a.mediaID, id: a.id,
                    allAttrs: Object.keys(a),
                    resolvedInMedia: !!(a.mediaID && mediaMap[a.mediaID]) || !!(a.id && mediaMap[a.id])
                })),
                sounds: (exAllAttrs(sXml || '', 'sound')).map(a => ({
                    name: a.name, hasSound: !!a.sound, mediaID: a.mediaID, id: a.id,
                    allAttrs: Object.keys(a),
                    resolvedInMedia: !!(a.mediaID && mediaMap[a.mediaID]) || !!(a.id && mediaMap[a.id])
                })),
                rawCostumesPreview: cXml ? cXml.replace(/(image|pentrails)="data:[^"]{0,30}[^"]*"/g, '$1="..."').slice(0, 400) : null,
            });
        }

        res.json({
            rawLength: raw.length,
            projectXmlLength: projectXml?.length,
            mediaXmlLength: mediaXml?.length,
            mediaMapKeys: Object.keys(mediaMap),
            mediaMapEntries: mediaMap,
            mediaCostumes,
            mediaSounds,
            mediaXmlPreview: mediaXml ? mediaXml.replace(/(image|sound)="data:[^"]{0,30}[^"]*"/g, '$1="[BASE64]"').slice(0, 1000) : null,
            targets,
            rawFirstCostumeTag: raw.match(/<costume[^>]{0,300}>/)?.[0]?.replace(/(image|pentrails)="data:[^"]{0,30}[^"]*"/g,'$1="..."') || 'none',
        });
    } catch(e) {
        res.status(500).json({ error: e.message, stack: e.stack });
    }
});

// ─── DEBUG: preview what will be saved ────────────────────────────────────────
app.get('/snap-api/debug-save/:name', async (req, res) => {
    const jar = getJar(req.sid);
    if (!jar.username) return res.status(401).json({ error: 'Not logged in' });
    try {
        const xml = await snapRequest(jar, 'GET',
            `/projects/${encodeURIComponent(jar.username)}/${encodeURIComponent(req.params.name)}`,
            { wantsRaw: true }
        );
        const projectXml = extractTag(xml, 'project');
        const mediaXml   = extractTag(xml, 'media');
        const strip = s => s ? s.replace(/(image|sound|thumbnail)="data:[^"]+"/g, '$1="data:...[BASE64]"') : null;
        res.json({
            rawLength: xml.length,
            hasSnapdata: xml.includes('<snapdata'),
            hasProject: xml.includes('<project'),
            hasMedia: xml.includes('<media'),
            projectLength: projectXml?.length,
            mediaLength: mediaXml?.length,
            projectStart: projectXml ? strip(projectXml.slice(0, 400)) : null,
            mediaContent: mediaXml ? strip(mediaXml.slice(0, 400)) : null,
            costumeCount: (xml.match(/<costume/g) || []).length,
            soundCount: (xml.match(/<sound[^s]/g) || []).length,
            listStructAtomic: (xml.match(/struct="atomic"/g) || []).length,
            spritesSelect: xml.match(/<sprites select="([^"]+)"/)?.[1],
        });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});
