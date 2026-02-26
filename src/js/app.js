/**
 * app.js — Shell: sidebar, routing, shared credentials
 */
import { login, getProjectList, state } from './snap-api.js?v=8';

console.log('[app] ✓ shell loaded');

// ═══ EVENT BUS ═══════════════════════════════════════════════════════════════
export const bus = {
    _h: {},
    on(e, fn)   { (this._h[e] ??= []).push(fn); },
    off(e, fn)  { this._h[e] = (this._h[e]||[]).filter(f=>f!==fn); },
    emit(e, d)  { (this._h[e]||[]).forEach(fn => fn(d)); },
};

// ═══ SHARED STATE ════════════════════════════════════════════════════════════
export const appState = {
    projects: [],
    projectCache: new Map(),
    currentPage: null,
};

// ═══ DOM ═════════════════════════════════════════════════════════════════════
const $ = id => document.getElementById(id);
const IS_LOCAL = ['localhost','127.0.0.1'].includes(location.hostname);

const inpUser     = $('inp-user');
const inpPass     = $('inp-pass');
const credStatus  = $('cred-status');
const credMsg     = $('cred-msg');
const pageTitle   = $('page-title');
const pageContent = $('page-content');

// ═══ ENV BADGE ═══════════════════════════════════════════════════════════════
if (!IS_LOCAL) $('env-badge')?.classList.add('prod');
if ($('env-badge')) $('env-badge').textContent = IS_LOCAL ? 'local' : 'github pages';

// ═══ SIDEBAR TOGGLE ══════════════════════════════════════════════════════════
if (localStorage.getItem('sidebar-collapsed') === 'true')
    document.body.classList.add('sidebar-collapsed');

$('sidebar-toggle').addEventListener('click', () => {
    document.body.classList.toggle('sidebar-collapsed');
    localStorage.setItem('sidebar-collapsed',
        document.body.classList.contains('sidebar-collapsed'));
});

// ═══ PAGE ROUTING ════════════════════════════════════════════════════════════
const PAGE_TITLES = { overview: 'Overview', uploader: 'Uploader' };
let uploaderInitFn = null;

async function navigateTo(page) {
    if (appState.currentPage === page) return;
    appState.currentPage = page;

    // Sidebar highlight
    document.querySelectorAll('.sidebar-link').forEach(btn =>
        btn.classList.toggle('active', btn.dataset.page === page));
    pageTitle.textContent = PAGE_TITLES[page] || page;

    // Load HTML
    try {
        const res = await fetch(`./src/html/${page}.html`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        pageContent.innerHTML = await res.text();
    } catch (e) {
        pageContent.innerHTML = `<div class="empty-page">
            <p class="empty-sub" style="color:#f87171">Failed to load page: ${e.message}</p></div>`;
        return;
    }

    // Init page JS
    if (page === 'uploader') {
        if (!uploaderInitFn) {
            const mod = await import('./uploader-page.js');
            uploaderInitFn = mod.initUploader;
        }
        uploaderInitFn();
    }

    history.replaceState(null, '', `#${page}`);
}

document.querySelectorAll('.sidebar-link').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.page));
});

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

// ═══ CREDENTIALS ═════════════════════════════════════════════════════════════
let loginTimer = null;

function setCredStatus(type, msg) {
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
            const paths = {
                ok:   'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
                warn: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
                err:  'M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z',
            };
            const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
            svg.setAttribute('fill','none');
            svg.setAttribute('stroke','currentColor');
            svg.setAttribute('viewBox','0 0 24 24');
            svg.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${paths[type]||paths.warn}"/>`;
            credStatus.insertBefore(svg, credMsg);
        }
    }
}

function onCredInput() {
    const user = inpUser.value.trim(), pass = inpPass.value;
    clearTimeout(loginTimer);
    if (!user && !pass) { setCredStatus('warn','Fill in username and password to connect'); return; }
    if (!user || !pass)  { setCredStatus('warn', !user ? 'Enter your username' : 'Enter your password'); return; }
    setCredStatus('loading','Connecting…');
    loginTimer = setTimeout(() => doLogin(user, pass), 900);
}

async function doLogin(user, pass) {
    setCredStatus('loading','Connecting…');
    try {
        const loggedAs = await login(user, pass);
        setCredStatus('ok', `Connected as ${loggedAs}`);
        $('session-pill').classList.add('active');
        $('session-user').textContent = loggedAs;
        await loadProjects();
        bus.emit('login', loggedAs);
    } catch (e) {
        setCredStatus('err', e.message.includes('login') ? 'Invalid credentials' : e.message);
        bus.emit('login-error', e.message);
    }
}

export async function loadProjects() {
    try {
        appState.projects = await getProjectList();
        if (!Array.isArray(appState.projects)) appState.projects = [];
        appState.projectCache = new Map();
        bus.emit('projects-loaded', appState.projects);
    } catch (e) {
        console.error('[app] loadProjects error:', e);
        bus.emit('projects-error', e.message);
    }
}

inpUser.addEventListener('input', onCredInput);
inpPass.addEventListener('input', onCredInput);

$('btn-refresh').addEventListener('click', async () => {
    const user = inpUser.value.trim(), pass = inpPass.value;
    if (!user || !pass) { setCredStatus('warn','Enter credentials first'); return; }
    clearTimeout(loginTimer);
    await doLogin(user, pass);
});

// ═══ INIT ════════════════════════════════════════════════════════════════════
setCredStatus('warn','Fill in username and password to connect');
const startPage = (location.hash.replace('#','') || 'overview');
navigateTo(['overview','uploader'].includes(startPage) ? startPage : 'overview');
