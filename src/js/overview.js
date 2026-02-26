/**
 * overview.js — Overview page: browse projects → sprites → costumes & sounds
 */
import { getProject, getSpritesFromXml, extractTag } from './snap-api.js?v=11';
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
            if (a.name && imgData && !nameMap[a.name]) nameMap[a.name] = { type: 'image', data: imgData };
        }
        for (const a of extractTagAttrs(mediaXml, 'sound')) {
            const sndData = a.sound ? decodeEntities(a.sound) : null;
            if (a.id && sndData) map[a.id] = { type: 'audio', data: sndData };
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

    if (!projData.projectXml) {
        el.innerHTML = '<div class="ov-empty-state"><span style="color:#f87171">No project data</span></div>';
        return;
    }

    try {
        _renderAssetsInner(el, badge, sprite, projData);
    } catch (err) {
        console.error('[renderAssets] Error:', err);
        el.innerHTML = `<div class="ov-empty-state"><span style="color:#f87171">Error loading assets: ${esc(err.message)}</span></div>`;
    }
}

function _renderAssetsInner(el, badge, sprite, projData) {
    // Build comprehensive media map from both <media> and inline data in <project>
    let mediaById = {}, mediaByName = {};
    try {
        const mm = buildMediaMap(projData.mediaXml, projData.projectXml);
        mediaById = mm.byId;
        mediaByName = mm.byName;
        console.log('[renderAssets] mediaMap: byId=', Object.keys(mediaById).length,
            '| byName=', Object.keys(mediaByName).length);
    } catch (e) {
        console.warn('[renderAssets] buildMediaMap failed:', e);
    }

    // Find the XML block for this stage/sprite
    const blockXml = findTargetBlock(projData.projectXml, sprite);
    if (!blockXml) {
        el.innerHTML = `<div class="ov-empty-state"><span style="color:#f87171">Could not find "${esc(sprite.name)}" in project XML</span></div>`;
        return;
    }

    // Debug: dump structure of blockXml and mediaXml
    const stripB64 = s => s ? s.replace(/(image|sound|pentrails)="data:[^"]{0,40}[^"]*"/g, '$1="[BASE64]"') : '';
    console.log('[renderAssets] blockXml length:', blockXml.length,
        '| first 500 chars:', stripB64(blockXml.slice(0, 500)));
    console.log('[renderAssets] mediaXml length:', projData.mediaXml?.length || 0,
        '| first 500 chars:', stripB64(projData.mediaXml?.slice(0, 500)));
    // Show all costume/sound tag openings in both blockXml and mediaXml
    const costumeTagsInBlock = [...blockXml.matchAll(/<costume\s/g)].length;
    const soundTagsInBlock = [...blockXml.matchAll(/<sound\s/g)].length;
    const costumeTagsInMedia = [...(projData.mediaXml || '').matchAll(/<costume\s/g)].length;
    const soundTagsInMedia = [...(projData.mediaXml || '').matchAll(/<sound\s/g)].length;
    console.log('[renderAssets] raw tag counts — blockXml: costumes=', costumeTagsInBlock, 'sounds=', soundTagsInBlock,
        '| mediaXml: costumes=', costumeTagsInMedia, 'sounds=', soundTagsInMedia);

    // ── Extract costumes ──
    const costumes = [];
    const costumesXml = extractTag(blockXml, 'costumes');
    console.log('[renderAssets] costumesXml found:', !!costumesXml,
        '| length:', costumesXml?.length || 0,
        '| preview:', stripB64(costumesXml?.slice(0, 300)));

    if (costumesXml) {
        const costumeAttrs = extractTagAttrs(costumesXml, 'costume');
        console.log('[renderAssets] costume tags found:', costumeAttrs.length);
        for (const a of costumeAttrs) {
            const name = a.name || 'unnamed';
            let image = a.image ? decodeEntities(a.image) : null;
            // Try all resolution methods
            let resolvedBy = image ? 'inline' : null;
            if (!image && a.mediaID && mediaById[a.mediaID]) { image = mediaById[a.mediaID].data; resolvedBy = 'mediaID'; }
            if (!image && a.id && mediaById[a.id]) { image = mediaById[a.id].data; resolvedBy = 'id'; }
            if (!image && name && mediaByName[name]) { image = mediaByName[name].data; resolvedBy = 'name'; }
            console.log('[renderAssets] costume:', name,
                '| attrs:', Object.keys(a).filter(k => k !== 'image' && k !== 'sound').join(','),
                '| inline image:', !!a.image, '| mediaID:', a.mediaID || '-', '| id:', a.id || '-',
                '| resolved:', !!image, '| by:', resolvedBy || 'NONE');
            costumes.push({
                name, image,
                cx: a['center-x'] || '0', cy: a['center-y'] || '0',
                id: a.id, mediaID: a.mediaID, resolved: !!image, resolvedBy
            });
        }
    }

    // ── Extract sounds ──
    const sounds = [];
    const soundsXml = extractTag(blockXml, 'sounds');
    console.log('[renderAssets] soundsXml found:', !!soundsXml,
        '| length:', soundsXml?.length || 0);

    if (soundsXml) {
        const soundAttrs = extractTagAttrs(soundsXml, 'sound');
        console.log('[renderAssets] sound tags found:', soundAttrs.length);
        for (const a of soundAttrs) {
            const name = a.name || 'unnamed';
            let audio = a.sound ? decodeEntities(a.sound) : null;
            let resolvedBy = audio ? 'inline' : null;
            if (!audio && a.mediaID && mediaById[a.mediaID]) { audio = mediaById[a.mediaID].data; resolvedBy = 'mediaID'; }
            if (!audio && a.id && mediaById[a.id]) { audio = mediaById[a.id].data; resolvedBy = 'id'; }
            if (!audio && name && mediaByName[name]) { audio = mediaByName[name].data; resolvedBy = 'name'; }
            console.log('[renderAssets] sound:', name,
                '| attrs:', Object.keys(a).filter(k => k !== 'sound').join(','),
                '| inline sound:', !!a.sound, '| mediaID:', a.mediaID || '-', '| id:', a.id || '-',
                '| resolved:', !!audio, '| by:', resolvedBy || 'NONE');
            sounds.push({
                name, audio,
                id: a.id, mediaID: a.mediaID, resolved: !!audio, resolvedBy
            });
        }
    }

    const total = costumes.length + sounds.length;
    if (badge) badge.textContent = total ? `${total} asset${total !== 1 ? 's' : ''}` : '';

    // Fallback: if no costumes/sounds found via normal extraction,
    // try a direct regex scan of the block XML for costume/sound name attributes
    if (!total) {
        console.warn('[renderAssets] No assets found via normal extraction. Trying regex fallback on blockXml...');
        const fallbackCostumes = [];
        const fallbackSounds = [];
        for (const m of blockXml.matchAll(/<costume\s[^>]*name="([^"]+)"/g)) {
            const name = m[1];
            let image = null;
            if (mediaByName[name]) image = mediaByName[name].data;
            fallbackCostumes.push({ name, image, cx: '0', cy: '0', resolved: !!image, resolvedBy: image ? 'name-fallback' : null });
        }
        for (const m of blockXml.matchAll(/<sound\s[^>]*name="([^"]+)"/g)) {
            const name = m[1];
            let audio = null;
            if (mediaByName[name]) audio = mediaByName[name].data;
            fallbackSounds.push({ name, audio, resolved: !!audio, resolvedBy: audio ? 'name-fallback' : null });
        }
        const fbTotal = fallbackCostumes.length + fallbackSounds.length;
        console.log('[renderAssets] regex fallback found:', fallbackCostumes.length, 'costumes,', fallbackSounds.length, 'sounds');
        if (fbTotal) {
            if (badge) badge.textContent = `${fbTotal} asset${fbTotal !== 1 ? 's' : ''}`;
            renderAssetItems(el, fallbackCostumes, fallbackSounds);
            return;
        }
    }

    if (!total) {
        el.innerHTML = '<div class="ov-empty-state"><span>No costumes or sounds</span></div>';
        return;
    }

    // Show a small diagnostic banner if some assets are unresolved
    const unresolvedCount = costumes.filter(c => !c.resolved).length + sounds.filter(s => !s.resolved).length;
    if (unresolvedCount > 0) {
        const info = document.createElement('div');
        info.className = 'ov-section-head';
        info.style.cssText = 'font-size:10px;color:#f59e0b;padding:4px 10px;';
        const mediaLen = projData.mediaXml?.length || 0;
        const mediaIdKeys = Object.keys(mediaById).length;
        const mediaNameKeys = Object.keys(mediaByName).length;
        info.textContent = `⚠ ${unresolvedCount} asset(s) without preview — media: ${mediaLen} chars, ${mediaIdKeys} by-id, ${mediaNameKeys} by-name`;
        el.appendChild(info);
    }

    renderAssetItems(el, costumes, sounds);
}

// ═══ RENDER ASSET ITEMS ══════════════════════════════════════════════════════
function renderAssetItems(el, costumes, sounds) {

    // ── Costumes section ──
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
            const item = document.createElement('div');
            item.className = 'ov-asset-item';
            // Show image preview if available, otherwise a placeholder with info
            let thumbHtml;
            if (c.image && c.image.startsWith('data:')) {
                thumbHtml = `<img src="${c.image}" alt="${esc(c.name)}"/>`;
            } else {
                thumbHtml = `<span class="ov-thumb-placeholder">🖼</span>`;
            }
            // Build detail line — show resolution info for unresolved costumes
            const detailParts = [`center: ${c.cx}, ${c.cy}`];
            if (c.mediaID) detailParts.push(`mediaID: ${c.mediaID}`);
            if (c.id) detailParts.push(`id: ${c.id}`);
            if (c.resolvedBy) detailParts.push(`via: ${c.resolvedBy}`);
            if (!c.resolved) detailParts.push('⚠ no preview');

            item.innerHTML = `
                <div class="ov-thumb">${thumbHtml}</div>
                <div class="ov-asset-info">
                    <div class="ov-asset-name">${esc(c.name)}</div>
                    <div class="ov-asset-detail">${esc(detailParts.join(' · '))}</div>
                </div>
                <span class="ov-index-badge costume">#${i + 1}</span>`;
            el.appendChild(item);
        });
    }

    // ── Sounds section ──
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
            const item = document.createElement('div');
            item.className = 'ov-asset-item';
            const detailParts = [`sound ${i + 1}`];
            if (s.mediaID) detailParts.push(`mediaID: ${s.mediaID}`);
            if (s.id) detailParts.push(`id: ${s.id}`);
            if (s.resolvedBy) detailParts.push(`via: ${s.resolvedBy}`);
            if (!s.resolved) detailParts.push('⚠ no preview');

            item.innerHTML = `
                <div class="ov-sound-thumb">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                            d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z"/>
                    </svg>
                </div>
                <div class="ov-asset-info">
                    <div class="ov-asset-name">${esc(s.name)}</div>
                    <div class="ov-asset-detail">${esc(detailParts.join(' · '))}</div>
                </div>
                <span class="ov-index-badge sound">#${i + 1}</span>`;
            if (s.audio && s.audio.startsWith('data:')) {
                const btn = document.createElement('button');
                btn.className = 'ov-play-btn';
                btn.title = 'Play';
                btn.innerHTML = `<svg fill="currentColor" viewBox="0 0 16 16"><path d="M3 2.5l10 5.5-10 5.5V2.5z"/></svg>`;
                let audioEl = null;
                btn.addEventListener('click', () => {
                    if (audioEl && !audioEl.paused) { audioEl.pause(); return; }
                    audioEl = new Audio(s.audio);
                    audioEl.play();
                });
                item.appendChild(btn);
            }
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
