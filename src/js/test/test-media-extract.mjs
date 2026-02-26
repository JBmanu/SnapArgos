/**
 * Test: Check if extractTag correctly finds <media> in a Snap! project
 * Run with: node test-media-extract.mjs
 */

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
                    if (inQ) { if (c === inQ) inQ = null; }
                    else if (c === '"' || c === "'") { inQ = c; }
                    else if (c === '>') break;
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

// Load the actual sprite XML
const fs = await import('fs');
let spriteXml;
try {
    spriteXml = fs.readFileSync('/Users/manuelbuizo/Downloads/apple sprite.xml', 'utf-8');
} catch {
    console.log('Sprite file not found, using inline test data');
    spriteXml = null;
}

// Simulate what happens in getProject: raw = response from Snap's API
// The raw response format is: <snapdata><project ...>...</project><media ...>...</media></snapdata>
// After extractTag(raw, 'project') and extractTag(raw, 'media'), we get projectXml and mediaXml

// But what does the project XML look like when it includes this sprite?
// The sprite was imported via importSpriteXml, which puts the sprite block into projectXml.
// The sprite block has costumes with inline image= attributes.
// When saved to Snap's cloud and fetched back, the server may separate images into <media>.

// Let's test the DOMParser approach with the sprite XML
if (spriteXml) {
    console.log('=== Testing with actual sprite XML ===');
    console.log('Length:', spriteXml.length);
    console.log('First 200 chars:', spriteXml.slice(0, 200));

    // Check costume tags
    const costumeMatches = [...spriteXml.matchAll(/<costume\s[^>]*name="([^"]+)"/g)];
    console.log('Costumes found:', costumeMatches.map(m => m[1]));

    // Check if DOMParser can handle it
    try {
        const { JSDOM } = await import('jsdom');
        const dom = new JSDOM();
        const parser = new dom.window.DOMParser();
        const doc = parser.parseFromString(spriteXml, 'text/xml');
        const err = doc.querySelector('parsererror');
        if (err) {
            console.log('DOMParser ERROR:', err.textContent.slice(0, 200));
        } else {
            console.log('DOMParser OK');
            const costumes = doc.querySelectorAll('costume');
            console.log('Costumes via DOM:', costumes.length);
            for (const c of costumes) {
                console.log('  -', c.getAttribute('name'), '| hasImage:', !!c.getAttribute('image'));
            }
        }
    } catch (e) {
        console.log('No jsdom available, skipping DOMParser test:', e.message);
    }
} else {
    console.log('No sprite file, testing with synthetic data');
}

// Now test the actual scenario: what the project looks like after saving to Snap cloud
// Simulate a projectXml where costumes have mediaID refs
console.log('\n=== Testing mediaID resolution ===');
const projectXml = `<project name="Test" app="Snap!" version="2">
<stage name="Stage" costume="0" id="1">
<costumes><list><item><costume name="backdrop1" mediaID="10" id="10"/></item></list></costumes>
<sounds><list struct="atomic"></list></sounds>
<sprites>
<sprite name="apple" costume="1" id="2">
<costumes><list><item><costume name="tetris-Sheet" mediaID="4" id="4"/></item><item><costume name="cactus2" mediaID="5" id="5"/></item><item><costume name="banca 2" center-x="0" center-y="0" image="data:image/png;base64,AAAA" id="6"/></item></list></costumes>
<sounds><list><item><sound name="sfx_hit" mediaID="8" id="8"/></item></list></sounds>
</sprite>
</sprites>
</stage>
</project>`;

const mediaXml = `<media name="Test" app="Snap!" version="2">
<costume name="backdrop1" center-x="0" center-y="0" id="10" image="data:image/png;base64,BBBB"/>
<costume name="tetris-Sheet" center-x="50" center-y="50" id="4" image="data:image/png;base64,CCCC"/>
<costume name="cactus2" center-x="0" center-y="0" id="5" image="data:image/png;base64,DDDD"/>
<sound name="sfx_hit" id="8" sound="data:audio/wav;base64,EEEE"/>
</media>`;

// Test extractTag
const costumesBlock = extractTag(extractTag(projectXml, 'sprite'), 'costumes');
console.log('Costumes block found:', !!costumesBlock);

const mediaFound = extractTag(`<snapdata>${projectXml}${mediaXml}</snapdata>`, 'media');
console.log('Media found:', !!mediaFound, '| length:', mediaFound?.length);

// Build media map
const mediaMap = {};
for (const m of (mediaFound || '').matchAll(/<costume[^>]+id="([^"]+)"[^>]+image="([^"]+)"/g)) {
    mediaMap[m[1]] = m[2];
}
for (const m of (mediaFound || '').matchAll(/<costume[^>]+image="([^"]+)"[^>]+id="([^"]+)"/g)) {
    mediaMap[m[2]] = m[1];
}
console.log('Media map keys:', Object.keys(mediaMap));

// Check costumes resolution
for (const m of (costumesBlock || '').matchAll(/<costume[^>]+name="([^"]+)"[^>]*/g)) {
    const name = m[1];
    const hasImage = m[0].includes('image="data:');
    const mediaID = m[0].match(/mediaID="([^"]+)"/)?.[1];
    const id = m[0].match(/\bid="([^"]+)"/)?.[1];
    const resolved = hasImage || (mediaID && mediaMap[mediaID]) || (id && mediaMap[id]);
    console.log(`  ${name}: hasImage=${hasImage}, mediaID=${mediaID}, id=${id}, RESOLVED=${!!resolved}`);
}

// NOW test what happens if there's NO mediaXml (empty)
console.log('\n=== Testing with EMPTY mediaXml ===');
const emptyMediaXml = '<media></media>';
const mediaFound2 = extractTag(`<snapdata>${projectXml}${emptyMediaXml}</snapdata>`, 'media');
console.log('Media found:', !!mediaFound2, '| content:', mediaFound2);

