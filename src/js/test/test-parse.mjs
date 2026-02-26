import { readFileSync } from 'fs';

// ── Replicate the LATEST parseAttrs from overview.js (indexOf-optimized) ──
function parseAttrs(tagStr) {
    const attrs = {};
    let i = tagStr.indexOf(' ');
    if (i === -1) return attrs;
    const len = tagStr.length;
    while (i < len) {
        while (i < len && /\s/.test(tagStr[i])) i++;
        if (tagStr[i] === '>' || tagStr[i] === '/' || i >= len) break;
        let nameStart = i;
        while (i < len && tagStr[i] !== '=' && tagStr[i] !== '>' && !/\s/.test(tagStr[i])) i++;
        const attrName = tagStr.slice(nameStart, i).trim();
        if (!attrName) { i++; continue; }
        while (i < len && /\s/.test(tagStr[i])) i++;
        if (tagStr[i] !== '=') { attrs[attrName] = ''; continue; }
        i++;
        while (i < len && /\s/.test(tagStr[i])) i++;
        if (tagStr[i] === '"' || tagStr[i] === "'") {
            const q = tagStr[i++];
            const closeIdx = tagStr.indexOf(q, i);
            if (closeIdx === -1) break;
            attrs[attrName] = tagStr.slice(i, closeIdx);
            i = closeIdx + 1;
        } else {
            let valStart = i;
            while (i < len && !/[\s>]/.test(tagStr[i])) i++;
            attrs[attrName] = tagStr.slice(valStart, i);
        }
    }
    return attrs;
}

// ── Replicate the LATEST extractTagAttrs (indexOf-optimized) ──
function extractTagAttrs(xml, tagName) {
    if (!xml) return [];
    const results = [];
    const re = new RegExp(`<${tagName}[\\s>]`, 'g');
    let m;
    while ((m = re.exec(xml)) !== null) {
        let start = m.index;
        let i = start + tagName.length + 1;
        let inQuote = null;
        while (i < xml.length) {
            const c = xml[i];
            if (inQuote) {
                const closeIdx = xml.indexOf(inQuote, i);
                if (closeIdx === -1) { i = xml.length; break; }
                i = closeIdx + 1;
                inQuote = null;
                continue;
            }
            if (c === '"' || c === "'") { inQuote = c; i++; continue; }
            if (c === '>') break;
            i++;
        }
        if (i >= xml.length) break;
        const tagStr = xml.slice(start, i + 1);
        results.push(parseAttrs(tagStr));
        re.lastIndex = i + 1;
    }
    return results;
}

function extractTag(xml, tag) {
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
                if (xml[j - 1] === '/') {
                    if (depth === 0) return xml.slice(i, j + 1);
                    i = j + 1; continue;
                }
                depth++;
                i = j + 1; continue;
            }
        }
        i++;
    }
    return null;
}

function decodeEntities(s) {
    if (!s || !s.includes('&')) return s;
    return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

function buildMediaMap(mediaXml, projectXml) {
    const map = {};
    const nameMap = {};
    if (mediaXml) {
        for (const a of extractTagAttrs(mediaXml, 'costume')) {
            const imgData = a.image ? decodeEntities(a.image) : null;
            if (a.id && imgData) map[a.id] = { type: 'image', data: imgData };
            if (a.name && imgData && !nameMap[a.name]) nameMap[a.name] = { type: 'image', data: imgData };
        }
        for (const a of extractTagAttrs(mediaXml, 'sound')) {
            const sndData = a.sound ? decodeEntities(a.sound) : null;
            if (a.id && sndData) map[a.id] = { type: 'audio', data: sndData };
            if (a.name && sndData && !nameMap[a.name]) nameMap[a.name] = { type: 'audio', data: sndData };
        }
    }
    if (projectXml) {
        for (const a of extractTagAttrs(projectXml, 'costume')) {
            const imgData = a.image ? decodeEntities(a.image) : null;
            if (a.id && imgData && !map[a.id]) map[a.id] = { type: 'image', data: imgData };
            if (a.name && imgData && !nameMap[a.name]) nameMap[a.name] = { type: 'image', data: imgData };
        }
        for (const a of extractTagAttrs(projectXml, 'sound')) {
            const sndData = a.sound ? decodeEntities(a.sound) : null;
            if (a.id && sndData && !map[a.id]) map[a.id] = { type: 'audio', data: sndData };
            if (a.name && sndData && !nameMap[a.name]) nameMap[a.name] = { type: 'audio', data: sndData };
        }
    }
    return { byId: map, byName: nameMap };
}

// ─── Test with the sprite file ───
try {
    const xml = readFileSync('/Users/manuelbuizo/Downloads/apple sprite.xml', 'utf8');
    console.log('=== File length:', xml.length);

    const fakeProjectXml = `<project name="Test"><stage name="Stage" costume="0"><costumes><list></list></costumes><sounds><list struct="atomic"></list></sounds><sprites>${xml}</sprites></stage></project>`;
    const fakeMediaXml = '<media></media>';

    console.log('\n=== Testing buildMediaMap ===');
    const { byId, byName } = buildMediaMap(fakeMediaXml, fakeProjectXml);
    console.log('byId entries:', Object.keys(byId).length);
    console.log('byName entries:', Object.keys(byName).length);
    for (const [k, v] of Object.entries(byId)) {
        console.log(`  byId[${k}] -> type=${v.type}, dataLen=${v.data.length}, starts=${v.data.slice(0, 30)}`);
    }
    for (const [k, v] of Object.entries(byName)) {
        console.log(`  byName["${k}"] -> type=${v.type}, dataLen=${v.data.length}`);
    }

    console.log('\n=== Testing costume extraction ===');
    const spriteBlock = extractTag(xml, 'sprite');
    const costumesXml = extractTag(spriteBlock, 'costumes');
    const costumes = extractTagAttrs(costumesXml || '', 'costume');
    console.log('Found', costumes.length, 'costumes');
    costumes.forEach((c, idx) => {
        console.log(`  ${idx+1}. "${c.name}" | hasImage: ${!!(c.image && c.image.startsWith('data:'))} | id: ${c.id}`);
    });

    const soundsXml = extractTag(spriteBlock, 'sounds');
    const sounds = extractTagAttrs(soundsXml || '', 'sound');
    console.log('\nFound', sounds.length, 'sounds');
    sounds.forEach((s, idx) => {
        console.log(`  ${idx+1}. "${s.name}" | hasSound: ${!!(s.sound && s.sound.startsWith('data:'))} | id: ${s.id}`);
    });

    console.log('\n=== Full resolve simulation ===');
    costumes.forEach((a, idx) => {
        const name = a.name || 'unnamed';
        let image = a.image ? decodeEntities(a.image) : null;
        if (!image && a.mediaID && byId[a.mediaID]) image = byId[a.mediaID].data;
        if (!image && a.id && byId[a.id]) image = byId[a.id].data;
        if (!image && name && byName[name]) image = byName[name].data;
        const resolvedBy = a.image ? 'inline' : (a.mediaID && byId[a.mediaID]) ? 'mediaID' :
            (a.id && byId[a.id]) ? 'id' : (byName[name]) ? 'name' : 'NONE';
        console.log(`  ${idx+1}. "${name}" resolved=${!!image} (by ${resolvedBy})`);
    });

    console.log('\nDONE');
} catch(e) {
    console.error('Error:', e.message, e.stack);
}
