// Redirect to offline.html immediately when the app detects no connectivity
(function () {
  try {
    var path = window.location.pathname || '';
    var isOfflinePage = /\/offline\.html$/.test(path);
    var isOutagePage = /\/outage\.html$/.test(path);

    function storeLastPath() {
      try { sessionStorage.setItem('last_path', window.location.href); } catch (_) {}
    }

    function redirectTo(url) {
      storeLastPath();
      window.location.replace(url);
    }

    function redirectIfOffline() {
      if (!navigator.onLine && !isOfflinePage) {
        redirectTo('/offline.html');
      }
    }

    function pingWithTimeout() {
      var controller = new AbortController();
      var t = setTimeout(function(){ try { controller.abort(); } catch(_){} }, 2000);
      return fetch('/api/ping', { cache: 'no-store', signal: controller.signal })
        .finally(function(){ clearTimeout(t); });
    }

    function redirectIfOutage() {
      if (isOfflinePage || isOutagePage) return;
      if (navigator.onLine) {
        pingWithTimeout().then(function(res){
          if (!res || !res.ok || (res.status >= 500)) {
            redirectTo('/outage.html');
          }
        }).catch(function(){
          redirectTo('/outage.html');
        });
      }
    }

    redirectIfOffline();
    redirectIfOutage();
    window.addEventListener('offline', redirectIfOffline);
    window.addEventListener('online', function(){ if (isOfflinePage || isOutagePage) { var last = null; try { last = sessionStorage.getItem('last_path'); } catch(_){} window.location.href = last || '/'; } });
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.addEventListener) {
        navigator.serviceWorker.addEventListener('message', function(e){
          if (e && e.data && e.data.type === 'OUTAGE' && !isOutagePage) {
            redirectTo('/outage.html');
          }
        });
      }
    } catch (_) {}
  } catch (e) {}
})();