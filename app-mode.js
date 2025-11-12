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

  // Expose minimal API
  window.AppMode = {
    isStandalone,
    getUserModeChoice,
    setUserModeChoice,
    shouldShowInstallReminder,
    markReminderShown,
    promptInstall,
  };
})();