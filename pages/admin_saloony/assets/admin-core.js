(() => {
  // --- Auth Logic ---
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

  // --- Layout Logic ---
  const loadScript = (src) => {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) return resolve();
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  };

  const applyLayout = () => {
    // 1. Remove old navigations
    const oldNavs = document.querySelectorAll('#bottom-nav, .bottom-nav, nav.fixed.bottom-0');
    oldNavs.forEach(n => n.remove());

    // 2. Wrap content if not already wrapped or if needed
    // We check if main already exists to avoid double wrapping if script runs twice
    if (document.querySelector('main.admin-main-wrapper')) return;

    const mainContent = document.createElement('main');
    mainContent.className = 'admin-main-wrapper p-4 md:ml-72 pt-8 transition-all duration-300 min-h-screen'; 

    // Move body children to mainContent (careful not to move scripts that are supposed to be in body)
    // A safer strategy is to move everything except the new sidebar/topbar containers we are about to create
    const bodyChildren = Array.from(document.body.childNodes);
    bodyChildren.forEach(child => {
        mainContent.appendChild(child);
    });

    // 3. Render Components
    const sidebarHTML = window.Sidebar ? window.Sidebar.render() : '';
    const topbarHTML = window.TopBar ? window.TopBar.render() : '';

    // Inject Sidebar
    const sidebarContainer = document.createElement('div');
    sidebarContainer.innerHTML = sidebarHTML;
    while (sidebarContainer.firstChild) {
        document.body.appendChild(sidebarContainer.firstChild);
    }

    // Inject TopBar
    const topbarContainer = document.createElement('div');
    topbarContainer.innerHTML = topbarHTML;
    while (topbarContainer.firstChild) {
        document.body.appendChild(topbarContainer.firstChild);
    }

    // Inject Main Content
    document.body.appendChild(mainContent);

    // 4. Setup Global Toggle
    window.toggleSidebar = () => {
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        
        if (sidebar && overlay) {
            if (sidebar.classList.contains('-translate-x-full')) {
                // Open (Slide in from left)
                sidebar.classList.remove('-translate-x-full');
                sidebar.classList.add('translate-x-0');
                overlay.classList.remove('hidden');
            } else {
                // Close (Slide out to left)
                sidebar.classList.add('-translate-x-full');
                sidebar.classList.remove('translate-x-0');
                overlay.classList.add('hidden');
            }
        }
    };

    // 5. Logout Handler
    const setupLogout = () => {
        const logoutBtn = document.getElementById('admin-logout');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => {
                try { 
                    localStorage.removeItem('adminToken');
                    localStorage.removeItem('saloony_token');
                    localStorage.removeItem('saloony_user');
                    localStorage.removeItem('saloony_refresh_token');
                } catch (_) {}
                location.href = '/auth.html';
            });
        }
    };
    setupLogout();
  };

  const init = async () => {
    ensureAuth();
    scheduleTokenRefresh();

    // Dependencies
    const dependencies = [
        '/admin_saloony/components/Sidebar.js',
        '/admin_saloony/components/TopBar.js'
    ];

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', async () => {
            await Promise.all(dependencies.map(src => loadScript(src)));
            applyLayout();
        });
    } else {
        await Promise.all(dependencies.map(src => loadScript(src)));
        applyLayout();
    }
  };

  init();

})();
