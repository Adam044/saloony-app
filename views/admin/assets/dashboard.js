// Shared dashboard utilities
(function() {
  const path = (window.location.pathname || '').toLowerCase();
  const map = {
    '/admin/admin_dashboard.html': 'nav-dashboard',
    '/admin/payments.html': 'nav-payments',
    '/admin/progress.html': 'nav-progress',
    '/admin/users.html': 'nav-users',
    '/admin/renewals.html': 'nav-renewals',
    '/admin/ai_analytics.html': 'nav-analytics',
    '/ai-analytics': 'nav-analytics' // in case of server route without extension
  };

  function setActiveNav() {
    const activeId = Object.keys(map).find(k => path.endsWith(k));
    if (!activeId) return;
    const id = map[activeId];
    document.querySelectorAll('.top-nav .nav-link').forEach(el => {
      el.classList.toggle('active', el.id === id);
    });
  }

  // Allow collapsing/expanding sections if needed
  function initSectionToggles() {
    document.querySelectorAll('[data-collapse-target]').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = document.getElementById(btn.getAttribute('data-collapse-target'));
        if (target) target.classList.toggle('hidden');
      });
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    setActiveNav();
    initSectionToggles();
  });
})();