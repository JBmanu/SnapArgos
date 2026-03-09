/**
 * image-editor.js — Image Editor page module
 * Client-side image trim & resize. Exports initImageEditor().
 */

console.log('[image-editor] ✓ module loaded');

const $ = id => document.getElementById(id);

// ═══ STATE ═══════════════════════════════════════════════════════════════════
let images = [];   // { file, url, img (HTMLImageElement), w, h }
let busy = false;
let actionOrder = ['trim', 'resize'];  // user-reorderable

// ═══ INIT ════════════════════════════════════════════════════════════════════
export function initImageEditor() {
    console.log('[image-editor] initImageEditor()');
    images = [];
    busy = false;
    actionOrder = ['trim', 'resize'];
    wireEvents();
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

    // Trim toggle
    $('ie-trim-enabled')?.addEventListener('change', function () {
        toggleBody('ie-trim-body', this.checked);
        updateUI();
    });
    $('ie-trim-auto')?.addEventListener('change', function () {
        const row = $('ie-trim-manual-row');
        if (row) row.style.display = this.checked ? 'none' : 'flex';
    });

    // Resize toggle
    $('ie-resize-enabled')?.addEventListener('change', function () {
        toggleBody('ie-resize-body', this.checked);
        updateUI();
    });

    // Resize mode radios
    document.querySelectorAll('input[name="ie-resize-mode"]').forEach(r => {
        r.addEventListener('change', () => {
            const isScale = r.value === 'scale' && r.checked;
            const sr = $('ie-resize-scale-row');
            const fr = $('ie-resize-fixed-row');
            if (sr) sr.style.display = isScale ? 'flex' : 'none';
            if (fr) fr.style.display = isScale ? 'none' : 'flex';
        });
    });

    // Lock aspect ratio — sync W↔H
    $('ie-resize-w')?.addEventListener('input', () => syncAspect('w'));
    $('ie-resize-h')?.addEventListener('input', () => syncAspect('h'));

    // Run button
    $('ie-btn-run')?.addEventListener('click', onRun);
}

function toggleBody(id, open) {
    const el = $(id);
    if (el) el.classList.toggle('open', open);
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
            if (loaded === arr.length) {
                renderThumbs();
                updateUI();
            }
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

// ═══ ASPECT LOCK ═════════════════════════════════════════════════════════════
function syncAspect(changed) {
    if (!$('ie-resize-lock')?.checked) return;
    if (!images.length) return;
    const first = images[0];
    const ratio = first.w / first.h;
    const wEl = $('ie-resize-w'), hEl = $('ie-resize-h');
    if (changed === 'w' && wEl && hEl) {
        hEl.value = Math.round(parseInt(wEl.value) / ratio) || '';
    } else if (changed === 'h' && wEl && hEl) {
        wEl.value = Math.round(parseInt(hEl.value) * ratio) || '';
    }
}

// ═══ DRAGGABLE ACTION ORDER ══════════════════════════════════════════════════
const ACTION_META = {
    trim: {
        label: 'Trim',
        icon: `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="16" height="16"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M6 2v4M6 18v4M2 6h4m12 0h4M18 2v4m0 12v4M2 18h4m12 0h4M8 8h8v8H8z"/></svg>`,
    },
    resize: {
        label: 'Resize',
        icon: `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="16" height="16"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5"/></svg>`,
    },
};

function renderOrderList() {
    const list = $('ie-order-list');
    if (!list) return;
    list.innerHTML = '';

    const trimOn = $('ie-trim-enabled')?.checked;
    const resizeOn = $('ie-resize-enabled')?.checked;
    const active = actionOrder.filter(a => (a === 'trim' && trimOn) || (a === 'resize' && resizeOn));

    if (!active.length) {
        list.innerHTML = '<div class="imgedit-order-empty">Enable actions in Step 2</div>';
        return;
    }

    let dragSrcIdx = null;

    active.forEach((key, idx) => {
        const meta = ACTION_META[key];
        const item = document.createElement('div');
        item.className = 'imgedit-order-item';
        item.draggable = true;
        item.dataset.action = key;

        item.innerHTML = `
            <div class="imgedit-order-grip"><span></span><span></span><span></span></div>
            <div class="imgedit-order-icon">${meta.icon}</div>
            <div class="imgedit-order-name">${meta.label}</div>
            <div class="imgedit-order-num">${idx + 1}</div>
        `;

        // ── Drag events ──
        item.addEventListener('dragstart', e => {
            dragSrcIdx = idx;
            item.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', key);
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
            const dropIdx = idx;
            if (dragSrcIdx === null || dragSrcIdx === dropIdx) return;

            // Reorder in actionOrder
            const srcKey = active[dragSrcIdx];
            const dstKey = active[dropIdx];
            const srcGlobal = actionOrder.indexOf(srcKey);
            const dstGlobal = actionOrder.indexOf(dstKey);
            actionOrder.splice(srcGlobal, 1);
            actionOrder.splice(dstGlobal, 0, srcKey);

            renderOrderList();
            updateSummary();
        });

        list.appendChild(item);
    });
}

// ═══ UI UPDATE ═══════════════════════════════════════════════════════════════
function updateUI() {
    const badge = $('ie-img-count');
    if (badge) badge.textContent = images.length ? `${images.length}` : '';

    const clearBtn = $('ie-clear-imgs');
    if (clearBtn) clearBtn.style.display = images.length ? 'inline-flex' : 'none';

    renderOrderList();
    updateSummary();
}

function updateSummary() {
    const trimOn = $('ie-trim-enabled')?.checked;
    const resizeOn = $('ie-resize-enabled')?.checked;
    const hasAction = trimOn || resizeOn;
    const canRun = images.length > 0 && hasAction && !busy;

    const btn = $('ie-btn-run');
    if (btn) btn.disabled = !canRun;

    const summary = $('ie-run-summary');
    if (summary) {
        if (!images.length || !hasAction) {
            summary.innerHTML = '<div class="imgedit-run-dim">Select images and at least one action</div>';
        } else {
            let html = `<div style="margin-bottom:0.3rem;color:var(--snap-text)">${images.length} image${images.length > 1 ? 's' : ''}</div>`;
            const active = actionOrder.filter(a => (a === 'trim' && trimOn) || (a === 'resize' && resizeOn));
            active.forEach((key, i) => {
                if (key === 'trim') {
                    const auto = $('ie-trim-auto')?.checked;
                    html += makeRunItem('crop', `${i + 1}. Trim (${auto ? 'auto-transparent' : 'manual'})`);
                } else if (key === 'resize') {
                    const mode = document.querySelector('input[name="ie-resize-mode"]:checked')?.value;
                    if (mode === 'scale') {
                        html += makeRunItem('resize', `${i + 1}. Resize to ${$('ie-resize-scale')?.value || 50}%`);
                    } else {
                        html += makeRunItem('resize', `${i + 1}. Resize to ${$('ie-resize-w')?.value || '?'}×${$('ie-resize-h')?.value || '?'}px`);
                    }
                }
            });
            summary.innerHTML = html;
        }
    }
}

function makeRunItem(icon, text) {
    const icons = {
        crop: `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="14" height="14"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 2v4M6 18v4M2 6h4m12 0h4M18 2v4m0 12v4M2 18h4m12 0h4M8 8h8v8H8z"/></svg>`,
        resize: `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="14" height="14"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5"/></svg>`,
    };
    return `<div class="imgedit-run-item">${icons[icon] || ''}<span>${text}</span></div>`;
}

// ═══ RUN (PROCESS) ═══════════════════════════════════════════════════════════
async function onRun() {
    if (busy || !images.length) return;
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

    const trimOn = $('ie-trim-enabled')?.checked;
    const resizeOn = $('ie-resize-enabled')?.checked;

    // Build ordered pipeline from user-defined order
    const pipeline = actionOrder.filter(a => (a === 'trim' && trimOn) || (a === 'resize' && resizeOn));
    log(`Pipeline: ${pipeline.join(' → ')}`, 'dim');

    // Gather settings
    const trimAuto = $('ie-trim-auto')?.checked;
    const trimTop = parseInt($('ie-trim-top')?.value) || 0;
    const trimRight = parseInt($('ie-trim-right')?.value) || 0;
    const trimBottom = parseInt($('ie-trim-bottom')?.value) || 0;
    const trimLeft = parseInt($('ie-trim-left')?.value) || 0;

    const resizeMode = document.querySelector('input[name="ie-resize-mode"]:checked')?.value || 'scale';
    const resizeScale = parseFloat($('ie-resize-scale')?.value) / 100 || 0.5;
    const resizeW = parseInt($('ie-resize-w')?.value) || 256;
    const resizeH = parseInt($('ie-resize-h')?.value) || 256;
    const resizeLock = $('ie-resize-lock')?.checked;

    const results = [];
    const total = images.length;

    for (let i = 0; i < total; i++) {
        const entry = images[i];
        if (barEl) barEl.style.width = `${((i) / total) * 100}%`;
        if (pctEl) pctEl.textContent = `${Math.round((i / total) * 100)}%`;
        if (lblEl) lblEl.textContent = `Processing ${i + 1}/${total}…`;

        try {
            let canvas = imgToCanvas(entry.img);

            // Apply pipeline in user-defined order
            for (const action of pipeline) {
                if (action === 'trim') {
                    if (trimAuto) {
                        canvas = autoTrim(canvas);
                        log(`✓ Auto-trimmed "${entry.file.name}" → ${canvas.width}×${canvas.height}`, 'ok');
                    } else {
                        canvas = manualTrim(canvas, trimTop, trimRight, trimBottom, trimLeft);
                        log(`✓ Manual-trimmed "${entry.file.name}" → ${canvas.width}×${canvas.height}`, 'ok');
                    }
                } else if (action === 'resize') {
                    if (resizeMode === 'scale') {
                        const nw = Math.max(1, Math.round(canvas.width * resizeScale));
                        const nh = Math.max(1, Math.round(canvas.height * resizeScale));
                        canvas = resizeCanvas(canvas, nw, nh);
                    } else {
                        let fw = resizeW, fh = resizeH;
                        if (resizeLock) {
                            const ratio = canvas.width / canvas.height;
                            if (fw / fh > ratio) { fw = Math.round(fh * ratio); }
                            else { fh = Math.round(fw / ratio); }
                        }
                        canvas = resizeCanvas(canvas, Math.max(1, fw), Math.max(1, fh));
                    }
                    log(`✓ Resized "${entry.file.name}" → ${canvas.width}×${canvas.height}`, 'ok');
                }
            }

            const blob = await canvasToBlob(canvas, entry.file.type);
            results.push({ blob, name: entry.file.name });

        } catch (err) {
            log(`✗ Error processing "${entry.file.name}": ${err.message}`, 'err');
        }
    }

    if (barEl) barEl.style.width = '100%';
    if (pctEl) pctEl.textContent = '100%';
    if (lblEl) lblEl.textContent = 'Done!';

    // Download
    if (results.length === 1) {
        downloadBlob(results[0].blob, results[0].name);
        log(`⬇ Downloaded "${results[0].name}"`, 'ok');
    } else if (results.length > 1) {
        for (const r of results) {
            downloadBlob(r.blob, r.name);
        }
        log(`⬇ Downloaded ${results.length} images`, 'ok');
    } else {
        log('No images were processed successfully', 'warn');
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
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return c;
}

/**
 * Auto-trim: remove transparent borders.
 */
function autoTrim(canvas) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    const data = ctx.getImageData(0, 0, w, h).data;

    let top = h, left = w, bottom = 0, right = 0;

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const alpha = data[(y * w + x) * 4 + 3];
            if (alpha > 0) {
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

    const tw = right - left + 1;
    const th = bottom - top + 1;
    const trimmed = document.createElement('canvas');
    trimmed.width = tw;
    trimmed.height = th;
    trimmed.getContext('2d').drawImage(canvas, left, top, tw, th, 0, 0, tw, th);
    return trimmed;
}

/**
 * Manual trim: crop N pixels from each side.
 */
function manualTrim(canvas, top, right, bottom, left) {
    const nw = Math.max(1, canvas.width - left - right);
    const nh = Math.max(1, canvas.height - top - bottom);
    const c = document.createElement('canvas');
    c.width = nw;
    c.height = nh;
    c.getContext('2d').drawImage(canvas, left, top, nw, nh, 0, 0, nw, nh);
    return c;
}

/**
 * Resize canvas to given dimensions.
 */
function resizeCanvas(canvas, w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d').drawImage(canvas, 0, 0, w, h);
    return c;
}

function canvasToBlob(canvas, mimeType) {
    const mime = (mimeType === 'image/svg+xml') ? 'image/png' : (mimeType || 'image/png');
    return new Promise(resolve => {
        canvas.toBlob(blob => resolve(blob), mime);
    });
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
