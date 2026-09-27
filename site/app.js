'use strict';

/* ============================================================
   Pale Diamond — front-end app
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
  return (saved || cfg || '').replace(/\/+$/, '') || (location.origin.includes('github.io') ? '' : '/api');
}
function apiUrl(path) { return `${apiBase()}/api/${path}`; }
async function apiFetch(path, options = {}) {
  const res = await fetch(apiUrl(path), { headers: { 'Content-Type': 'application/json' }, ...options });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}
function backendConfigured() { return !!apiBase() || !location.origin.includes('github.io'); }

/* ============ INTRO: logo-gem spin + shine + vortex logo ============ */
(function intro() {
  const overlay = $('#intro');
  if (!overlay) return;
  const finish = () => overlay.classList.add('done');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || window.location.hash) { finish(); return; }   // skip on deep links / reduced motion
  overlay.setAttribute('aria-hidden', 'false');
  // timeline: gem spins in 3D (CSS), shine sweeps at ~2.0s, vortex logo forms at ~2.7s
  const shine = setTimeout(() => overlay.classList.add('shine'), 2000);
  const forming = setTimeout(() => overlay.classList.add('forming'), 2700);
  const timer = setTimeout(finish, 4600);
  $('#intro-skip')?.addEventListener('click', () => { clearTimeout(shine); clearTimeout(forming); clearTimeout(timer); finish(); });
})();

/* ============ THEME ============ */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.body.setAttribute('data-theme', theme);
  store.set('pd_theme', theme);
  const icon = $('.theme-icon'); if (icon) icon.textContent = theme === 'dark' ? '◐' : '◑';
  const ts = $('#theme-setting'); if (ts) ts.querySelector('span').textContent = theme === 'dark' ? 'Dark' : 'Bright';
}
applyTheme(store.get('pd_theme', 'dark'));
$('#theme-toggle')?.addEventListener('click', () =>
  applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'));

/* ============ SCROLL DIAMOND (spins by scroll direction) ============ */
(function scrollDiamond() {
  const el = $('.scroll-diamond');
  if (!el) return;
  const svg = el.querySelector('svg');
  let last = window.scrollY, angle = 0;
  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    const delta = y - last; last = y;
    angle += delta * 0.4;                 // down => clockwise, up => counter-clockwise
    svg.style.transform = `rotate(${angle}deg)`;
    el.classList.toggle('show', y > 260);
  }, { passive: true });
})();

/* ============ MAGNETIC + GRAVITY BUTTONS ============ */
$$('.magnetic').forEach(btn => {
  btn.addEventListener('mousemove', e => {
    const r = btn.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    btn.style.setProperty('--mx', mx + 'px');
    btn.style.setProperty('--my', my + 'px');
    const px = (mx / r.width - 0.5), py = (my / r.height - 0.5);
    btn.style.transform = `translate(${px * 10}px, ${py * 8}px)`;
  });
  btn.addEventListener('mouseleave', () => { btn.style.transform = ''; });
});

/* ============ ACCOUNTS ============ */
function accounts() { return store.get('pd_accounts', {}); }
function saveAccounts(a) { store.set('pd_accounts', a); }
function currentEmail() { return store.get('pd_session', null); }
function currentUser() { const e = currentEmail(); return e ? accounts()[e] : null; }
function makeKey() {
  const seg = () => Math.random().toString(36).slice(2, 6).toUpperCase();
  return `pdk_${seg()}${seg()}_${seg()}${seg()}`;
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function refreshAuthUI() {
  const user = currentUser();
  const signInBtn = $('[data-open-auth="signin"]');
  const avatar = $('#avatar-button');
  if (user) {
    signInBtn.hidden = true;
    avatar.hidden = false;
    avatar.textContent = user.email[0].toUpperCase();
    const an = $('.agent-account-name'); if (an) an.textContent = user.email.split('@')[0];
    const aa = $('.agent-account-avatar'); if (aa) aa.textContent = user.email[0].toUpperCase();
  } else {
    signInBtn.hidden = false;
    avatar.hidden = true;
    const an = $('.agent-account-name'); if (an) an.textContent = 'Guest';
    const aa = $('.agent-account-avatar'); if (aa) aa.textContent = 'G';
  }
}

/* ============ MODAL HELPERS ============ */
function openModal(id) { const m = $(id); m.classList.add('open'); m.setAttribute('aria-hidden', 'false'); }
function closeModal(m) { m.classList.remove('open'); m.setAttribute('aria-hidden', 'true'); }
$$('[data-close-modal]').forEach(b => b.addEventListener('click', () => closeModal(b.closest('.modal-backdrop'))));
$$('.modal-backdrop').forEach(bd => bd.addEventListener('click', e => { if (e.target === bd) closeModal(bd); }));

/* ---------- auth modal ---------- */
let authMode = 'signup';
const authModal = $('#auth-modal');
function openAuth(mode = 'signup') {
  authMode = mode;
  const signin = mode === 'signin';
  $('#modal-mode-label').textContent = signin ? 'SIGN IN' : 'WELCOME';
  $('#modal-title').innerHTML = signin ? 'Welcome<br /><em>back.</em>' : 'Make room for<br /><em>better work.</em>';
  $('#modal-subtitle').textContent = signin ? 'Pick up where you left off.' : 'Create your private facet in a few seconds.';
  $('#auth-submit').innerHTML = signin ? 'Enter facet <span>↗</span>' : 'Create facet <span>↗</span>';
  $('#modal-switch-copy').textContent = signin ? 'New to Pale Diamond?' : 'Already have an account?';
  $('#modal-switch-button').textContent = signin ? 'Create an account' : 'Sign in';
  openModal('#auth-modal');
  setTimeout(() => authModal.querySelector('input')?.focus(), 100);
}
$$('[data-open-auth]').forEach(b => b.addEventListener('click', () => openAuth(b.dataset.openAuth)));
$('#modal-switch-button').addEventListener('click', () => openAuth(authMode === 'signup' ? 'signin' : 'signup'));

$('#auth-form').addEventListener('submit', async e => {
  e.preventDefault();
  const data = new FormData(e.target);
  const email = String(data.get('email')).trim().toLowerCase();
  const password = String(data.get('password'));
  e.target.reset();

  if (authMode === 'signup') {
    // Real database first (backend on Vercel); local fallback when offline.
    try {
      if (backendConfigured()) {
        const res = await apiFetch('auth/register', { method: 'POST', body: JSON.stringify({ email, password }) });
        saveServerAccount(email, password, res.token, res.user);
        store.set('pd_session', email);
        showToast('Your private facet is ready — saved to the Pale Diamond database.');
        closeModal(authModal);
        refreshAuthUI();
        return;
      }
    } catch (err) {
      if (String(err.message).includes('409')) return showToast('That account already exists — try signing in.');
      // backend unreachable → fall through to local demo account
    }
    const acc = accounts();
    if (acc[email]) return showToast('That account already exists — try signing in.');
    acc[email] = { email, password, created: new Date().toISOString(), tier: 'Free', credits: 0, apiKey: makeKey(), models: ['Nano Banana Pro', 'Seedance 2.5'] };
    saveAccounts(acc);
    store.set('pd_session', email);
    showToast('Your private facet is ready. A hidden API key was issued.');
    closeModal(authModal);
    refreshAuthUI();
  } else {
    try {
      if (backendConfigured()) {
        const res = await apiFetch('auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
        saveServerAccount(email, password, res.token, res.user);
        store.set('pd_session', email);
        showToast(`Welcome back, ${email.split('@')[0]}.`);
        closeModal(authModal);
        refreshAuthUI();
        return;
      }
    } catch (err) {
      if (String(err.message).includes('401')) return showToast('Email or password not recognized.');
      // backend unreachable → local login below
    }
    const acc = accounts();
    if (!acc[email] || acc[email].password !== password) return showToast('Email or password not recognized.');
    store.set('pd_session', email);
    showToast(`Welcome back, ${email.split('@')[0]}.`);
    closeModal(authModal);
    refreshAuthUI();
  }
});

/* Server-backed account: keep the session token + mirror the profile locally
   so the Switch Accounts screen and offline UI keep working. */
function saveServerAccount(email, password, token, u) {
  store.set('pd_auth_token', token);
  const acc = accounts();
  acc[email] = {
    ...(acc[email] || { apiKey: makeKey(), models: ['Nano Banana Pro', 'Seedance 2.5'] }),
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

/* Boot: refresh the signed-in user from the server (tier, subscription dates). */
(async function refreshServerUser() {
  const token = store.get('pd_auth_token', null);
  const email = currentEmail();
  if (!token || !email || !backendConfigured()) return;
  try {
    const u = await apiFetch('auth/me', { headers: { Authorization: `Bearer ${token}` } });
    const acc = accounts();
    acc[email] = {
      ...(acc[email] || { email, apiKey: makeKey() }),
      email,
      tier: u.plan || acc[email]?.tier || 'Free',
      credits: u.credits ?? acc[email]?.credits ?? 0,
      subscribedAt: u.subscribedAt || acc[email]?.subscribedAt || null,
      nextDue: u.nextDue || acc[email]?.nextDue || null,
    };
    saveAccounts(acc);
    refreshAuthUI();
  } catch (err) { /* offline or expired token — local state stands */ }
})();

/* ============ PROFILE DROPDOWN MENU ============ */
const profileMenu = $('#profile-menu');
function closeProfileMenu() { if (profileMenu) { profileMenu.hidden = true; profileMenu.removeAttribute('data-anchor'); } }
function openProfileMenu(anchorBtn) {
  if (!profileMenu) return;
  const r = anchorBtn.getBoundingClientRect();
  profileMenu.style.top = `${r.bottom + 10}px`;
  profileMenu.style.right = `${Math.max(12, window.innerWidth - r.right)}px`;
  profileMenu.style.left = 'auto';
  profileMenu.hidden = false;
}
function toggleProfileMenu(anchorBtn) {
  if (!profileMenu || profileMenu.hidden) openProfileMenu(anchorBtn);
  else closeProfileMenu();
}
document.addEventListener('click', e => {
  if (!profileMenu || profileMenu.hidden) return;
  if (e.target.closest('#profile-menu') || e.target.closest('#avatar-button') || e.target.closest('#agent-account')) return;
  closeProfileMenu();
});
$('#avatar-button')?.addEventListener('click', e => { e.stopPropagation(); toggleProfileMenu(e.currentTarget); });
$('#agent-account')?.addEventListener('click', e => { e.stopPropagation(); toggleProfileMenu(e.currentTarget); });
$$('[data-menu-action]').forEach(b => b.addEventListener('click', () => {
  const action = b.dataset.menuAction;
  closeProfileMenu();
  if (action === 'info') openProfile();
  else if (action === 'settings') { openProfile(); switchProfileTab('settings'); }
  else if (action === 'switch') openSwitchScreen();
  else if (action === 'signout') doSignOut();
}));

function doSignOut() {
  if (store.get('pd_auth_token', null)) {
    apiFetch('auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${store.get('pd_auth_token', '')}` } })
      .catch(() => {});
    store.set('pd_auth_token', null);
  }
  store.set('pd_session', null);
  closeProfileMenu();
  $$('.modal-backdrop.open').forEach(closeModal);
  refreshAuthUI();
  showToast('Signed out.');
}

/* ============ SWITCH ACCOUNTS SCREEN ============ */
function openSwitchScreen() {
  const user = currentUser();
  if (!user) return openAuth('signin');
  const list = $('#switch-list');
  const others = Object.values(accounts()).filter(a => a.email !== user.email);
  list.innerHTML = others.length
    ? others.map(a => `
      <div class="switch-row" data-switch-to="${escapeHtml(a.email)}">
        <span class="switch-avatar">${a.email[0].toUpperCase()}</span>
        <div><strong>${escapeHtml(a.email)}</strong><span>${fmtDate(a.created)} · ${a.tier || 'Free'}</span></div>
        <span class="switch-go">›</span>
      </div>`).join('')
    : '<p class="ag-empty" style="font-family:\'DM Mono\',monospace;color:var(--muted);font-size:11px">No other accounts on this device. Create one from the sign-in screen.</p>';
  openModal('#switch-modal');
  $$('#switch-list [data-switch-to]').forEach(row => row.addEventListener('click', () => {
    const email = row.dataset.switchTo;
    store.set('pd_session', email);
    closeModal($('#switch-modal'));
    refreshAuthUI();
    showToast(`Switched to ${email.split('@')[0]}.`);
  }));
}

/* ============ PROFILE + SETTINGS ============ */
function fmtDate(iso) { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
function ageString(iso) {
  const days = Math.max(0, Math.floor((Date.now() - new Date(iso)) / 864e5));
  if (days < 1) return 'New today';
  if (days < 30) return `${days} day${days > 1 ? 's' : ''}`;
  if (days < 365) return `${Math.floor(days / 30)} month${days >= 60 ? 's' : ''}`;
  return `${(days / 365).toFixed(1)} years`;
}
function openProfile() {
  const user = currentUser();
  if (!user) return openAuth('signin');
  $('#profile-avatar').textContent = user.email[0].toUpperCase();
  $('#profile-name').textContent = user.email.split('@')[0];
  $('#profile-email').textContent = user.email;
  $('#stat-tier').textContent = user.tier;
  $('#stat-created').textContent = fmtDate(user.created);
  $('#stat-age').textContent = ageString(user.created);
  $('#stat-credits').textContent = user.credits;
  // subscription payment dates
  $('#stat-sub-since').textContent = user.subscribedAt ? fmtDate(user.subscribedAt) : 'not yet';
  $('#stat-sub-next').textContent = user.nextDue
    ? `${fmtDate(user.nextDue)} (${dueInDays(user.nextDue)})`
    : (user.tier !== 'Free' ? '—' : 'free plan');
  // credit timeline (deterministic-ish demo based on account)
  const bars = $('#timeline-bars'); bars.innerHTML = '';
  for (let i = 0; i < 16; i++) {
    const b = document.createElement('i');
    b.style.height = (10 + Math.round((Math.sin(i * 1.7 + user.email.length) * 0.5 + 0.5) * 54)) + 'px';
    bars.appendChild(b);
  }
  openModal('#profile-modal');
}
function dueInDays(iso) {
  const d = Math.ceil((new Date(iso) - Date.now()) / 864e5);
  if (d <= 0) return 'today';
  if (d === 1) return 'tomorrow';
  return `in ${d} days`;
}
function recordSubscription(user, tier, interval) {
  const now = new Date();
  const a = accounts();
  const acc = a[user.email];
  if (!acc) return;
  acc.tier = tier;
  if (!acc.subscribedAt) acc.subscribedAt = now.toISOString();   // first payment date sticks
  const due = new Date(acc.subscribedAt);
  if (interval === 'yearly') due.setFullYear(due.getFullYear() + 1);
  else due.setMonth(due.getMonth() + 1);
  acc.nextDue = due.toISOString();
  acc.billing = interval;
  saveAccounts(a);
  // Mirror into the server database when signed in through it.
  const token = store.get('pd_auth_token', null);
  if (token && backendConfigured()) {
    apiFetch('billing/record', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ plan: tier, interval }),
    }).catch(() => {});
  }
}
$$('[data-open-settings]').forEach(b => b.addEventListener('click', () => { openProfile(); switchProfileTab('settings'); }));

function switchProfileTab(tab) {
  $$('.profile-tabs button').forEach(b => b.classList.toggle('active', b.dataset.profileTab === tab));
  $$('.profile-panel').forEach(p => p.hidden = p.dataset.panel !== tab);
}
$$('.profile-tabs button').forEach(b => b.addEventListener('click', () => switchProfileTab(b.dataset.profileTab)));

$('#theme-setting')?.addEventListener('click', () =>
  applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'));

$('#change-pass')?.addEventListener('click', () => {
  const user = currentUser(); if (!user) return;
  const np = prompt('Enter a new password (min 6 chars):');
  if (np && np.length >= 6) { const a = accounts(); a[user.email].password = np; saveAccounts(a); showToast('Password updated.'); }
  else if (np !== null) showToast('Password too short.');
});
$('#add-models')?.addEventListener('click', () => {
  const user = currentUser(); if (!user) return;
  const pick = prompt('Add a model (e.g. Sora 2, Google Veo 3.1, GPT Image 2, Kling 3.0):');
  if (pick) { const a = accounts(); a[user.email].models = [...new Set([...(a[user.email].models || []), pick.trim()])]; saveAccounts(a); showToast(`Added ${pick.trim()} to your models.`); }
});
$('#switch-account')?.addEventListener('click', () => { closeModal($('#profile-modal')); openSwitchScreen(); });
$('#sign-out')?.addEventListener('click', doSignOut);
$('#delete-account')?.addEventListener('click', () => {
  const user = currentUser(); if (!user) return;
  if (confirm('Permanently delete this account? This cannot be undone.')) {
    const a = accounts(); delete a[user.email]; saveAccounts(a);
    store.set('pd_session', null); closeModal($('#profile-modal')); refreshAuthUI();
    showToast('Account deleted.');
  }
});

/* ============ PLANS (data-driven) ============ */
const PLANS = [
  { key: 'Free', name: 'Free', price: 0, desc: 'Open-weight models. Feel the cut before you commit.',
    images: 'Open-weight', videos: '—',
    quota: ['<b>Open-weight</b> models only', 'Core workspace & agent', 'Limited daily usage', 'Upgrade anytime — keep your facet'] },
  { key: 'Port', name: 'Port', price: 9.99, desc: 'A polished entry into creation.',
    images: '~1,330', videos: '16',
    quota: ['<b>~1,330</b> budget image gens', '~160 mid · ~67 premium · ~33 high-end', '<b>16</b> budget 5s videos', '8 mid · 3–4 premium videos'] },
  { key: 'Plus', name: 'Plus', price: 20, featured: true, desc: 'The recommended everyday facet — Standard quotas.',
    images: '~2,660', videos: '32',
    quota: ['<b>~2,660</b> budget image gens', '~320 mid · ~133 premium · ~67 high-end', '<b>32</b> budget 5s videos', '16 mid · 5–8 premium videos'] },
  { key: 'Pro', name: 'Pro', price: 45, desc: 'For people building at full speed.',
    images: '~5,000', videos: '60',
    quota: ['<b>~5,000</b> budget image gens', '~600 mid · ~250 premium · ~125 high-end', '<b>60</b> budget 5s videos', '30 mid · 10–15 premium videos'] },
  { key: 'Max', name: 'Max', price: 115, desc: 'Maximum brilliance, maximum output.',
    images: '~16,660', videos: '200',
    quota: ['<b>~16,660</b> budget image gens', '~2,000 mid · ~833 premium · ~417 high-end', '<b>200</b> budget 5s videos', '100 mid · 33–50 premium videos'] },
];
let billing = 'monthly';
function renderPlans() {
  const grid = $('#plan-grid'); if (!grid) return;
  grid.innerHTML = PLANS.map(p => {
    const monthly = billing === 'monthly';
    const val = p.price === 0 ? 0 : (monthly ? p.price : (p.price * 0.8));
    const price = `$${val.toFixed(2).replace(/\.00$/, '')}`;
    const suffix = p.price === 0 ? '/ forever' : (monthly ? '/ month' : '/ mo · billed yearly');
    return `<article class="plan-card glass${p.featured ? ' featured' : ''}">
      ${p.featured ? '<div class="popular-tag">RECOMMENDED</div>' : ''}
      <span class="plan-eyebrow">${p.name.toUpperCase()}</span>
      <h3>${p.name}</h3>
      <p class="plan-desc">${p.desc}</p>
      <div class="price"><b>${price}</b><span>${suffix}</span></div>
      <ul class="plan-quota">${p.quota.map(q => `<li>${q}</li>`).join('')}</ul>
      <button class="plan-button${p.featured ? ' light' : ''} magnetic" data-plan="${p.key}">Choose ${p.name} <span>↗</span></button>
    </article>`;
  }).join('');
  $$('#plan-grid [data-plan]').forEach(b => b.addEventListener('click', () => {
    const plan = b.dataset.plan;
    const user = currentUser();
    if (!user && plan !== 'Free') { store.set('pd_pending_plan', plan); openAuth('signup'); showToast(`${plan} selected — create your facet to continue.`); return; }
    startCheckout(plan);
  }));
  // re-bind magnetic on freshly created buttons
  $$('#plan-grid .magnetic').forEach(bindMagnetic);
}

/* ---------- Stripe checkout (live keys via backend; demo fallback) ---------- */
async function startCheckout(plan) {
  const user = currentUser();
  if (plan === 'Free') {
    if (user) { const a = accounts(); a[user.email].tier = 'Free'; saveAccounts(a); showToast('Free plan active.'); }
    return;
  }
  try {
    const data = await apiFetch('checkout', {
      method: 'POST',
      body: JSON.stringify({ action: 'create', plan, interval: billing }),
    });
    if (data.url) { showToast(`Redirecting to Stripe for ${plan}…`); window.location.href = data.url; return; }
    throw new Error(data.error || 'no url');
  } catch (err) {
    // Demo fallback: no backend / Stripe configured yet
    if (user) { const a = accounts(); a[user.email].tier = plan; saveAccounts(a); recordSubscription(user, plan, billing); showToast(`${plan} is now your plan. (Demo mode — connect Stripe to bill.)`); }
    else showToast(`${plan} selected — sign in to continue. (Demo mode)`);
  }
}
async function verifyCheckoutOnLoad() {
  const q = new URLSearchParams(location.search);
  if (!q.get('checkout')) return;
  const sid = q.get('session_id');
  history.replaceState({}, '', location.pathname);
  if (q.get('checkout') === 'cancelled') { showToast('Checkout cancelled — nothing was charged.'); return; }
  const user = currentUser();
  if (!user) { store.set('pd_pending_plan', null); showToast('Payment complete — sign in to attach it to your facet.'); return; }
  try {
    const data = await apiFetch('checkout', {
      method: 'POST',
      body: JSON.stringify({ action: 'verify', sessionId: sid }),
    });
    if (data.status === 'paid') {
      const a = accounts();
      a[user.email].tier = data.plan;
      saveAccounts(a);
      recordSubscription(user, data.plan, data.interval);
      const split = data.split;
      showToast(`${data.plan} plan active — payment split 50/50 (owner $${(split.owner / 100).toFixed(2)} / API funding $${(split.apiFunding / 100).toFixed(2)}).`);
      refreshAuthUI();
    }
  } catch (err) {
    showToast('Could not verify payment with the backend. (Demo mode)');
  }
}
verifyCheckoutOnLoad();
function bindMagnetic(btn) {
  btn.addEventListener('mousemove', e => {
    const r = btn.getBoundingClientRect();
    btn.style.setProperty('--mx', (e.clientX - r.left) + 'px');
    btn.style.setProperty('--my', (e.clientY - r.top) + 'px');
  });
}
$$('.billing-toggle button').forEach(b => b.addEventListener('click', () => {
  $$('.billing-toggle button').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  billing = b.dataset.billing;
  renderPlans();
  showToast(billing === 'yearly' ? 'Yearly billing — 20% saved.' : 'Monthly billing selected.');
}));
renderPlans();

/* ============ PAY AS YOU GO ============ */
$('[data-paygo]')?.addEventListener('click', () => openModal('#paygo-modal'));
$$('[data-credits]').forEach(b => b.addEventListener('click', () => {
  const c = Number(b.dataset.credits);
  const user = currentUser();
  if (user) { const a = accounts(); a[user.email].credits = (a[user.email].credits || 0) + c * 10; saveAccounts(a); }
  closeModal($('#paygo-modal'));
  showToast(`A $${c} credit pack was added.`);
}));

/* ============ AGENT (pop-up preview + full agent page) ============ */
const agent = $('#agent');
function openAgent() {
  agent.classList.add('open', 'fade-in');
  agent.setAttribute('aria-hidden', 'false');
  setTimeout(() => { agent.classList.remove('fade-in'); $('#agent-input')?.focus(); }, 720);
}
function closeAgent() { agent.classList.remove('open'); agent.setAttribute('aria-hidden', 'true'); }
// Every agent button routes to the larger agent page; the section-04 picture fades the pop-up in.
$$('[data-launch-agent]').forEach(b => {
  b.addEventListener('click', () => { window.location.href = 'agent.html'; });
});
$$('[data-agent-picture]').forEach(el => {
  const open = () => openAgent();
  el.addEventListener('click', open);
  el.addEventListener('keydown', e => { if (e.key === 'Enter') open(); });
});
$('[data-close-agent]')?.addEventListener('click', closeAgent);
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeAgent(); $$('.modal-backdrop.open').forEach(closeModal); } });
$('#agent-full-link')?.addEventListener('click', e => { e.preventDefault(); window.location.href = 'agent.html'; });

$$('.agent-nav-item[data-agent-view]').forEach(b => b.addEventListener('click', () => {
  $$('.agent-nav-item').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  const view = b.dataset.agentView;
  const views = {
    conversations: 'Your saved conversations will appear here.',
    packages: 'Packages bundle models and credits — Port, Standard, Pro, Max.',
    models: 'Image: Nano Banana Pro, Seedream 5, FLUX.2, GPT Image 2, Recraft V4.1 · Video: Kling 3.0, Seedance 2.5, Veo 3.1, Sora 2, Minimax Hailuo.',
    analytics: 'Usage analytics: credits, generations, and model mix over time.',
    help: 'Type a message below and Pale Diamond will respond. Ask for plans, drafts, ideas, or code.',
  };
  if (views[view]) addMsg('ai', views[view]);
}));

$('#agent-model')?.addEventListener('click', () => {
  const m = prompt('Choose a model:', $('#agent-model').textContent);
  if (m) { $('#agent-model').textContent = m.trim(); showToast(`Model set to ${m.trim()}.`); }
});

const messagesEl = $('#agent-messages');
function addMsg(role, text) {
  $('.agent-welcome')?.remove();
  const el = document.createElement('div');
  el.className = `msg ${role}`;
  el.textContent = text;
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return el;
}

/* --- small intent-aware responder --- */
function agentReply(input) {
  const t = input.toLowerCase().trim();
  const has = (...w) => w.some(x => t.includes(x));
  if (has('hi', 'hello', 'hey', 'yo ') || t === 'hi' || t === 'hey')
    return "Hello — I'm Pale Diamond. Tell me what you're working on and I'll help you cut it down to a clear next step.";
  if (has('who are you', 'what are you', 'your name'))
  return "I'm Pale Diamond, a web-hosted AI agent for tasks, automation, and image & video creation. Think of me as a facet between your idea and the outcome.";
  if (has('price', 'plan', 'cost', 'subscription', 'how much'))
    return "Five ways in: Free (open-weight models), Port $9.99, Plus $20 (recommended, Standard quotas), Pro $45, and Max $115 — each with image & video generation quotas, plus pay-as-you-go credits. Want the breakdown for one of them?";
  if (has('image', 'picture', 'photo', 'render', 'draw', 'generate an'))
    return "For images I route to models like Nano Banana Pro, Seedream 5, FLUX.2, or GPT Image 2 depending on quality and budget. Describe the shot — subject, style, mood — and I'll turn it into a generation-ready prompt.";
  if (has('video', 'clip', 'animation', 'motion'))
    return "For 5-second clips I can reach Kling 3.0, Seedance 2.5, Veo 3.1 or Sora 2. Give me the scene and pacing and I'll storyboard it, then draft the generation prompt.";
  if (has('plan', 'roadmap', 'strategy', 'launch'))
    return "Here's a shape you can steal: 1) Frame the goal and success metric. 2) List the 3 hardest unknowns. 3) Assign an owner + date to each. Tell me the project and I'll fill it in.";
  if (has('write', 'draft', 'email', 'copy', 'post'))
    return "Happy to draft it. Give me the audience, the one thing they should do after reading, and the tone — and I'll write a first version you can trim.";
  if (has('code', 'bug', 'function', 'python', 'javascript', 'typescript', 'error'))
    return "Share the snippet and what you expected vs. what happened. I'll read it, explain the likely cause, and give you a corrected version.";
  if (has('summar', 'tl;dr', 'shorten'))
    return "Paste the text and I'll return a tight summary: the core claim, the 3 supporting points, and the one thing to remember.";
  if (has('thank'))
    return "Anytime. Bring me the next messy middle whenever you're ready.";
  if (t.endsWith('?'))
    return `Good question. Here's how I'd approach "${input.trim()}": start from what a great answer looks like, work backward to the facts you'd need, then close the gaps one at a time. Want me to go deeper on any part?`;
  return `Got it — "${input.trim()}". I read that as a task to move forward. The clearest next step is to name the outcome you want, then I'll break it into the two or three moves that get you there. What does "done" look like?`;
}

$('#agent-form')?.addEventListener('submit', e => {
  e.preventDefault();
  const input = $('#agent-input');
  const text = input.value.trim();
  if (!text) return;
  addMsg('user', text);
  input.value = '';
  const typing = addMsg('ai', 'Pale Diamond is thinking…');
  typing.classList.add('typing');
  setTimeout(() => {
    typing.remove();
    addMsg('ai', agentReply(text));
    const user = currentUser();
    if (user) { const a = accounts(); a[user.email].credits = (a[user.email].credits || 0) + 1; saveAccounts(a); }
  }, 650 + Math.random() * 500);
});

/* ============ AD BOXES (Red-Bottom $340/mo · Blue $400/mo) ============ */
const HOUSE_ADS = {
  redbottom: [
    { advertiser: 'Aperture Studio', headline: 'Objects for focus', body: 'Desk tools made for long, quiet work.', cta: 'See the range', href: '#plans' },
    { advertiser: 'Cold Harbour', headline: 'Coffee, measured', body: 'Single-origin subscriptions, ground to order.', cta: 'Start a box', href: '#plans' },
  ],
  blue: [
    { advertiser: 'Northbound', headline: 'Ship on Fridays', body: 'Project tracking that stays out of the way.', cta: 'Try it free', href: '#plans' },
    { advertiser: 'Verra Type', headline: 'Typefaces with a point', body: 'Editorial families for teams that care.', cta: 'Browse fonts', href: '#plans' },
  ],
};
(function mountAds() {
  const cfg = (window.PD_CONFIG && window.PD_CONFIG.ads) || {};
  const liveClient = !!cfg.adsenseClient && /^ca-pub-[0-9]{10,}/.test(cfg.adsenseClient);
  const dismissed = store.get('pd_ads_dismissed', []);
  const timers = [];
  function houseCreative(slot, host, i) {
    const ad = HOUSE_ADS[slot][i % HOUSE_ADS[slot].length];
    host.innerHTML = `<div class="ad-house"><span class="ad-advertiser">${ad.advertiser}</span><strong>${ad.headline}</strong><p>${ad.body}</p><a href="${ad.href}">${ad.cta} ↗</a><em>HOUSE CREATIVE — YOUR AD LIVES HERE</em></div>`;
  }
  function googleSlot(slot, host) {
    host.innerHTML = '';
    const ins = document.createElement('ins');
    ins.className = 'adsbygoogle';
    ins.style.display = 'block';
    ins.setAttribute('data-ad-client', cfg.adsenseClient);
    ins.setAttribute('data-ad-slot', (cfg.adsenseSlots || {})[slot] || '');
    ins.setAttribute('data-ad-format', 'auto');
    ins.setAttribute('data-full-width-responsive', 'true');
    host.appendChild(ins);
    (window.adsbygoogle = window.adsbygoogle || []).push({});
  }
  $$('[data-ad-slot]').forEach(viewport => {
    const slot = viewport.dataset.adSlot;
    const box = viewport.closest('.ad-box');
    if (dismissed.includes(slot)) { box.classList.add('ad-dismissed'); return; }
    if (liveClient) { googleSlot(slot, viewport); return; }
    let i = 0;
    houseCreative(slot, viewport, i);
    timers.push(setInterval(() => {
      i++;
      viewport.classList.add('is-swapping');
      setTimeout(() => { houseCreative(slot, viewport, i); viewport.classList.remove('is-swapping'); }, 340);
    }, 9000));
  });
  $$('[data-ad-dismiss]').forEach(b => b.addEventListener('click', () => {
    const slot = b.dataset.adDismiss;
    const d = store.get('pd_ads_dismissed', []);
    if (!d.includes(slot)) { d.push(slot); store.set('pd_ads_dismissed', d); }
    b.closest('.ad-box').classList.add('ad-dismissed');
    showToast('Ad dismissed. Your attention stays yours.');
  }));
})();

/* ---------- ad request modal ---------- */
$$('[data-open-ads-info]').forEach(b => b.addEventListener('click', () => openModal('#ads-info-modal')));
$('#ads-request-form')?.addEventListener('submit', e => {
  e.preventDefault();
  const data = new FormData(e.target);
  const subject = encodeURIComponent(`Ad slot request — ${data.get('box')}`);
  const body = encodeURIComponent(`Name: ${data.get('name')}\nEmail: ${data.get('email')}\nBox: ${data.get('box')}\nNetwork: ${data.get('network')}\n`);
  window.location.href = `mailto:ads@palediamond.app?subject=${subject}&body=${body}`;
  closeModal($('#ads-info-modal'));
  showToast('Your email client is opening — send the request to confirm your slot.');
});
$('.menu-button')?.addEventListener('click', () => {
  const nav = $('.main-nav');
  const open = nav.style.display === 'flex';
  if (open) { nav.removeAttribute('style'); }
  else { Object.assign(nav.style, { display: 'flex', position: 'absolute', top: '72px', left: '0', right: '0', padding: '22px 24px', background: 'var(--panel)', flexDirection: 'column', gap: '18px', zIndex: '20' }); }
});
$$('.main-nav a').forEach(a => a.addEventListener('click', () => { const n = $('.main-nav'); if (window.innerWidth <= 900) n.removeAttribute('style'); }));

refreshAuthUI();
