// common.js - shared utilities, language & theme state

// --- Fetch wrapper ---
window.api = async function api(path, options = {}) {
  const opts = {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  };
  if (opts.body && typeof opts.body !== 'string') opts.body = JSON.stringify(opts.body);
  const res = await fetch(path, opts);
  if (res.status === 401) {
    if (location.pathname !== '/' && location.pathname !== '/login') location.href = '/';
    throw new Error('Not authenticated');
  }
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    const msg = typeof data === 'object' && data.error ? data.error : 'Request failed';
    throw new Error(msg);
  }
  return data;
};

window.logout = async function logout() {
  try { await window.api('/api/auth/logout', { method: 'POST' }); } catch {}
  location.href = '/';
};

// --- Language state ---
function readLang() {
  const stored = localStorage.getItem('hj_lang');
  if (stored === 'en' || stored === 'es') return stored;
  const nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
  return nav === 'es' ? 'es' : 'en';
}
window.currentLang = readLang();
window.setLang = function setLang(l) {
  window.currentLang = l;
  localStorage.setItem('hj_lang', l);
  document.documentElement.lang = l;
  window.dispatchEvent(new Event('hj-lang-change'));
};

// --- Theme state ---
function readTheme() {
  const stored = localStorage.getItem('hj_theme');
  if (stored === 'light' || stored === 'dark' || stored === 'auto') return stored;
  return 'auto';
}
function applyTheme(mode) {
  const root = document.documentElement;
  let effective = mode;
  if (mode === 'auto') {
    effective = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  root.setAttribute('data-theme', effective);
}
window.currentTheme = readTheme();
applyTheme(window.currentTheme);
window.setTheme = function setTheme(mode) {
  window.currentTheme = mode;
  localStorage.setItem('hj_theme', mode);
  applyTheme(mode);
  window.dispatchEvent(new Event('hj-theme-change'));
};
// Watch OS theme changes if in auto
if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (window.currentTheme === 'auto') applyTheme('auto');
  });
}

// --- UI helpers ---
window.showAlert = function showAlert(container, msg, type = 'error') {
  if (!container) return;
  const cls = type === 'error' ? 'alert-error' : type === 'success' ? 'alert-success' : 'alert-info';
  container.innerHTML = `<div class="alert ${cls}">${msg}</div>`;
  if (type === 'success') setTimeout(() => { container.innerHTML = ''; }, 2500);
};

window.fmt = function fmt(n, digits = 1) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Number(n).toFixed(digits);
};

window.escapeHtml = function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
};

// --- Top bar controls (language + theme menu) ---
window.renderTopControls = function renderTopControls(containerSelector = '#topControls') {
  const host = document.querySelector(containerSelector);
  if (!host) return;

  function html() {
    return `
      <button class="icon-btn" id="langBtn" title="${t('language')}">
        ${window.currentLang === 'en' ? '🇺🇸' : '🇲🇽'} ${window.currentLang.toUpperCase()}
      </button>
      <button class="icon-btn" id="themeBtn" title="${t('theme')}">
        ${window.currentTheme === 'dark' ? '🌙' : window.currentTheme === 'light' ? '☀️' : '🌓'}
      </button>
    `;
  }

  function wire() {
    host.innerHTML = html();
    host.querySelector('#langBtn').addEventListener('click', () => {
      window.setLang(window.currentLang === 'en' ? 'es' : 'en');
    });
    host.querySelector('#themeBtn').addEventListener('click', () => {
      const order = ['auto', 'light', 'dark'];
      const next = order[(order.indexOf(window.currentTheme) + 1) % order.length];
      window.setTheme(next);
    });
  }

  wire();
  window.addEventListener('hj-lang-change', wire);
  window.addEventListener('hj-theme-change', wire);
};

document.documentElement.lang = window.currentLang;
