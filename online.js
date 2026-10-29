/* Live "online now" counter.
   Paste your Firebase Realtime Database address between the quotes below (see the setup steps Claude gave you).
   While it is empty, the counter stays hidden and nothing is sent anywhere.
   Example: var DB_URL = 'https://my-site-default-rtdb.firebaseio.com'; */
var DB_URL = 'https://gulshan-portfolio-95d07-default-rtdb.asia-southeast1.firebasedatabase.app/';

(function () {
  if (!DB_URL) return;
  var base = DB_URL.replace(/\/+$/, '');
  var el = document.getElementById('onlineCount'); if (!el) return;
  var num = el.querySelector('b'), STALE = 45000, BEAT = 20000, POLL = 15000;
  var id; try { id = sessionStorage.getItem('vid'); } catch (e) {}
  if (!id) { id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36); try { sessionStorage.setItem('vid', id); } catch (e) {} }
  var mine = base + '/presence/' + id + '.json';
  function beat() { return fetch(mine, { method: 'PUT', body: '{".sv":"timestamp"}' }); }
  function count() {
    return fetch(base + '/presence.json').then(function (r) { return r.json(); }).then(function (d) {
      d = d || {}; var ids = Object.keys(d), newest = 0;
      ids.forEach(function (k) { if (typeof d[k] === 'number' && d[k] > newest) newest = d[k]; });   /* our own beat was just written, so the newest time is "now" on the server */
      var live = 0;
      ids.forEach(function (k) {
        if (newest - d[k] <= STALE) live++;
        else if (newest - d[k] > 120000) fetch(base + '/presence/' + k + '.json', { method: 'DELETE' }).catch(function () {});
      });
      if (live < 1) live = 1;
      num.textContent = live; el.hidden = false;
    });
  }
  function tick() { if (document.hidden) return; beat().then(count).catch(function () {}); }
  tick(); setInterval(tick, POLL);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); });
  window.addEventListener('pagehide', function () { try { fetch(mine, { method: 'DELETE', keepalive: true }); } catch (e) {} });
})();
