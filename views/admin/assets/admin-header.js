(() => {
  // Keep script minimal: preserve existing header/nav and add small enhancements

  function ensureAuth() {
    try {
      const token = localStorage.getItem('adminToken');
      if (!token) location.replace('/auth.html');
    } catch (_) {}
  }

  function mountHeader() {
    // Non-destructive: keep any existing header and top nav
    // Add a theme flag so shared CSS applies
    document.body.classList.add('admin-theme');

    // Highlight current link in existing top nav if present
    const path = location.pathname;
    const navLinks = document.querySelectorAll('nav.top-nav a[href]');
    navLinks.forEach(a => {
      try {
        const href = a.getAttribute('href');
        if (href && (href === path || href.endsWith(path.split('/').pop() || ''))) {
          a.classList.add('nav-active');
        }
      } catch (_) {}
    });

    // Hook existing logout button if present (supports multiple ids)
    const logoutBtn = document.getElementById('admin-logout') || document.getElementById('logout-btn');
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
  });
})();