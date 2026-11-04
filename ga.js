/* Google Analytics (GA4): shows where visitors come from, which pages and projects they open, and trends over time.
   Paste your Measurement ID (it starts with G-) between the quotes. While it is empty, nothing is loaded.
   Example: var GA_ID = 'G-ABC123DEF4'; */
var GA_ID = '';

(function () {
  if (!GA_ID) return;
  try { if (localStorage.getItem('noTrack')) return; } catch (e) {}   /* your own visits (after logging in to /admin/ once on this browser) are skipped */
  var s = document.createElement('script'); s.async = true; s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA_ID);
  document.head.appendChild(s);
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  gtag('js', new Date()); gtag('config', GA_ID);
})();
