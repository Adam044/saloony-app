// Lightweight helper for hybrid app/browser modes
// Detect install state and persist user choice
(function () {
  const KEY_CHOICE = 'app_mode_choice'; // 'browser' | 'app'
  const KEY_REMINDER = 'app_install_reminder_last';
  const REMINDER_INTERVAL_MS = 72 * 60 * 60 * 1000; // 72 hours

  function isStandalone() {
    try {
      return (
        window.matchMedia && window.matchMedia('(display-mode: standalone)').matches
      ) || Boolean(window.navigator.standalone);
    } catch (_) { return false; }
  }

  function getUserModeChoice() {
    try { return localStorage.getItem(KEY_CHOICE); } catch (_) { return null; }
  }

  function setUserModeChoice(choice) {
    try { localStorage.setItem(KEY_CHOICE, choice); } catch (_) {}
  }

  function shouldShowInstallReminder() {
    try {
      const last = parseInt(localStorage.getItem(KEY_REMINDER) || '0', 10);
      const now = Date.now();
      return !isStandalone() && (now - last) > REMINDER_INTERVAL_MS;
    } catch (_) { return false; }
  }

  function markReminderShown() {
    try { localStorage.setItem(KEY_REMINDER, String(Date.now())); } catch (_) {}
  }

  // Capture beforeinstallprompt for controlled install prompting
  let deferredInstallPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    window.__canInstallApp = true;
    window.dispatchEvent(new CustomEvent('can-install-app'));
  });

  async function promptInstall() {
    if (deferredInstallPrompt) {
      try {
        const choice = await deferredInstallPrompt.prompt();
        const outcome = choice && choice.outcome;
        if (outcome === 'accepted') setUserModeChoice('app');
      } catch (_) {}
    } else {
      // Fallback: open instructions asset/page if available
      window.location.href = '/index.html';
    }
  }

  function ensureStyles() {
    if (document.getElementById('app-mode-animations')) return;
    var css = '' +
      'body.page-fade-in{opacity:1;transition:opacity .25s ease-out}'+
      'body.page-fade-out{opacity:0;transition:opacity .25s ease-in}'+
      '#global-loading-overlay{position:fixed;inset:0;background:rgba(255,255,255,.92);backdrop-filter:blur(2px);display:none;align-items:center;justify-content:center;z-index:999999}'+
      '#global-loading-overlay.show{display:flex}'+
      '#global-loading-overlay .spinner{width:40px;height:40px;border:4px solid #06C167;border-right-color:transparent;border-radius:9999px;animation:appmode-spin .8s linear infinite}'+
      '@keyframes appmode-spin{to{transform:rotate(360deg)}}';
    var style = document.createElement('style');
    style.id = 'app-mode-animations';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function ensureOverlay() {
    var el = document.getElementById('global-loading-overlay');
    if (el) return el;
    var wrap = document.createElement('div');
    wrap.id = 'global-loading-overlay';
    var inner = document.createElement('div');
    inner.style.textAlign = 'center';
    var spinner = document.createElement('div');
    spinner.className = 'spinner';
    wrap.appendChild(inner);
    inner.appendChild(spinner);
    document.body.appendChild(wrap);
    return wrap;
  }

  function applyPageEnter() {
    document.body.classList.remove('page-fade-out');
    document.body.classList.add('page-fade-in');
  }

  function showLoading() {
    ensureStyles();
    var overlay = ensureOverlay();
    overlay.classList.add('show');
  }

  function hideLoading() {
    var overlay = document.getElementById('global-loading-overlay');
    if (overlay) overlay.classList.remove('show');
  }

  function transitionTo(url, opts) {
    var delay = (opts && opts.delay) || 200;
    ensureStyles();
    showLoading();
    document.body.classList.add('page-fade-out');
    setTimeout(function(){ window.location.href = url; }, delay);
  }

  function transitionBack(opts) {
    var delay = (opts && opts.delay) || 200;
    ensureStyles();
    showLoading();
    document.body.classList.add('page-fade-out');
    setTimeout(function(){ window.history.back(); }, delay);
  }

  function bindGlobalLoading() {
    document.addEventListener('click', function(e){
      var a = e.target && e.target.closest ? e.target.closest('a') : null;
      if (!a) return;
      var href = a.getAttribute('href') || '';
      if (!href) return;
      if (href[0] === '#') return;
      if (a.hasAttribute('download')) return;
      if (a.target && a.target.toLowerCase() === '_blank') return;
      var url = null;
      try { url = new URL(href, window.location.href); } catch (_) {}
      if (url && url.origin !== window.location.origin) return;
      showLoading();
      document.body.classList.add('page-fade-out');
    }, true);
    document.addEventListener('submit', function(){ showLoading(); document.body.classList.add('page-fade-out'); }, true);
    window.addEventListener('beforeunload', function(){ showLoading(); });
  }

  window.AppMode = {
    isStandalone,
    getUserModeChoice,
    setUserModeChoice,
    shouldShowInstallReminder,
    markReminderShown,
    promptInstall,
    ensureStyles,
    applyPageEnter,
    showLoading,
    hideLoading,
    transitionTo,
    transitionBack,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){ ensureStyles(); applyPageEnter(); bindGlobalLoading(); });
  } else {
    ensureStyles(); applyPageEnter(); bindGlobalLoading();
  }
})();