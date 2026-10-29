/* Counts you as "online" for the admin page. Nothing is shown to visitors.
   The database address is read from online.js (DB_URL), so there is nothing to edit here. */
(function () {
  var base = (typeof DB_URL === 'string' ? DB_URL : '').replace(/\/+$/, '');
  if (!base) return;
  var BEAT = 20000, id;
  try { id = sessionStorage.getItem('vid'); } catch (e) {}
  if (!id) { id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36); try { sessionStorage.setItem('vid', id); } catch (e) {} }
  var mine = base + '/presence/' + id + '.json';
  function beat() { if (!document.hidden) fetch(mine, { method: 'PUT', body: '{".sv":"timestamp"}' }).catch(function () {}); }
  beat(); setInterval(beat, BEAT);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) beat(); });
  window.addEventListener('pagehide', function () { try { fetch(mine, { method: 'DELETE', keepalive: true }); } catch (e) {} });
})();
