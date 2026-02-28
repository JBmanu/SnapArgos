/**
 * overview.js — Overview page: browse projects → sprites → costumes & sounds
 *
 * FIX: Uses xmlOffset from getSpritesFromXml to precisely identify the correct
 * XML block for each sprite/stage, even when multiple share the same name.
 */
import { getProject, getSpritesFromXml, extractTag } from './snap-api.js?v=14';
import { appState, bus } from './app.js';

let _projectsHandler = null;

const $ = id => document.getElementById(id);
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

export function initOverview() {
    console.log('[overview] init');

    // Render projects if already loaded
    if (appState.projects.length) renderProjects(appState.projects);

    // On new load (including credential refresh): reset all columns then re-render
    if (_projectsHandler) bus.off('projects-loaded', _projectsHandler);
    _projectsHandler = (projects) => {
        resetSprites();
        clearAssets();
        renderProjects(projects);
    };
    bus.on('projects-loaded', _projectsHandler);
}

// ═══ COL 1: PROJECTS ═════════════════════════════════════════════════════════
function renderProjects(projects) {
    const el = $('ov-project-list');
    const badge = $('ov-proj-count');
    if (!el) return;

    el.innerHTML = '';
    if (badge) badge.textContent = projects.length ? `${projects.length}` : '';

    if (!projects.length) {
        el.innerHTML = '<div class="ov-empty-state"><span>No projects found</span></div>';
        return;
    }

    // Ordina alfabeticamente
    const sorted = [...projects].sort((a, b) =>
        a.projectname.localeCompare(b.projectname, undefined, { sensitivity: 'base' }));

    sorted.forEach(p => {
        const row = document.createElement('div');
        row.className = 'ov-row';
        row.dataset.name = p.projectname;
        const date = p.lastupdated
            ? new Date(p.lastupdated).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
            : '';
        row.innerHTML = `
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                    d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/>
            </svg>
            <span class="ov-row-name">${esc(p.projectname)}</span>
            <span class="ov-row-meta">${date}</span>`;
        row.addEventListener('click', () => onProjectClick(p.projectname));
        el.appendChild(row);
    });
}

let _loadToken = 0;

async function onProjectClick(name) {
    // Bump the token — any in-flight load with an older token will be discarded
    const myToken = ++_loadToken;

    // Evidenzia riga attiva
    const el = $('ov-project-list');
    el.querySelectorAll('.ov-row').forEach(r =>
        r.classList.toggle('active', r.dataset.name === name));

    // Reset colonna 3
    clearAssets();

    // Carica sprites
    const spriteEl = $('ov-sprite-list');
    spriteEl.innerHTML = '<div class="ov-loading"><span class="inline-spin"></span></div>';

    try {
        const data = await getOrFetchProject(name);
        // If another project was clicked while we were loading, discard this result
        if (myToken !== _loadToken) return;
        const sprites = getSpritesFromXml(data.projectXml);
        renderSprites(sprites, data);
    } catch (e) {
        if (myToken !== _loadToken) return;
        spriteEl.innerHTML = `<div class="ov-empty-state"><span style="color:#f87171">${esc(e.message)}</span></div>`;
    }
}

// ═══ COL 2: SPRITES ══════════════════════════════════════════════════════════
function renderSprites(sprites, projData) {
    const el = $('ov-sprite-list');
    const badge = $('ov-sprite-count');
    if (!el) return;

    el.innerHTML = '';
    const totalSprites = sprites.filter(s => s.type === 'sprite').length;
    const totalStages  = sprites.filter(s => s.type === 'stage').length;
    if (badge) badge.textContent = sprites.length
        ? `${totalStages} stage${totalStages !== 1 ? 's' : ''}, ${totalSprites} sprite${totalSprites !== 1 ? 's' : ''}`
        : '';

    sprites.forEach(s => {
        const row = document.createElement('div');
        const isStage = s.type === 'stage';
        row.className = isStage ? 'ov-row ov-stage-row' : 'ov-row ov-sprite-row ov-child-row';
        row.dataset.name = s.name;
        row.dataset.type = s.type;
        row.dataset.parentStage = s.parentStage ?? '';
        // Store xmlOffset for precise identification
        row.dataset.xmlOffset = String(s.xmlOffset ?? '');
        row.innerHTML = `
            <svg fill="currentColor" viewBox="0 0 16 16">
                ${isStage
                    ? '<rect x="1" y="2" width="14" height="10" rx="1.5"/><path d="M5 14h6"/>'
                    : '<circle cx="8" cy="6" r="3"/><path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6"/>'}
            </svg>
            <span class="ov-row-name">${esc(s.name)}</span>
            <span class="ov-row-tag">${s.type}</span>`;
        row.addEventListener('click', () => onSpriteClick(s, projData));
        el.appendChild(row);
    });
}

function onSpriteClick(sprite, projData) {
    const el = $('ov-sprite-list');
    el.querySelectorAll('.ov-row').forEach(r => {
        // Use xmlOffset for precise matching when available
        const match = r.dataset.xmlOffset && sprite.xmlOffset != null
            ? r.dataset.xmlOffset === String(sprite.xmlOffset)
            : (r.dataset.name === sprite.name
                && r.dataset.type === sprite.type
                && (r.dataset.parentStage ?? '') === (sprite.parentStage ?? ''));
        r.classList.toggle('active', match);
    });
    renderAssets(sprite, projData);
}

// ═══ COL 3: ASSETS (costumi + suoni) ═════════════════════════════════════════
function resetSprites() {
    const el = $('ov-sprite-list');
    const badge = $('ov-sprite-count');
    if (!el) return;
    if (badge) badge.textContent = '';
    el.innerHTML = `<div class="ov-empty-state"><span>Select a project</span></div>`;
}

function clearAssets() {
    const el = $('ov-asset-list');
    const badge = $('ov-asset-count');
    if (!el) return;
    if (badge) badge.textContent = '';
    el.innerHTML = `<div class="ov-empty-state">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14"/>
        </svg>
        <span>Select a sprite or stage</span>
    </div>`;
}

/**
 * Parse all XML attributes from a tag opening string (handles huge values safely).
 * Uses indexOf to jump over quoted attribute values efficiently.
 */
function parseAttrs(tagStr) {
    const attrs = {};
    // skip past the tag name (e.g. "<costume " or "<sound ")
    let i = tagStr.indexOf(' ');
    if (i === -1) return attrs;
    const len = tagStr.length;
    while (i < len) {
        // skip whitespace
        while (i < len && /\s/.test(tagStr[i])) i++;
        if (tagStr[i] === '>' || tagStr[i] === '/' || i >= len) break;
        // read attr name
        let nameStart = i;
        while (i < len && tagStr[i] !== '=' && tagStr[i] !== '>' && !/\s/.test(tagStr[i])) i++;
        const attrName = tagStr.slice(nameStart, i).trim();
        if (!attrName) { i++; continue; }
        // skip whitespace before '='
        while (i < len && /\s/.test(tagStr[i])) i++;
        if (tagStr[i] !== '=') { attrs[attrName] = ''; continue; }
        i++; // skip '='
        while (i < len && /\s/.test(tagStr[i])) i++;
        // read value - use indexOf for huge speedup on base64 blobs
        if (tagStr[i] === '"' || tagStr[i] === "'") {
            const q = tagStr[i++];
            const closeIdx = tagStr.indexOf(q, i);
            if (closeIdx === -1) break; // malformed
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

/**
 * Extract all opening/self-closing tags of a given name from an XML string.
 * Returns an array of attribute maps (one per tag found).
 * Optimized: skips over huge quoted attribute values using indexOf.
 */
function extractTagAttrs(xml, tagName) {
    if (!xml) return [];
    const results = [];
    const re = new RegExp(`<${tagName}[\\s>]`, 'g');
    let m;
    while ((m = re.exec(xml)) !== null) {
        // find the end of this opening tag (the closing '>' or '/>')
        // Use indexOf to jump over quoted strings efficiently
        let start = m.index;
        let i = start + tagName.length + 1; // skip past "<tagName"
        let inQuote = null;
        while (i < xml.length) {
            const c = xml[i];
            if (inQuote) {
                // Skip to closing quote using indexOf (huge speedup for base64 blobs)
                const closeIdx = xml.indexOf(inQuote, i);
                if (closeIdx === -1) { i = xml.length; break; }
                i = closeIdx + 1;
                inQuote = null;
                continue;
            }
            if (c === '"' || c === "'") {
                inQuote = c;
                i++;
                continue;
            }
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

/**
 * Decode common HTML entities that Snap uses in XML attribute values.
 */
function decodeEntities(s) {
    if (!s || !s.includes('&')) return s;
    return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

/**
 * Build a map from mediaID / id / name → data URL by scanning the <media> XML
 * AND inline images/sounds found anywhere in projectXml.
 * This ensures we can resolve assets regardless of whether Snap cloud
 * kept them inline or moved them to <media>.
 */
function buildMediaMap(mediaXml, projectXml) {
    const map = {};       // id → { type, data }
    const nameMap = {};   // name → { type, data }  (fallback)

    // 1) Scan the <media> section for costume/sound entries with id + data
    if (mediaXml) {
        for (const a of extractTagAttrs(mediaXml, 'costume')) {
            const imgData = a.image ? decodeEntities(a.image) : null;
            if (a.id && imgData) map[a.id] = { type: 'image', data: imgData };
            // Also index by mediaID attribute if present (Snap 11+ uses this key)
            if (a.mediaID && imgData) map[a.mediaID] = { type: 'image', data: imgData };
            if (a.name && imgData && !nameMap[a.name]) nameMap[a.name] = { type: 'image', data: imgData };
        }
        for (const a of extractTagAttrs(mediaXml, 'sound')) {
            const sndData = a.sound ? decodeEntities(a.sound) : null;
            if (a.id && sndData) map[a.id] = { type: 'audio', data: sndData };
            if (a.mediaID && sndData) map[a.mediaID] = { type: 'audio', data: sndData };
            if (a.name && sndData && !nameMap[a.name]) nameMap[a.name] = { type: 'audio', data: sndData };
        }
    }
    // 2) Also scan projectXml for inline images/sounds (some may stay inline)
    //    Only add entries that are NOT already in the map (media section takes priority)
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

/**
 * Build a map from id → {name, type} by scanning the entire projectXml for
 * <costume> and <sound> tags. Used to resolve <ref id="X"/> references.
 */
function buildRefMap(projectXml, mediaXml) {
    const map = {}; // id → { name, assetType }
    if (projectXml) {
        for (const a of extractTagAttrs(projectXml, 'costume')) {
            if (a.id) map[a.id] = { name: a.name || `costume-${a.id}`, assetType: 'costume' };
        }
        for (const a of extractTagAttrs(projectXml, 'sound')) {
            if (a.id) map[a.id] = { name: a.name || `sound-${a.id}`, assetType: 'sound' };
        }
    }
    if (mediaXml) {
        for (const a of extractTagAttrs(mediaXml, 'costume')) {
            if (a.id && !map[a.id]) map[a.id] = { name: a.name || `costume-${a.id}`, assetType: 'costume' };
        }
        for (const a of extractTagAttrs(mediaXml, 'sound')) {
            if (a.id && !map[a.id]) map[a.id] = { name: a.name || `sound-${a.id}`, assetType: 'sound' };
        }
    }
    return map;
}

/**
 * Find the XML block for a specific sprite or stage target.
 *
 * KEY FIX: Uses sprite.xmlOffset (the character position in projectXml) for
 * precise identification. This eliminates all ambiguity when multiple sprites
 * or stages share the same name.
 */
function findTargetBlock(projectXml, sprite) {
    // ── Use xmlOffset for precise lookup when available ──
    if (sprite.xmlOffset != null && sprite.xmlOffset >= 0) {
        const tagName = sprite.type === 'stage' ? 'stage' : 'sprite';
        // Verify that the tag at this offset matches
        if (projectXml.startsWith(`<${tagName}`, sprite.xmlOffset)) {
            const block = extractTag(projectXml.slice(sprite.xmlOffset), tagName);
            if (block) {
                if (sprite.type === 'stage') {
                    // Strip child <sprites> to only get stage's own assets
                    const spIdx = block.indexOf('<sprites');
                    return spIdx !== -1 ? block.slice(0, spIdx) + '</stage>' : block;
                }
                return block;
            }
        }
        console.warn(`[findTargetBlock] xmlOffset ${sprite.xmlOffset} did not match expected <${tagName}>, falling back`);
    }

    // ── Fallback: name-based search (original logic) ──

    if (sprite.type === 'stage') {
        // Scan for <stage tags robustly
        let searchFrom = 0;
        while (searchFrom < projectXml.length) {
            const idx = projectXml.indexOf('<stage', searchFrom);
            if (idx === -1) break;
            const after = projectXml[idx + 6];
            if (after && !/[\s>\/]/.test(after)) { searchFrom = idx + 1; continue; }

            const block = extractTag(projectXml.slice(idx), 'stage');
            if (!block) { searchFrom = idx + 1; continue; }

            // Read name from opening tag
            let j = 0, inQ = null;
            while (j < block.length) {
                const c = block[j];
                if (inQ) {
                    const closeIdx = block.indexOf(inQ, j + 1);
                    if (closeIdx === -1) break;
                    j = closeIdx + 1;
                    inQ = null;
                    continue;
                }
                if (c === '"' || c === "'") { inQ = c; j++; continue; }
                if (c === '>') break;
                j++;
            }
            const openTag = block.slice(0, j + 1);
            const attrs = parseAttrs(openTag);
            const name = attrs.name || 'Stage';

            if (name === sprite.name) {
                const spIdx = block.indexOf('<sprites');
                return spIdx !== -1 ? block.slice(0, spIdx) + '</stage>' : block;
            }
            searchFrom = idx + block.length;
        }

        // Fallback: first stage
        const idx = projectXml.indexOf('<stage');
        if (idx !== -1) {
            const block = extractTag(projectXml.slice(idx), 'stage');
            if (block) {
                const spIdx = block.indexOf('<sprites');
                return spIdx !== -1 ? block.slice(0, spIdx) + '</stage>' : block;
            }
        }
        return null;
    }

    // ── Sprite: find by name, disambiguate by parentStage ──
    const nameEsc = escRe(sprite.name);
    const re = new RegExp(`<sprite[\\s][^>]*\\bname="${nameEsc}"[^>]*>`, 'g');
    let m;
    const candidates = [];
    while ((m = re.exec(projectXml)) !== null) {
        const start = m.index;
        const block = extractTag(projectXml.slice(start), 'sprite');
        if (!block) continue;
        const parentStage = _findLastStageName(projectXml, start);
        candidates.push({ block, stage: parentStage });
    }
    if (!candidates.length) return null;
    if (sprite.parentStage) {
        const match = candidates.find(c => c.stage === sprite.parentStage);
        if (match) return match.block;
    }
    return candidates[0].block;
}

/**
 * Find the name of the last <stage> tag appearing before position `beforePos` in xml.
 */
function _findLastStageName(xml, beforePos) {
    let lastName = 'Stage';
    let searchFrom = 0;
    const region = xml.slice(0, beforePos);
    while (searchFrom < region.length) {
        const idx = region.indexOf('<stage', searchFrom);
        if (idx === -1) break;
        const after = region[idx + 6];
        if (after && !/[\s>\/]/.test(after)) { searchFrom = idx + 1; continue; }
        let i = idx + 6, inQ = null;
        while (i < region.length) {
            const c = region[i];
            if (inQ) {
                const closeIdx = region.indexOf(inQ, i + 1);
                if (closeIdx === -1) { i = region.length; break; }
                i = closeIdx + 1; inQ = null; continue;
            }
            if (c === '"' || c === "'") { inQ = c; i++; continue; }
            if (c === '>') break;
            i++;
        }
        const openTag = region.slice(idx, i + 1);
        const attrs = parseAttrs(openTag);
        if (attrs.name) lastName = attrs.name;
        searchFrom = i + 1;
    }
    return lastName;
}

/**
 * Decode a Snap! mediaID string into its components.
 */
function parseMediaID(mediaID) {
    if (!mediaID) return null;
    const cstIdx = mediaID.indexOf('_cst_');
    const sndIdx = mediaID.indexOf('_snd_');
    if (cstIdx !== -1) {
        const name  = mediaID.slice(cstIdx + 5);
        const prefix = mediaID.slice(0, cstIdx);
        const ownerRaw = prefix.slice(prefix.indexOf('_') + 1);
        return { owner: ownerRaw, assetType: 'costume', name };
    }
    if (sndIdx !== -1) {
        const name  = mediaID.slice(sndIdx + 5);
        const prefix = mediaID.slice(0, sndIdx);
        const ownerRaw = prefix.slice(prefix.indexOf('_') + 1);
        return { owner: ownerRaw, assetType: 'sound', name };
    }
    return null;
}

/**
 * Extract asset info from a section of XML (<costumes>...</costumes> or <sounds>...</sounds>),
 * handling both <costume>/<sound> tags AND <ref id="X"/> / <ref mediaID="Y"/> tags.
 *
 * FIX: Only considers <ref> tags that appear inside <item> wrappers within the
 * costumes/sounds list, not inside <script> or other nested blocks.
 *
 * Returns an array of { name, id, mediaID, hasImage, hasSound, isRef, owner }
 */
function extractAssetsFromRegion(xml, assetTag, refMap) {
    const assets = [];

    // First, extract the <list> inside the section — this is where the actual
    // asset items live. Refs inside <scripts> or other blocks are NOT assets.
    const listXml = extractTag(xml, 'list');
    if (!listXml) {
        // No <list> found — try scanning the raw section (backwards compat)
        return _extractAssetsRaw(xml, assetTag, refMap);
    }

    // Now scan only within the <list> for <item> wrappers
    // Each <item> should contain exactly one <costume>, <sound>, or <ref>
    let pos = 0;
    while (pos < listXml.length) {
        const itemStart = listXml.indexOf('<item', pos);
        if (itemStart === -1) break;
        const afterItem = listXml[itemStart + 5];
        if (afterItem && !/[\s>\/]/.test(afterItem)) { pos = itemStart + 1; continue; }

        const itemBlock = extractTag(listXml.slice(itemStart), 'item');
        if (!itemBlock) { pos = itemStart + 1; continue; }

        // Look for the asset tag or <ref> inside this <item>
        const assetResult = _extractSingleAsset(itemBlock, assetTag, refMap);
        if (assetResult) {
            assets.push(assetResult);
        }

        pos = itemStart + itemBlock.length;
    }

    return assets;
}

/**
 * Extract a single asset from an <item> block.
 * Looks for <costume>/<sound> first, then <ref>.
 */
function _extractSingleAsset(itemXml, assetTag, refMap) {
    // Check for direct asset tag
    const assetIdx = itemXml.indexOf('<' + assetTag);
    if (assetIdx !== -1) {
        const afterChar = itemXml[assetIdx + assetTag.length + 1];
        if (afterChar && /[\s>\/]/.test(afterChar)) {
            // Parse the tag attributes
            let i = assetIdx + assetTag.length + 1;
            let inQ = null;
            while (i < itemXml.length) {
                const c = itemXml[i];
                if (inQ) {
                    const ci = itemXml.indexOf(inQ, i);
                    if (ci === -1) { i = itemXml.length; break; }
                    i = ci + 1; inQ = null; continue;
                }
                if (c === '"' || c === "'") { inQ = c; i++; continue; }
                if (c === '>') break;
                i++;
            }
            const tagStr = itemXml.slice(assetIdx, i + 1);
            const attrs = parseAttrs(tagStr);
            return {
                name: attrs.name ? decodeEntities(attrs.name) : null,
                id: attrs.id || null,
                mediaID: attrs.mediaID || null,
                hasImage: !!(attrs.image && attrs.image.startsWith('data:')),
                hasSound: !!(attrs.sound && attrs.sound.startsWith('data:')),
                isRef: false,
            };
        }
    }

    // Check for <ref> tag
    const refIdx = itemXml.indexOf('<ref');
    if (refIdx !== -1) {
        const afterChar = itemXml[refIdx + 4];
        if (afterChar && /[\s>\/]/.test(afterChar)) {
            let i = refIdx + 4;
            while (i < itemXml.length && itemXml[i] !== '>') i++;
            const tagStr = itemXml.slice(refIdx, i + 1);
            const attrs = parseAttrs(tagStr);

            // Case 1: <ref mediaID="...">
            if (attrs.mediaID) {
                const parsed = parseMediaID(attrs.mediaID);
                if (parsed && parsed.assetType === assetTag) {
                    return {
                        name: parsed.name,
                        id: null,
                        mediaID: attrs.mediaID,
                        hasImage: false,
                        hasSound: false,
                        isRef: true,
                        owner: parsed.owner,
                    };
                }
            }

            // Case 2: <ref id="X"/>
            const refId = attrs.id;
            const resolved = refId ? refMap[refId] : null;
            if (resolved && resolved.assetType === assetTag) {
                return {
                    name: resolved.name,
                    id: refId,
                    mediaID: null,
                    hasImage: false,
                    hasSound: false,
                    isRef: true,
                    owner: null,
                };
            }
        }
    }

    return null;
}

/**
 * Fallback: raw extraction without <list>/<item> structure.
 * Used when the section doesn't have a proper <list> wrapper.
 */
function _extractAssetsRaw(xml, assetTag, refMap) {
    const assets = [];
    for (const a of extractTagAttrs(xml, assetTag)) {
        assets.push({
            name: a.name ? decodeEntities(a.name) : null,
            id: a.id || null,
            mediaID: a.mediaID || null,
            hasImage: !!(a.image && a.image.startsWith('data:')),
            hasSound: !!(a.sound && a.sound.startsWith('data:')),
            isRef: false,
        });
    }
    return assets;
}


/**
 * Main asset rendering — always uses string-based parsing (robust with Snap XML).
 */
function renderAssets(sprite, projData) {
    const el = $('ov-asset-list');
    const badge = $('ov-asset-count');
    if (!el) return;
    el.innerHTML = '';

    // Content container
    const content = document.createElement('div');
    el.appendChild(content);

    if (!projData.projectXml) {
        content.innerHTML = `<div class="ov-empty-state"><span style="color:#f87171">No project data — projectXml is null/empty</span></div>`;
        return;
    }

    try {
        _renderAssetsInner(content, badge, sprite, projData);
    } catch (err) {
        console.error('[renderAssets] Error:', err);
        content.innerHTML = `<div class="ov-empty-state"><span style="color:#f87171">Error: ${esc(err.message)}</span></div>`;
    }
}


function _renderAssetsInner(el, badge, sprite, projData) {
    // Find the XML block for this stage/sprite using xmlOffset for precision
    const blockXml = findTargetBlock(projData.projectXml, sprite);

    if (!blockXml) {
        el.innerHTML = `<div class="ov-empty-state"><span style="color:#f87171">Could not find "${esc(sprite.name)}" in project XML</span></div>`;
        return;
    }

    // Build maps for resolving refs and media
    const refMap = buildRefMap(projData.projectXml, projData.mediaXml);
    const mediaMap = buildMediaMap(projData.mediaXml, projData.projectXml);

    // ── Extract costumes using extractTag for proper nesting ──
    const costumes = [];
    const costumesSection = extractTag(blockXml, 'costumes');
    if (costumesSection) {
        const found = extractAssetsFromRegion(costumesSection, 'costume', refMap);
        for (const a of found) {
            costumes.push({
                name: a.name || `costume-${a.id || '?'}`,
                id: a.id,
                mediaID: a.mediaID,
                hasImage: a.hasImage,
                isRef: a.isRef,
                owner: a.owner || null,
            });
        }
    }

    // ── Extract sounds using extractTag for proper nesting ──
    const sounds = [];
    const soundsSection = extractTag(blockXml, 'sounds');
    if (soundsSection) {
        const found = extractAssetsFromRegion(soundsSection, 'sound', refMap);
        for (const a of found) {
            sounds.push({
                name: a.name || `sound-${a.id || '?'}`,
                id: a.id,
                mediaID: a.mediaID,
                hasSound: a.hasSound,
                isRef: a.isRef,
                owner: a.owner || null,
            });
        }
    }

    // ── Fallback: if no costumes/sounds found via structured extraction,
    //    try matching by name from mediaMap — but ONLY for names that appear
    //    directly in THIS target's <costumes>/<sounds> blocks. ──
    if (costumes.length === 0 && sounds.length === 0) {
        const costumeNamesInBlock = new Set();
        const soundNamesInBlock   = new Set();

        if (costumesSection) {
            for (const a of extractTagAttrs(costumesSection, 'costume')) {
                const name = a.name ? decodeEntities(a.name) : null;
                if (name) costumeNamesInBlock.add(name);
            }
        }
        if (soundsSection) {
            for (const a of extractTagAttrs(soundsSection, 'sound')) {
                const name = a.name ? decodeEntities(a.name) : null;
                if (name) soundNamesInBlock.add(name);
            }
        }

        // Only include assets whose names are explicitly declared in THIS block
        for (const [name, entry] of Object.entries(mediaMap.byName)) {
            if (entry.type === 'image' && costumeNamesInBlock.has(name)) {
                costumes.push({ name, id: null, mediaID: null, hasImage: true, isRef: false });
            } else if (entry.type === 'audio' && soundNamesInBlock.has(name)) {
                sounds.push({ name, id: null, mediaID: null, hasSound: true, isRef: false });
            }
        }

        // Last resort: if we have NO costume/sound names in the block at all,
        // and the block truly has no <costumes>/<sounds> sections, show nothing.
        // Do NOT fall back to showing all assets — that causes the duplicate bug.
    }

    const total = costumes.length + sounds.length;
    if (badge) badge.textContent = total ? `${total} asset${total !== 1 ? 's' : ''}` : '';

    if (!total) {
        const empty = document.createElement('div');
        empty.className = 'ov-empty-state';
        empty.innerHTML = '<span>No costumes or sounds found</span>';
        el.appendChild(empty);
        return;
    }

    // ── Helper: resolve image data for a costume ──
    function resolveImageData(costume) {
        if (costume.hasImage && costume.id && mediaMap.byId[costume.id]) {
            return mediaMap.byId[costume.id].data;
        }
        if (costume.mediaID && mediaMap.byId[costume.mediaID]) {
            return mediaMap.byId[costume.mediaID].data;
        }
        if (costume.id && mediaMap.byId[costume.id]) {
            return mediaMap.byId[costume.id].data;
        }
        if (costume.name && mediaMap.byName[costume.name]) {
            return mediaMap.byName[costume.name].data;
        }
        return null;
    }

    // ── Helper: close all open asset menus ──
    function closeAllMenus() {
        el.querySelectorAll('.ov-asset-menu.open').forEach(m => m.classList.remove('open'));
    }
    document.addEventListener('click', closeAllMenus, { capture: true, once: false });
    const _cleanup = () => document.removeEventListener('click', closeAllMenus, { capture: true });
    const observer = new MutationObserver((_, obs) => { if (!el.isConnected) { _cleanup(); obs.disconnect(); } });
    observer.observe(document.body, { childList: true, subtree: true });

    // ── Helper: build three-dots menu button ──
    function makeMenuBtn(menuItems) {
        const wrap = document.createElement('div');
        wrap.className = 'ov-menu-wrap';

        const btn = document.createElement('button');
        btn.className = 'ov-menu-btn';
        btn.title = 'More options';
        btn.innerHTML = `<svg fill="currentColor" viewBox="0 0 20 20" width="14" height="14">
            <circle cx="10" cy="4"  r="1.5"/>
            <circle cx="10" cy="10" r="1.5"/>
            <circle cx="10" cy="16" r="1.5"/>
        </svg>`;

        const menu = document.createElement('div');
        menu.className = 'ov-asset-menu';
        menuItems.forEach(({ label, icon, action }) => {
            const row = document.createElement('button');
            row.className = 'ov-asset-menu-item';
            row.innerHTML = `${icon}<span>${label}</span>`;
            row.addEventListener('click', e => { e.stopPropagation(); closeAllMenus(); action(); });
            menu.appendChild(row);
        });

        btn.addEventListener('click', e => {
            e.stopPropagation();
            const isOpen = menu.classList.contains('open');
            closeAllMenus();
            if (!isOpen) menu.classList.add('open');
        });

        wrap.appendChild(btn);
        wrap.appendChild(menu);
        return wrap;
    }

    // ── Helper: download a data-URL ──
    function downloadDataUrl(dataUrl, filename) {
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = filename;
        a.click();
    }

    // ── Render costumes ──
    if (costumes.length) {
        const head = document.createElement('div');
        head.className = 'ov-section-head';
        head.innerHTML = `
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
            </svg>
            Costumes
            <span class="ov-section-badge">${costumes.length}</span>`;
        el.appendChild(head);

        costumes.forEach((c, i) => {
            const imgData = resolveImageData(c);
            const item = document.createElement('div');
            item.className = 'ov-asset-item';

            const thumbHtml = imgData
                ? `<div class="ov-thumb"><img src="${esc(imgData)}" alt="${esc(c.name)}" style="max-width:100%;max-height:100%;object-fit:contain;border-radius:3px;"/></div>`
                : `<div class="ov-thumb"><span class="ov-thumb-placeholder">🖼</span></div>`;

            const refTag   = c.isRef ? '<span class="ov-ref-tag" title="Shared reference (ref)">ref</span>' : '';
            const mediaTag = c.mediaID ? '<span class="ov-media-tag" title="Image in media section">media</span>' : '';
            const ownerTag = c.owner ? `<span class="ov-owner-tag" title="Owner sprite/stage">${esc(c.owner)}</span>` : '';

            item.innerHTML = `
                ${thumbHtml}
                <div class="ov-asset-info">
                    <div class="ov-asset-name">${esc(c.name)}</div>
                    <div class="ov-asset-detail">costume ${i + 1} ${ownerTag}${refTag}${mediaTag}</div>
                </div>
                <span class="ov-index-badge costume">#${i + 1}</span>`;

            if (imgData) {
                const ext = imgData.startsWith('data:image/svg') ? 'svg'
                          : imgData.startsWith('data:image/png') ? 'png'
                          : imgData.startsWith('data:image/jpeg') ? 'jpg' : 'png';
                const menuBtn = makeMenuBtn([{
                    label: 'Download image',
                    icon: `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="13" height="13">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
                    </svg>`,
                    action: () => downloadDataUrl(imgData, `${c.name}.${ext}`),
                }]);
                item.appendChild(menuBtn);
            }

            el.appendChild(item);
        });
    }

    // ── Render sounds ──
    if (sounds.length) {
        const head = document.createElement('div');
        head.className = 'ov-section-head';
        head.innerHTML = `
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M15.536 8.464a5 5 0 010 7.072M12 6v12m-3.536-2.464a5 5 0 010-7.072M18.364 5.636a9 9 0 010 12.728M5.636 18.364a9 9 0 010-12.728"/>
            </svg>
            Sounds
            <span class="ov-section-badge">${sounds.length}</span>`;
        el.appendChild(head);

        sounds.forEach((s, i) => {
            let soundData = null;
            if (s.mediaID && mediaMap.byId[s.mediaID]) soundData = mediaMap.byId[s.mediaID].data;
            else if (s.id && mediaMap.byId[s.id]) soundData = mediaMap.byId[s.id].data;
            else if (s.name && mediaMap.byName[s.name]) soundData = mediaMap.byName[s.name].data;

            const refTag   = s.isRef ? '<span class="ov-ref-tag" title="Shared reference (ref)">ref</span>' : '';
            const mediaTag = s.mediaID ? '<span class="ov-media-tag" title="Sound in media section">media</span>' : '';
            const ownerTag = s.owner ? `<span class="ov-owner-tag" title="Owner sprite/stage">${esc(s.owner)}</span>` : '';

            const item = document.createElement('div');
            item.className = 'ov-asset-item ov-sound-item';

            const topRow = document.createElement('div');
            topRow.className = 'ov-sound-top';

            const soundThumb = `<div class="ov-sound-thumb">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                        d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z"/>
                </svg>
            </div>`;

            topRow.innerHTML = `
                ${soundThumb}
                <div class="ov-asset-info">
                    <div class="ov-asset-name">${esc(s.name)}</div>
                    <div class="ov-asset-detail">sound ${i + 1} ${ownerTag}${refTag}${mediaTag}</div>
                </div>
                <span class="ov-index-badge sound">#${i + 1}</span>`;

            if (soundData) {
                const ext = soundData.startsWith('data:audio/mpeg') ? 'mp3'
                          : soundData.startsWith('data:audio/wav')  ? 'wav'
                          : soundData.startsWith('data:audio/ogg')  ? 'ogg' : 'wav';
                const menuBtn = makeMenuBtn([{
                    label: 'Download sound',
                    icon: `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="13" height="13">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
                    </svg>`,
                    action: () => downloadDataUrl(soundData, `${s.name}.${ext}`),
                }]);
                topRow.appendChild(menuBtn);
            }

            item.appendChild(topRow);

            if (soundData) {
                const playerWrap = document.createElement('div');
                playerWrap.className = 'ov-sound-player-wrap';
                playerWrap.innerHTML = `<audio class="ov-sound-player" controls preload="none" src="${esc(soundData)}"></audio>`;
                item.appendChild(playerWrap);
            }

            el.appendChild(item);
        });
    }
}

// ── Helper ──
async function getOrFetchProject(name) {
    const data = await getProject(name);
    appState.projectCache.set(name, data);
    return data;
}
