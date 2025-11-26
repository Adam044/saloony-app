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

    const headerHTML = `
      <header id="admin-shared-header" class="bg-primary-dark shadow-lg p-2 flex justify-between items-center w-full z-20 fixed top-0" style="padding-top: env(safe-area-inset-top)">
        <div class="flex items-center pl-8 pr-4">
          <img src="/images/Saloony_logo.png" onerror="this.onerror=null;this.src='https://placehold.co/48x48/1E293B/ffffff?text=ADM';" alt="Saloony Admin" class="h-10 w-auto object-contain object-center">
        </div>
        <h1 class="text-xl font-bold text-white">لوحة الإدارة</h1>
        <button id="admin-logout" class="text-white/80 hover:text-red-400 transition duration-150 p-2 rounded-lg hover:bg-white/10">
          <i class="fas fa-sign-out-alt text-lg"></i>
        </button>
      </header>`;

    const navHTML = `
      <nav class="top-nav">
        <a class="nav-link" href="/admin/admin_dashboard.html"><i class="fas fa-tachometer-alt"></i><span>الرئيسية</span></a>
        <a class="nav-link" href="/admin/renewals.html"><i class="fas fa-receipt"></i><span>التجديدات</span></a>
        <a class="nav-link" href="/admin/users.html"><i class="fas fa-users"></i><span>المستخدمون</span></a>
        <a class="nav-link" href="/admin/saloony_employees.html"><i class="fas fa-id-badge"></i><span>الموظفون</span></a>
      </nav>`;

    const existingHeader = document.querySelector('body > header');
    if (existingHeader) {
      existingHeader.outerHTML = headerHTML;
    } else {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = headerHTML;
      document.body.prepend(wrapper.firstElementChild);
    }

    document.querySelectorAll('nav.top-nav').forEach(n => n.remove());
    const navWrapper = document.createElement('div');
    navWrapper.innerHTML = navHTML;
    const headerEl = document.getElementById('admin-shared-header');
    headerEl.parentNode.insertBefore(navWrapper.firstElementChild, headerEl.nextSibling);

    const path = location.pathname;
    const hash = location.hash || '';
    document.querySelectorAll('nav.top-nav a[href]').forEach(a => {
      const href = a.getAttribute('href') || '';
      const url = new URL(href, location.origin);
      const samePath = url.pathname === path;
      const hashMatch = hash && url.hash === hash;
      if ((samePath && !url.hash) || hashMatch) a.classList.add('nav-active');
    });

    const logoutBtn = document.getElementById('admin-logout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        try { localStorage.removeItem('adminToken'); } catch (_) {}
        location.href = '/auth.html';
      });
    }
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
