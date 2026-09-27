'use strict';

/* ============================================================
   Pale Diamond — Agent page engine
   chat · streaming · models · image generation · uploads
   file outputs (pptx/xlsx/docx/svg/json) · weather · music
   ============================================================ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const store = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
};

/* ---------- toast ---------- */
const toast = $('.toast');
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(showToast.t);
  showToast.t = setTimeout(() => toast.classList.remove('show'), 3200);
}

/* ---------- backend API helper ---------- */
function apiBase() {
  const cfg = (window.PD_CONFIG && window.PD_CONFIG.apiBase) || '';
  const saved = store.get('pd_api_base', '');
  return (saved || cfg || '').replace(/\/+$/, '');
}
function apiUrl(path) { return `${apiBase()}/api/${path}`; }
async function apiFetch(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const token = store.get('pd_auth_token', null);
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(apiUrl(path), { ...options, headers });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}
function backendConfigured() { return !!apiBase() || !location.origin.includes('github.io'); }

/* ---------- account (shared with the main site) ---------- */
function accounts() { return store.get('pd_accounts', {}); }
function saveAccounts(a) { store.set('pd_accounts', a); }
function currentEmail() { return store.get('pd_session', null); }
function currentUser() { const e = currentEmail(); return e ? accounts()[e] : null; }
function refreshAccountUI() {
  const user = currentUser();
  $('#ag-account-name').textContent = user ? user.email.split('@')[0] : 'Guest';
  $('#ag-account-avatar').textContent = user ? user.email[0].toUpperCase() : 'G';
  $('#ag-account-stats').textContent = user
    ? `${user.tier} plan · member since ${new Date(user.created).toLocaleDateString()} · ${user.credits} credits used`
    : 'Not signed in — you are browsing as a guest.';
  updateAgentLock();
}

/* ============================================================
   SIGN-IN GATE — the agent only works when signed in
   ============================================================ */
function updateAgentLock() {
  const locked = !currentUser();
  const lock = $('#ag-lock');
  if (lock) lock.hidden = !locked;
  const copy = $('#ag-welcome-copy'); if (copy) copy.hidden = locked;
  const chips = $('#ag-chips'); if (chips) chips.style.display = locked ? 'none' : '';
  const input = $('#ag-input'); if (input) input.disabled = locked;
  const send = $('.ag-send'); if (send) send.disabled = locked;
  $('#ag-plus')?.setAttribute('disabled', locked ? '' : '');
  if (locked) $('#ag-welcome').hidden = false;
}
$('#ag-lock-signin')?.addEventListener('click', () => openAuth('signup'));

/* ---------- auth modal (register / sign in, server first) ---------- */
let authMode = 'signup';
function setAuthMode(mode) {
  authMode = mode;
  const signin = mode === 'signin';
  $('#ag-modal-mode-label').textContent = signin ? 'SIGN IN' : 'WELCOME';
  $('#ag-modal-title').innerHTML = signin ? 'Welcome<br /><em>back.</em>' : 'Make room for<br /><em>better work.</em>';
  $('#ag-modal-subtitle').textContent = signin ? 'Pick up where you left off.' : 'Create your private facet in a few seconds.';
  $('#ag-auth-submit').innerHTML = signin ? 'Enter facet <span>↗</span>' : 'Create facet <span>↗</span>';
  $('#ag-modal-switch-copy').textContent = signin ? 'New to Pale Diamond?' : 'Already have an account?';
  $('#ag-modal-switch-button').textContent = signin ? 'Create an account' : 'Sign in';
}
function openAuth(mode = 'signup') {
  setAuthMode(mode);
  openModal('#ag-auth-modal');
  setTimeout(() => $('#ag-auth-form')?.querySelector('input')?.focus(), 100);
}
$('#ag-modal-switch-button')?.addEventListener('click', () => openAuth(authMode === 'signup' ? 'signin' : 'signup'));

$('#ag-auth-form')?.addEventListener('submit', async e => {
  e.preventDefault();
  const data = new FormData(e.target);
  const email = String(data.get('email')).trim().toLowerCase();
  const password = String(data.get('password'));
  e.target.reset();

  if (authMode === 'signup') {
    try {
      const res = await apiFetch('auth/register', { method: 'POST', body: JSON.stringify({ email, password }) });
      saveServerAccount(email, password, res.token, res.user);
      store.set('pd_session', email);
      showToast('Your private facet is ready — the agent is awake.');
      closeModal($('#ag-auth-modal'));
      refreshAccountUI();
      return;
    } catch (err) {
      if (String(err.message).includes('409')) return showToast('That account already exists — try signing in.');
      // backend unreachable → local demo account
    }
    const acc = accounts();
    if (acc[email]) return showToast('That account already exists — try signing in.');
    acc[email] = { email, password, created: new Date().toISOString(), tier: 'Free', credits: 0, apiKey: 'pdk_' + Math.random().toString(36).slice(2, 10).toUpperCase() };
    saveAccounts(acc);
    store.set('pd_session', email);
    showToast('Your private facet is ready (offline mode).');
    closeModal($('#ag-auth-modal'));
    refreshAccountUI();
  } else {
    try {
      const res = await apiFetch('auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      saveServerAccount(email, password, res.token, res.user);
      store.set('pd_session', email);
      showToast(`Welcome back, ${email.split('@')[0]}. The agent is awake.`);
      closeModal($('#ag-auth-modal'));
      refreshAccountUI();
      return;
    } catch (err) {
      if (String(err.message).includes('401')) {
        // Not on the server yet — migrate an offline account if credentials match locally.
        const acc = accounts();
        if (acc[email] && acc[email].password === password) {
          try {
            const res = await apiFetch('auth/register', { method: 'POST', body: JSON.stringify({ email, password }) });
            saveServerAccount(email, password, res.token, res.user);
            store.set('pd_session', email);
            showToast('Account migrated to the database. Welcome back.');
            closeModal($('#ag-auth-modal'));
            refreshAccountUI();
            return;
          } catch (err2) {
            if (String(err2.message).includes('409')) return showToast('Email or password not recognized.');
          }
        }
        return showToast('Email or password not recognized.');
      }
      // backend unreachable → local login
    }
    const acc = accounts();
    if (!acc[email] || acc[email].password !== password) return showToast('Email or password not recognized.');
    store.set('pd_session', email);
    showToast(`Welcome back, ${email.split('@')[0]}. (Offline mode)`);
    closeModal($('#ag-auth-modal'));
    refreshAccountUI();
  }
});

function saveServerAccount(email, password, token, u) {
  store.set('pd_auth_token', token);
  const acc = accounts();
  acc[email] = {
    ...(acc[email] || { apiKey: 'pdk_' + Math.random().toString(36).slice(2, 10).toUpperCase(), models: ['Nano Banana Pro', 'Seedance 2.5'] }),
    email,
    password,
    created: u.createdAt || acc[email]?.created || new Date().toISOString(),
    tier: u.plan || 'Free',
    credits: u.credits ?? 0,
    subscribedAt: u.subscribedAt || acc[email]?.subscribedAt || null,
    nextDue: u.nextDue || acc[email]?.nextDue || null,
  };
  saveAccounts(acc);
}
$('#ag-account')?.addEventListener('click', e => { e.stopPropagation(); toggleProfileMenu(e.currentTarget); });

/* ---------- profile dropdown (same four options as the site) ---------- */
const profileMenu = $('#profile-menu');
function closeProfileMenu() { if (profileMenu) profileMenu.hidden = true; }
function toggleProfileMenu(anchorBtn) {
  if (!profileMenu) return;
  if (!profileMenu.hidden) { closeProfileMenu(); return; }
  const r = anchorBtn.getBoundingClientRect();
  profileMenu.style.top = `${Math.max(12, r.top - 10 - 180)}px`;
  profileMenu.style.right = `${Math.max(12, window.innerWidth - r.right)}px`;
  profileMenu.style.left = 'auto';
  profileMenu.hidden = false;
}
document.addEventListener('click', e => {
  if (!profileMenu || profileMenu.hidden) return;
  if (e.target.closest('#profile-menu') || e.target.closest('#ag-account')) return;
  closeProfileMenu();
});
$$('[data-menu-action]').forEach(b => b.addEventListener('click', () => {
  const action = b.dataset.menuAction;
  closeProfileMenu();
  if (action === 'info') openAccountModal();
  else if (action === 'settings') switchView('settings');
  else if (action === 'switch') openSwitchScreen();
  else if (action === 'signout') doSignOut();
}));

function fmtDate(iso) { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
function ageString(iso) {
  const days = Math.max(0, Math.floor((Date.now() - new Date(iso)) / 864e5));
  if (days < 1) return 'New today';
  if (days < 30) return `${days} day${days > 1 ? 's' : ''}`;
  if (days < 365) return `${Math.floor(days / 30)} month${days >= 60 ? 's' : ''}`;
  return `${(days / 365).toFixed(1)} years`;
}
function dueInDays(iso) {
  const d = Math.ceil((new Date(iso) - Date.now()) / 864e5);
  if (d <= 0) return 'today';
  if (d === 1) return 'tomorrow';
  return `in ${d} days`;
}
function openModal(id) { const m = $(id); m.classList.add('open'); m.setAttribute('aria-hidden', 'false'); }
function closeModal(m) { m.classList.remove('open'); m.setAttribute('aria-hidden', 'true'); }
$$('[data-close-modal]').forEach(b => b.addEventListener('click', () => closeModal(b.closest('.modal-backdrop'))));
$$('.modal-backdrop').forEach(bd => bd.addEventListener('click', e => { if (e.target === bd) closeModal(bd); }));
document.addEventListener('keydown', e => { if (e.key === 'Escape') $$('.modal-backdrop.open').forEach(closeModal); });
function openAccountModal() {
  const user = currentUser();
  if (!user) { switchView('settings'); return; }
  $('#agp-avatar').textContent = user.email[0].toUpperCase();
  $('#agp-name').textContent = user.email.split('@')[0];
  $('#agp-email').textContent = user.email;
  $('#agp-tier').textContent = user.tier;
  $('#agp-created').textContent = fmtDate(user.created);
  $('#agp-age').textContent = ageString(user.created);
  $('#agp-credits').textContent = user.credits;
  $('#agp-sub-since').textContent = user.subscribedAt ? fmtDate(user.subscribedAt) : 'not yet';
  $('#agp-sub-next').textContent = user.nextDue
    ? `${fmtDate(user.nextDue)} (${dueInDays(user.nextDue)})`
    : (user.tier !== 'Free' ? '—' : 'free plan');
  openModal('#ag-account-modal');
}
function openSwitchScreen() {
  const user = currentUser();
  if (!user) { switchView('settings'); showToast('Sign in first — create your facet on the main site.'); return; }
  const list = $('#ag-switch-list');
  const others = Object.values(accounts()).filter(a => a.email !== user.email);
  list.innerHTML = others.length
    ? others.map(a => `
      <div class="switch-row" data-switch-to="${escapeHtml(a.email)}">
        <span class="switch-avatar">${a.email[0].toUpperCase()}</span>
        <div><strong>${escapeHtml(a.email)}</strong><span>${fmtDate(a.created)} · ${a.tier || 'Free'}</span></div>
        <span class="switch-go">›</span>
      </div>`).join('')
    : '<p class="ag-empty">No other accounts on this device. Create one from the main site.</p>';
  openModal('#ag-switch-modal');
  $$('#ag-switch-list [data-switch-to]').forEach(row => row.addEventListener('click', () => {
    const email = row.dataset.switchTo;
    store.set('pd_session', email);
    store.set('pd_auth_token', null);   // server session belongs to the previous account
    closeModal($('#ag-switch-modal'));
    refreshAccountUI();
    showToast(`Switched to ${email.split('@')[0]}.`);
  }));
}
function doSignOut() {
  if (store.get('pd_auth_token', null)) {
    apiFetch('auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${store.get('pd_auth_token', '')}` } }).catch(() => {});
    store.set('pd_auth_token', null);
  }
  store.set('pd_session', null);
  closeProfileMenu();
  $$('.modal-backdrop.open').forEach(closeModal);
  refreshAccountUI();
  showToast('Signed out.');
}

/* Boot: refresh the signed-in user from the server database. */
(async function refreshServerUser() {
  const token = store.get('pd_auth_token', null);
  const email = currentEmail();
  if (!token || !email || !backendConfigured()) return;
  try {
    const u = await apiFetch('auth/me', { headers: { Authorization: `Bearer ${token}` } });
    const acc = accounts();
    acc[email] = {
      ...(acc[email] || { email, apiKey: 'pdk_' + Math.random().toString(36).slice(2, 10).toUpperCase() }),
      email,
      tier: u.plan || acc[email]?.tier || 'Free',
      credits: u.credits ?? acc[email]?.credits ?? 0,
      subscribedAt: u.subscribedAt || acc[email]?.subscribedAt || null,
      nextDue: u.nextDue || acc[email]?.nextDue || null,
    };
    saveAccounts(acc);
    refreshAccountUI();
  } catch (err) { /* offline or expired token — local state stands */ }
})();

/* ---------- theme ---------- */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.body.setAttribute('data-theme', theme);
  store.set('pd_theme', theme);
}
applyTheme(store.get('pd_theme', 'dark'));

/* ============================================================
   VIEW SWITCHING
   ============================================================ */
function switchView(name) {
  $$('.ag-nav-item').forEach(x => x.classList.toggle('active', x.dataset.view === name));
  $$('.ag-view').forEach(v => v.classList.toggle('active', v.dataset.view === name));
  if (name === 'conversations') renderConvos();
  if (name === 'analytics') renderAnalytics();
  if (name === 'models') renderModelsView();
  if (name === 'packages') renderPackages();
  if (name === 'settings') refreshAccountUI();
  if (name === 'chat') setTimeout(() => $('#ag-input')?.focus(), 60);
}
$$('.ag-nav-item').forEach(b => b.addEventListener('click', () => {
  if (b.dataset.view === 'chat') resetChat();
  switchView(b.dataset.view);
}));

/* ============================================================
   MODELS — from the OpenRouter routers, grouped by provider
   ============================================================ */
let MODEL_DATA = null;        // [{provider, models:[{id,name,image,video,free,ctx,pricing}]}]
let SELECTED_MODEL = store.get('pd_model', '');

async function loadModels(force) {
  if (MODEL_DATA && !force) return MODEL_DATA;
  try {
    const data = await apiFetch('models');
    MODEL_DATA = data.groups;
  } catch (err) {
    MODEL_DATA = demoModelGroups();
  }
  // Default stays "Auto (recommended)" — the backend picks a solid text model.
  // Image requests discover an image-capable model on their own.
  updateModelButton();
  renderModelsView();
  return MODEL_DATA;
}
function demoModelGroups() {
  return [
    { provider: 'pale-diamond (demo router)', models: [
      { id: 'nano-banana-pro', name: 'Nano Banana Pro', image: true, video: false, free: false, ctx: '—', pricing: 'demo' },
      { id: 'seedance-2.5', name: 'Seedance 2.5', image: false, video: true, free: false, ctx: '—', pricing: 'demo' },
      { id: 'pale-core', name: 'Pale Core (open-weight)', image: false, video: false, free: true, ctx: '128K', pricing: 'demo' },
    ]},
  ];
}
function allModels() { return (MODEL_DATA || []).flatMap(g => g.models); }
function firstImageModel() {
  return allModels().find(m => m.image) ||
    { id: 'google/gemini-2.5-flash-image-preview', name: 'Gemini Image (default)' };
}
function selectedSupportsImage() {
  const m = allModels().find(m => m.id === SELECTED_MODEL);
  return !m || m.image;      // unknown models are assumed text; image flow re-routes itself
}
function updateModelButton() {
  const btn = $('#ag-model');
  if (!btn) return;
  const m = allModels().find(m => m.id === SELECTED_MODEL);
  btn.textContent = SELECTED_MODEL ? (m ? m.name : SELECTED_MODEL) : 'Auto (recommended)';
}
$('#ag-model')?.addEventListener('click', () => switchView('models'));

function modelMatchesFilter(name, q) {
  return !q || name.toLowerCase().includes(q);
}
function renderModelsView() {
  const root = $('#ag-models-list');
  if (!root) return;
  const q = ($('#ag-model-search')?.value || '').toLowerCase();
  const groups = MODEL_DATA || [];
  if (!groups.length) { root.innerHTML = '<p class="ag-empty">No models available.</p>'; return; }
  root.innerHTML = groups.map(g => {
    const models = g.models.filter(m => modelMatchesFilter(`${m.id} ${m.name}`, q));
    if (!models.length) return '';
    return `<div class="ag-provider open" data-provider="${g.provider}">
      <div class="ag-provider-head"><i>▸</i><strong>${escapeHtml(g.provider)}</strong><span>${models.length} models</span></div>
      <div class="ag-provider-body">${models.map(m => `
        <div class="ag-model-row-item">
          <span class="ag-model-name">${escapeHtml(m.name)}</span>
          <span class="ag-model-tags">${m.image ? '<span class="ag-tag image">IMAGE</span>' : ''}${m.video ? '<span class="ag-tag">VIDEO</span>' : ''}${m.free ? '<span class="ag-tag free">FREE</span>' : ''}</span>
          <span class="ag-model-meta"><span>${m.ctx || ''}</span><button class="ag-ghost-button" data-select-model="${escapeHtml(m.id)}">${m.id === SELECTED_MODEL ? 'Selected' : 'Select'}</button></span>
        </div>`).join('')}</div>
    </div>`;
  }).join('') || '<p class="ag-empty">Nothing matches that search.</p>';
  $$('#ag-models-list .ag-provider-head').forEach(h => h.addEventListener('click', () => h.parentElement.classList.toggle('open')));
  $$('#ag-models-list [data-select-model]').forEach(b => b.addEventListener('click', () => {
    SELECTED_MODEL = b.dataset.selectModel;
    store.set('pd_model', SELECTED_MODEL);
    updateModelButton();
    renderModelsView();
    showToast(`Model set to ${SELECTED_MODEL}.`);
  }));
}
$('#ag-model-search')?.addEventListener('input', renderModelsView);

/* ============================================================
   CHAT — messages, streaming, attachments, intents
   ============================================================ */
const messagesEl = $('#ag-messages');
let HISTORY = [];             // [{role, content}] for the API
let CONVO_ID = null;

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmtBytes(n) { return n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`; }

function resetChat() {
  HISTORY = [];
  CONVO_ID = null;
  attachments.length = 0;
  renderAttachments();
  messagesEl.innerHTML = '';
  $('#ag-welcome').hidden = false;
}

function addMsg(role, text, opts = {}) {
  $('#ag-welcome').hidden = true;
  const el = document.createElement('div');
  el.className = `ag-msg ${role}${opts.demo ? ' demo' : ''}`;
  el.textContent = text;
  if (opts.chips) {
    const files = document.createElement('div');
    files.className = 'ag-msg-files';
    opts.chips.forEach(c => files.insertAdjacentHTML('beforeend', `<span class="ag-attachment-chip">${c.kind === 'image' ? `<img src="${c.dataUrl}" alt="">` : '▤'} ${escapeHtml(c.name)}</span>`));
    el.appendChild(files);
  }
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return el;
}

/* ---------- attachments: + button, drag-drop, paste ---------- */
const attachments = [];       // {name, kind:'image'|'text', dataUrl?, text?, size}
$('#ag-plus')?.addEventListener('click', () => $('#ag-file').click());
$('#ag-file')?.addEventListener('change', e => { addFiles([...e.target.files]); e.target.value = ''; });

function renderAttachments() {
  const strip = $('#ag-attachments');
  strip.hidden = attachments.length === 0;
  strip.innerHTML = attachments.map((a, i) => `
    <span class="ag-attachment">${a.kind === 'image' ? `<img src="${a.dataUrl}" alt="">` : '▤'}<span>${escapeHtml(a.name)}</span><button type="button" data-rm-att="${i}" aria-label="Remove">×</button></span>`).join('');
  $$('#ag-attachments [data-rm-att]').forEach(b => b.addEventListener('click', () => { attachments.splice(Number(b.dataset.rmAtt), 1); renderAttachments(); }));
}

async function addFiles(files) {
  if (!files.length) return;
  if (!currentUser()) { openAuth('signup'); showToast('Sign in to upload files.'); return; }
  for (const f of files) {
    try {
      if (f.type.startsWith('image/')) {
        if (f.size > 8 * 1024 * 1024) { showToast(`${f.name} is larger than 8 MB — skipped.`); continue; }
        attachments.push({ name: f.name, kind: 'image', dataUrl: await readAsDataURL(f), size: f.size });
      } else if (f.name.endsWith('.docx')) {
        if (!window.mammoth) { showToast('Document reader still loading — try again in a moment.'); continue; }
        const buf = await f.arrayBuffer();
        const res = await mammoth.extractRawText({ arrayBuffer: buf });
        attachments.push({ name: f.name, kind: 'text', text: res.value.slice(0, 40000), size: f.size });
      } else if (/\.(txt|md|csv|json|log|ts|js|py|html|css)$/i.test(f.name) || f.type.startsWith('text/')) {
        attachments.push({ name: f.name, kind: 'text', text: (await f.text()).slice(0, 40000), size: f.size });
      } else {
        showToast(`${f.name}: unsupported type — images, text and .docx only.`);
      }
    } catch (err) { showToast(`Could not read ${f.name}.`); }
  }
  renderAttachments();
  if (files.length) showToast(`${files.length} file${files.length > 1 ? 's' : ''} attached.`);
}
function readAsDataURL(f) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); }); }

const chatArea = $('#ag-chat-area');
['dragenter', 'dragover'].forEach(ev => $('#ag-form')?.addEventListener(ev, e => { e.preventDefault(); chatArea.classList.add('ag-drop-over'); }));
['dragleave', 'drop'].forEach(ev => $('#ag-form')?.addEventListener(ev, e => { e.preventDefault(); if (ev === 'drop' || e.target === chatArea) chatArea.classList.remove('ag-drop-over'); }));
$('#ag-form')?.addEventListener('drop', e => { e.preventDefault(); chatArea.classList.remove('ag-drop-over'); addFiles([...e.dataTransfer.files]); });
document.addEventListener('paste', e => {
  if (!$('.ag-view[data-view="chat"]').classList.contains('active')) return;
  const items = [...(e.clipboardData?.files || [])];
  const text = e.clipboardData?.getData('text');
  if (items.length) { addFiles(items); e.preventDefault(); }
  else if (text && document.activeElement === $('#ag-input')) { /* normal paste into input */ }
});

/* ---------- quick chips + templates ---------- */
$$('[data-chip]').forEach(b => b.addEventListener('click', () => { $('#ag-input').value = b.dataset.chip; $('#ag-form').requestSubmit(); }));
const TEMPLATES = [
  { icon: '📑', name: 'Presentation', desc: 'Slide deck built to download as .pptx', prompt: 'Make a presentation titled "Pale Diamond Q4 Launch" with 5 slides: vision, product, pricing, roadmap, call to action.' },
  { icon: '📊', name: 'Spreadsheet', desc: 'Workbook built to download as .xlsx', prompt: 'Make a spreadsheet tracking a project budget: columns Task, Owner, Cost, Status with 8 realistic rows.' },
  { icon: '📄', name: 'Document', desc: 'Report built to download as .docx', prompt: 'Write a one-page product brief for Pale Diamond as a document.' },
  { icon: '◈', name: 'Diagram', desc: 'Architecture sketch built to download as .svg', prompt: 'Draw a diagram of the Pale Diamond request flow: user → backend → OpenRouter → model → response.' },
  { icon: '🗄', name: 'Datasheet', desc: 'Structured data built to download as .json', prompt: 'Make a datasheet for the Pale Diamond plans with fields, prices and quotas.' },
  { icon: '✦', name: 'Image', desc: 'Generated with your image model', prompt: 'Make an image of a pale blue crystal city under aurora light.' },
  { icon: '☀', name: 'Weather', desc: 'Live forecast, any city', prompt: "What's the weather forecast for Tokyo?" },
  { icon: '🌐', name: 'Web research', desc: 'Reads a live page you link', prompt: 'Read https://openrouter.ai/docs and summarize it in three bullets.' },
];
(function renderTemplates() {
  const root = $('#ag-templates');
  if (!root) return;
  root.innerHTML = TEMPLATES.map((t, i) => `<button class="ag-tpl" data-tpl="${i}"><i>${t.icon}</i><strong>${t.name}</strong><span>${t.desc}</span></button>`).join('');
  $$('#ag-templates [data-tpl]').forEach(b => b.addEventListener('click', () => {
    const t = TEMPLATES[Number(b.dataset.tpl)];
    switchView('chat');
    $('#ag-input').value = t.prompt;
    $('#ag-form').requestSubmit();
  }));
})();

/* ---------- intents ---------- */
const IMAGE_INTENT = /\b(make|draw|generate|create|render|design)\b[^.?!]*\b(image|picture|photo|artwork|illustration|logo|wallpaper|portrait|render|drawing)\b/i;
const WEATHER_INTENT = /\b(weather|forecast|temperature|how (?:hot|cold|rainy|sunny)|rain|snow|umbrella|humidity)\b/i;
function outputIntent(text) {
  if (/\bpresentation|slides\b|slide deck|powerpoint|\.pptx\b/i.test(text)) return 'pptx';
  if (/\bspreadsheet|excel\b|\.xlsx\b/i.test(text)) return 'xlsx';
  if (/\bdiagram|flowchart|wireframe|chart drawing\b/i.test(text)) return 'svg';
  if (/\bdatasheet|data sheet|\.json\b/i.test(text)) return 'json';
  if (/\bdocument|report\b|memo|word doc|publication|essay|article|\.docx\b/i.test(text)) return 'docx';
  return null;
}

/* ---------- send pipeline ---------- */
$('#ag-form')?.addEventListener('submit', async e => {
  e.preventDefault();
  if (!currentUser()) { openAuth('signup'); showToast('Sign in to use the agent.'); return; }
  const input = $('#ag-input');
  const text = input.value.trim();
  if (!text || sendBusy) return;
  input.value = '';
  const chips = attachments.map(a => ({ name: a.name, kind: a.kind, dataUrl: a.dataUrl }));
  addMsg('user', text, { chips });
  HISTORY.push({ role: 'user', content: buildUserContent(text) });
  attachments.splice(0);
  renderAttachments();
  bumpStat('messages');

  const weather = WEATHER_INTENT.test(text);
  const image = IMAGE_INTENT.test(text);
  const fileKind = outputIntent(text);
  if (weather) await weatherFlow(text);
  else if (image) await imageFlow(text);
  else if (fileKind) await fileFlow(text, fileKind);
  else await chatFlow(text);
});

/* Attachments become multimodal content parts; text files become context blocks. */
function buildUserContent(text) {
  const parts = [];
  const textFiles = attachments.filter(a => a.kind === 'text');
  const images = attachments.filter(a => a.kind === 'image');
  let body = text;
  if (textFiles.length) {
    body = textFiles.map(f => `--- FILE: ${f.name} ---\n${f.text}\n--- END FILE ---`).join('\n\n') + '\n\n' + text;
  }
  parts.push({ type: 'text', text: body });
  images.forEach(a => parts.push({ type: 'image_url', image_url: { url: a.dataUrl } }));
  return parts.length === 1 ? text : parts;
}

/* ---------- core chat (streams through the backend) ---------- */
const SYSTEM_PROMPT = "You are Pale Diamond, a web-hosted AI agent for tasks, automation, research, and image & video creation. You are precise, warm, and concise. When the user asks you to create something, you do it — files, images, plans, analyses. Format answers in clean markdown-free plain text with short paragraphs; use '•' bullets where lists help.";

let sendBusy = false;
async function chatFlow(userText) {
  sendBusy = true;
  const el = addMsg('ai', '', {});
  el.classList.add('streaming');
  let acc = '';
  const paint = () => { el.textContent = acc; messagesEl.scrollTop = messagesEl.scrollHeight; };
  try {
    if (!backendConfigured()) throw new Error('demo');
    await streamChat({
      model: SELECTED_MODEL || undefined,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...HISTORY.slice(-24)],
    }, d => { acc += d; paint(); });
    if (!acc.trim()) throw new Error('empty');
  } catch (err) {
    await new Promise(r => setTimeout(r, 600 + Math.random() * 500));
    acc = agentReply(userText);
    paint();
    el.classList.add('demo');
  }
  el.classList.remove('streaming');
  finalize('assistant', acc);
  sendBusy = false;
  $('#ag-input')?.focus();
}

async function streamChat(payload, onDelta) {
  const headers = { 'Content-Type': 'application/json' };
  const token = store.get('pd_auth_token', null);
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(apiUrl('chat'), {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...payload, stream: true }),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      const s = line.trim();
      if (!s || s.startsWith(':')) continue;
      if (!s.startsWith('data:')) continue;
      const data = s.slice(5).trim();
      if (data === '[DONE]') return;
      try {
        const j = JSON.parse(data);
        if (j.error) throw new Error(j.error.message || 'stream error');
        const delta = j.choices?.[0]?.delta?.content;
        if (delta) onDelta(delta);
      } catch (e) { if (String(e.message).startsWith('API') || e.message === 'stream error') throw e; }
    }
  }
}

function finalize(role, content) {
  HISTORY.push({ role, content });
  saveConvo();
}

/* ---------- demo responder (used when the backend is offline) ---------- */
function agentReply(input) {
  const t = input.toLowerCase().trim();
  const has = (...w) => w.some(x => t.includes(x));
  if (has('hi', 'hello', 'hey')) return "Hello — I'm Pale Diamond. Connect the Vercel backend (Settings → Backend) to give me real intelligence, or keep exploring the interface.";
  if (has('weather', 'forecast')) return "I can answer from live weather once the backend is connected — or ask me again after you add your Vercel API URL in Settings. Data source: Open-Meteo.";
  if (has('image', 'picture', 'photo', 'draw')) return "With an image-capable model selected I generate real images through OpenRouter. In demo mode I'll sketch a placeholder so you can see the flow — connect the backend for the real thing.";
  return `Got it — "${input.trim()}". In demo mode I can't reason deeply, but the full agent can once the backend is connected. The interface, files, images, weather and music around me are all live.`;
}

/* ============================================================
   IMAGE GENERATION — aura glow while generating, lightbox, download
   ============================================================ */
async function imageFlow(prompt) {
  const aura = document.createElement('div');
  aura.className = 'ag-aura';
  aura.innerHTML = `<div class="aura-gem"><img src="pale-diamond-gem.png" alt=""></div><span>GENERATING IMAGE…</span>`;
  $('#ag-welcome').hidden = true;
  messagesEl.appendChild(aura);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  let result = null, demo = false;
  try {
    if (!backendConfigured()) throw new Error('demo');
    result = await apiFetch('image', { method: 'POST', body: JSON.stringify({ prompt, model: SELECTED_MODEL || undefined }) });
    if (!result.images?.length) throw new Error('no image');
  } catch (err) {
    demo = true;
    result = { images: [demoImage(prompt)], text: 'Demo image — connect the backend for real generation.' };
  }
  aura.remove();
  const el = addMsg('ai', result.text || '');
  result.images.forEach(src => {
    const fig = document.createElement('figure');
    fig.className = 'ag-image-card';
    fig.innerHTML = `<img src="${src}" alt="Generated image"><figcaption><span>${demo ? 'DEMO RENDER' : escapeHtml(SELECTED_MODEL || 'image model')}</span><a data-dl="${encodeURIComponent(src)}" download="pale-diamond-image.png">⬇ save</a></figcaption>`;
    fig.querySelector('img').addEventListener('click', () => openLightbox(src));
    fig.querySelector('[data-dl]').addEventListener('click', e => { e.preventDefault(); downloadDataUrl(src); });
    el.appendChild(fig);
  });
  bumpStat('images');
  finalize('assistant', `[generated image: ${prompt}]`);
}

function demoImage(prompt) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0a1020"/><stop offset="1" stop-color="#1c2c55"/></linearGradient></defs>
  <rect width="640" height="480" fill="url(#g)"/>
  <g transform="translate(320,210) rotate(45)"><rect x="-90" y="-90" width="180" height="180" rx="14" fill="none" stroke="#bcd2ff" stroke-width="3"/><rect x="-60" y="-60" width="120" height="120" rx="10" fill="rgba(188,210,255,.25)" stroke="#eaf1ff" stroke-width="1.5"/></g>
  <text x="320" y="390" fill="#cfe0ff" font-family="monospace" font-size="15" text-anchor="middle">DEMO RENDER — PALE DIAMOND</text>
  <text x="320" y="415" fill="#7f8bab" font-family="monospace" font-size="11" text-anchor="middle">${escapeHtml(prompt.slice(0, 64))}</text>
</svg>`;
  return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
}
function downloadDataUrl(src, name = 'pale-diamond-image.png') {
  const a = document.createElement('a');
  a.href = src; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
}

/* ---------- lightbox ---------- */
function openLightbox(src) {
  $('#ag-lightbox').hidden = false;
  $('#ag-lb-img').src = src;
  $('#ag-lb-download').href = src;
}
$('#ag-lb-close')?.addEventListener('click', () => { $('#ag-lightbox').hidden = true; });
$('#ag-lightbox')?.addEventListener('click', e => { if (e.target === $('#ag-lightbox')) $('#ag-lightbox').hidden = true; });
document.addEventListener('keydown', e => { if (e.key === 'Escape') $('#ag-lightbox').hidden = true; });

/* ============================================================
   LIVE WEATHER — Open-Meteo (free, no key)
   ============================================================ */
async function weatherFlow(text) {
  const loc = extractLocation(text);
  if (!loc) {
    const reply = 'Which city would you like the forecast for? Just say "weather in Paris" or "forecast for Tokyo".';
    addMsg('ai', reply);
    finalize('assistant', reply);
    return;
  }
  const el = addMsg('ai', `Reading the live sky over ${loc.name}…`);
  let data;
  try {
    const coords = await geocode(loc.name);
    data = await fetchWeather(coords.latitude, coords.longitude);
  } catch (err) {
    el.textContent = `I couldn't find live weather for "${loc.name}". Check the spelling, or try a larger nearby city.`;
    finalize('assistant', el.textContent);
    return;
  }
  const summary = weatherSummary(loc.name, data);
  let reply = null;
  try {
    if (backendConfigured()) {
      const res = await apiFetch('chat', {
        method: 'POST',
        body: JSON.stringify({
          model: SELECTED_MODEL || undefined,
          stream: false,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT + ' You answer weather questions naturally, like a polished concierge.' },
            ...HISTORY.slice(-12),
            { role: 'user', content: `The user asked: "${text}"\n\nLive weather data for ${loc.name}:\n${summary}\n\nAnswer with a natural, useful forecast.` },
          ],
        }),
      });
      reply = res.reply;
    }
  } catch (err) { /* fall through to local formatting */ }
  if (!reply) { reply = localWeatherReply(loc.name, data); el.classList.add('demo'); }
  el.textContent = reply;
  bumpStat('weather');
  finalize('assistant', reply);
}
function extractLocation(text) {
  const m = text.match(/\b(?:in|for|at)\s+([A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F\s,'.-]{1,40})/i);
  if (!m) return null;
  const name = m[1].replace(/[?.!,]+$/, '').replace(/\b(today|tomorrow|now|right now|this week)\b/gi, '').trim();
  if (!name || name.length < 2) return null;
  return { name, latitude: null, longitude: null, _needsGeocode: true };
}
async function geocode(name) {
  const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=en&format=json`);
  if (!r.ok) throw new Error('geocode');
  const hit = (await r.json()).results?.[0];
  if (!hit) throw new Error('no match');
  return hit;
}
async function fetchWeather(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=5`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('weather');
  return r.json();
}
const WMO = { 0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Rime fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 80: 'Rain showers', 81: 'Heavy showers', 82: 'Violent showers', 95: 'Thunderstorm', 96: 'Thunderstorm + hail', 99: 'Severe thunderstorm' };
function wmo(code) { return WMO[code] || 'Mixed conditions'; }
function weatherSummary(name, d) {
  const cur = d.current, days = d.daily;
  const line = i => `${d.daily.time[i]}: ${wmo(days.weather_code[i])}, ${Math.round(days.temperature_2m_min[i])}–${Math.round(days.temperature_2m_max[i])}°C, rain chance ${days.precipitation_probability_max[i]}%`;
  return `Current: ${Math.round(cur.temperature_2m)}°C (feels ${Math.round(cur.apparent_temperature)}°C), ${wmo(cur.weather_code)}, humidity ${cur.relative_humidity_2m}%, wind ${Math.round(cur.wind_speed_10m)} km/h.\n` + days.time.map((_, i) => line(i)).join('\n');
}
function localWeatherReply(name, d) {
  const cur = d.current;
  return `${name} right now: ${Math.round(cur.temperature_2m)}°C, ${wmo(cur.weather_code).toLowerCase()} (feels like ${Math.round(cur.apparent_temperature)}°C). Wind ${Math.round(cur.wind_speed_10m)} km/h, humidity ${cur.relative_humidity_2m}%.\n\n${d.daily.time.slice(0, 5).map((t, i) => `• ${t}: ${wmo(d.daily.weather_code[i])}, ${Math.round(d.daily.temperature_2m_min[i])}°–${Math.round(d.daily.temperature_2m_max[i])}°, rain ${d.daily.precipitation_probability_max[i]}%`).join('\n')}`;
}

/* ============================================================
   FILE OUTPUTS — presentations, spreadsheets, docs, diagrams, datasheets
   ============================================================ */
async function fileFlow(prompt, kind) {
  const el = addMsg('ai', `Building your ${KIND_LABEL[kind]}…`);
  let payload = null, demo = false;
  const instruction = FILE_PROMPTS[kind](prompt);
  try {
    if (!backendConfigured()) throw new Error('demo');
    const res = await apiFetch('chat', {
      method: 'POST',
      body: JSON.stringify({ model: SELECTED_MODEL || undefined, stream: false, messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...HISTORY.slice(-12), { role: 'user', content: instruction }] }),
    });
    payload = parseStructured(res.reply);
  } catch (err) { demo = true; payload = demoFilePayload(kind, prompt); }
  if (!payload) { demo = true; payload = demoFilePayload(kind, prompt); }
  const blobInfo = await buildFile(kind, payload);
  el.textContent = demo
    ? `Here's a demo ${KIND_LABEL[kind]} built from local templates — connect the backend and I'll draft it properly with your model.`
    : `Done — your ${KIND_LABEL[kind]} is ready.`;
  const card = document.createElement('div');
  card.className = 'ag-file-card';
  card.innerHTML = `<span class="ag-file-icon">${KIND_ICON[kind]}</span><div><strong>${escapeHtml(blobInfo.name)}</strong><span>${blobInfo.size}</span></div><a href="${blobInfo.url}" download="${escapeHtml(blobInfo.name)}">⬇ Download</a>`;
  el.appendChild(card);
  bumpStat('files');
  finalize('assistant', `[built ${KIND_LABEL[kind]}: ${blobInfo.name}]`);
}
const KIND_LABEL = { pptx: 'presentation', xlsx: 'spreadsheet', docx: 'document', svg: 'diagram', json: 'datasheet' };
const KIND_ICON = { pptx: '📑', xlsx: '📊', docx: '📄', svg: '◈', json: '🗄' };
const FILE_PROMPTS = {
  pptx: p => `Create a presentation for this request. Reply with ONLY a JSON object, no prose: {"title": "...", "slides": [{"title": "...", "bullets": ["...", "..."]}]} — 4-7 slides. Request: ${p}`,
  xlsx: p => `Create spreadsheet data for this request. Reply with ONLY a JSON object, no prose: {"title": "...", "headers": ["..."], "rows": [["cell", "..."], ...]} — 6-12 realistic rows. Request: ${p}`,
  docx: p => `Write a document for this request. Reply with ONLY a JSON object, no prose: {"title": "...", "body": "markdown-ish text with # headings, - bullets, plain paragraphs"}. Request: ${p}`,
  svg: p => `Draw a diagram for this request. Reply with ONLY a JSON object, no prose: {"title": "...", "svg": "<svg xmlns='http://www.w3.org/2000/svg' ...>...</svg>"} — a clean labeled diagram using the pale palette (#bcd2ff, #eaf1ff on #0a1020). Request: ${p}`,
  json: p => `Create a datasheet for this request. Reply with ONLY a JSON object, no prose: {"title": "...", "data": { ...structured fields and arrays... }}. Request: ${p}`,
};
function parseStructured(text) {
  if (!text) return null;
  let t = text.replace(/```json|```/g, '').trim();
  const start = t.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < t.length; i++) {
    if (t[i] === '{') depth++;
    else if (t[i] === '}') { depth--; if (!depth) { try { return JSON.parse(t.slice(start, i + 1)); } catch { return null; } } }
  }
  return null;
}
function demoFilePayload(kind, prompt) {
  const topic = prompt.replace(/^(make|create|build|draw|write)\b.*?(a|an|the)?\s*/i, '').slice(0, 60) || 'Pale Diamond';
  if (kind === 'pptx') return { title: `Presentation — ${topic}`, slides: [
    { title: 'Overview', bullets: [`Scope: ${topic}`, 'Prepared with Pale Diamond', 'Demo template — connect the backend for tailored content'] },
    { title: 'Key Points', bullets: ['Context and goals', 'Main challenges', 'Proposed approach', 'Next steps'] },
    { title: 'Roadmap', bullets: ['Phase 1 — Frame', 'Phase 2 — Build', 'Phase 3 — Ship'] },
  ]};
  if (kind === 'xlsx') return { title: `Spreadsheet — ${topic}`, headers: ['Item', 'Owner', 'Cost', 'Status'], rows: [
    ['Foundations', 'A. Cross', 1200, 'Done'], ['Design system', 'R. Vale', 3400, 'In progress'], ['Agent core', 'K. Idris', 5200, 'In progress'], ['Payments', 'M. Osei', 2100, 'Planned'], ['Launch', 'A. Cross', 900, 'Planned'],
  ]};
  if (kind === 'docx') return { title: `Document — ${topic}`, body: `# ${topic}\n\nThis is a demo document generated locally by Pale Diamond.\n\n- Connect the Vercel backend for model-written documents\n- Everything else about the file pipeline is already live\n- You can download this file to verify the flow\n\n## Next steps\n\n1. Add the backend URL in Settings\n2. Ask again for a tailored document` };
  if (kind === 'svg') return { title: `Diagram — ${topic}`, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="240"><rect width="560" height="240" fill="#0a1020"/><g fill="none" stroke="#bcd2ff" stroke-width="1.6"><rect x="30" y="90" width="120" height="54" rx="8"/><rect x="220" y="90" width="120" height="54" rx="8"/><rect x="410" y="90" width="120" height="54" rx="8"/></g><g fill="#cfe0ff" font-family="monospace" font-size="11" text-anchor="middle"><text x="90" y="121">USER</text><text x="280" y="121">PALE DIAMOND</text><text x="470" y="121">OPENROUTER</text></g><g stroke="#7f8bab" stroke-width="1.4"><line x1="150" y1="117" x2="218" y2="117"/><line x1="340" y1="117" x2="408" y2="117"/></g><text x="280" y="210" fill="#7f8bab" font-family="monospace" font-size="10" text-anchor="middle">DEMO DIAGRAM — ${escapeHtml(topic.toUpperCase().slice(0, 30))}</text></svg>` };
  return { title: `Datasheet — ${topic}`, data: { product: 'Pale Diamond', plans: ['Free', 'Port', 'Plus', 'Pro', 'Max'], currency: 'USD', monthly: [0, 9.99, 20, 45, 115], note: 'Demo datasheet — connect the backend for tailored data.' } };
}

async function buildFile(kind, payload) {
  if (kind === 'pptx') return buildPptx(payload);
  if (kind === 'xlsx') return buildXlsx(payload);
  if (kind === 'docx') return await buildDocx(payload);
  if (kind === 'svg') return blobUrl(new Blob([payload.svg || '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'], { type: 'image/svg+xml' }), `${slug(payload.title)}.svg`);
  return blobUrl(new Blob([JSON.stringify({ title: payload.title, ...payload.data }, null, 2)], { type: 'application/json' }), `${slug(payload.title)}.json`);
}
function blobUrl(blob, name) { return { url: URL.createObjectURL(blob), name, size: fmtBytes(blob.size) }; }
function slug(s) { return String(s || 'pale-diamond').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'pale-diamond'; }

function buildPptx(payload) {
  const safeTitle = payload.title || 'Pale Diamond Presentation';
  if (window.PptxGenJS) {
    const pptx = new PptxGenJS();
    pptx.defineLayout({ name: 'PD', width: 13.33, height: 7.5 });
    pptx.layout = 'PD';
    pptx.addSlide().addText(safeTitle, { x: 0.8, y: 2.6, w: 11.7, h: 2, fontSize: 44, color: 'BCD2FF', fontFace: 'Manrope' });
    (payload.slides || []).forEach((s, i) => {
      const slide = pptx.addSlide();
      slide.background = { color: '0A1020' };
      slide.addText(s.title || `Slide ${i + 1}`, { x: 0.8, y: 0.7, w: 11.7, h: 1, fontSize: 30, color: 'EAF1FF', fontFace: 'Manrope' });
      slide.addText((s.bullets || []).map(b => ({ text: b, options: { bullet: true, color: 'CFE0FF', breakLine: true } })), { x: 1.0, y: 2.1, w: 11.0, h: 4.4, fontSize: 18, fontFace: 'Manrope' });
    });
    const out = pptx.write({ outputType: 'blob' });
    return blobUrl(out instanceof Blob ? out : new Blob([out]), `${slug(safeTitle)}.pptx`);
  }
  // fallback: a self-contained HTML slide deck
  const slides = (payload.slides || []).map((s, i) => `<section><h1>${escapeHtml(s.title)}</h1><ul>${(s.bullets || []).map(b => `<li>${escapeHtml(b)}</li>`).join('')}</ul></section>`).join('');
  return blobUrl(new Blob([`<!doctype html><meta charset="utf-8"><title>${escapeHtml(safeTitle)}</title><style>body{background:#0a1020;color:#cfe0ff;font-family:Arial,serif;margin:0}section{min-height:100vh;display:grid;align-content:center;padding:8vw}h1{color:#eaf1ff}li{line-height:2}</style>${slides}`], { type: 'text/html' }), `${slug(safeTitle)}.html`);
}
function buildXlsx(payload) {
  const safeTitle = payload.title || 'Pale Diamond Spreadsheet';
  if (window.XLSX) {
    const ws = XLSX.utils.aoa_to_sheet([payload.headers || [], ...(payload.rows || [])]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet 1');
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    return blobUrl(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${slug(safeTitle)}.xlsx`);
  }
  const csv = [(payload.headers || []).join(','), ...(payload.rows || []).map(r => r.join(','))].join('\n');
  return blobUrl(new Blob([csv], { type: 'text/csv' }), `${slug(safeTitle)}.csv`);
}
function buildDocx(payload) {
  const safeTitle = payload.title || 'Pale Diamond Document';
  const body = String(payload.body || '');
  if (window.docx) {
    const D = window.docx;
    const paras = [];
    body.split('\n').forEach(line => {
      const l = line.trim();
      if (!l) return;
      if (l.startsWith('# ')) paras.push(new D.Paragraph({ text: l.slice(2), heading: D.HeadingLevel.HEADING_1 }));
      else if (l.startsWith('## ')) paras.push(new D.Paragraph({ text: l.slice(3), heading: D.HeadingLevel.HEADING_2 }));
      else if (l.startsWith('- ')) paras.push(new D.Paragraph({ text: l.slice(2), bullet: { level: 0 } }));
      else if (/^\d+\.\s/.test(l)) paras.push(new D.Paragraph({ text: l.replace(/^\d+\.\s/, ''), numbering: undefined, bullet: { level: 0 } }));
      else paras.push(new D.Paragraph({ text: l }));
    });
    const doc = new D.Document({ sections: [{ properties: {}, children: [new D.Paragraph({ text: safeTitle, heading: D.HeadingLevel.TITLE }), ...paras] }] });
    return D.Packer.toBlob(doc).then(b => blobUrl(b, `${slug(safeTitle)}.docx`));
  }
  return blobUrl(new Blob([`# ${safeTitle}\n\n${body}`], { type: 'text/markdown' }), `${slug(safeTitle)}.md`);
}

/* ============================================================
   CONVERSATIONS — saved locally, restorable
   ============================================================ */
function convos() { return store.get('pd_agent_convos', []); }
function saveConvo() {
  if (!HISTORY.length) return;
  const list = convos();
  const title = firstUserText() || 'New conversation';
  if (CONVO_ID) {
    const c = list.find(c => c.id === CONVO_ID);
    if (c) { c.messages = HISTORY.slice(-200); c.updated = Date.now(); c.title = title; }
    else list.unshift({ id: CONVO_ID, title, updated: Date.now(), messages: HISTORY.slice(-200) });
  } else {
    CONVO_ID = `c_${Date.now()}`;
    list.unshift({ id: CONVO_ID, title, updated: Date.now(), messages: HISTORY.slice(-200) });
  }
  store.set('pd_agent_convos', list.slice(0, 30));
}
function firstUserText() {
  for (const m of HISTORY) {
    if (m.role !== 'user') continue;
    const t = typeof m.content === 'string' ? m.content : (m.content.find?.(p => p.type === 'text')?.text || '');
    if (t) return t.slice(0, 58);
  }
  return null;
}
function renderConvos() {
  const root = $('#ag-convos');
  const list = convos();
  if (!list.length) { root.innerHTML = '<p class="ag-empty">No conversations yet — start a chat.</p>'; return; }
  root.innerHTML = list.map(c => `
    <div class="ag-convo" data-open-convo="${c.id}">
      <div><strong>${escapeHtml(c.title)}</strong><span>${new Date(c.updated).toLocaleString()} · ${c.messages.length} messages</span></div>
      <div class="ag-convo-actions"><button data-del-convo="${c.id}" aria-label="Delete">✕</button></div>
    </div>`).join('');
  $$('#ag-convos [data-open-convo]').forEach(el => el.addEventListener('click', e => {
    if (e.target.closest('[data-del-convo]')) return;
    openConvo(el.dataset.openConvo);
  }));
  $$('#ag-convos [data-del-convo]').forEach(b => b.addEventListener('click', () => {
    store.set('pd_agent_convos', convos().filter(c => c.id !== b.dataset.delConvo));
    renderConvos();
    showToast('Conversation deleted.');
  }));
}
function openConvo(id) {
  const c = convos().find(c => c.id === id);
  if (!c) return;
  resetChat();
  CONVO_ID = c.id;
  HISTORY = [...c.messages];
  c.messages.forEach(m => {
    const text = typeof m.content === 'string' ? m.content : (m.content.find?.(p => p.type === 'text')?.text || '[attachment]');
    addMsg(m.role, text);
  });
  switchView('chat');
  showToast('Conversation restored.');
}

/* ============================================================
   ANALYTICS — local, private
   ============================================================ */
function stats() { return store.get('pd_agent_stats', { messages: 0, images: 0, files: 0, weather: 0, days: {} }); }
function bumpStat(kind) {
  const s = stats();
  s[kind] = (s[kind] || 0) + 1;
  const day = new Date().toISOString().slice(0, 10);
  s.days[day] = (s.days[day] || 0) + 1;
  store.set('pd_agent_stats', s);
}
function renderAnalytics() {
  const s = stats();
  $('#ag-stats').innerHTML = [
    ['MESSAGES', s.messages], ['IMAGES GENERATED', s.images], ['FILES BUILT', s.files], ['WEATHER ASKS', s.weather],
  ].map(([k, v]) => `<div class="ag-stat"><span>${k}</span><strong>${v}</strong></div>`).join('');
  const bars = $('#ag-timeline-bars');
  bars.innerHTML = '';
  for (let i = 15; i >= 0; i--) {
    const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
    const v = s.days[d] || 0;
    const b = document.createElement('i');
    b.style.height = `${Math.min(100, 8 + v * 18)}px`;
    b.title = `${d}: ${v}`;
    bars.appendChild(b);
  }
}

/* ---------- packages ---------- */
function renderPackages() {
  const user = currentUser();
  const plans = [['FREE', 'Free', '$0'], ['PORT', 'Port', '$9.99'], ['PLUS', 'Plus', '$20'], ['PRO', 'Pro', '$45'], ['MAX', 'Max', '$115']];
  $('#ag-plans').innerHTML = plans.map(([k, n, p]) => `
    <div class="ag-plan-mini${user && user.tier === k.charAt(0) + k.slice(1).toLowerCase() ? ' current' : ''}"><b>${k}</b><strong>${p}</strong><span>${n === 'Free' ? 'Open-weight models' : 'Image + video quotas, priority routing'}</span></div>`).join('');
}

/* ============================================================
   SETTINGS
   ============================================================ */
(function initSettings() {
  $('#ag-api-url').value = store.get('pd_api_base', '') || (window.PD_CONFIG?.apiBase || '');
  $('#ag-save-api')?.addEventListener('click', () => {
    const v = $('#ag-api-url').value.trim().replace(/\/+$/, '');
    store.set('pd_api_base', v);
    MODEL_DATA = null;
    loadModels(true);
    showToast(v ? `Backend set — testing the routers…` : 'Backend cleared. Demo mode active.');
  });
  $('#ag-theme')?.addEventListener('click', () => applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'));
  $('#ag-clear-model')?.addEventListener('click', () => { SELECTED_MODEL = ''; store.set('pd_model', ''); updateModelButton(); showToast('Model reset to Auto.'); });
  $('#ag-clear-data')?.addEventListener('click', () => {
    if (!confirm('Clear saved conversations, models, and usage stats from this browser?')) return;
    ['pd_agent_convos', 'pd_agent_stats', 'pd_model'].forEach(k => localStorage.removeItem(k));
    resetChat();
    showToast('Local agent data cleared.');
  });
})();

/* ============================================================
   MUSIC PLAYER — persistent controls, queue, search
   ============================================================ */
(function musicPlayer() {
  const audio = $('#ag-audio');
  const player = $('#ag-player');
  const queuePanel = $('#ag-queue');
  let queue = [];            // {name, url, size}
  let index = -1;
  let filter = '';

  function renderQueue() {
    const list = $('#ag-queue-list');
    const visible = queue.map((s, i) => ({ s, i })).filter(({ s }) => s.name.toLowerCase().includes(filter));
    list.innerHTML = visible.length
      ? visible.map(({ s, i }) => `
        <div class="ag-song${i === index ? ' playing' : ''}" data-play="${i}">
          <span class="ag-song-idx">${String(i + 1).padStart(2, '0')}</span>
          <span class="ag-song-name">${escapeHtml(s.name)}</span>
          <span class="ag-song-actions">
            <button data-up="${i}" aria-label="Move up">▲</button>
            <button data-down="${i}" aria-label="Move down">▼</button>
            <button data-del="${i}" class="ag-song-del" aria-label="Remove">✕</button>
          </span>
        </div>`).join('')
      : '<p class="ag-empty">Nothing in the queue matches.</p>';
    $$('#ag-queue-list [data-play]').forEach(el => el.addEventListener('click', e => {
      if (e.target.closest('button')) return;
      playAt(Number(el.dataset.play));
    }));
    $$('#ag-queue-list [data-up]').forEach(b => b.addEventListener('click', () => move(Number(b.dataset.up), -1)));
    $$('#ag-queue-list [data-down]').forEach(b => b.addEventListener('click', () => move(Number(b.dataset.down), +1)));
    $$('#ag-queue-list [data-del]').forEach(b => b.addEventListener('click', () => removeAt(Number(b.dataset.del))));
  }
  function move(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= queue.length) return;
    [queue[i], queue[j]] = [queue[j], queue[i]];
    if (index === i) index = j; else if (index === j) index = i;
    renderQueue();
  }
  function removeAt(i) {
    if (i === index) { stop(); }
    else if (i < index) index--;
    const wasPlaying = !audio.paused;
    const url = queue[i].url;
    queue.splice(i, 1);
    URL.revokeObjectURL(url);
    if (i === index && wasPlaying && queue.length) { index = Math.min(index, queue.length - 1); playAt(index); }
    else if (i === index) { index = -1; updateMeta(); }
    renderQueue();
  }
  function updateMeta() {
    const cur = queue[index];
    $('#ag-player-title').textContent = cur ? cur.name.replace(/\.[^.]+$/, '') : 'Nothing playing';
    $('#ag-player-sub').textContent = cur ? `${fmtBytes(cur.size)} · track ${index + 1}/${queue.length}` : 'add songs to build a queue';
    player.classList.toggle('playing', !!cur && !audio.paused);
    renderQueue();
  }
  function playAt(i) {
    if (i < 0 || i >= queue.length) return;
    index = i;
    audio.src = queue[i].url;
    audio.play().catch(() => showToast('Press play to start (browser autoplay rules).'));
    updateMeta();
    setPlayIcon();
  }
  function setPlayIcon() { $('#ag-play').textContent = audio.paused ? '▶' : '⏸'; }
  function stop() { audio.pause(); audio.removeAttribute('src'); }
  function fmtTime(t) { if (!isFinite(t)) return '0:00'; const m = Math.floor(t / 60); return `${m}:${String(Math.floor(t % 60)).padStart(2, '0')}`; }

  $('#ag-play')?.addEventListener('click', () => {
    if (!queue.length) return $('#ag-queue-add').click();
    if (index === -1) return playAt(0);
    audio.paused ? audio.play() : audio.pause();
    setPlayIcon(); updateMeta();
  });
  $('#ag-next')?.addEventListener('click', () => playAt((index + 1) % Math.max(1, queue.length)));
  $('#ag-prev')?.addEventListener('click', () => playAt(index <= 0 ? queue.length - 1 : index - 1));
  $('#ag-queue-toggle')?.addEventListener('click', () => { queuePanel.hidden = !queuePanel.hidden; if (!queuePanel.hidden) renderQueue(); });
  $('#ag-queue-add')?.addEventListener('click', () => $('#ag-music-file').click());
  $('#ag-music-file')?.addEventListener('change', e => {
    [...e.target.files].forEach(f => queue.push({ name: f.name, url: URL.createObjectURL(f), size: f.size }));
    e.target.value = '';
    if (index === -1 && queue.length) playAt(0); else renderQueue();
    showToast(`${queue.length} song${queue.length > 1 ? 's' : ''} in your queue.`);
  });
  $('#ag-queue-search')?.addEventListener('input', e => { filter = e.target.value.toLowerCase(); renderQueue(); });
  audio.addEventListener('timeupdate', () => {
    $('#ag-time-now').textContent = fmtTime(audio.currentTime);
    $('#ag-time-total').textContent = fmtTime(audio.duration);
    $('#ag-seek').value = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
  });
  $('#ag-seek')?.addEventListener('input', e => { if (audio.duration) audio.currentTime = (e.target.value / 100) * audio.duration; });
  $('#ag-vol')?.addEventListener('input', e => { audio.volume = e.target.value / 100; });
  audio.addEventListener('ended', () => { if (queue.length > 1) playAt((index + 1) % queue.length); else setPlayIcon(); });
  audio.volume = 0.8;
  renderQueue();
})();

/* ============================================================
   BOOT
   ============================================================ */
refreshAccountUI();
loadModels();