// Redirect to offline.html immediately when the app detects no connectivity
(function () {
  try {
    var path = window.location.pathname || '';
    var isOfflinePage = /\/offline\.html$/.test(path);

    function redirectIfOffline() {
      if (!navigator.onLine && !isOfflinePage) {
        window.location.replace('/offline.html');
      }
    }

    // Initial check at load
    redirectIfOffline();
    // Redirect if connection drops
    window.addEventListener('offline', redirectIfOffline);
  } catch (e) {
    // no-op
  }
})();