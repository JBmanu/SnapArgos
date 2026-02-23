/**
 * test-api.js — Testa login + lista progetti direttamente in Node
 * Esattamente come login2.js, zero browser, zero proxy.
 *
 * Uso: node test-api.js <username> <password>
 */
'use strict';
const fetch  = require('node-fetch');
const crypto = require('crypto');

const BASE = 'https://snap.berkeley.edu/api/v1';
const cookies = {};

function sha512(s) { return crypto.createHash('sha512').update(s).digest('hex'); }

function saveCookies(headers) {
    const sc = headers.raw()['set-cookie'];
    if (!sc) return;
    for (const h of (Array.isArray(sc) ? sc : [sc])) {
        const [pair] = h.split(';');
        const eq = pair.indexOf('=');
        cookies[pair.slice(0,eq).trim()] = pair.slice(eq+1).trim();
    }
}

function cookieStr() {
    return Object.entries(cookies).map(([k,v])=>`${k}=${v}`).join('; ');
}

async function call(method, path, body) {
    const res = await fetch(BASE + path, {
        method,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cookie': cookieStr(),
            'Origin': 'https://snap.berkeley.edu',
            'Referer': 'https://snap.berkeley.edu/',
        },
        body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
    });
    saveCookies(res.headers);
    const text = await res.text();
    console.log(`  HTTP ${res.status}  cookies: ${JSON.stringify(cookies)}`);
    try { return JSON.parse(text); } catch { return text; }
}

(async () => {
    const [,, username, password] = process.argv;
    if (!username || !password) {
        console.error('Uso: node test-api.js <username> <password>');
        process.exit(1);
    }

    console.log(`\n1. LOGIN → ${username}`);
    const loginRes = await call('POST',
        `/users/${encodeURIComponent(username.toLowerCase())}/login?persist=true`,
        sha512(password)
    );
    console.log('  risposta:', JSON.stringify(loginRes).slice(0, 200));

    console.log('\n2. GET /users/c');
    const user = await call('GET', '/users/c');
    console.log('  utente:', user);

    if (!user.username) {
        console.error('\n✗ Login fallito — username non tornato da /users/c');
        process.exit(1);
    }

    console.log(`\n3. GET progetti di "${user.username}"`);
    const projects = await call('GET',
        `/projects/${encodeURIComponent(user.username)}?updatingnotes=true`
    );
    console.log('  progetti:', Array.isArray(projects) ? projects.map(p=>p.projectname) : projects);
    console.log('\n✓ Tutto OK');
})();
