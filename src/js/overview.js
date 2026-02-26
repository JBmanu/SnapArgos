/**
 * overview.js — Overview page: browse projects → sprites → costumes & sounds
 */
import { getProject, getSpritesFromXml, extractTag, state } from './snap-api.js?v=8';
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

function renderAssets(sprite, projData) {
    const el = $('ov-asset-list');
    const badge = $('ov-asset-count');
    if (!el) return;
    el.innerHTML = '';

    // Estrai il blocco XML dello sprite/stage
    const xml = projData.projectXml;
    let blockXml;

    if (sprite.type === 'stage') {
        // Find the <stage> tag with this name, then extract the full block
        const stageRe = new RegExp(`<stage\\s[^>]*\\bname="${escRe(sprite.name)}"[^>]*>`);
        const stageM = xml.match(stageRe);
        if (stageM) {
            const start = xml.indexOf(stageM[0]);
            blockXml = extractTag(xml.slice(start), 'stage');
        } else {
            // Fallback: just grab the first <stage>
            blockXml = extractTag(xml, 'stage');
        }
    } else {
        const re = new RegExp(`<sprite[^>]+\\bname="${escRe(sprite.name)}"[^>]*>`);
        const m = xml.match(re);
        if (m) {
            const start = xml.indexOf(m[0]);
            blockXml = extractTag(xml.slice(start), 'sprite');
        }
    }

    if (!blockXml) {
        el.innerHTML = `<div class="ov-empty-state"><span style="color:#f87171">Could not parse XML for "${esc(sprite.name)}"</span></div>`;
        return;
    }

    // ── Estrai costumi ──
    const costumesXml = extractTag(blockXml, 'costumes');
    const costumes = [];
    if (costumesXml) {
        // Match both self-closing <costume .../> and opening <costume ...>
        const matches = [...costumesXml.matchAll(/<costume\s([^>]*?)(?:\/>|>)/g)];
        for (const cm of matches) {
            const attrs = cm[0];
            const name  = attrs.match(/\bname="([^"]+)"/)?.[1] || 'unnamed';
            const image = attrs.match(/\bimage="([^"]+)"/)?.[1] || null;
            const cx    = attrs.match(/\bcenter-x="([^"]+)"/)?.[1] || '0';
            const cy    = attrs.match(/\bcenter-y="([^"]+)"/)?.[1] || '0';
            costumes.push({ name, image, cx, cy });
        }
    }

    // ── Estrai suoni ──
    const soundsXml = extractTag(blockXml, 'sounds');
    const sounds = [];
    if (soundsXml) {
        // Match both self-closing <sound .../> and opening <sound ...>
        const matches = [...soundsXml.matchAll(/<sound\s([^>]*?)(?:\/>|>)/g)];
        for (const sm of matches) {
            const attrs = sm[0];
            const name = attrs.match(/\bname="([^"]+)"/)?.[1] || 'unnamed';
            sounds.push({ name });
        }
    }

    const total = costumes.length + sounds.length;
    if (badge) badge.textContent = total ? `${total} asset${total !== 1 ? 's' : ''}` : '';

    if (!total) {
        el.innerHTML = '<div class="ov-empty-state"><span>No costumes or sounds</span></div>';
        return;
    }

    // ── Render sezione costumi ──
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
            item.innerHTML = `
                <div class="ov-thumb">
                    ${c.image && c.image.startsWith('data:')
                        ? `<img src="${esc(c.image)}" alt="${esc(c.name)}"/>`
                        : `<span class="ov-thumb-placeholder">#${i + 1}</span>`}
                </div>
                <div class="ov-asset-info">
                    <div class="ov-asset-name">${esc(c.name)}</div>
                    <div class="ov-asset-detail">center: ${c.cx}, ${c.cy}</div>
                </div>
                <span class="ov-index-badge costume">#${i + 1}</span>`;
            el.appendChild(item);
        });
    }

    // ── Render sezione suoni ──
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
            item.innerHTML = `
                <div class="ov-sound-thumb">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                            d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z"/>
                    </svg>
                </div>
                <div class="ov-asset-info">
                    <div class="ov-asset-name">${esc(s.name)}</div>
                    <div class="ov-asset-detail">sound ${i + 1}</div>
                </div>
                <span class="ov-index-badge sound">#${i + 1}</span>`;
            el.appendChild(item);
        });
    }
}

// ── Helper ──
async function getOrFetchProject(name) {
    if (!appState.projectCache.has(name)) {
        appState.projectCache.set(name, await getProject(name));
    }
    return appState.projectCache.get(name);
}
