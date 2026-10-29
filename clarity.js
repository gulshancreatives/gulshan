/* Microsoft Clarity: shows you recordings and heatmaps of how visitors use the site (only you can see them, in your Clarity account).
   Paste your Clarity project ID between the quotes. While it is empty, nothing is loaded.
   Example: var CLARITY_ID = 'abc123xyz9'; */
var CLARITY_ID = '';

(function () {
  if (!CLARITY_ID) return;
  try { if (localStorage.getItem('noTrack')) return; } catch (e) {}   /* your own visits (after logging in to /admin/ once on this browser) are skipped */
  (function (c, l, a, r, i, t, y) {
    c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments); };
    t = l.createElement(r); t.async = 1; t.src = 'https://www.clarity.ms/tag/' + i;
    y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y);
  })(window, document, 'clarity', 'script', CLARITY_ID);
})();
