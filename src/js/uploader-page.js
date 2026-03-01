/**
 * uploader-page.js — Uploader page module
 * Identica logica al vecchio uploader.js ma senza gestione credenziali
 * (gestite da app.js). Esporta initUploader() chiamata al caricamento pagina.
 *
 * FIX: Stores xmlOffset for each selected sprite so that upload functions
 * target the correct sprite even when multiple share the same name.
 */
import {
    getProject, saveProject,
    getSpritesFromXml, uploadImageToSprite, uploadAudioToSprite,
    importSpriteXml, importCustomBlocks, importScriptXml,
    detectXmlType, isFileAccepted, fileExt, fileBase,
    EXTS_IMG, EXTS_AUDIO, state,
} from './snap-api.js?v=14';
import { appState, bus } from './app.js';

console.log('[uploader-page] ✓ module loaded');

let selMode = 'none';
let selectedProjects = new Set();
let selectedSprites = [];  // Each entry: { projectName, spriteName, spriteType, xmlOffset }
let spritePanelProj = null;
let files = [];
let busy = false;
let _projectsHandler = null;

const $ = id => document.getElementById(id);

export function initUploader() {
    console.log('[uploader-page] initUploader()');
    selMode = 'none'; selectedProjects = new Set(); selectedSprites = [];
    spritePanelProj = null; files = []; busy = false;

    if (appState.projects.length) renderProjList();

    if (_projectsHandler) bus.off('projects-loaded', _projectsHandler);
    _projectsHandler = () => { renderProjList(); checkUploadReady(); };
    bus.on('projects-loaded', _projectsHandler);

    wireEvents();
    updateDropHint(); updateBanner(); updateSelPanel(); checkUploadReady();
}

function wireEvents() {
    const dz = $('drop-zone'), fi = $('file-input');
    if (dz) {
        dz.addEventListener('dragover', e => { e.preventDefault(); if (selMode !== 'none') dz.classList.add('over'); });
        dz.addEventListener('dragleave', () => dz.classList.remove('over'));
        dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('over'); if (selMode !== 'none') addFiles(e.dataTransfer.files); });
        dz.addEventListener('click', e => { if (e.target.id !== 'browse-link' && selMode !== 'none') fi?.click(); });
    }
    $('browse-link')?.addEventListener('click', e => { e.stopPropagation(); if (selMode !== 'none') fi?.click(); });
    fi?.addEventListener('change', () => { addFiles(fi.files); fi.value = ''; });
    $('btn-clear-sel')?.addEventListener('click', clearSelection);
    $('btn-clear-files')?.addEventListener('click', () => { files = []; renderFiles(); updateDetectBox(); checkUploadReady(); log('Files cleared', 'dim'); });
    $('btn-upload')?.addEventListener('click', onUploadClick);
    $('btn-download-xml')?.addEventListener('click', onDownloadClick);
    $('btn-clear-log')?.addEventListener('click', () => { const lp = $('log-panel'); if (lp) lp.innerHTML = '<div class="log-dim">// cleared</div>'; });
}

// ═══ LOG ═════════════════════════════════════════════════════════════════════
function log(msg, type = 'info') {
    const lp = $('log-panel'); if (!lp) return;
    const d = document.createElement('div');
    d.className = {ok:'log-ok',err:'log-err',info:'log-info',warn:'log-warn',dim:'log-dim'}[type]||'log-info';
    d.textContent = `${{ok:'✓',err:'✗',info:'·',warn:'!',dim:'//'}[type]||'·'}  ${msg}`;
    lp.appendChild(d); lp.scrollTop = lp.scrollHeight;
}

// ═══ HELPERS ═════════════════════════════════════════════════════════════════
/** Returns the set of project names that have at least one sprite selected */
function projectsWithSelectedSprites() {
    const s = new Set();
    for (const sp of selectedSprites) s.add(sp.projectName);
    return s;
}

// ═══ PROJECT LIST ════════════════════════════════════════════════════════════
function renderProjList() {
    const pl = $('project-list'); if (!pl) return; pl.innerHTML = '';
    const pb = $('proj-count-badge');
    if (pb) pb.textContent = appState.projects.length ? `${appState.projects.length}` : '';
    if (!appState.projects.length) { pl.innerHTML = '<div class="list-empty">No projects found</div>'; return; }
    const sorted = [...appState.projects].sort((a, b) =>
        a.projectname.localeCompare(b.projectname, undefined, { sensitivity: 'base' }));

    // Projects that have sprites selected — show accent border
    const sprProjs = projectsWithSelectedSprites();

    sorted.forEach(p => {
        const row = document.createElement('div');
        const bo = selMode === 'sprites';
        let cls = 'proj-row';
        if (selectedProjects.has(p.projectname)) cls += ' sel';
        if (bo) cls += ' browse-only';
        // Highlight: project currently being browsed in sprite panel
        if (bo && p.projectname === spritePanelProj) cls += ' panel-active';
        // Highlight: project has selected sprites
        if (bo && sprProjs.has(p.projectname)) cls += ' has-selected-sprites';
        row.className = cls;

        const date = p.lastupdated ? new Date(p.lastupdated).toLocaleDateString('en-GB',{day:'2-digit',month:'short'}) : '';

        // Count of selected sprites for this project
        const sprCount = selectedSprites.filter(s => s.projectName === p.projectname).length;

        row.innerHTML = `<svg class="row-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/></svg>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.projectname)}</span>
          ${bo && sprCount > 0 ? `<span class="row-spr-count">${sprCount}</span>` : ''}
          ${bo ? '<span class="row-browse-tag">browse</span>' : `<span class="row-date">${date}</span>`}`;
        row.addEventListener('click', () => onProjClick(p.projectname, row));
        pl.appendChild(row);
    });
}

async function onProjClick(name, row) {
    if (selMode === 'sprites') {
        // No need to manually toggle panel-active — renderProjList handles it via spritePanelProj
        loadSpritePanel(name);
        return;
    }
    if (selectedProjects.has(name)) { selectedProjects.delete(name); row.classList.remove('sel'); }
    else { selectedProjects.add(name); row.classList.add('sel'); selMode = 'projects'; }
    if (selectedProjects.size === 0) selMode = 'none';
    updateBanner(); updateSelPanel(); updateDropHint(); updateDetectBox(); checkUploadReady();
    loadSpritePanel(name);
}

async function loadSpritePanel(projName) {
    spritePanelProj = projName;
    // Re-render project list so panel-active is correctly applied
    renderProjList();
    const lbl = $('spr-proj-lbl'); if (lbl) lbl.textContent = `— ${projName}`;
    const sl = $('sprite-list'); if (sl) sl.innerHTML = '<div class="list-empty"><span class="inline-spin"></span></div>';
    const sb = $('sprite-count-badge'); if (sb) sb.textContent = '';
    try {
        if (!appState.projectCache.has(projName)) appState.projectCache.set(projName, await getProject(projName));
        renderSprList(getSpritesFromXml(appState.projectCache.get(projName).projectXml), projName);
    } catch (e) { if (sl) sl.innerHTML = `<div class="list-empty" style="color:#f87171;font-size:11px">${esc(e.message)}</div>`; }
}

function renderSprList(sprites, projName) {
    const sl = $('sprite-list'); if (!sl) return; sl.innerHTML = '';
    const sb = $('sprite-count-badge');
    const totalStages  = sprites.filter(s => s.type === 'stage').length;
    const totalSprites = sprites.filter(s => s.type === 'sprite').length;
    if (sb) sb.textContent = sprites.length
        ? `${totalStages} stage${totalStages !== 1 ? 's' : ''}, ${totalSprites} sprite${totalSprites !== 1 ? 's' : ''}`
        : '';
    sprites.forEach(s => {
        const row = document.createElement('div');
        const locked = selMode === 'projects';
        const isSel = selectedSprites.some(x =>
            x.projectName === projName && x.spriteName === s.name && x.xmlOffset === s.xmlOffset);
        const isStage = s.type === 'stage';
        row.className = 'spr-row' + (isSel ? ' sel' : '') + (locked ? ' locked' : '') + (!isStage ? ' spr-child-row' : '');
        row.innerHTML = `<svg class="row-icon" fill="currentColor" viewBox="0 0 16 16">${isStage?'<rect x="1" y="2" width="14" height="10" rx="1.5"/><path d="M5 14h6"/>':'<circle cx="8" cy="6" r="3"/><path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6"/>'}</svg>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.name)}</span>
          <span class="row-tag">${s.type}</span>`;
        if (!locked) row.addEventListener('click', () => onSprClick(projName, s, row));
        sl.appendChild(row);
    });
}

function onSprClick(projName, sprite, row) {
    if (selMode === 'projects') return;
    // Match by xmlOffset for precision (handles same-name sprites)
    const idx = selectedSprites.findIndex(x =>
        x.projectName === projName && x.spriteName === sprite.name && x.xmlOffset === sprite.xmlOffset);
    if (idx >= 0) { selectedSprites.splice(idx, 1); row.classList.remove('sel'); }
    else {
        selectedSprites.push({
            projectName: projName,
            spriteName: sprite.name,
            spriteType: sprite.type,
            xmlOffset: sprite.xmlOffset,  // KEY: store the precise offset
        });
        row.classList.add('sel');
        selMode = 'sprites';
    }
    if (selectedSprites.length === 0) selMode = 'none';
    updateBanner(); updateSelPanel(); updateDropHint(); updateDetectBox(); checkUploadReady();
    // Re-render project list to update has-selected-sprites + sprite count badges
    renderProjList();
}

function clearSelection() {
    selMode = 'none'; selectedProjects = new Set(); selectedSprites = [];
    document.querySelectorAll('.proj-row.sel').forEach(r => r.classList.remove('sel'));
    document.querySelectorAll('.spr-row.sel').forEach(r => r.classList.remove('sel'));
    renderProjList(); if (spritePanelProj) loadSpritePanel(spritePanelProj);
    updateBanner(); updateSelPanel(); updateDropHint(); updateDetectBox(); checkUploadReady();
    log('Selection cleared', 'dim');
}

function updateBanner() {
    const mb = $('mode-banner'), mt = $('mode-text'), cs = $('btn-clear-sel'); if (!mb) return;
    mb.className = 'mode-banner';
    const n = selMode === 'projects' ? selectedProjects.size : selectedSprites.length;
    if (cs) cs.style.display = n > 0 ? 'inline-flex' : 'none';
    if (selMode === 'projects') { mb.classList.add('proj'); if (mt) mt.textContent = `${n} project(s) selected — upload sprite files (.xml) or custom blocks (.xml). Selecting sprites is locked.`; }
    else if (selMode === 'sprites') { mb.classList.add('spr'); if (mt) mt.textContent = `${n} sprite(s)/stage(s) selected — upload images, audio or script XML. Selecting whole projects is locked.`; }
    else { if (mt) mt.textContent = 'Select projects or sprites to define your upload target.'; }
    const ss = $('sel-summary'); if (ss) ss.textContent = n ? `${n} ${selMode==='projects'?'project':'sprite'}(s) selected` : '';
}

function updateSelPanel() {
    const sl = $('sel-list'), se = $('sel-empty-msg'), cs = $('btn-clear-sel'), scb = $('sel-count-badge'); if (!sl) return;
    sl.querySelectorAll('.sel-chip').forEach(e => e.remove());
    const has = selMode === 'projects' ? selectedProjects.size > 0 : selectedSprites.length > 0;
    const selCount = selMode === 'projects' ? selectedProjects.size : selectedSprites.length;
    if (se) se.style.display = has ? 'none' : 'block';
    if (cs) cs.style.display = has ? 'inline-flex' : 'none';
    if (scb) scb.textContent = selCount > 0 ? `${selCount}` : '';
    if (selMode === 'projects') {
        [...selectedProjects].forEach(name => addChip('proj', name, null, () => {
            selectedProjects.delete(name); if (!selectedProjects.size) selMode = 'none';
            renderProjList(); updateBanner(); updateSelPanel(); updateDropHint(); updateDetectBox(); checkUploadReady();
        }));
    } else if (selMode === 'sprites') {
        selectedSprites.forEach(s => addChip('spr', s.spriteName, s.projectName, () => {
            const i = selectedSprites.findIndex(x =>
                x.projectName === s.projectName && x.spriteName === s.spriteName && x.xmlOffset === s.xmlOffset);
            if (i >= 0) selectedSprites.splice(i, 1);
            if (!selectedSprites.length) { selMode = 'none'; renderProjList(); }
            if (spritePanelProj) { const c = appState.projectCache.get(spritePanelProj); if (c) renderSprList(getSpritesFromXml(c.projectXml), spritePanelProj); }
            updateBanner(); updateSelPanel(); updateDropHint(); updateDetectBox(); checkUploadReady();
            renderProjList();
        }));
    }
}

function addChip(type, name, sub, onRemove) {
    const sl = $('sel-list'), se = $('sel-empty-msg'); if (!sl) return;
    const chip = document.createElement('div');
    chip.className = `sel-chip type-${type}`;
    chip.innerHTML = `<div class="sel-chip-body"><div class="sel-chip-name">${esc(name)}</div>${sub?`<div class="sel-chip-sub">${esc(sub)}</div>`:''}</div><button class="sel-del">✕</button>`;
    chip.querySelector('.sel-del').addEventListener('click', onRemove);
    sl.insertBefore(chip, se);
}

function updateDropHint() {
    const dh = $('drop-hint'), fi = $('file-input'), dz = $('drop-zone'); if (!dh) return;
    if (selMode === 'projects') { dh.textContent = 'XML only — <sprites> sprite files or <blocks> custom blocks'; if (fi) fi.accept = '.xml'; if (dz) dz.classList.remove('locked'); }
    else if (selMode === 'sprites') { dh.textContent = 'PNG · JPG · GIF · SVG · MP3 · WAV · XML (script)'; if (fi) fi.accept = '.png,.jpg,.jpeg,.gif,.svg,.mp3,.wav,.ogg,.xml'; if (dz) dz.classList.remove('locked'); }
    else { dh.textContent = 'Select a target first'; if (fi) fi.accept = ''; if (dz) dz.classList.add('locked'); }
    files.forEach(f => { f.valid = isFileAccepted(f.file, selMode, f.xmlType); }); renderFiles();
}

function updateDetectBox() {
    const db = $('detect-box'); if (!db) return;
    const vf = files.filter(f => f.valid);
    if (!vf.length || selMode === 'none') { db.style.display = 'none'; return; }
    db.style.display = 'block';
    const lines = ['<strong>What will happen:</strong>'];
    if (selMode === 'projects') {
        const sp = vf.filter(f => f.xmlType === 'sprite').length, bl = vf.filter(f => f.xmlType === 'blocks').length;
        if (sp) lines.push(`· ${sp} sprite file(s) → imported into each project (duplicates skipped)`);
        if (bl) lines.push(`· ${bl} custom block file(s) → added to global blocks (duplicates skipped)`);
    } else {
        const im = vf.filter(f => EXTS_IMG.includes(fileExt(f.file))).length, au = vf.filter(f => EXTS_AUDIO.includes(fileExt(f.file))).length, sc = vf.filter(f => ['script','scripts'].includes(f.xmlType)).length;
        if (im) lines.push(`· ${im} image(s) → costume added`); if (au) lines.push(`· ${au} audio file(s) → sound added`); if (sc) lines.push(`· ${sc} script(s) → injected`);
    }
    const rej = files.filter(f => !f.valid).length; if (rej) lines.push(`· ${rej} file(s) rejected`);
    db.innerHTML = lines.join('<br/>');
}

async function addFiles(newFiles) {
    for (const f of newFiles) {
        if (files.find(x => x.file.name === f.name && x.file.size === f.size)) continue;
        let xmlType = null; if (fileExt(f) === 'xml') xmlType = await detectXmlType(f);
        files.push({file: f, xmlType, valid: isFileAccepted(f, selMode, xmlType)});
    }
    renderFiles(); updateDetectBox(); checkUploadReady();
}

function renderFiles() {
    const fl = $('file-list'); if (!fl) return; fl.innerHTML = '';
    const em = {png:'img',jpg:'img',jpeg:'img',gif:'img',svg:'img',mp3:'audio',wav:'audio',ogg:'audio',xml:'xml'};
    const cm = {img:'ext-img',audio:'ext-audio',xml:'ext-xml'};
    const kindIcons = {
        img: `<svg class="file-kind-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>`,
        audio: `<svg class="file-kind-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"/></svg>`,
        xml: `<svg class="file-kind-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/></svg>`,
        sprite: `<svg class="file-kind-icon" fill="currentColor" viewBox="0 0 16 16"><circle cx="8" cy="6" r="3"/><path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6"/></svg>`,
        stage: `<svg class="file-kind-icon" fill="currentColor" viewBox="0 0 16 16"><rect x="1" y="2" width="14" height="10" rx="1.5"/><path d="M5 14h6"/></svg>`,
    };
    files.forEach((entry, i) => {
        const {file, xmlType, valid} = entry; const e = fileExt(file); const kind = em[e]||'xml';
        const xmlIconKey = (kind === 'xml' && xmlType === 'sprite') ? 'sprite'
                         : (kind === 'xml' && xmlType === 'stage') ? 'stage'
                         : null;
        const chip = document.createElement('div');
        chip.className = 'file-chip' + (valid ? '' : ' invalid');
        chip.innerHTML = `${kindIcons[xmlIconKey] || kindIcons[kind] || kindIcons.xml}
          <span class="ext-badge ${valid ? cm[kind]||'ext-xml' : 'ext-bad'}">${e}</span>
          <span class="fname">${esc(file.name)}</span>${xmlType?`<span class="xml-tag">${xmlType}</span>`:''}${!valid?'<span class="rej-tag">rejected</span>':''}
          <span class="fsize">${(file.size/1024).toFixed(0)} KB</span><button class="del-btn">✕</button>`;
        chip.querySelector('.del-btn').addEventListener('click', () => { files.splice(i,1); renderFiles(); updateDetectBox(); checkUploadReady(); });
        fl.appendChild(chip);
    });
    const b = $('file-count-badge'), v = files.filter(f => f.valid).length;
    if (b) b.textContent = files.length ? `${v}/${files.length} accepted` : '';
    const cf = $('btn-clear-files'); if (cf) cf.style.display = files.length ? 'inline-flex' : 'none';
}

function checkUploadReady() {
    const hasSel = selMode === 'projects' ? selectedProjects.size > 0 : selectedSprites.length > 0;
    const hasValid = files.some(f => f.valid);
    const bu = $('btn-upload'); if (bu) bu.disabled = !state.username || !hasSel || !hasValid || busy;
    const bd = $('btn-download-xml');
    if (bd) { bd.style.display = (selMode === 'sprites' && hasSel && hasValid && !!state.username) ? '' : 'none'; bd.disabled = busy; }
}

// ═══ UPLOAD ══════════════════════════════════════════════════════════════════
async function onUploadClick() {
    if (busy) return; const vf = files.filter(f => f.valid);
    setBusy(true); setProgress(true, 0, 'Starting…');
    try { if (selMode === 'projects') await uploadToProjects(vf); else await uploadToSprites(vf); }
    catch (e) { log(e.message, 'err'); } setProgress(false); setBusy(false);
}

async function onDownloadClick() {
    if (busy) return; const vf = files.filter(f => f.valid); setBusy(true);
    try {
        const bp = {}; for (const s of selectedSprites) { if (!bp[s.projectName]) bp[s.projectName] = []; bp[s.projectName].push(s); }
        for (const [pn, sprites] of Object.entries(bp)) {
            let {projectXml, mediaXml} = await getOrFetch(pn);
            for (const {file, xmlType} of vf) { const e = fileExt(file);
                if (EXTS_IMG.includes(e)) {
                    for (const s of sprites) {
                        const r = await uploadImageToSprite(projectXml, mediaXml, s.spriteName, file, s.xmlOffset);
                        projectXml = r.projectXml; mediaXml = r.mediaXml;
                    }
                }
                else if (EXTS_AUDIO.includes(e)) {
                    for (const s of sprites) {
                        const r = await uploadAudioToSprite(projectXml, mediaXml, s.spriteName, file, s.xmlOffset);
                        projectXml = r.projectXml; mediaXml = r.mediaXml;
                    }
                }
                else if (e === 'xml' && ['script','scripts'].includes(xmlType)) {
                    const text = await file.text();
                    for (const s of sprites) {
                        const r = importScriptXml(projectXml, mediaXml, s.spriteName, text, s.xmlOffset);
                        projectXml = r.projectXml; mediaXml = r.mediaXml;
                    }
                }
            }
            log(`⬇ Downloaded modified XML for "${pn}"`, 'ok');
        }
    } catch (e) { log('✗ Download error: '+e.message, 'err'); } finally { setBusy(false); setProgress(false); }
}

async function uploadToProjects(vf) {
    const targets = [...selectedProjects];
    log(`Uploading to ${targets.length} project(s) — ${vf.length} file(s)`, 'info');
    for (let i = 0; i < targets.length; i++) {
        const name = targets[i]; log(`↓ "${name}"…`, 'info');
        try {
            let {projectXml, mediaXml} = await getOrFetch(name);
            for (const {file, xmlType} of vf) { const text = await file.text();
                if (xmlType==='sprite') { const r = importSpriteXml(projectXml,mediaXml,text); projectXml=r.projectXml; mediaXml=r.mediaXml; if (r.skipped.length) log(`  ⚠ skipped: ${r.skipped.join(', ')}`,'warn'); else log(`  + sprites "${file.name}"`,'ok'); }
                else if (xmlType==='blocks') { const r = importCustomBlocks(projectXml,mediaXml,text); projectXml=r.projectXml; mediaXml=r.mediaXml; if (r.skipped.length) log(`  ⚠ skipped: ${r.skipped.join(', ')}`,'warn'); else log(`  + blocks "${file.name}"`,'ok'); }
            }
            await saveProject(name,projectXml,mediaXml); appState.projectCache.set(name,{projectXml,mediaXml}); log(`  ✓ saved "${name}"`,'ok');
        } catch (e) { log(`  ✗ "${name}": ${e.message}`,'err'); }
        setProgress(true, (i+1)/targets.length*100, `${i+1}/${targets.length} done`);
    }
    log(`Done — ${targets.length} project(s) processed`, 'ok');
}

async function uploadToSprites(vf) {
    const bp = {};
    for (const s of selectedSprites) {
        if (!bp[s.projectName]) bp[s.projectName] = [];
        bp[s.projectName].push(s);
    }
    const pn = Object.keys(bp);
    log(`Uploading to ${selectedSprites.length} sprite(s) in ${pn.length} project(s)`, 'info');

    for (let pi = 0; pi < pn.length; pi++) {
        const projName = pn[pi];
        const sprites = bp[projName];
        log(`↓ "${projName}"…`, 'info');
        try {
            let {projectXml, mediaXml} = await getOrFetch(projName);

            for (const {file, xmlType} of vf) {
                const e = fileExt(file);
                const isImg = EXTS_IMG.includes(e);
                const isAud = EXTS_AUDIO.includes(e);

                if (isImg || isAud) {
                    for (const s of sprites) {
                        try {
                            const freshOffset = resolveCurrentOffset(projectXml, s);
                            let r;
                            if (isImg) r = await uploadImageToSprite(projectXml, mediaXml, s.spriteName, file, freshOffset);
                            else r = await uploadAudioToSprite(projectXml, mediaXml, s.spriteName, file, freshOffset);
                            projectXml = r.projectXml; mediaXml = r.mediaXml;
                            if (r.skipped) log(`  ⚠ "${file.name}" exists on "${s.spriteName}"`, 'warn');
                            else log(`  + ${isImg?'image':'audio'} "${file.name}" → "${s.spriteName}"`, 'ok');
                        } catch(e2) { log(`  ✗ "${s.spriteName}": ${e2.message}`, 'err'); }
                    }
                } else if (e === 'xml' && ['script','scripts'].includes(xmlType)) {
                    const text = await file.text();
                    for (const s of sprites) {
                        try {
                            const freshOffset = resolveCurrentOffset(projectXml, s);
                            const r = importScriptXml(projectXml, mediaXml, s.spriteName, text, freshOffset);
                            projectXml = r.projectXml; mediaXml = r.mediaXml;
                            log(`  + script "${file.name}" → "${s.spriteName}"`, 'ok');
                        } catch(e2) { log(`  ✗ "${s.spriteName}": ${e2.message}`, 'err'); }
                    }
                }
            }
            await saveProject(projName, projectXml, mediaXml);
            appState.projectCache.set(projName, {projectXml, mediaXml});
            log(`  ✓ saved "${projName}"`, 'ok');
        } catch (e) { log(`  ✗ "${projName}": ${e.message}`, 'err'); }
        setProgress(true, (pi+1)/pn.length*100, `${pi+1}/${pn.length} done`);
    }
    log(`Done — ${pn.length} project(s) updated`, 'ok');
}

function resolveCurrentOffset(projectXml, spriteEntry) {
    const freshSprites = getSpritesFromXml(projectXml);
    const candidates = freshSprites.filter(s =>
        s.name === spriteEntry.spriteName && s.type === spriteEntry.spriteType);

    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0].xmlOffset;

    if (spriteEntry.xmlOffset != null) {
        let best = candidates[0];
        let bestDist = Math.abs(best.xmlOffset - spriteEntry.xmlOffset);
        for (let i = 1; i < candidates.length; i++) {
            const dist = Math.abs(candidates[i].xmlOffset - spriteEntry.xmlOffset);
            if (dist < bestDist) { best = candidates[i]; bestDist = dist; }
        }
        return best.xmlOffset;
    }

    return candidates[0].xmlOffset;
}

async function getOrFetch(name) {
    if (!appState.projectCache.has(name)) appState.projectCache.set(name, await getProject(name));
    return appState.projectCache.get(name);
}

function setBusy(v) {
    busy = v; $('btn-upload')?.classList.toggle('busy', v);
    const l = $('btn-label'); if (l) l.textContent = v ? 'Uploading…' : 'Upload to Snap!';
    checkUploadReady();
}
function setProgress(show, pct=0, label='') {
    const pw = $('prog-wrap'); if (!pw) return; pw.classList.toggle('active', show);
    if (show) { const b=$('prog-bar'); if(b)b.style.width=pct+'%'; const p=$('prog-pct'); if(p)p.textContent=Math.round(pct)+'%'; const l=$('prog-label'); if(l)l.textContent=label; }
}
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
