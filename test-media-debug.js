#!/usr/bin/env node
/**
 * test-media-debug.js — Fetches a project from the local proxy and dumps
 * the exact XML structure of <media> and costume/sound references.
 *
 * Usage: node test-media-debug.js <username> <password> <projectName>
 */
'use strict';
const fetch = require('node-fetch');
const BASE = 'http://localhost:3000/snap-api';

let sessionId = null;
async function api(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (sessionId) headers['x-session-id'] = sessionId;
    const res = await fetch(BASE + path, {
        method, headers,
        body: body ? JSON.stringify(body) : undefined
    });
    sessionId = res.headers.get('x-session-id') || sessionId;
    return res;
}

(async () => {
    const [,, username, password, projectName] = process.argv;
    if (!username || !password || !projectName) {
        console.error('Usage: node test-media-debug.js <username> <password> <projectName>');
        process.exit(1);
    }

    // Login
    console.log('Logging in as', username, '...');
    const loginRes = await api('POST', '/login', { username, password });
    const loginData = await loginRes.json();
    if (loginRes.status !== 200) { console.error('Login failed:', loginData); process.exit(1); }
    console.log('Logged in as', loginData.username);

    // Fetch project
    console.log('Fetching project:', projectName, '...');
    const projRes = await api('GET', `/project/${encodeURIComponent(projectName)}`);
    const raw = await projRes.text();
    console.log('\n=== RAW RESPONSE ===');
    console.log('Length:', raw.length);
    console.log('First 200 chars:', raw.slice(0, 200));
    console.log('Contains <snapdata>:', raw.includes('<snapdata'));
    console.log('Contains <project:', raw.includes('<project'));
    console.log('Contains <media:', raw.includes('<media'));

    // Extract <project> and <media> using simple indexOf-based approach
    function findTag(xml, tag) {
        const re = new RegExp(`<${tag}[\\s>/]`);
        const startIdx = xml.search(re);
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
                const after = xml[i + tag.length + 1] || '';
                if (/[\s>/]/.test(after)) {
                    // Find end of opening tag, skipping quoted attrs
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
                    if (xml[j - 1] === '/') {
                        if (depth === 0) return xml.slice(i, j + 1);
                        i = j + 1; continue;
                    }
                    depth++; i = j + 1; continue;
                }
            }
            i++;
        }
        return null;
    }

    const projectXml = findTag(raw, 'project');
    const mediaXml = findTag(raw, 'media');

    console.log('\n=== PARSED SECTIONS ===');
    console.log('projectXml:', projectXml ? `${projectXml.length} chars` : 'NULL');
    console.log('mediaXml:', mediaXml ? `${mediaXml.length} chars` : 'NULL');

    // Strip base64 for display
    const strip = s => s.replace(/(image|sound|pentrails|thumbnail)="data:[^"]{0,30}[^"]*"/g, '$1="[BASE64...]"');

    if (mediaXml) {
        console.log('\n=== MEDIA XML (stripped) ===');
        console.log(strip(mediaXml).slice(0, 2000));
    } else {
        console.log('\n⚠ NO <media> TAG FOUND!');
        // Search around where <media should be
        const idx = raw.indexOf('</project>');
        if (idx !== -1) {
            console.log('After </project>:', raw.slice(idx, idx + 200));
        }
    }

    // Find all costume tags in projectXml
    if (projectXml) {
        console.log('\n=== COSTUME TAGS IN <project> ===');
        const costumeRe = /<costume\s[^>]*>/g;
        let cm;
        let count = 0;
        while ((cm = costumeRe.exec(projectXml)) !== null) {
            count++;
            const tag = strip(cm[0]);
            console.log(`  [${count}] ${tag}`);
            if (count > 30) { console.log('  ... (truncated)'); break; }
        }
        console.log(`Total costume tags in <project>: ${count}`);

        console.log('\n=== SOUND TAGS IN <project> ===');
        const soundRe = /<sound\s[^>]*>/g;
        let sm;
        count = 0;
        while ((sm = soundRe.exec(projectXml)) !== null) {
            count++;
            const tag = strip(sm[0]);
            console.log(`  [${count}] ${tag}`);
            if (count > 30) { console.log('  ... (truncated)'); break; }
        }
        console.log(`Total sound tags in <project>: ${count}`);
    }

    // Find all costume/sound tags in mediaXml
    if (mediaXml) {
        console.log('\n=== COSTUME TAGS IN <media> ===');
        const costumeRe = /<costume\s[^>]*>/g;
        let cm;
        let count = 0;
        while ((cm = costumeRe.exec(mediaXml)) !== null) {
            count++;
            const tag = strip(cm[0]);
            console.log(`  [${count}] ${tag}`);
            if (count > 30) { console.log('  ... (truncated)'); break; }
        }
        console.log(`Total costume tags in <media>: ${count}`);

        console.log('\n=== SOUND TAGS IN <media> ===');
        const soundRe = /<sound\s[^>]*>/g;
        let sm;
        count = 0;
        while ((sm = soundRe.exec(mediaXml)) !== null) {
            count++;
            const tag = strip(sm[0]);
            console.log(`  [${count}] ${tag}`);
            if (count > 30) { console.log('  ... (truncated)'); break; }
        }
        console.log(`Total sound tags in <media>: ${count}`);
    }

    // Check mediaID cross-references
    console.log('\n=== CROSS-REFERENCE CHECK ===');
    const mediaIDs = [...(projectXml || '').matchAll(/mediaID="([^"]+)"/g)].map(m => m[1]);
    const mediaEntryIDs = [...(mediaXml || '').matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
    console.log('mediaID refs in <project>:', mediaIDs);
    console.log('id attrs in <media>:', mediaEntryIDs);
    for (const mid of mediaIDs) {
        const found = mediaEntryIDs.includes(mid);
        console.log(`  mediaID="${mid}" → ${found ? '✓ FOUND' : '✗ NOT FOUND'} in <media>`);
    }
})().catch(e => { console.error('Fatal:', e.message); process.exit(1); });

