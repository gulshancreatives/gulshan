/* Microsoft Clarity for the Koto landing page: recordings and heatmaps of how this page is read.
   Separate Clarity project, only for this page. No pop-up. */
var CLARITY_ID = 'z8ehckvkve';

(function () {
  if (!CLARITY_ID) return;
  try { if (localStorage.getItem('noTrack')) return; } catch (e) {}   /* your own visits (after logging in to /admin/ once on this browser) are skipped */
  (function (c, l, a, r, i, t, y) {
    c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments); };
    t = l.createElement(r); t.async = 1; t.src = 'https://www.clarity.ms/tag/' + i;
    y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y);
  })(window, document, 'clarity', 'script', CLARITY_ID);
})();
