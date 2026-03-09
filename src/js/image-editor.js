/**
 * image-editor.js — Image Editor page module
 * Client-side image trim & resize with dynamic action pipeline.
 * Exports initImageEditor().
 */

console.log('[image-editor] ✓ module loaded');

const $ = id => document.getElementById(id);

// ═══ STATE ═══════════════════════════════════════════════════════════════════
let images = [];    // { file, url, img (HTMLImageElement), w, h }
let actions = [];   // { id, type:'trim'|'resize', opts:{...} }
let actionIdSeq = 0;
let busy = false;

// ═══ INIT ════════════════════════════════════════════════════════════════════
export function initImageEditor() {
    console.log('[image-editor] initImageEditor()');
    images = [];
    actions = [];
    actionIdSeq = 0;
    busy = false;
    wireEvents();
    renderActions();
    updateUI();
}

// ═══ WIRING ══════════════════════════════════════════════════════════════════
function wireEvents() {
    const dz = $('ie-drop-zone'), fi = $('ie-file-input');

    if (dz) {
        dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
        dz.addEventListener('dragleave', () => dz.classList.remove('over'));
        dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('over'); addFiles(e.dataTransfer.files); });
        dz.addEventListener('click', e => { if (e.target.id !== 'ie-browse') fi?.click(); });
    }
    $('ie-browse')?.addEventListener('click', e => { e.stopPropagation(); fi?.click(); });
    fi?.addEventListener('change', () => { addFiles([...fi.files]); fi.value = ''; });

    $('ie-clear-imgs')?.addEventListener('click', () => {
        images.forEach(i => URL.revokeObjectURL(i.url));
        images = [];
        renderThumbs();
        updateUI();
    });

    // Add action buttons
    $('ie-add-trim')?.addEventListener('click', () => addAction('trim'));
    $('ie-add-resize')?.addEventListener('click', () => addAction('resize'));

    // Clear all actions
    $('ie-clear-actions')?.addEventListener('click', () => {
        actions = [];
        renderActions();
        updateUI();
    });

    // Run button
    $('ie-btn-run')?.addEventListener('click', onRun);
}

// ═══ ADD FILES ═══════════════════════════════════════════════════════════════
function addFiles(fileList) {
    const accepted = ['image/png','image/jpeg','image/gif','image/webp','image/svg+xml'];
    const arr = Array.from(fileList).filter(f => accepted.includes(f.type));
    if (!arr.length) return;

    let loaded = 0;
    arr.forEach(file => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            images.push({ file, url, img, w: img.naturalWidth, h: img.naturalHeight });
            loaded++;
            if (loaded === arr.length) { renderThumbs(); updateUI(); }
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            loaded++;
            if (loaded === arr.length) { renderThumbs(); updateUI(); }
        };
        img.src = url;
    });
}

// ═══ THUMBNAILS ══════════════════════════════════════════════════════════════
function renderThumbs() {
    const list = $('ie-thumb-list');
    if (!list) return;
    list.innerHTML = '';

    if (!images.length) {
        list.innerHTML = `<div class="imgedit-empty-state">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="32" height="32">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
            </svg>
            <span>No images loaded</span>
          </div>`;
        return;
    }

    images.forEach((entry, i) => {
        const thumb = document.createElement('div');
        thumb.className = 'imgedit-thumb';
        const im = document.createElement('img');
        im.src = entry.url;
        im.alt = entry.file.name;
        thumb.appendChild(im);

        const del = document.createElement('button');
        del.className = 'imgedit-thumb-del';
        del.textContent = '✕';
        del.addEventListener('click', e => {
            e.stopPropagation();
            URL.revokeObjectURL(entry.url);
            images.splice(i, 1);
            renderThumbs();
            updateUI();
        });
        thumb.appendChild(del);

        const info = document.createElement('div');
        info.className = 'imgedit-thumb-info';
        info.textContent = `${entry.w}×${entry.h}`;
        thumb.appendChild(info);

        list.appendChild(thumb);
    });
}

// ═══ ACTION MANAGEMENT ═══════════════════════════════════════════════════════

const ICONS = {
    trim: `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="16" height="16"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M6 2v4M6 18v4M2 6h4m12 0h4M18 2v4m0 12v4M2 18h4m12 0h4M8 8h8v8H8z"/></svg>`,
    resize: `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="16" height="16"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5"/></svg>`,
};

function defaultOpts(type) {
    if (type === 'trim') return { auto: true, top: 0, right: 0, bottom: 0, left: 0 };
    if (type === 'resize') return { mode: 'scale', scale: 50, w: 256, h: 256, lock: true };
    return {};
}

function addAction(type) {
    actions.push({ id: ++actionIdSeq, type, opts: defaultOpts(type) });
    renderActions();
    updateUI();
}

function removeAction(id) {
    actions = actions.filter(a => a.id !== id);
    renderActions();
    updateUI();
}

// ═══ RENDER ACTION CARDS ═════════════════════════════════════════════════════
function renderActions() {
    const list = $('ie-action-list');
    const empty = $('ie-action-empty');
    if (!list) return;

    // Remove existing cards (keep the empty placeholder)
    list.querySelectorAll('.imgedit-action-card').forEach(el => el.remove());

    if (!actions.length) {
        if (empty) empty.style.display = 'flex';
        return;
    }
    if (empty) empty.style.display = 'none';

    actions.forEach((action, idx) => {
        const card = document.createElement('div');
        card.className = 'imgedit-action-card';
        card.dataset.actionId = action.id;

        // Header
        const head = document.createElement('div');
        head.className = 'imgedit-action-card-head';
        head.innerHTML = `
            ${ICONS[action.type] || ''}
            <span class="imgedit-action-card-title">${action.type === 'trim' ? 'Trim' : 'Resize'}</span>
            <span class="imgedit-action-card-idx">#${idx + 1}</span>
        `;
        const delBtn = document.createElement('button');
        delBtn.className = 'imgedit-action-card-del';
        delBtn.textContent = '✕';
        delBtn.title = 'Remove this action';
        delBtn.addEventListener('click', () => removeAction(action.id));
        head.appendChild(delBtn);
        card.appendChild(head);

        // Body with settings
        const body = document.createElement('div');
        body.className = 'imgedit-action-card-body';

        if (action.type === 'trim') {
            body.innerHTML = buildTrimBody(action);
            card.appendChild(body);
            list.appendChild(card);
            wireTrimCard(body, action);
        } else if (action.type === 'resize') {
            body.innerHTML = buildResizeBody(action);
            card.appendChild(body);
            list.appendChild(card);
            wireResizeCard(body, action);
        }
    });
}

// ── Trim card HTML ──
function buildTrimBody(action) {
    const o = action.opts;
    const uid = `at${action.id}`;
    return `
        <div class="imgedit-trim-layout">
            <label class="imgedit-toggle-option imgedit-toggle-inline">
                <input type="checkbox" class="ie-trim-auto" data-uid="${uid}" ${o.auto ? 'checked' : ''}/>
                <span class="imgedit-toggle-slider"></span>
                <span class="imgedit-toggle-text">Auto-trim</span>
            </label>
            <div class="imgedit-option-row ie-trim-manual" data-uid="${uid}" style="display:${o.auto ? 'none' : 'flex'}">
                <div class="imgedit-field-group">
                    <label class="imgedit-field-label">Top</label>
                    <input type="number" class="imgedit-input ie-trim-val" data-side="top" value="${o.top}" min="0" placeholder="px"/>
                </div>
                <div class="imgedit-field-group">
                    <label class="imgedit-field-label">Right</label>
                    <input type="number" class="imgedit-input ie-trim-val" data-side="right" value="${o.right}" min="0" placeholder="px"/>
                </div>
                <div class="imgedit-field-group">
                    <label class="imgedit-field-label">Bottom</label>
                    <input type="number" class="imgedit-input ie-trim-val" data-side="bottom" value="${o.bottom}" min="0" placeholder="px"/>
                </div>
                <div class="imgedit-field-group">
                    <label class="imgedit-field-label">Left</label>
                    <input type="number" class="imgedit-input ie-trim-val" data-side="left" value="${o.left}" min="0" placeholder="px"/>
                </div>
            </div>
        </div>
    `;
}

function wireTrimCard(body, action) {
    const uid = `at${action.id}`;
    const autoChk = body.querySelector(`.ie-trim-auto[data-uid="${uid}"]`);
    const manualRow = body.querySelector(`.ie-trim-manual[data-uid="${uid}"]`);
    autoChk?.addEventListener('change', function () {
        action.opts.auto = this.checked;
        if (manualRow) manualRow.style.display = this.checked ? 'none' : 'flex';
        updateUI();
    });
    body.querySelectorAll('.ie-trim-val').forEach(inp => {
        inp.addEventListener('input', function () {
            action.opts[this.dataset.side] = parseInt(this.value) || 0;
        });
    });
}

// ── Resize card HTML ──
function buildResizeBody(action) {
    const o = action.opts;
    const uid = `ar${action.id}`;
    return `
        <div class="imgedit-resize-modes">
            <label class="imgedit-radio">
                <input type="radio" name="ie-rmode-${uid}" value="scale" ${o.mode === 'scale' ? 'checked' : ''}/>
                <span>Scale by %</span>
            </label>
            <label class="imgedit-radio">
                <input type="radio" name="ie-rmode-${uid}" value="fixed" ${o.mode === 'fixed' ? 'checked' : ''}/>
                <span>Fixed size (px)</span>
            </label>
        </div>
        <div class="imgedit-option-row ie-rscale" data-uid="${uid}" style="display:${o.mode === 'scale' ? 'flex' : 'none'}">
            <div class="imgedit-field-group">
                <label class="imgedit-field-label">Scale</label>
                <div class="imgedit-input-suffix">
                    <input type="number" class="imgedit-input ie-resize-scale-inp" value="${o.scale}" min="1" max="1000" step="1"/>
                    <span class="imgedit-suffix">%</span>
                </div>
            </div>
        </div>
        <div class="imgedit-option-row ie-rfixed" data-uid="${uid}" style="display:${o.mode === 'fixed' ? 'flex' : 'none'}">
            <div class="imgedit-field-group">
                <label class="imgedit-field-label">Width</label>
                <div class="imgedit-input-suffix">
                    <input type="number" class="imgedit-input ie-rw" value="${o.w}" min="1" placeholder="px"/>
                    <span class="imgedit-suffix">px</span>
                </div>
            </div>
            <div class="imgedit-field-group">
                <label class="imgedit-field-label">Height</label>
                <div class="imgedit-input-suffix">
                    <input type="number" class="imgedit-input ie-rh" value="${o.h}" min="1" placeholder="px"/>
                    <span class="imgedit-suffix">px</span>
                </div>
            </div>
            <div class="imgedit-lock-group">
                <label class="imgedit-toggle-option imgedit-toggle-inline">
                    <input type="checkbox" class="ie-rlock" ${o.lock ? 'checked' : ''}/>
                    <span class="imgedit-toggle-slider"></span>
                    <span class="imgedit-toggle-text">Keep ratio</span>
                </label>
            </div>
        </div>
    `;
}

function wireResizeCard(body, action) {
    const uid = `ar${action.id}`;
    const scaleRow = body.querySelector(`.ie-rscale[data-uid="${uid}"]`);
    const fixedRow = body.querySelector(`.ie-rfixed[data-uid="${uid}"]`);

    body.querySelectorAll(`input[name="ie-rmode-${uid}"]`).forEach(r => {
        r.addEventListener('change', () => {
            const isScale = r.value === 'scale' && r.checked;
            action.opts.mode = r.value;
            if (scaleRow) scaleRow.style.display = isScale ? 'flex' : 'none';
            if (fixedRow) fixedRow.style.display = isScale ? 'none' : 'flex';
            updateUI();
        });
    });

    const scaleInp = body.querySelector('.ie-resize-scale-inp');
    scaleInp?.addEventListener('input', function () {
        action.opts.scale = parseFloat(this.value) || 50;
        updateUI();
    });

    const wInp = body.querySelector('.ie-rw');
    const hInp = body.querySelector('.ie-rh');
    const lockChk = body.querySelector('.ie-rlock');

    wInp?.addEventListener('input', function () {
        action.opts.w = parseInt(this.value) || 1;
        if (lockChk?.checked && images.length) {
            const ratio = images[0].w / images[0].h;
            action.opts.h = Math.round(action.opts.w / ratio);
            if (hInp) hInp.value = action.opts.h;
        }
        updateUI();
    });
    hInp?.addEventListener('input', function () {
        action.opts.h = parseInt(this.value) || 1;
        if (lockChk?.checked && images.length) {
            const ratio = images[0].w / images[0].h;
            action.opts.w = Math.round(action.opts.h * ratio);
            if (wInp) wInp.value = action.opts.w;
        }
        updateUI();
    });
    lockChk?.addEventListener('change', function () {
        action.opts.lock = this.checked;
        updateUI();
    });
}

// ═══ DRAGGABLE ORDER LIST (Run panel) ════════════════════════════════════════

function getActionDetail(action) {
    if (action.type === 'trim') {
        const o = action.opts;
        if (o.auto) return 'Auto — remove transparent borders';
        return `Manual — T:${o.top} R:${o.right} B:${o.bottom} L:${o.left}px`;
    }
    if (action.type === 'resize') {
        const o = action.opts;
        if (o.mode === 'scale') return `Scale to ${o.scale}%`;
        const lock = o.lock ? ' (keep ratio)' : ' (stretch)';
        return `Fixed ${o.w}×${o.h}px${lock}`;
    }
    return '';
}

function renderOrderList() {
    const list = $('ie-order-list');
    if (!list) return;
    list.innerHTML = '';

    if (!actions.length) {
        list.innerHTML = '<div class="imgedit-order-empty">Add actions in Step 2</div>';
        return;
    }

    let dragSrcIdx = null;

    actions.forEach((action, idx) => {
        const item = document.createElement('div');
        item.className = 'imgedit-order-item';
        item.draggable = true;
        item.dataset.idx = idx;

        item.innerHTML = `
            <div class="imgedit-order-grip"><span></span><span></span><span></span></div>
            <div class="imgedit-order-icon">${ICONS[action.type] || ''}</div>
            <div class="imgedit-order-text">
                <div class="imgedit-order-name">${action.type === 'trim' ? 'Trim' : 'Resize'}</div>
                <div class="imgedit-order-detail">${getActionDetail(action)}</div>
            </div>
            <div class="imgedit-order-num">${idx + 1}</div>
        `;

        item.addEventListener('dragstart', e => {
            dragSrcIdx = idx;
            item.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', String(idx));
        });
        item.addEventListener('dragend', () => {
            item.classList.remove('dragging');
            list.querySelectorAll('.imgedit-order-item').forEach(el => el.classList.remove('drag-over'));
            dragSrcIdx = null;
        });
        item.addEventListener('dragover', e => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            item.classList.add('drag-over');
        });
        item.addEventListener('dragleave', () => {
            item.classList.remove('drag-over');
        });
        item.addEventListener('drop', e => {
            e.preventDefault();
            item.classList.remove('drag-over');
            if (dragSrcIdx === null || dragSrcIdx === idx) return;
            const [moved] = actions.splice(dragSrcIdx, 1);
            actions.splice(idx, 0, moved);
            renderActions();
            updateUI();
        });

        list.appendChild(item);
    });
}

// ═══ UI UPDATE ═══════════════════════════════════════════════════════════════
function updateUI() {
    // Image badge
    const badge = $('ie-img-count');
    if (badge) badge.textContent = images.length ? `${images.length}` : '';
    const clearImgBtn = $('ie-clear-imgs');
    if (clearImgBtn) clearImgBtn.style.display = images.length ? 'inline-flex' : 'none';

    // Action badge + clear
    const aBadge = $('ie-action-count');
    if (aBadge) aBadge.textContent = actions.length ? `${actions.length}` : '';
    const clearActBtn = $('ie-clear-actions');
    if (clearActBtn) clearActBtn.style.display = actions.length ? 'inline-flex' : 'none';

    renderOrderList();
    updateSummary();
}

function updateSummary() {
    const hasAction = actions.length > 0;
    const canRun = images.length > 0 && hasAction && !busy;

    const btn = $('ie-btn-run');
    if (btn) btn.disabled = !canRun;

    const summary = $('ie-run-summary');
    if (!summary) return;

    if (!images.length || !hasAction) {
        summary.innerHTML = '<div class="imgedit-run-dim">Select images and add at least one action</div>';
        return;
    }

    let html = `<div style="margin-bottom:0.3rem;color:var(--snap-text)">${images.length} image${images.length > 1 ? 's' : ''} · ${actions.length} action${actions.length > 1 ? 's' : ''}</div>`;
    actions.forEach((a, i) => {
        if (a.type === 'trim') {
            html += makeRunItem('trim', `${i + 1}. Trim (${a.opts.auto ? 'auto' : 'manual'})`);
        } else {
            if (a.opts.mode === 'scale') {
                html += makeRunItem('resize', `${i + 1}. Resize ${a.opts.scale}%`);
            } else {
                html += makeRunItem('resize', `${i + 1}. Resize ${a.opts.w}×${a.opts.h}px`);
            }
        }
    });
    summary.innerHTML = html;
}

function makeRunItem(icon, text) {
    return `<div class="imgedit-run-item">${ICONS[icon] || ''}<span>${text}</span></div>`;
}

// ═══ RUN (PROCESS) ═══════════════════════════════════════════════════════════
async function onRun() {
    if (busy || !images.length || !actions.length) return;
    busy = true;
    updateUI();

    const logEl = $('ie-log');
    const progEl = $('ie-prog');
    const barEl = $('ie-prog-bar');
    const pctEl = $('ie-prog-pct');
    const lblEl = $('ie-prog-label');

    if (logEl) logEl.innerHTML = '';
    if (progEl) progEl.style.display = 'block';
    log('Starting processing…', 'info');
    log(`Pipeline: ${actions.map((a, i) => `${i + 1}.${a.type}`).join(' → ')}`, 'dim');

    const results = [];
    const total = images.length;

    for (let i = 0; i < total; i++) {
        const entry = images[i];
        if (barEl) barEl.style.width = `${(i / total) * 100}%`;
        if (pctEl) pctEl.textContent = `${Math.round((i / total) * 100)}%`;
        if (lblEl) lblEl.textContent = `Processing ${i + 1}/${total}…`;

        try {
            let canvas = imgToCanvas(entry.img);

            for (const action of actions) {
                if (action.type === 'trim') {
                    const o = action.opts;
                    if (o.auto) {
                        canvas = autoTrim(canvas);
                    } else {
                        canvas = manualTrim(canvas, o.top, o.right, o.bottom, o.left);
                    }
                    log(`✓ Trimmed "${entry.file.name}" → ${canvas.width}×${canvas.height}`, 'ok');
                } else if (action.type === 'resize') {
                    const o = action.opts;
                    if (o.mode === 'scale') {
                        const s = (o.scale || 50) / 100;
                        canvas = resizeCanvas(canvas, Math.max(1, Math.round(canvas.width * s)), Math.max(1, Math.round(canvas.height * s)));
                    } else {
                        let fw = o.w || 256, fh = o.h || 256;
                        if (o.lock) {
                            const ratio = canvas.width / canvas.height;
                            if (fw / fh > ratio) fw = Math.round(fh * ratio);
                            else fh = Math.round(fw / ratio);
                        }
                        canvas = resizeCanvas(canvas, Math.max(1, fw), Math.max(1, fh));
                    }
                    log(`✓ Resized "${entry.file.name}" → ${canvas.width}×${canvas.height}`, 'ok');
                }
            }

            const blob = await canvasToBlob(canvas, entry.file.type);
            results.push({ blob, name: entry.file.name });
        } catch (err) {
            log(`✗ Error "${entry.file.name}": ${err.message}`, 'err');
        }
    }

    if (barEl) barEl.style.width = '100%';
    if (pctEl) pctEl.textContent = '100%';
    if (lblEl) lblEl.textContent = 'Done!';

    if (results.length === 1) {
        downloadBlob(results[0].blob, results[0].name);
        log(`⬇ Downloaded "${results[0].name}"`, 'ok');
    } else if (results.length > 1) {
        for (const r of results) downloadBlob(r.blob, r.name);
        log(`⬇ Downloaded ${results.length} images`, 'ok');
    } else {
        log('No images processed successfully', 'warn');
    }

    log(`Finished — ${results.length}/${total} processed`, 'info');
    busy = false;
    updateUI();
    setTimeout(() => { if (progEl) progEl.style.display = 'none'; }, 2000);
}

// ═══ IMAGE PROCESSING HELPERS ════════════════════════════════════════════════

function imgToCanvas(img) {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    return c;
}

function autoTrim(canvas) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    const data = ctx.getImageData(0, 0, w, h).data;
    let top = h, left = w, bottom = 0, right = 0;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (data[(y * w + x) * 4 + 3] > 0) {
                if (y < top) top = y;
                if (y > bottom) bottom = y;
                if (x < left) left = x;
                if (x > right) right = x;
            }
        }
    }
    if (top > bottom || left > right) {
        const c = document.createElement('canvas');
        c.width = 1; c.height = 1;
        return c;
    }
    const tw = right - left + 1, th = bottom - top + 1;
    const c = document.createElement('canvas');
    c.width = tw; c.height = th;
    c.getContext('2d').drawImage(canvas, left, top, tw, th, 0, 0, tw, th);
    return c;
}

function manualTrim(canvas, top, right, bottom, left) {
    const nw = Math.max(1, canvas.width - left - right);
    const nh = Math.max(1, canvas.height - top - bottom);
    const c = document.createElement('canvas');
    c.width = nw; c.height = nh;
    c.getContext('2d').drawImage(canvas, left, top, nw, nh, 0, 0, nw, nh);
    return c;
}

function resizeCanvas(canvas, w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(canvas, 0, 0, w, h);
    return c;
}

function canvasToBlob(canvas, mimeType) {
    const mime = (mimeType === 'image/svg+xml') ? 'image/png' : (mimeType || 'image/png');
    return new Promise(resolve => canvas.toBlob(blob => resolve(blob), mime));
}

function downloadBlob(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ═══ LOG ═════════════════════════════════════════════════════════════════════
function log(msg, type = 'info') {
    const el = $('ie-log');
    if (!el) return;
    const d = document.createElement('div');
    d.className = { ok: 'log-ok', err: 'log-err', info: 'log-info', warn: 'log-warn', dim: 'log-dim' }[type] || 'log-info';
    d.textContent = `${{ ok: '✓', err: '✗', info: '·', warn: '⚠' }[type] || '·'} ${msg}`;
    el.appendChild(d);
    el.scrollTop = el.scrollHeight;
}
