import {
    login, getProjectList, getProject, saveProject,
    getSpritesFromXml, uploadImageToSprite, uploadAudioToSprite,
    importSpriteXml, importCustomBlocks, importScriptXml,
    detectXmlType, isFileAccepted, fileExt, fileBase,
    EXTS_IMG, EXTS_AUDIO, state,
} from './snap-api.js?v=8';

console.log('[uploader] ✓ module loaded');

// ═══ APP STATE ═══════════════════════════════════════════════════════════════
let projects = [];
let selMode = 'none';
let selectedProjects = new Set();
let selectedSprites = [];
let projectCache = new Map();
let spritePanelProj = null;
let files = [];
let busy = false;
let loginTimer = null;

// ═══ DOM ═════════════════════════════════════════════════════════════════════
const $ = id => document.getElementById(id);
const inpUser = $('inp-user'), inpPass = $('inp-pass');
const btnRefresh = $('btn-refresh'), refreshLabel = $('refresh-label');
const credStatus = $('cred-status'), credMsg = $('cred-msg');
const projList = $('project-list'), sprList = $('sprite-list');
const selList = $('sel-list'), selEmptyMsg = $('sel-empty-msg');
const modeBanner = $('mode-banner'), modeText = $('mode-text');
const selSummary = $('sel-summary'), sprProjLbl = $('spr-proj-lbl');
const btnClearSel = $('btn-clear-sel');
const dropZone = $('drop-zone'), fileInput = $('file-input');
const fileListEl = $('file-list'), detectBox = $('detect-box');
const dropHint = $('drop-hint'), fileCountBadge = $('file-count-badge');
const btnUpload = $('btn-upload'), btnLabel = $('btn-label');
const btnDownXml = $('btn-download-xml');
const logPanel = $('log-panel');
const progWrap = $('prog-wrap'), progBar = $('prog-bar');
const progPct = $('prog-pct'), progLabel = $('prog-label');

console.log('[uploader] DOM refs:', {inpUser: !!inpUser, inpPass: !!inpPass, credStatus: !!credStatus});

// ═══ ENV BADGE ═══════════════════════════════════════════════════════════════
const IS_LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
if (!IS_LOCAL) $('env-badge').classList.add('prod');
$('env-badge').textContent = IS_LOCAL ? 'local' : 'github pages';

// ═══ PASSWORD EYE ════════════════════════════════════════════════════════════
$('eye-btn').addEventListener('click', () => {
    const isPass = inpPass.type === 'password';
    inpPass.type = isPass ? 'text' : 'password';
    $('eye-icon').innerHTML = isPass
        ? `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"/>`
        : `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
           <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>`;
});

// ═══ AUTO-LOGIN (debounced) ═══════════════════════════════════════════════════
function onCredInput() {
    const user = inpUser.value.trim(), pass = inpPass.value;
    console.log('[uploader] onCredInput:', {user: user ? user.slice(0,3)+'...' : '(empty)', passLen: pass.length});
    clearTimeout(loginTimer);

    if (!user && !pass) {
        setCredStatus('warn', null, 'Fill in username and password to connect');
        return;
    }
    if (!user || !pass) {
        setCredStatus('warn', null, !user ? 'Enter your username' : 'Enter your password');
        return;
    }
    setCredStatus('loading', null, 'Connecting…');
    loginTimer = setTimeout(() => {
        console.log('[uploader] debounce fired, calling doLogin');
        doLogin(user, pass);
    }, 900);
}

inpUser.addEventListener('input', onCredInput);
inpPass.addEventListener('input', onCredInput);
console.log('[uploader] ✓ input listeners attached');

async function doLogin(user, pass) {
    console.log('[uploader] doLogin() start');
    setCredStatus('loading', null, 'Connecting…');
    try {
        const loggedAs = await login(user, pass);
        console.log('[uploader] login success:', loggedAs);
        setCredStatus('ok', null, `Connected as ${loggedAs}`);
        $('session-pill').classList.add('active');
        $('session-user').textContent = loggedAs;
        log(`Logged in as "${loggedAs}"`, 'ok');
        await loadProjects();
    } catch (e) {
        console.error('[uploader] login error:', e);
        setCredStatus('err', null, e.message.includes('login') ? 'Invalid credentials' : e.message);
        log(`Login failed: ${e.message}`, 'err');
    }
}

function setCredStatus(type, icon, msg) {
    credStatus.className = 'cred-status ' + type;
    credMsg.textContent = msg;
    const spinner = credStatus.querySelector('.inline-spin');
    if (type === 'loading' && !spinner) {
        const s = document.createElement('div');
        s.className = 'inline-spin';
        credStatus.insertBefore(s, credMsg);
        credStatus.querySelector('svg')?.remove();
    }
    if (type !== 'loading') {
        credStatus.querySelector('.inline-spin')?.remove();
        if (!credStatus.querySelector('svg')) {
            const icons = {
                ok: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
                warn: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
                err: 'M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z',
            };
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('fill', 'none');
            svg.setAttribute('stroke', 'currentColor');
            svg.setAttribute('viewBox', '0 0 24 24');
            svg.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${icons[type] || icons.warn}"/>`;
            credStatus.insertBefore(svg, credMsg);
        }
    }
}

// ═══ REFRESH BUTTON ══════════════════════════════════════════════════════════
btnRefresh.addEventListener('click', async () => {
    if (busy) return;
    const user = inpUser.value.trim(), pass = inpPass.value;
    if (!user || !pass) { log('Enter credentials first', 'warn'); return; }
    clearTimeout(loginTimer);
    await doLogin(user, pass);
});

async function loadProjects() {
    try {
        projects = await getProjectList();
        if (!Array.isArray(projects)) projects = [];
        log(`${projects.length} projects loaded`, 'ok');
        resetSelection();
        renderProjList();
        checkUploadReady();
    } catch (e) { log(e.message, 'err'); }
}

// ═══ CLEAR SELECTION ════════════════════════════════════════════════════════
btnClearSel.addEventListener('click', () => {
    selMode = 'none';
    selectedProjects = new Set();
    selectedSprites = [];
    document.querySelectorAll('.proj-row.sel').forEach(r => r.classList.remove('sel'));
    document.querySelectorAll('.spr-row.sel').forEach(r => r.classList.remove('sel'));
    renderProjList();
    if (spritePanelProj) loadSpritePanel(spritePanelProj);
    updateBanner(); updateSelPanel(); updateDropHint(); updateDetectBox(); checkUploadReady();
    log('Selection cleared', 'dim');
});

// ═══ LOG ═════════════════════════════════════════════════════════════════════
function log(msg, type = 'info') {
    const d = document.createElement('div');
    d.className = {ok:'log-ok',err:'log-err',info:'log-info',warn:'log-warn',dim:'log-dim'}[type] || 'log-info';
    d.textContent = `${{'ok':'✓','err':'✗','info':'·','warn':'!','dim':'//'}[type]||'·'}  ${msg}`;
    logPanel.appendChild(d);
    logPanel.scrollTop = logPanel.scrollHeight;
}

$('btn-clear-log').onclick = () => { logPanel.innerHTML = '<div class="log-dim">// cleared</div>'; };

// ═══ PROJECT LIST ═════════════════════════════════════════════════════════════
function renderProjList() {
    projList.innerHTML = '';
    if (!projects.length) { projList.innerHTML = '<div class="list-empty">No projects found</div>'; return; }
    projects.forEach(p => {
        const row = document.createElement('div');
        const browseOnly = selMode === 'sprites';
        row.className = 'proj-row' + (selectedProjects.has(p.projectname) ? ' sel' : '') + (browseOnly ? ' browse-only' : '');
        const date = p.lastupdated ? new Date(p.lastupdated).toLocaleDateString('en-GB',{day:'2-digit',month:'short'}) : '';
        row.innerHTML = `<svg class="row-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/></svg>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.projectname)}</span>
          ${browseOnly ? '<span class="row-browse-tag">browse</span>' : `<span class="row-date">${date}</span>`}`;
        row.addEventListener('click', () => onProjClick(p.projectname, row));
        projList.appendChild(row);
    });
}

async function onProjClick(name, row) {
    if (selMode === 'sprites') {
        document.querySelectorAll('.proj-row.panel-active').forEach(r => r.classList.remove('panel-active'));
        row.classList.add('panel-active');
        loadSpritePanel(name); return;
    }
    if (selectedProjects.has(name)) { selectedProjects.delete(name); row.classList.remove('sel'); }
    else { selectedProjects.add(name); row.classList.add('sel'); selMode = 'projects'; }
    if (selectedProjects.size === 0) selMode = 'none';
    updateBanner(); updateSelPanel(); updateDropHint(); updateDetectBox(); checkUploadReady();
    loadSpritePanel(name);
}

// ═══ SPRITE PANEL ════════════════════════════════════════════════════════════
async function loadSpritePanel(projName) {
    spritePanelProj = projName;
    sprProjLbl.textContent = `— ${projName}`;
    sprList.innerHTML = '<div class="list-empty"><span class="inline-spin"></span></div>';
    try {
        if (!projectCache.has(projName)) projectCache.set(projName, await getProject(projName));
        renderSprList(getSpritesFromXml(projectCache.get(projName).projectXml), projName);
    } catch (e) {
        sprList.innerHTML = `<div class="list-empty" style="color:#f87171;font-size:11px">${esc(e.message)}</div>`;
    }
}

function renderSprList(sprites, projName) {
    sprList.innerHTML = '';
    sprites.forEach(s => {
        const row = document.createElement('div');
        const locked = selMode === 'projects';
        const isSel = selectedSprites.some(x => x.projectName === projName && x.spriteName === s.name);
        row.className = 'spr-row' + (isSel ? ' sel' : '') + (locked ? ' locked' : '');
        row.innerHTML = `<svg class="row-icon" fill="currentColor" viewBox="0 0 16 16">
            ${s.type === 'stage' ? '<rect x="1" y="2" width="14" height="10" rx="1.5"/><path d="M5 14h6"/>' : '<polygon points="8,2 14,13 2,13"/>'}
          </svg>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.name)}</span>
          <span class="row-tag">${s.type}</span>`;
        if (!locked) row.addEventListener('click', () => onSprClick(projName, s, row));
        sprList.appendChild(row);
    });
}

function onSprClick(projName, sprite, row) {
    if (selMode === 'projects') return;
    const idx = selectedSprites.findIndex(x => x.projectName === projName && x.spriteName === sprite.name);
    if (idx >= 0) { selectedSprites.splice(idx, 1); row.classList.remove('sel'); }
    else { selectedSprites.push({projectName: projName, spriteName: sprite.name, spriteType: sprite.type}); row.classList.add('sel'); selMode = 'sprites'; }
    if (selectedSprites.length === 0) selMode = 'none';
    updateBanner(); updateSelPanel(); updateDropHint(); updateDetectBox(); checkUploadReady(); renderProjList();
}

function resetSelection() {
    selMode = 'none'; selectedProjects = new Set(); selectedSprites = []; projectCache = new Map(); spritePanelProj = null;
    sprList.innerHTML = '<div class="list-empty">Click a project<br/>to see sprites</div>';
    sprProjLbl.textContent = '';
    updateBanner(); updateSelPanel(); updateDropHint(); updateDetectBox(); checkUploadReady();
}

function updateBanner() {
    modeBanner.className = 'mode-banner';
    const n = selMode === 'projects' ? selectedProjects.size : selectedSprites.length;
    btnClearSel.style.display = n > 0 ? 'inline-flex' : 'none';
    if (selMode === 'projects') { modeBanner.classList.add('proj'); modeText.textContent = `${n} project(s) selected — upload sprite files (.xml) or custom blocks (.xml). Selecting sprites is locked.`; }
    else if (selMode === 'sprites') { modeBanner.classList.add('spr'); modeText.textContent = `${n} sprite(s)/stage(s) selected — upload images, audio or script XML. Selecting whole projects is locked.`; }
    else { modeText.textContent = 'Select projects or sprites to define your upload target.'; }
    selSummary.textContent = n ? `${n} ${selMode === 'projects' ? 'project' : 'sprite'}(s) selected` : '';
}

function updateSelPanel() {
    selList.querySelectorAll('.sel-chip').forEach(e => e.remove());
    const hasAny = selMode === 'projects' ? selectedProjects.size > 0 : selectedSprites.length > 0;
    selEmptyMsg.style.display = hasAny ? 'none' : 'block';
    const clearBtn = $('btn-clear-sel');
    if (clearBtn) clearBtn.style.display = hasAny ? 'inline-flex' : 'none';
    if (selMode === 'projects') {
        [...selectedProjects].forEach(name => addChip('proj', name, null, () => {
            selectedProjects.delete(name); if (!selectedProjects.size) selMode = 'none';
            renderProjList(); updateBanner(); updateSelPanel(); updateDropHint(); updateDetectBox(); checkUploadReady();
        }));
    } else if (selMode === 'sprites') {
        selectedSprites.forEach(s => addChip('spr', s.spriteName, s.projectName, () => {
            const i = selectedSprites.findIndex(x => x.projectName === s.projectName && x.spriteName === s.spriteName);
            if (i >= 0) selectedSprites.splice(i, 1);
            if (!selectedSprites.length) { selMode = 'none'; renderProjList(); }
            if (spritePanelProj) { const cache = projectCache.get(spritePanelProj); if (cache) renderSprList(getSpritesFromXml(cache.projectXml), spritePanelProj); }
            updateBanner(); updateSelPanel(); updateDropHint(); updateDetectBox(); checkUploadReady();
        }));
    }
}

function addChip(type, name, sub, onRemove) {
    const chip = document.createElement('div');
    chip.className = `sel-chip type-${type}`;
    chip.innerHTML = `<div class="sel-chip-body"><div class="sel-chip-name">${esc(name)}</div>${sub ? `<div class="sel-chip-sub">${esc(sub)}</div>` : ''}</div><button class="sel-del">✕</button>`;
    chip.querySelector('.sel-del').addEventListener('click', onRemove);
    selList.insertBefore(chip, selEmptyMsg);
}

function updateDropHint() {
    if (selMode === 'projects') { dropHint.textContent = 'XML only — <sprites> sprite files or <blocks> custom blocks'; fileInput.accept = '.xml'; dropZone.classList.remove('locked'); }
    else if (selMode === 'sprites') { dropHint.textContent = 'PNG · JPG · GIF · SVG · MP3 · WAV · XML (script)'; fileInput.accept = '.png,.jpg,.jpeg,.gif,.svg,.mp3,.wav,.ogg,.xml'; dropZone.classList.remove('locked'); }
    else { dropHint.textContent = 'Select a target first'; fileInput.accept = ''; dropZone.classList.add('locked'); }
    files.forEach(f => { f.valid = isFileAccepted(f.file, selMode, f.xmlType); });
    renderFiles();
}

function updateDetectBox() {
    const validFiles = files.filter(f => f.valid);
    if (!validFiles.length || selMode === 'none') { detectBox.style.display = 'none'; return; }
    detectBox.style.display = 'block';
    const lines = ['<strong>What will happen:</strong>'];
    if (selMode === 'projects') {
        const sprites = validFiles.filter(f => f.xmlType === 'sprite').length;
        const blocks = validFiles.filter(f => f.xmlType === 'blocks').length;
        if (sprites) lines.push(`· ${sprites} sprite file(s) → imported into each project (duplicates skipped)`);
        if (blocks) lines.push(`· ${blocks} custom block file(s) → added to global blocks (duplicates skipped)`);
    } else {
        const imgs = validFiles.filter(f => EXTS_IMG.includes(fileExt(f.file))).length;
        const audios = validFiles.filter(f => EXTS_AUDIO.includes(fileExt(f.file))).length;
        const scripts = validFiles.filter(f => ['script','scripts'].includes(f.xmlType)).length;
        if (imgs) lines.push(`· ${imgs} image(s) → costume added (duplicates skipped)`);
        if (audios) lines.push(`· ${audios} audio file(s) → sound added (duplicates skipped)`);
        if (scripts) lines.push(`· ${scripts} script(s) → injected into each selected sprite`);
    }
    const rejected = files.filter(f => !f.valid).length;
    if (rejected) lines.push(`· ${rejected} file(s) rejected (wrong type for this mode)`);
    detectBox.innerHTML = lines.join('<br/>');
}

async function addFiles(newFiles) {
    for (const f of newFiles) {
        if (files.find(x => x.file.name === f.name && x.file.size === f.size)) continue;
        let xmlType = null;
        if (fileExt(f) === 'xml') xmlType = await detectXmlType(f);
        files.push({file: f, xmlType, valid: isFileAccepted(f, selMode, xmlType)});
    }
    renderFiles(); updateDetectBox(); checkUploadReady();
}

function renderFiles() {
    fileListEl.innerHTML = '';
    const extMap = {png:'img',jpg:'img',jpeg:'img',gif:'img',svg:'img',mp3:'audio',wav:'audio',ogg:'audio',xml:'xml'};
    const clsMap = {img:'ext-img',audio:'ext-audio',xml:'ext-xml'};
    files.forEach((entry, i) => {
        const {file, xmlType, valid} = entry;
        const e = fileExt(file);
        const kind = extMap[e] || 'xml';
        const chip = document.createElement('div');
        chip.className = 'file-chip' + (valid ? '' : ' invalid');
        chip.innerHTML = `<span class="ext-badge ${valid ? clsMap[kind]||'ext-xml' : 'ext-bad'}">${e}</span>
          <span class="fname">${esc(file.name)}</span>
          ${xmlType ? `<span class="xml-tag">${xmlType}</span>` : ''}
          ${!valid ? `<span class="rej-tag">rejected</span>` : ''}
          <span class="fsize">${(file.size/1024).toFixed(0)} KB</span>
          <button class="del-btn">✕</button>`;
        chip.querySelector('.del-btn').addEventListener('click', () => { files.splice(i,1); renderFiles(); updateDetectBox(); checkUploadReady(); });
        fileListEl.appendChild(chip);
    });
    const valid = files.filter(f => f.valid).length;
    fileCountBadge.textContent = files.length ? `${valid}/${files.length} accepted` : '';
}

dropZone.addEventListener('dragover', e => { e.preventDefault(); if (selMode !== 'none') dropZone.classList.add('over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('over'));
dropZone.addEventListener('drop', e => { e.preventDefault(); dropZone.classList.remove('over'); if (selMode !== 'none') addFiles(e.dataTransfer.files); });
$('browse-link').addEventListener('click', e => { e.stopPropagation(); if (selMode !== 'none') fileInput.click(); });
dropZone.addEventListener('click', e => { if (e.target.id !== 'browse-link' && selMode !== 'none') fileInput.click(); });
fileInput.addEventListener('change', () => { addFiles(fileInput.files); fileInput.value = ''; });

function checkUploadReady() {
    const hasSel = selMode === 'projects' ? selectedProjects.size > 0 : selectedSprites.length > 0;
    const hasValid = files.some(f => f.valid);
    btnUpload.disabled = !state.username || !hasSel || !hasValid || busy;
    const showDownload = selMode === 'sprites' && hasSel && hasValid && !!state.username;
    btnDownXml.style.display = showDownload ? '' : 'none';
    btnDownXml.disabled = busy;
}

// ═══ MAIN UPLOAD ═════════════════════════════════════════════════════════════
btnDownXml.addEventListener('click', async () => {
    if (busy || btnDownXml.disabled) return;
    const validFiles = files.filter(f => f.valid);
    setBusy(true);
    try {
        const byProject = {};
        for (const s of selectedSprites) { if (!byProject[s.projectName]) byProject[s.projectName] = []; byProject[s.projectName].push(s); }
        for (const [projName, sprites] of Object.entries(byProject)) {
            let {projectXml, mediaXml} = await getOrFetch(projName);
            for (const {file, xmlType} of validFiles) {
                const e = fileExt(file);
                if (EXTS_IMG.includes(e)) { for (const s of sprites) { const r = await uploadImageToSprite(projectXml, mediaXml, s.spriteName, file); projectXml = r.projectXml; mediaXml = r.mediaXml; } }
                else if (EXTS_AUDIO.includes(e)) { for (const s of sprites) { const r = await uploadAudioToSprite(projectXml, mediaXml, s.spriteName, file); projectXml = r.projectXml; mediaXml = r.mediaXml; } }
                else if (e === 'xml' && ['script','scripts'].includes(xmlType)) { const text = await file.text(); for (const s of sprites) { const r = importScriptXml(projectXml, mediaXml, s.spriteName, text); projectXml = r.projectXml; mediaXml = r.mediaXml; } }
            }
            console.log("Download triggered for", projName);
            log(`⬇ Downloaded modified XML for "${projName}" — load this file in Snap! to test`, 'ok');
        }
    } catch (e) { log('✗ Download error: ' + e.message, 'err'); }
    finally { setBusy(false); setProgress(false); }
});

btnUpload.addEventListener('click', async () => {
    if (busy || btnUpload.disabled) return;
    const validFiles = files.filter(f => f.valid);
    setBusy(true); setProgress(true, 0, 'Starting…');
    try { if (selMode === 'projects') await uploadToProjects(validFiles); else await uploadToSprites(validFiles); }
    catch (e) { log(e.message, 'err'); }
    setProgress(false); setBusy(false);
});

async function uploadToProjects(validFiles) {
    const targets = [...selectedProjects];
    log(`Uploading to ${targets.length} project(s) — ${validFiles.length} file(s)`, 'info');
    for (let i = 0; i < targets.length; i++) {
        const name = targets[i]; log(`↓ "${name}"…`, 'info');
        try {
            let {projectXml, mediaXml} = await getOrFetch(name);
            for (const {file, xmlType} of validFiles) {
                const text = await file.text();
                if (xmlType === 'sprite') { const r = importSpriteXml(projectXml, mediaXml, text); projectXml = r.projectXml; mediaXml = r.mediaXml; if (r.skipped.length) log(`  ⚠ skipped duplicate sprites: ${r.skipped.join(', ')}`, 'warn'); else log(`  + sprites from "${file.name}"`, 'ok'); }
                else if (xmlType === 'blocks') { const r = importCustomBlocks(projectXml, mediaXml, text); projectXml = r.projectXml; mediaXml = r.mediaXml; if (r.skipped.length) log(`  ⚠ skipped duplicate blocks: ${r.skipped.join(', ')}`, 'warn'); else log(`  + custom blocks "${file.name}"`, 'ok'); }
            }
            await saveProject(name, projectXml, mediaXml); projectCache.set(name, {projectXml, mediaXml}); log(`  ✓ saved "${name}"`, 'ok');
        } catch (e) { log(`  ✗ "${name}": ${e.message}`, 'err'); }
        setProgress(true, (i+1)/targets.length*100, `${i+1}/${targets.length} projects done`);
    }
    log(`Done — ${targets.length} project(s) processed`, 'ok');
}

async function uploadToSprites(validFiles) {
    const byProject = {};
    for (const s of selectedSprites) { if (!byProject[s.projectName]) byProject[s.projectName] = []; byProject[s.projectName].push(s); }
    const projNames = Object.keys(byProject);
    log(`Uploading to ${selectedSprites.length} sprite(s) in ${projNames.length} project(s)`, 'info');
    for (let pi = 0; pi < projNames.length; pi++) {
        const projName = projNames[pi]; const sprites = byProject[projName]; log(`↓ "${projName}"…`, 'info');
        try {
            let {projectXml, mediaXml} = await getOrFetch(projName);
            for (const {file, xmlType} of validFiles) {
                const e = fileExt(file); const isImg = EXTS_IMG.includes(e); const isAud = EXTS_AUDIO.includes(e);
                if (isImg || isAud) {
                    for (const s of sprites) {
                        try { let r; if (isImg) r = await uploadImageToSprite(projectXml, mediaXml, s.spriteName, file); else r = await uploadAudioToSprite(projectXml, mediaXml, s.spriteName, file); projectXml = r.projectXml; mediaXml = r.mediaXml; if (r.skipped) log(`  ⚠ "${file.name}" already exists on "${s.spriteName}" — skipped`, 'warn'); else log(`  + ${isImg?'image':'audio'} "${file.name}" → "${s.spriteName}"`, 'ok'); }
                        catch (e2) { log(`  ✗ "${s.spriteName}": ${e2.message}`, 'err'); }
                    }
                } else if (e === 'xml' && ['script','scripts'].includes(xmlType)) {
                    const text = await file.text();
                    for (const s of sprites) { try { const r = importScriptXml(projectXml, mediaXml, s.spriteName, text); projectXml = r.projectXml; mediaXml = r.mediaXml; log(`  + script "${file.name}" → "${s.spriteName}"`, 'ok'); } catch (e2) { log(`  ✗ "${s.spriteName}": ${e2.message}`, 'err'); } }
                }
            }
            await saveProject(projName, projectXml, mediaXml); projectCache.set(projName, {projectXml, mediaXml}); log(`  ✓ saved "${projName}"`, 'ok');
        } catch (e) { log(`  ✗ "${projName}": ${e.message}`, 'err'); }
        setProgress(true, (pi+1)/projNames.length*100, `${pi+1}/${projNames.length} projects done`);
    }
    log(`Done — ${projNames.length} project(s) updated`, 'ok');
}

async function getOrFetch(name) { if (!projectCache.has(name)) projectCache.set(name, await getProject(name)); return projectCache.get(name); }

function setBusy(v) { busy = v; btnUpload.classList.toggle('busy', v); btnLabel.textContent = v ? 'Uploading…' : 'Upload to Snap!'; checkUploadReady(); }
function setProgress(show, pct = 0, label = '') { progWrap.classList.toggle('active', show); if (show) { progBar.style.width = pct+'%'; progPct.textContent = Math.round(pct)+'%'; progLabel.textContent = label; } }
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// Init
console.log('[uploader] ✓ init complete');
updateDropHint();
setCredStatus('warn', null, 'Fill in username and password to connect');
