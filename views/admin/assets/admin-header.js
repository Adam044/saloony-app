(() => {
  // Keep script minimal: preserve existing header/nav and add small enhancements

  function ensureAuth() {
    try {
      const token = localStorage.getItem('adminToken');
      const secondsLeft = tokenSecondsLeft(token);
      if (!token || secondsLeft <= 60) {
        attemptRefresh().then((newToken) => {
          if (!newToken) location.replace('/auth.html');
        }).catch(() => location.replace('/auth.html'));
      }
    } catch (_) {}
  }

  function mountHeader() {
    document.body.classList.add('admin-theme');
    const logoutBtn = document.getElementById('admin-logout') || document.getElementById('logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        try { localStorage.removeItem('adminToken'); } catch (_) {}
        location.href = '/auth.html';
      });
    }
    document.querySelectorAll('nav.top-nav').forEach(n => n.remove());
  }

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  ready(() => {
    ensureAuth();
    mountHeader();
    scheduleTokenRefresh();
  });
  function parseJwt(token) {
    try {
      const base64Url = (token || '').split('.')[1];
      const base64 = (base64Url || '').replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(atob(base64).split('').map(function (c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join(''));
      return JSON.parse(jsonPayload);
    } catch (_) { return null; }
  }
  function tokenSecondsLeft(token) {
    const payload = parseJwt(token || '');
    if (!payload || !payload.exp) return 0;
    return Math.floor(payload.exp - (Date.now() / 1000));
  }
  async function attemptRefresh() {
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({})
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (data && data.access_token) {
        localStorage.setItem('adminToken', data.access_token);
        return data.access_token;
      }
      return null;
    } catch (_) { return null; }
  }
  function scheduleTokenRefresh() {
    const intervalMs = 60000;
    setInterval(async () => {
      try {
        const t = localStorage.getItem('adminToken');
        if (!t) return;
        const left = tokenSecondsLeft(t);
        if (left <= 120) { await attemptRefresh(); }
      } catch (_) {}
    }, intervalMs);
  }
})();
