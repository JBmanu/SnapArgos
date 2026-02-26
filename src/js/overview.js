/**
 * overview.js — Overview page: browse projects → sprites → costumes & sounds
 */
import { getProject, getSpritesFromXml, extractTag } from './snap-api.js?v=14';
import { appState, bus } from './app.js';

let _projectsHandler = null;

const $ = id => document.getElementById(id);
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

export function initOverview() {
    console.log('[overview] init');

    // Render progetti se già caricati
    if (appState.projects.length) renderProjects(appState.projects);

    // Ascolta nuovi caricamenti
    if (_projectsHandler) bus.off('projects-loaded', _projectsHandler);
    _projectsHandler = (projects) => renderProjects(projects);
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

async function onProjectClick(name) {
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
        const sprites = getSpritesFromXml(data.projectXml);
        renderSprites(sprites, data);
    } catch (e) {
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
        const match = r.dataset.name === sprite.name
            && r.dataset.type === sprite.type
            && (r.dataset.parentStage ?? '') === (sprite.parentStage ?? '');
        r.classList.toggle('active', match);
    });
    renderAssets(sprite, projData);
}

// ═══ COL 3: ASSETS (costumi + suoni) ═════════════════════════════════════════
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
    const t0 = performance.now();
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
    console.log('[buildMediaMap] done in', (performance.now() - t0).toFixed(1), 'ms |',
        'byId:', Object.keys(map).length, '| byName:', Object.keys(nameMap).length);
    return { byId: map, byName: nameMap };
}

/**
 * Build a map from assetName → { type: 'costume'|'sound', ownerName: string }
 * by scanning every <stage> and <sprite> block in projectXml.
 * Used by the fallback path to associate mediaMap.byName entries with their owners.
 */
function buildOwnershipMap(projectXml, refMap) {
    const ownerMap = {}; // name → { type, ownerName }

    function scanTarget(blockXml, ownerName) {
        // Costumes
        const cStart = blockXml.indexOf('<costumes');
        const cEnd   = blockXml.indexOf('</costumes>', cStart !== -1 ? cStart : 0);
        if (cStart !== -1 && cEnd !== -1 && cEnd > cStart) {
            const region = blockXml.slice(cStart, cEnd + 11);
            for (const a of extractTagAttrs(region, 'costume')) {
                const name = a.name ? decodeEntities(a.name) : null;
                if (name && !ownerMap[name]) ownerMap[name] = { type: 'costume', ownerName };
            }
            // Also handle <ref> tags resolved via refMap
            for (const a of extractTagAttrs(region, 'ref')) {
                const resolved = a.id ? refMap[a.id] : null;
                if (resolved && resolved.assetType === 'costume' && !ownerMap[resolved.name]) {
                    ownerMap[resolved.name] = { type: 'costume', ownerName };
                }
            }
        }
        // Sounds
        const sStart = blockXml.indexOf('<sounds');
        const sEnd   = blockXml.indexOf('</sounds>', sStart !== -1 ? sStart : 0);
        if (sStart !== -1 && sEnd !== -1 && sEnd > sStart) {
            const region = blockXml.slice(sStart, sEnd + 9);
            for (const a of extractTagAttrs(region, 'sound')) {
                const name = a.name ? decodeEntities(a.name) : null;
                if (name && !ownerMap[name]) ownerMap[name] = { type: 'sound', ownerName };
            }
            for (const a of extractTagAttrs(region, 'ref')) {
                const resolved = a.id ? refMap[a.id] : null;
                if (resolved && resolved.assetType === 'sound' && !ownerMap[resolved.name]) {
                    ownerMap[resolved.name] = { type: 'sound', ownerName };
                }
            }
        }
    }

    // Scan every <stage> (strip its <sprites> child to get stage-own assets only)
    let searchFrom = 0;
    while (searchFrom < projectXml.length) {
        const idx = projectXml.indexOf('<stage', searchFrom);
        if (idx === -1) break;
        const after = projectXml[idx + 6];
        if (after && !/[\s>\/]/.test(after)) { searchFrom = idx + 1; continue; }
        const block = extractTag(projectXml.slice(idx), 'stage');
        if (!block) { searchFrom = idx + 1; continue; }
        // Get stage name
        let j = 0, inQ = null;
        while (j < block.length) {
            const c = block[j];
            if (inQ) { const ci = block.indexOf(inQ, j + 1); if (ci === -1) break; j = ci + 1; inQ = null; continue; }
            if (c === '"' || c === "'") { inQ = c; j++; continue; }
            if (c === '>') break;
            j++;
        }
        const stageAttrs = parseAttrs(block.slice(0, j + 1));
        const stageName = stageAttrs.name || 'Stage';
        // Strip <sprites> so we only scan stage-own assets
        const spIdx = block.indexOf('<sprites');
        const stageBlock = spIdx !== -1 ? block.slice(0, spIdx) + '</stage>' : block;
        scanTarget(stageBlock, stageName);
        searchFrom = idx + block.length;
    }

    // Scan every <sprite>
    searchFrom = 0;
    while (searchFrom < projectXml.length) {
        const idx = projectXml.indexOf('<sprite', searchFrom);
        if (idx === -1) break;
        const after = projectXml[idx + 7];
        if (after && !/[\s>\/]/.test(after)) { searchFrom = idx + 1; continue; }
        const block = extractTag(projectXml.slice(idx), 'sprite');
        if (!block) { searchFrom = idx + 1; continue; }
        // Get sprite name from opening tag
        let j = 0, inQ = null;
        while (j < block.length) {
            const c = block[j];
            if (inQ) { const ci = block.indexOf(inQ, j + 1); if (ci === -1) break; j = ci + 1; inQ = null; continue; }
            if (c === '"' || c === "'") { inQ = c; j++; continue; }
            if (c === '>') break;
            j++;
        }
        const spriteAttrs = parseAttrs(block.slice(0, j + 1));
        const spriteName = spriteAttrs.name || 'Sprite';
        scanTarget(block, spriteName);
        searchFrom = idx + block.length;
    }

    return ownerMap;
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
 * Find the XML block for a specific sprite or stage target, handling:
 * - Multiple stages
 * - Sprites with same name in different stages (uses parentStage)
 * - Stage pentrails and other huge base64 attributes
 */
function findTargetBlock(projectXml, sprite) {
    if (sprite.type === 'stage') {
        // Scan for <stage tags robustly (indexOf-based, avoids regex issues with huge attrs)
        let searchFrom = 0;
        while (searchFrom < projectXml.length) {
            const idx = projectXml.indexOf('<stage', searchFrom);
            if (idx === -1) break;
            const after = projectXml[idx + 6];
            if (after && !/[\s>\/]/.test(after)) { searchFrom = idx + 1; continue; }

            const block = extractTag(projectXml.slice(idx), 'stage');
            if (!block) { searchFrom = idx + 1; continue; }

            // Read name from opening tag using parseAttrs (safe with huge pentrails attrs)
            let j = 0, inQ = null;
            while (j < block.length) {
                const c = block[j];
                if (inQ) {
                    // Skip over quoted values using indexOf for efficiency
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
                // Strip child <sprites> to only get the stage's own costumes/sounds
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
        // Determine parent stage using indexOf-based scanning (safe with huge pentrails)
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
 * Uses indexOf-based scanning to safely skip over huge pentrails attributes.
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
        // Read name attribute from this <stage> opening tag
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

/**
 * Decode a Snap! mediaID string into its components.
 * Format: {projectName}_{spriteName}_{cst|snd}_{assetName}
 * e.g. "Snake_snake_cst_tetris-Sheet" → { owner: "snake", assetType: "costume", name: "tetris-Sheet" }
 * Returns null if the format is not recognised.
 */
function parseMediaID(mediaID) {
    if (!mediaID) return null;
    // Split on first two underscores to get projectName and spriteName,
    // then the type token (cst/snd), then the rest is the asset name.
    // Pattern: <project>_<sprite>_<cst|snd>_<name>
    const cstIdx = mediaID.indexOf('_cst_');
    const sndIdx = mediaID.indexOf('_snd_');
    if (cstIdx !== -1) {
        const name  = mediaID.slice(cstIdx + 5);          // after "_cst_"
        const prefix = mediaID.slice(0, cstIdx);           // "Project_sprite"
        const ownerRaw = prefix.slice(prefix.indexOf('_') + 1); // strip project prefix
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
 * Extract asset info from a section of XML, handling both <costume>/<sound> tags
 * AND <ref id="X"/> / <ref mediaID="Y"/> tags (Snap's deduplication mechanism).
 *
 * Returns an array of { name, id, mediaID, hasImage, hasSound, isRef, owner }
 */
function extractAssetsFromRegion(xml, assetTag, refMap) {
    const assets = [];
    // Scan for both <assetTag ...> and <ref ...> within <item> wrappers
    let pos = 0;
    while (pos < xml.length) {
        // Find next <item> or next tag of interest
        const nextAsset = xml.indexOf('<' + assetTag, pos);
        const nextRef = xml.indexOf('<ref', pos);

        // Determine which comes first
        let useAsset = nextAsset !== -1;
        let useRef = nextRef !== -1;

        if (useAsset && useRef) {
            if (nextRef < nextAsset) useAsset = false;
            else useRef = false;
        }

        if (!useAsset && !useRef) break;

        if (useAsset) {
            const tagIdx = nextAsset;
            const afterChar = xml[tagIdx + assetTag.length + 1];
            if (afterChar && !/[\s>\/]/.test(afterChar)) { pos = tagIdx + 1; continue; }

            // Parse opening tag attributes
            let i = tagIdx + assetTag.length + 1;
            let inQ = null;
            while (i < xml.length) {
                const c = xml[i];
                if (inQ) {
                    const ci = xml.indexOf(inQ, i);
                    if (ci === -1) { i = xml.length; break; }
                    i = ci + 1; inQ = null; continue;
                }
                if (c === '"' || c === "'") { inQ = c; i++; continue; }
                if (c === '>') break;
                i++;
            }
            const tagStr = xml.slice(tagIdx, i + 1);
            const attrs = parseAttrs(tagStr);
            assets.push({
                name: attrs.name ? decodeEntities(attrs.name) : null,
                id: attrs.id || null,
                mediaID: attrs.mediaID || null,
                hasImage: !!(attrs.image && attrs.image.startsWith('data:')),
                hasSound: !!(attrs.sound && attrs.sound.startsWith('data:')),
                isRef: false,
            });
            pos = i + 1;
        } else {
            // <ref id="X"/> or <ref mediaID="Y"/>
            const tagIdx = nextRef;
            const afterChar = xml[tagIdx + 4];
            if (afterChar && !/[\s>\/]/.test(afterChar)) { pos = tagIdx + 1; continue; }

            // Parse <ref .../>
            let i = tagIdx + 4;
            while (i < xml.length && xml[i] !== '>') i++;
            const tagStr = xml.slice(tagIdx, i + 1);
            const attrs = parseAttrs(tagStr);

            // Case 1: <ref mediaID="Snake_snake_cst_tetris-Sheet"> (Snap 11+)
            if (attrs.mediaID) {
                const parsed = parseMediaID(attrs.mediaID);
                if (parsed && parsed.assetType === assetTag) {
                    assets.push({
                        name: parsed.name,
                        id: null,
                        mediaID: attrs.mediaID,
                        hasImage: false,
                        hasSound: false,
                        isRef: true,
                        owner: parsed.owner,
                    });
                }
                pos = i + 1;
                continue;
            }

            // Case 2: <ref id="X"/> — look up in refMap
            const refId = attrs.id;
            const resolved = refId ? refMap[refId] : null;
            if (resolved && resolved.assetType === assetTag) {
                assets.push({
                    name: resolved.name,
                    id: refId,
                    mediaID: null,
                    hasImage: false,
                    hasSound: false,
                    isRef: true,
                    owner: null,
                });
            }
            pos = i + 1;
        }
    }
    return assets;
}


function _renderAssetsInner(el, badge, sprite, projData) {
    // Find the XML block for this stage/sprite
    const blockXml = findTargetBlock(projData.projectXml, sprite);

    if (!blockXml) {
        el.innerHTML = `<div class="ov-empty-state"><span style="color:#f87171">Could not find "${esc(sprite.name)}" in project XML</span></div>`;
        return;
    }

    // Build maps for resolving refs and media
    const refMap = buildRefMap(projData.projectXml, projData.mediaXml);
    const mediaMap = buildMediaMap(projData.mediaXml, projData.projectXml);

    // ── Extract costumes ──
    const costumes = [];
    const costumesStart = blockXml.indexOf('<costumes');
    const costumesEnd = blockXml.indexOf('</costumes>', costumesStart !== -1 ? costumesStart : 0);
    if (costumesStart !== -1 && costumesEnd !== -1 && costumesEnd > costumesStart) {
        const costumesRegion = blockXml.slice(costumesStart, costumesEnd + 11);
        const found = extractAssetsFromRegion(costumesRegion, 'costume', refMap);
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

    // ── Extract sounds ──
    const sounds = [];
    const soundsStart = blockXml.indexOf('<sounds');
    const soundsEnd = blockXml.indexOf('</sounds>', soundsStart !== -1 ? soundsStart : 0);
    if (soundsStart !== -1 && soundsEnd !== -1 && soundsEnd > soundsStart) {
        const soundsRegion = blockXml.slice(soundsStart, soundsEnd + 9);
        const found = extractAssetsFromRegion(soundsRegion, 'sound', refMap);
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

    console.log('[renderAssets]', sprite.name, '→', costumes.length, 'costumes,', sounds.length, 'sounds');

    // ── Fallback: if blockXml costumes/sounds have no resolvable data (no id, no inline
    //    image), try extracting asset names directly from the blockXml <costume name="...">
    //    and <sound name="..."> tags and matching them against mediaMap.byName.
    //    This handles projects where <costume>/<sound> carry only a name attribute.
    if (costumes.length === 0 && sounds.length === 0) {
        // Strategy 1: collect names directly declared in THIS target's <costumes>/<sounds> blocks
        const costumeNamesInBlock = new Set();
        const soundNamesInBlock   = new Set();

        if (costumesStart !== -1 && costumesEnd !== -1 && costumesEnd > costumesStart) {
            const region = blockXml.slice(costumesStart, costumesEnd + 11);
            for (const a of extractTagAttrs(region, 'costume')) {
                const name = a.name ? decodeEntities(a.name) : null;
                if (name) costumeNamesInBlock.add(name);
            }
        }
        if (soundsStart !== -1 && soundsEnd !== -1 && soundsEnd > soundsStart) {
            const region = blockXml.slice(soundsStart, soundsEnd + 9);
            for (const a of extractTagAttrs(region, 'sound')) {
                const name = a.name ? decodeEntities(a.name) : null;
                if (name) soundNamesInBlock.add(name);
            }
        }

        // Strategy 2: if projectXml has tags, build ownership map as cross-check
        const ownerMap = (Object.keys(refMap).length > 0)
            ? buildOwnershipMap(projData.projectXml, refMap)
            : {};

        console.log('[renderAssets] fallback: costumeNames in block:', [...costumeNamesInBlock],
            '| soundNames:', [...soundNamesInBlock], '| ownerMap size:', Object.keys(ownerMap).length);

        for (const [name, entry] of Object.entries(mediaMap.byName)) {
            // Determine if this asset belongs to the current target:
            // - First check if its name appears directly in the blockXml sections (most reliable)
            // - Fall back to ownerMap if available
            // - If neither source gives ANY ownership info at all, show all assets (last resort)
            const inBlock = entry.type === 'image'
                ? costumeNamesInBlock.has(name)
                : soundNamesInBlock.has(name);
            const owner = ownerMap[name];
            const ownedByThis = inBlock || (owner && owner.ownerName === sprite.name);

            // If we have no ownership info anywhere, include asset unconditionally (last resort)
            const noOwnershipInfo = costumeNamesInBlock.size === 0 && soundNamesInBlock.size === 0
                && Object.keys(ownerMap).length === 0;

            if (!ownedByThis && !noOwnershipInfo) continue;

            if (entry.type === 'image') {
                costumes.push({ name, id: null, mediaID: null, hasImage: true, isRef: false });
            } else if (entry.type === 'audio') {
                sounds.push({ name, id: null, mediaID: null, hasSound: true, isRef: false });
            }
        }
        console.log('[renderAssets] after ownership fallback →', costumes.length, 'costumes,', sounds.length, 'sounds');
    }

    // ── DEBUG PANEL ──────────────────────────────────────────────────────────
    // Resolve each costume/sound and record what path was used (or 'NONE')
    function resolveSource(item) {
        if (item.mediaID && mediaMap.byId[item.mediaID]) return `byId[mediaID=${item.mediaID}] ✓`;
        if (item.id && mediaMap.byId[item.id]) return `byId[id=${item.id}] ✓`;
        if (item.name && mediaMap.byName[item.name]) return `byName["${item.name}"] ✓`;
        return '✗ NOT FOUND';
    }

    const dbgLines = [];
    dbgLines.push(`projectXml: ${projData.projectXml ? projData.projectXml.length + ' chars' : 'NULL'}`);
    dbgLines.push(`mediaXml:   ${projData.mediaXml   ? projData.mediaXml.length   + ' chars' : 'NULL'}`);
    dbgLines.push(`blockXml:   ${blockXml.length} chars`);
    dbgLines.push(`mediaMap.byId keys: [${Object.keys(mediaMap.byId).join(', ') || '—'}]`);
    dbgLines.push(`mediaMap.byName keys: [${Object.keys(mediaMap.byName).map(k=>`"${k}"`).join(', ') || '—'}]`);
    dbgLines.push('');
    dbgLines.push(`Costumes (${costumes.length}):`);
    costumes.forEach((c, i) => {
        dbgLines.push(`  #${i+1} name="${c.name}" owner=${c.owner ?? '—'} id=${c.id ?? '—'} mediaID=${c.mediaID ?? '—'} hasImage=${c.hasImage} ref=${c.isRef} → ${resolveSource(c)}`);
    });
    dbgLines.push('');
    dbgLines.push(`Sounds (${sounds.length}):`);
    sounds.forEach((s, i) => {
        dbgLines.push(`  #${i+1} name="${s.name}" owner=${s.owner ?? '—'} id=${s.id ?? '—'} mediaID=${s.mediaID ?? '—'} hasSound=${s.hasSound} ref=${s.isRef} → ${resolveSource(s)}`);
    });
    // Also show first 600 chars of projectXml and mediaXml to see structure
    dbgLines.push('');
    dbgLines.push('projectXml[0..600]:');
    dbgLines.push('  ' + (projData.projectXml || '').slice(0, 600).replace(/\n/g, ' '));
    dbgLines.push('mediaXml[0..600]:');
    dbgLines.push('  ' + (projData.mediaXml || '').slice(0, 600).replace(/\n/g, ' '));

    // Show costumes/sounds sections from blockXml (to diagnose ownership structure)
    const blockCostumesSnip = costumesStart !== -1 && costumesEnd !== -1
        ? blockXml.slice(costumesStart, Math.min(costumesEnd + 11, costumesStart + 800)).replace(/\n/g, ' ')
        : '—';
    const blockSoundsSnip = soundsStart !== -1 && soundsEnd !== -1
        ? blockXml.slice(soundsStart, Math.min(soundsEnd + 9, soundsStart + 400)).replace(/\n/g, ' ')
        : '—';
    dbgLines.push('');
    dbgLines.push('blockXml <costumes>[0..800]: ' + blockCostumesSnip);
    dbgLines.push('blockXml <sounds>[0..400]:   ' + blockSoundsSnip);

    // Show first <costume and <sound tags found anywhere in projectXml / mediaXml
    const firstCostumeInProj = (projData.projectXml || '').match(/<costume[\s][^>]{0,200}/)?.[0] ?? '—';
    const firstSoundInProj   = (projData.projectXml || '').match(/<sound[\s][^>]{0,200}/)?.[0] ?? '—';
    const firstCostumeInMedia = (projData.mediaXml || '').match(/<costume[\s][^>]{0,200}/)?.[0] ?? '—';
    const firstSoundInMedia   = (projData.mediaXml || '').match(/<sound[\s][^>]{0,200}/)?.[0] ?? '—';
    dbgLines.push('');
    dbgLines.push('First <costume in projectXml: ' + firstCostumeInProj);
    dbgLines.push('First <sound   in projectXml: ' + firstSoundInProj);
    dbgLines.push('First <costume in mediaXml:   ' + firstCostumeInMedia);
    dbgLines.push('First <sound   in mediaXml:   ' + firstSoundInMedia);

    console.group('[DEBUG] Asset resolution for', sprite.name);
    dbgLines.forEach(l => console.log(l));
    console.groupEnd();

    const dbgPanel = document.createElement('div');
    dbgPanel.className = 'ov-debug-panel';
    dbgPanel.innerHTML = `
        <div class="ov-debug-title">🔍 Debug — ${esc(sprite.name)}</div>
        <pre class="ov-debug-pre">${esc(dbgLines.join('\n'))}</pre>`;
    el.appendChild(dbgPanel);
    // ── END DEBUG PANEL ──────────────────────────────────────────────────────

    const total = costumes.length + sounds.length;
    if (badge) badge.textContent = total ? `${total} asset${total !== 1 ? 's' : ''}` : '';

    if (!total) {
        // Don't wipe el (would destroy debug panel above) — just append a notice
        const empty = document.createElement('div');
        empty.className = 'ov-empty-state';
        empty.innerHTML = '<span>No costumes or sounds found</span>';
        el.appendChild(empty);
        return;
    }

    // ── Helper: resolve image data for a costume ──
    function resolveImageData(costume) {
        // 1. Inline image in blockXml (hasImage means image= was in the tag)
        //    We need to find it from the media map by id or name
        // 2. Via mediaID
        // 3. Via id
        // 4. Via name
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
            // Resolve sound data for playback
            let soundData = null;
            if (s.mediaID && mediaMap.byId[s.mediaID]) soundData = mediaMap.byId[s.mediaID].data;
            else if (s.id && mediaMap.byId[s.id]) soundData = mediaMap.byId[s.id].data;
            else if (s.name && mediaMap.byName[s.name]) soundData = mediaMap.byName[s.name].data;

            const refTag   = s.isRef ? '<span class="ov-ref-tag" title="Shared reference (ref)">ref</span>' : '';
            const mediaTag = s.mediaID ? '<span class="ov-media-tag" title="Sound in media section">media</span>' : '';
            const ownerTag = s.owner ? `<span class="ov-owner-tag" title="Owner sprite/stage">${esc(s.owner)}</span>` : '';

            const item = document.createElement('div');
            item.className = 'ov-asset-item ov-sound-item';

            // Build audio player if data is available, otherwise show placeholder icon
            const audioHtml = soundData
                ? `<audio class="ov-sound-player" controls preload="none" src="${esc(soundData)}"></audio>`
                : `<div class="ov-sound-thumb">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                            d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z"/>
                    </svg>
                   </div>`;

            item.innerHTML = `
                ${audioHtml}
                <div class="ov-asset-info">
                    <div class="ov-asset-name">${esc(s.name)}</div>
                    <div class="ov-asset-detail">sound ${i + 1} ${ownerTag}${refTag}${mediaTag}</div>
                </div>
                <span class="ov-index-badge sound">#${i + 1}</span>`;
            el.appendChild(item);
        });
    }
}

// ── Helper ──
async function getOrFetchProject(name) {
    // Always re-fetch to ensure fresh parsing (no stale cache)
    const data = await getProject(name);
    appState.projectCache.set(name, data);
    return data;
}
