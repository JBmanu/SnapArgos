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
        const result = await snapRequest(jar, 'POST',
            `/projects/${encodeURIComponent(jar.username)}/${encodeURIComponent(req.params.name)}`,
            { body: req.body }
        );
        console.log(`[snap-api] saved "${req.params.name}" (sid: ${req.sid.slice(0,8)})`);
        res.json({ ok: true, message: result });
    } catch(e) {
        console.error('[snap-api] save error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

app.listen(PORT, () => {
    console.log(`\n  ✦ Snap! Uploader  →  http://localhost:${PORT}`);
    console.log(`  ✦ API bridge      →  /snap-api/* → ${SNAP_BASE}\n`);
});
