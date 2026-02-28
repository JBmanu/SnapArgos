/**
 * snap-api.js — Snap! Cloud API (browser)
 * LOCAL -> /snap-api/*  |  PROD -> worker -> snap.berkeley.edu/api/v1
 * v8 — cookie jar fix + debug logging for GitHub Pages
 */

const IS_LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
const PROD_BASE = 'https://snap-argos.buizomanuel.workers.dev/snap-api';

console.log('[snap-api] ✓ module loaded, IS_LOCAL =', IS_LOCAL, ', hostname =', location.hostname);

export const state = {username: null, sessionId: null, cookies: {}};

// ── Core HTTP ─────────────────────────────────────────────────────────────────
async function req(method, path, {body, wantsRaw = false} = {}) {
    const headers = {'Content-Type': 'application/json; charset=utf-8'};
    const url = IS_LOCAL ? `/snap-api${path}` : PROD_BASE + path;

    if (IS_LOCAL && state.sessionId) headers['x-session-id'] = state.sessionId;

    const cookieStr = Object.entries(state.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
    if (!IS_LOCAL && cookieStr) headers['x-snap-cookie'] = cookieStr;

    console.log(`[snap-api] → ${method} ${path}`, {url, hasCookies: !!cookieStr, bodyType: body == null ? 'none' : typeof body});

    let res;
    try {
        res = await fetch(url, {
            method, headers,
            credentials: IS_LOCAL ? 'same-origin' : 'omit',
            body: body == null ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
        });
    } catch (err) {
        console.error(`[snap-api] ✗ NETWORK ERROR: ${method} ${url}`, err);
        throw new Error(`Network error: ${err.message}`);
    }

    console.log(`[snap-api] ← ${res.status} ${res.statusText}`, {
        contentType: res.headers.get('content-type'),
        setCookie: res.headers.get('x-snap-set-cookie'),
    });

    if (IS_LOCAL) {
        const s = res.headers.get('x-session-id');
        if (s) state.sessionId = s;
    } else {
        const s = res.headers.get('x-snap-set-cookie');
        if (s) {
            console.log('[snap-api] merging cookies:', s.slice(0, 80));
            for (const pair of s.split(';')) {
                const eq = pair.indexOf('=');
                if (eq > 0) {
                    state.cookies[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
                }
            }
            console.log('[snap-api] cookie jar now has', Object.keys(state.cookies).length, 'entries:', Object.keys(state.cookies));
        }
    }

    const text = await res.text();
    console.log(`[snap-api] body (${text.length} chars):`, text.slice(0, 150));

    // DELETE (and some other mutating requests) may return an empty body on success.
    // Treat an empty body as success only when the HTTP status is 2xx.
    if (!text) {
        if (res.ok) return null;
        throw new Error(`Empty response ${method} ${path} (${res.status})`);
    }

    // For wantsRaw: return raw text unless it's a JSON error
    if (wantsRaw) {
        // Still check for JSON error envelopes
        if (text.trimStart().startsWith('{')) {
            try {
                const j = JSON.parse(text);
                if (j.errors) throw new Error(j.errors[0]);
                if (j.error) throw new Error(j.error);
                // If it's a JSON-wrapped message, unwrap it
                if (typeof j.message === 'string') {
                    console.log('[snap-api] unwrapping JSON message for wantsRaw');
                    return j.message;
                }
            } catch (e) {
                if (!(e instanceof SyntaxError)) throw e; // re-throw API errors, only swallow parse errors
            }
        }
        return text;
    }

    // Non-raw: parse as JSON
    let j;
    try { j = JSON.parse(text); } catch (e) {
        console.error('[snap-api] JSON parse fail:', e.message);
        throw new Error(text);
    }
    if (j.errors) throw new Error(j.errors[0]);
    if (j.error) throw new Error(j.error);
    return j.message !== undefined ? j.message : j;
}


// ── Auth ──────────────────────────────────────────────────────────────────────
export async function login(username, password) {
    console.log('[snap-api] login() IS_LOCAL =', IS_LOCAL);
    if (IS_LOCAL) {
        const r = await req('POST', '/login', {body: {username, password}});
        state.username = r.username;
        state.sessionId = r.sessionId;
    } else {
        const hash = await sha512(password);
        console.log('[snap-api] sha512 done, hash prefix:', hash.slice(0, 16));
        await req('POST', `/users/${enc(username.toLowerCase())}/login?persist=true`, {body: hash});
        console.log('[snap-api] login POST ok, now GET /users/c');
        const userInfo = await req('GET', '/users/c');
        console.log('[snap-api] /users/c result:', userInfo);
        state.username = userInfo.username;
    }
    console.log('[snap-api] login complete:', state.username);
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
    let raw = await (IS_LOCAL
        ? req('GET', `/project/${enc(projectName)}`, {wantsRaw: true})
        : req('GET', `/projects/${enc(state.username)}/${enc(projectName)}`, {wantsRaw: true}));

    // Handle case where response is JSON-wrapped (some cloud endpoints return {"message": "...xml..."})
    if (typeof raw === 'string' && raw.trimStart().startsWith('{')) {
        try {
            const parsed = JSON.parse(raw);
            if (typeof parsed.message === 'string') {
                console.log('[getProject] unwrapped JSON message envelope');
                raw = parsed.message;
            } else if (typeof parsed === 'string') {
                raw = parsed;
            }
        } catch (e) {
            // Not JSON — use as-is
        }
    }

    console.log('[getProject] raw type:', typeof raw, '| length:', raw?.length,
        '| starts with:', raw?.slice(0, 30));

    const projectXml = extractTag(raw, 'project');

    // Extract the OUTER <media> block — the one that lives outside <project>,
    // as a sibling inside <snapdata>. The inner <media> (nested inside <project>)
    // is typically empty; all actual image/sound data is in the outer one.
    // Strategy: find </project>, then look for <media after that position.
    let mediaXml = '<media></media>';
    if (projectXml) {
        const projEnd = raw.indexOf('</project>');
        if (projEnd !== -1) {
            const afterProject = raw.slice(projEnd + 10); // skip past </project>
            const outerMedia = extractTag(afterProject, 'media');
            if (outerMedia) {
                mediaXml = outerMedia;
                console.log('[getProject] using OUTER media block, length:', outerMedia.length);
            } else {
                // Fallback: use first <media> anywhere (old behaviour)
                mediaXml = extractTag(raw, 'media') || '<media></media>';
                console.log('[getProject] no outer media found, falling back to first <media>');
            }
        } else {
            mediaXml = extractTag(raw, 'media') || '<media></media>';
        }
    } else {
        // No <project> tag — might be a raw <sprites> export or other format
        mediaXml = extractTag(raw, 'media') || '<media></media>';
    }

    console.log('[getProject] projectXml length:', projectXml?.length,
        '| mediaXml length:', mediaXml?.length);
    // Count costume tags with inline images vs mediaID references
    const inlineCount = (projectXml?.match(/\bimage="data:/g) || []).length;
    const mediaIDCount = (projectXml?.match(/\bmediaID="/g) || []).length;
    const mediaImageCount = (mediaXml?.match(/\bimage="data:/g) || []).length;
    const mediaSoundCount = (mediaXml?.match(/\bsound="data:/g) || []).length;
    console.log('[getProject] project: inline images:', inlineCount, '| mediaID refs:', mediaIDCount,
        '| media: images:', mediaImageCount, '| sounds:', mediaSoundCount);
    return { projectXml, mediaXml };
}

export async function saveProject(projectName, projectXml, mediaXml, notes = '') {
    assertLoggedIn();
    const body = {xml: projectXml, media: mediaXml, thumbnail: BLANK_PNG, notes, remixID: null};
    if (JSON.stringify(body).length > 10 * 1024 * 1024) throw new Error('Project exceeds 10 MB limit');
    return IS_LOCAL
        ? req('POST', `/project/${enc(projectName)}`, {body})
        : req('POST', `/projects/${enc(state.username)}/${enc(projectName)}`, {body});
}

// ── Delete project from cloud ─────────────────────────────────────────────────
export async function deleteProject(projectName) {
    assertLoggedIn();
    return IS_LOCAL
        ? req('DELETE', `/project/${enc(projectName)}`)
        : req('DELETE', `/projects/${enc(state.username)}/${enc(projectName)}`);
}

// ── Delete a sprite from projectXml ───────────────────────────────────────────
export function deleteSpriteXml(projectXml, targetName, xmlOffset = null) {
    const start = findTargetStart(projectXml, targetName, xmlOffset);
    const block = extractTag(projectXml.slice(start), 'sprite');
    if (!block) throw new Error(`Cannot find <sprite> "${targetName}"`);
    return projectXml.slice(0, start) + projectXml.slice(start + block.length);
}

// ── Delete a stage from projectXml ────────────────────────────────────────────
// In Snap!, each "stage" in the overview is actually a <scene> that contains
// a <stage>. So we must delete the entire <scene>…</scene> block, then update
// the <scenes select="N"> attribute so the project stays valid.
export function deleteStageXml(projectXml, targetName, xmlOffset = null) {
    // 1. Find the <stage> tag using the normal offset-based lookup
    const stageStart = findTargetStart(projectXml, targetName, xmlOffset);

    // 2. Walk backwards from stageStart to find the enclosing <scene …> tag
    const sceneStart = _findEnclosingScene(projectXml, stageStart);
    if (sceneStart === -1) {
        // Fallback: maybe it's a single-scene project — just remove <stage>
        const block = extractTag(projectXml.slice(stageStart), 'stage');
        if (!block) throw new Error(`Cannot find <stage> "${targetName}"`);
        return projectXml.slice(0, stageStart) + projectXml.slice(stageStart + block.length);
    }

    // 3. Extract the full <scene>…</scene> block from sceneStart
    const sceneBlock = extractTag(projectXml.slice(sceneStart), 'scene');
    if (!sceneBlock) throw new Error(`Cannot find <scene> enclosing stage "${targetName}"`);

    // 4. Remove the scene
    let result = projectXml.slice(0, sceneStart) + projectXml.slice(sceneStart + sceneBlock.length);

    // 5. Update <scenes select="N"> — clamp to valid range
    result = _fixScenesSelect(result);

    return result;
}

// Walk backwards from `pos` to find the start of the <scene ...> tag that encloses it.
function _findEnclosingScene(xml, pos) {
    // Search backwards for '<scene ' or '<scene>'
    let i = pos - 1;
    while (i >= 0) {
        if (xml[i] === '<' && (xml.startsWith('<scene ', i) || xml.startsWith('<scene>', i))) {
            // Make sure this scene actually contains `pos` (not a prior, already-closed scene)
            const sceneBlock = extractTag(xml.slice(i), 'scene');
            if (sceneBlock && i + sceneBlock.length > pos) {
                return i; // This scene encompasses the target position
            }
        }
        i--;
    }
    return -1;
}

// After removing a scene, fix the <scenes select="N"> attribute
function _fixScenesSelect(xml) {
    const m = xml.match(/<scenes\s+select="(\d+)"/);
    if (!m) return xml;
    const oldSelect = parseInt(m[1], 10);

    // Count remaining <scene> opening tags
    let count = 0;
    let idx = 0;
    while (true) {
        idx = xml.indexOf('<scene', idx);
        if (idx === -1) break;
        const ch = xml[idx + 6]; // char after '<scene'
        if (ch === ' ' || ch === '>') count++;
        idx += 6;
    }

    // Clamp select to valid range (1-based)
    const newSelect = Math.max(1, Math.min(oldSelect, count));
    return xml.replace(/<scenes\s+select="\d+"/, `<scenes select="${newSelect}"`);
}

// ── Delete a costume from a sprite/stage ──────────────────────────────────────
// costumeIndex is 0-based
export function deleteCostumeXml(projectXml, targetName, costumeIndex, xmlOffset = null) {
    const start = findTargetStart(projectXml, targetName, xmlOffset);
    const tag = targetTag(targetName);
    const blockXml = extractTag(projectXml.slice(start), tag);
    if (!blockXml) throw new Error(`Cannot find <${tag}> "${targetName}"`);

    const costumesXml = extractTag(blockXml, 'costumes');
    if (!costumesXml) throw new Error(`<costumes> not found in "${targetName}"`);
    const listXml = extractTag(costumesXml, 'list');
    if (!listXml) throw new Error(`<list> not found in <costumes> of "${targetName}"`);

    // Extract all <item> blocks from the list
    const items = _extractAllItems(listXml);
    if (costumeIndex < 0 || costumeIndex >= items.length) throw new Error(`Costume index ${costumeIndex} out of range`);

    // Remove the item at costumeIndex
    const itemToRemove = items[costumeIndex];
    const newList = listXml.replace(itemToRemove, '');
    const newCostumes = costumesXml.replace(listXml, newList);
    const newBlock = blockXml.replace(costumesXml, newCostumes);
    return projectXml.slice(0, start) + newBlock + projectXml.slice(start + blockXml.length);
}

// ── Delete a sound from a sprite/stage ────────────────────────────────────────
// soundIndex is 0-based
export function deleteSoundXml(projectXml, targetName, soundIndex, xmlOffset = null) {
    const start = findTargetStart(projectXml, targetName, xmlOffset);
    const tag = targetTag(targetName);
    const blockXml = extractTag(projectXml.slice(start), tag);
    if (!blockXml) throw new Error(`Cannot find <${tag}> "${targetName}"`);

    const soundsXml = extractTag(blockXml, 'sounds');
    if (!soundsXml) throw new Error(`<sounds> not found in "${targetName}"`);
    const listXml = extractTag(soundsXml, 'list');
    if (!listXml) throw new Error(`<list> not found in <sounds> of "${targetName}"`);

    const items = _extractAllItems(listXml);
    if (soundIndex < 0 || soundIndex >= items.length) throw new Error(`Sound index ${soundIndex} out of range`);

    const itemToRemove = items[soundIndex];
    const newList = listXml.replace(itemToRemove, '');
    const newSounds = soundsXml.replace(listXml, newList);
    const newBlock = blockXml.replace(soundsXml, newSounds);
    return projectXml.slice(0, start) + newBlock + projectXml.slice(start + blockXml.length);
}

// ── Helper: extract all <item>...</item> blocks from a <list> ─────────────────
function _extractAllItems(listXml) {
    const items = [];
    let remaining = listXml;
    while (true) {
        const item = extractTag(remaining, 'item');
        if (!item) break;
        items.push(item);
        const idx = remaining.indexOf(item);
        remaining = remaining.slice(idx + item.length);
    }
    return items;
}

// ── File type helpers ─────────────────────────────────────────────────────────
export const EXTS_IMG = ['png', 'jpg', 'jpeg', 'gif', 'svg'];
export const EXTS_AUDIO = ['mp3', 'wav', 'ogg'];
export function fileExt(file) { return file.name.split('.').pop().toLowerCase(); }
export function fileBase(file) { return file.name.replace(/\.[^.]+$/, ''); }

export async function detectXmlType(file) {
    const s = (await file.slice(0, 300).text()).trimStart();
    if (s.startsWith('<sprites')) return 'sprite';
    if (s.startsWith('<blocks')) return 'blocks';
    if (s.startsWith('<scripts')) return 'scripts';
    if (s.startsWith('<script ') || s.startsWith('<script>')) return 'script';
    if (s.startsWith('<block-definition')) return 'blockdef';
    return 'unknown';
}

export function isFileAccepted(file, selMode, xmlType = null) {
    const e = fileExt(file);
    if (selMode === 'projects') {
        if (e !== 'xml') return false;
        if (xmlType && !['sprite', 'blocks'].includes(xmlType)) return false;
        return true;
    }
    if (selMode === 'sprites') {
        if (EXTS_IMG.includes(e) || EXTS_AUDIO.includes(e)) return true;
        if (e === 'xml') {
            if (xmlType && !['script', 'scripts'].includes(xmlType)) return false;
            return true;
        }
    }
    return false;
}

/**
 * Extract all sprites and stages from projectXml.
 * Each entry includes a unique `xmlOffset` — the character position of the
 * opening tag in projectXml — so that sprites with identical names can be
 * disambiguated later (e.g. in overview.js findTargetBlock).
 */
export function getSpritesFromXml(projectXml) {
    const list = [];

    // Find all <stage> elements using indexOf (avoids slow regex on huge pentrails attrs)
    let searchFrom = 0;
    while (searchFrom < projectXml.length) {
        const idx = projectXml.indexOf('<stage', searchFrom);
        if (idx === -1) break;
        const after = projectXml[idx + 6];
        if (after && !/[\s>\/]/.test(after)) { searchFrom = idx + 1; continue; }

        // Extract stage name from opening tag (scan quote-aware to skip pentrails etc.)
        const stageName = _readAttrFromTag(projectXml, idx, 'name') || 'Stage';
        list.push({ name: stageName, type: 'stage', xmlOffset: idx });

        // Extract the full <stage>…</stage> block to find its child sprites
        const stageBlock = extractTag(projectXml.slice(idx), 'stage');
        if (stageBlock) {
            const spritesBlock = extractTag(stageBlock, 'sprites');
            if (spritesBlock) {
                // The spritesBlock starts at some offset within stageBlock.
                // We need to compute the absolute offset in projectXml.
                const spritesOffsetInStage = stageBlock.indexOf(spritesBlock);

                // Find <sprite> tags inside <sprites>
                let sprSearchFrom = 0;
                while (sprSearchFrom < spritesBlock.length) {
                    const sprIdx = spritesBlock.indexOf('<sprite', sprSearchFrom);
                    if (sprIdx === -1) break;
                    const sprAfter = spritesBlock[sprIdx + 7];
                    if (sprAfter && !/[\s>\/]/.test(sprAfter)) { sprSearchFrom = sprIdx + 1; continue; }

                    const spName = _readAttrFromTag(spritesBlock, sprIdx, 'name');
                    if (spName) {
                        // Compute absolute offset in projectXml
                        const absoluteOffset = idx + spritesOffsetInStage + sprIdx;
                        list.push({ name: spName, type: 'sprite', parentStage: stageName, xmlOffset: absoluteOffset });
                    }

                    // Skip past this sprite's opening tag to find the next one
                    const sprBlock = extractTag(spritesBlock.slice(sprIdx), 'sprite');
                    if (sprBlock) {
                        sprSearchFrom = sprIdx + sprBlock.length;
                    } else {
                        sprSearchFrom = sprIdx + 1;
                    }
                }
            }
            searchFrom = idx + stageBlock.length;
        } else {
            searchFrom = idx + 1;
        }
    }

    // Fallback if no <stage> tag found
    if (!list.length) {
        list.push({ name: 'Stage', type: 'stage', xmlOffset: 0 });
        for (const m of projectXml.matchAll(/<sprite\s[^>]*name="([^"]+)"/g))
            list.push({ name: m[1], type: 'sprite', parentStage: 'Stage', xmlOffset: m.index });
    }

    return list;
}

/**
 * Read a specific attribute from an XML opening tag starting at `tagStart`.
 * Uses indexOf to efficiently skip huge attribute values (e.g. pentrails base64).
 */
function _readAttrFromTag(xml, tagStart, attrName) {
    let i = tagStart;
    let inQ = null;
    while (i < xml.length) {
        const c = xml[i];
        if (inQ) {
            // Jump to closing quote using indexOf (skips huge base64 blobs in one call)
            const closeIdx = xml.indexOf(inQ, i + 1);
            if (closeIdx === -1) return null;
            i = closeIdx + 1;
            inQ = null;
            continue;
        }
        if (c === '"' || c === "'") { inQ = c; i++; continue; }
        if (c === '>') return null; // reached end of opening tag without finding attr
        // Check if we're at the attribute name (with word boundary: prev char must be whitespace)
        if (xml.startsWith(attrName + '="', i)) {
            const prev = i > 0 ? xml[i - 1] : ' ';
            if (/\s/.test(prev)) {
                const valStart = i + attrName.length + 2;
                const valEnd = xml.indexOf('"', valStart);
                if (valEnd === -1) return null;
                return xml.slice(valStart, valEnd);
            }
        }
        i++;
    }
    return null;
}

// ── XML mutations ─────────────────────────────────────────────────────────────
export function importSpriteXml(projectXml, mediaXml, xmlString) {
    if (!xmlString.trimStart().startsWith('<sprites')) throw new Error('Expected <sprites>');
    const nodes = extractAllTags(xmlString, 'sprite');
    if (!nodes.length) throw new Error('No <sprite> nodes found');
    const existing = xmlAttrAll(projectXml, 'sprite', 'name');
    const skipped = [];
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
    return {projectXml: pxml, mediaXml, skipped};
}

export function importCustomBlocks(projectXml, mediaXml, xmlString) {
    if (!xmlString.trimStart().startsWith('<blocks')) throw new Error('Expected <blocks>');
    const existingNames = [...projectXml.matchAll(/<block-definition[^>]+s="([^"]+)"/g)].map(m => m[1]);
    const defs = extractAllTags(xmlString, 'block-definition');
    const skipped = [];
    let toAdd = '';
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
    if (!toAdd) return {projectXml, mediaXml, skipped};
    if (!projectXml.includes('</blocks>')) throw new Error('</blocks> not found in project XML');
    return {projectXml: projectXml.replace('</blocks>', toAdd + '</blocks>'), mediaXml, skipped};
}

/**
 * Find the character offset of a target (sprite/stage) in projectXml.
 * @param {string} projectXml
 * @param {string} targetName - name of the sprite/stage
 * @param {number|null} xmlOffset - if provided, use this exact offset (precise mode)
 */
function findTargetStart(projectXml, targetName, xmlOffset = null) {
    // Precise mode: use xmlOffset directly if it points to the right tag
    if (xmlOffset != null && xmlOffset >= 0) {
        const expectedTag = targetName === 'Stage' || projectXml.startsWith('<stage', xmlOffset) ? 'stage' : 'sprite';
        if (projectXml.startsWith(`<${expectedTag}`, xmlOffset)) {
            return xmlOffset;
        }
        console.warn(`[findTargetStart] xmlOffset ${xmlOffset} doesn't match <${expectedTag}>, falling back to name search`);
    }

    // Fallback: name-based search
    if (targetName === 'Stage') {
        const m = projectXml.match(/<stage[\s]/);
        if (!m) throw new Error('Stage not found in project XML');
        return projectXml.indexOf(m[0]);
    }
    const re = new RegExp(`<sprite[^>]+name="${escRe(targetName)}"[^>]*>`);
    const m = projectXml.match(re);
    if (!m) throw new Error(`Sprite "${targetName}" not found in project XML`);
    return projectXml.indexOf(m[0]);
}

function targetTag(n) { return n === 'Stage' ? 'stage' : 'sprite'; }

function getAssetNames(projectXml, targetName, assetTag, xmlOffset = null) {
    try {
        const start = findTargetStart(projectXml, targetName, xmlOffset);
        const tag = targetTag(targetName);
        const blockXml = extractTag(projectXml.slice(start), tag);
        if (!blockXml) return [];
        const sn = assetTag === 'costume' ? 'costumes' : 'sounds';
        const sectionXml = extractTag(blockXml, sn);
        if (!sectionXml) return [];
        return [...sectionXml.matchAll(new RegExp(`<${assetTag}[^>]+name="([^"]+)"`, 'g'))].map(m => m[1]);
    } catch { return []; }
}

function injectAssetItem(projectXml, targetName, section, itemXml, xmlOffset = null) {
    const start = findTargetStart(projectXml, targetName, xmlOffset);
    const tag = targetTag(targetName);
    const blockXml = extractTag(projectXml.slice(start), tag);
    if (!blockXml) throw new Error(`Cannot extract <${tag}> for "${targetName}"`);
    const sectionXml = extractTag(blockXml, section);
    if (!sectionXml) throw new Error(`<${section}> not found in "${targetName}"`);
    const listXml = extractTag(sectionXml, 'list');
    if (!listXml) throw new Error(`<list> not found in <${section}> of "${targetName}"`);
    const cleanList = listXml.replace(/\s*struct="atomic"/, '');
    const newList = cleanList.replace('</list>', itemXml + '</list>');
    const newSection = sectionXml.replace(listXml, newList);
    const newBlock = blockXml.replace(sectionXml, newSection);
    return projectXml.slice(0, start) + newBlock + projectXml.slice(start + blockXml.length);
}

export async function uploadImageToSprite(projectXml, mediaXml, targetName, file, xmlOffset = null) {
    const {dataURL, name} = await readFile(file);
    const existing = getAssetNames(projectXml, targetName, 'costume', xmlOffset);
    if (existing.includes(name)) return {projectXml, mediaXml, skipped: name};
    const item = `<item><costume name="${xa(name)}" center-x="0" center-y="0" image="${xa(dataURL)}" id="${rndId()}"/></item>`;
    let newXml = injectAssetItem(projectXml, targetName, 'costumes', item, xmlOffset);
    newXml = setActiveCostume(newXml, targetName, existing.length + 1, xmlOffset);
    return {projectXml: newXml, mediaXml, skipped: null};
}

export async function uploadAudioToSprite(projectXml, mediaXml, targetName, file, xmlOffset = null) {
    const {dataURL, name} = await readFile(file);
    if (getAssetNames(projectXml, targetName, 'sound', xmlOffset).includes(name))
        return {projectXml, mediaXml, skipped: name};
    const item = `<item><sound name="${xa(name)}" sound="${xa(dataURL)}" id="${rndId()}"/></item>`;
    return {projectXml: injectAssetItem(projectXml, targetName, 'sounds', item, xmlOffset), mediaXml, skipped: null};
}

export function importScriptXml(projectXml, mediaXml, targetName, xmlString, xmlOffset = null) {
    const trimmed = xmlString.trimStart();
    const isScriptsContainer = trimmed.startsWith('<scripts');
    const isScriptFile = trimmed.startsWith('<script ') || trimmed.startsWith('<script>');
    if (!isScriptsContainer && !isScriptFile) throw new Error('Expected <script> or <scripts>');
    let nodesToInject;
    if (isScriptsContainer) {
        nodesToInject = trimmed.replace(/^<scripts[^>]*>/, '').replace(/<\/scripts>\s*$/, '').trim();
        if (!nodesToInject) return {projectXml, mediaXml};
    } else {
        let node = trimmed.trimEnd();
        if (/^<script[^>]+app=/.test(node)) {
            node = node.replace(/^<script[^>]*>/, '').replace(/<\/script>\s*$/, '').trim();
            if (!node) return {projectXml, mediaXml};
        }
        node = node.replace(/^(<script(?![^>]*\bx=")[^>]*>)/m, (m) => m.replace('<script', '<script x="10"'));
        node = node.replace(/^(<script(?![^>]*\by=")[^>]*>)/m, (m) => m.replace('<script', '<script y="10"'));
        nodesToInject = node;
    }
    const start = findTargetStart(projectXml, targetName, xmlOffset);
    const tag = targetTag(targetName);
    const blockXml = extractTag(projectXml.slice(start), tag);
    if (!blockXml) throw new Error(`Cannot extract <${tag}> for "${targetName}"`);
    const scriptsXml = extractTag(blockXml, 'scripts');
    let newBlock;
    if (scriptsXml) {
        newBlock = blockXml.replace(scriptsXml, scriptsXml.replace('</scripts>', nodesToInject + '</scripts>'));
    } else {
        newBlock = blockXml.replace(`</${tag}>`, `<scripts>${nodesToInject}</scripts></${tag}>`);
    }
    return {
        projectXml: projectXml.slice(0, start) + newBlock + projectXml.slice(start + blockXml.length),
        mediaXml,
    };
}

function setActiveCostume(projectXml, targetName, costumeIndex, xmlOffset = null) {
    if (xmlOffset != null && xmlOffset >= 0) {
        // Precise mode: replace costume attribute in the tag at xmlOffset
        const tagName = projectXml.startsWith('<stage', xmlOffset) ? 'stage' : 'sprite';
        // Find end of opening tag at xmlOffset
        let i = xmlOffset, inQ = null;
        while (i < projectXml.length) {
            const c = projectXml[i];
            if (inQ) {
                const ci = projectXml.indexOf(inQ, i + 1);
                if (ci === -1) break;
                i = ci + 1; inQ = null; continue;
            }
            if (c === '"' || c === "'") { inQ = c; i++; continue; }
            if (c === '>') break;
            i++;
        }
        const openTag = projectXml.slice(xmlOffset, i + 1);
        const newTag = openTag.replace(/\bcostume="\d+"/, `costume="${costumeIndex}"`);
        if (newTag !== openTag) {
            return projectXml.slice(0, xmlOffset) + newTag + projectXml.slice(xmlOffset + openTag.length);
        }
        return projectXml;
    }
    // Fallback: name-based
    if (targetName === 'Stage') {
        return projectXml.replace(/(<stage [^>]+>)/, tag => tag.replace(/\bcostume="\d+"/, `costume="${costumeIndex}"`));
    }
    const tagRe = new RegExp(`<sprite (?=[^>]*name="${escRe(targetName)}"[^>]*>)[^>]+>`);
    return projectXml.replace(tagRe, tag => tag.replace(/\bcostume="\d+"/, `costume="${costumeIndex}"`));
}

// ── XML helpers ───────────────────────────────────────────────────────────────
export function extractTag(xml, tag) {
    if (!xml) return null;
    const startIdx = xml.search(new RegExp(`<${tag}(\\s|>|/)`));
    if (startIdx === -1) return null;
    let depth = 0, i = startIdx;
    while (i < xml.length) {
        // Jump to next '<' instead of scanning char-by-char through base64 blobs
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
                // Find the end of this opening tag, skipping over quoted attribute values
                let j = i + 1;
                let inQ = null;
                while (j < xml.length) {
                    const c = xml[j];
                    if (inQ) {
                        // Use indexOf to jump to closing quote (huge speedup for base64 blobs)
                        const closeIdx = xml.indexOf(inQ, j + 1);
                        if (closeIdx === -1) { j = xml.length; break; }
                        j = closeIdx + 1;
                        inQ = null;
                        continue;
                    }
                    if (c === '"' || c === "'") { inQ = c; j++; continue; }
                    if (c === '>') break;
                    j++;
                }
                const closeAngle = j;
                if (closeAngle >= xml.length) { i++; continue; }
                if (xml[closeAngle - 1] === '/') {
                    // self-closing tag
                    if (depth === 0) return xml.slice(i, closeAngle + 1);
                    i = closeAngle + 1; continue;
                }
                depth++;
                i = closeAngle + 1; continue;
            }
        }
        i++;
    }
    return null;
}

function extractAllTags(xml, tag) {
    const out = []; let rem = xml;
    for (;;) { const c = extractTag(rem, tag); if (!c) break; out.push(c); rem = rem.slice(rem.indexOf(c) + c.length); }
    return out;
}

function xmlAttrAll(xml, tag, attr) {
    return [...xml.matchAll(new RegExp(`<${tag}[^>]+${attr}="([^"]+)"`, 'g'))].map(m => m[1]);
}

// ── Utilities ─────────────────────────────────────────────────────────────────
async function readFile(file) {
    const dataURL = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
    return {dataURL, name: file.name.replace(/\.[^.]+$/, '')};
}

async function sha512(str) {
    const buf = new TextEncoder().encode(str);
    const h = await crypto.subtle.digest('SHA-512', buf);
    return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function enc(s) { return encodeURIComponent(s); }
function xa(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function rndId() { return String(Math.floor(Math.random() * 9e6 + 1e6)); }
function assertLoggedIn() { if (!state.username) throw new Error('Not logged in'); }

export function downloadProjectXml(projectName, projectXml, mediaXml) {
    const snapdata = `<snapdata>${projectXml}${mediaXml}</snapdata>`;
    const blob = new Blob([snapdata], {type: 'application/xml'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${projectName}_modified.xml`; a.click();
    URL.revokeObjectURL(url);
}

const BLANK_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
