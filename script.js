(function () {
  var root = document.documentElement;
  var page = document.body.getAttribute('data-page');
  var all = window.ALL_PROJECTS || [];

  /* Which scroll direction hides the top bar on project pages: 'down' or 'up' */
  var HIDE_NAV_ON_SCROLL = 'down';

  function byId(id) { return all.filter(function (p) { return p.id === id; })[0]; }
  function isVideo(src) { return /\.(mp4|webm|mov)$/i.test(src || ''); }
  function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : s; return d.innerHTML; }
  function media(src, label, poster) {
    if (!src) return '';
    if (isVideo(src)) return '<video src="' + src + '"' + (poster ? ' poster="' + poster + '"' : '') + ' muted loop playsinline preload="metadata" aria-label="' + esc(label) + '"></video>';
    return '<img src="' + src + '" alt="' + esc(label) + '" loading="lazy">';
  }
  function tagList(t) {
    return String(t || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean)
      .map(function (s) { return '<span class="tag tag--type">' + esc(s) + '</span>'; }).join('');
  }
  function tcell(c) {
    var s = c.size || 20;
    return '<p class="' + (s >= 30 ? 't-h' : 't-b') + '" style="--s:' + s + ';--w:' + (c.weight || 400) + '">' + esc(c.text) + '</p>';
  }
  function sidecell(c) {
    if (!c || !c.kind) return '<div></div>';
    if (c.kind === 'media') return '<div class="blk__media">' + media(c.src, '') + '</div>';
    return '<div class="side__text">' + tcell(c) + '</div>';
  }
  function style(size, weight, dsize, dweight) {
    return ' style="--s:' + (size || dsize) + ';--w:' + (weight || dweight) + '"';
  }

  /* ---- Dark / light toggle ---- */
  var btn = document.getElementById('themeToggle');
  function sync() { btn.setAttribute('aria-checked', root.getAttribute('data-theme') === 'dark'); }
  btn.addEventListener('click', function () {
    var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('theme', next); } catch (e) {}
    sync();
  });
  sync();

  /* ---- Home / Work: project cards (each opens its project page) ---- */
  if (page === 'home' || page === 'work') {
    var list = all;
    if (page === 'home') {
      list = all.filter(function (p) { return p.pinned; });
    }
    var work = document.getElementById('work');
    list.forEach(function (p) {
      var card = document.createElement('a');
      card.className = 'card';
      card.href = 'project.html?id=' + encodeURIComponent(p.id);
      card.innerHTML = media(p.cover, p.title + ' ' + p.type + ' cover', p.poster) +
        '<div class="card__tags"><span class="tag tag--name">' + esc(p.title) + '</span>' + tagList(p.type) + '</div>' +
        (p.conceptual ? '<span class="card__conceptual tag tag--concept">Conceptual work</span>' : '');
      work.appendChild(card);
    });
  }

  /* ---- Project page ---- */
  if (page === 'project') {
    var id = new URLSearchParams(location.search).get('id');
    var p = byId(id);
    var cover = document.getElementById('pcover');
    var blocks = document.getElementById('blocks');
    if (!p) {
      cover.style.display = 'none';
      blocks.innerHTML = '<p class="notfound">That project could not be found. <a href="work.html">See all work</a></p>';
    } else {
      document.title = p.title + ' – Gulshan Singh';
      cover.innerHTML = media(p.cover, p.title + ' cover', p.poster);
      blocks.innerHTML = (p.blocks || []).map(function (b) {
        var m = '<div class="blk__media">' + media(b.media, p.title, b.poster) + '</div>';
        if (b.type === 'text1') {
          return '<div class="blk blk--text"><p class="t-b"' + style(b.size, b.weight, 20, 400) + '>' + esc(b.text) + '</p></div>';
        }
        if (b.type === 'embed') {
          return '<div class="blk blk--embed"><div class="blk__media"><iframe src="' + esc(b.src) + '" loading="lazy" allowfullscreen title="Embedded content"></iframe></div></div>';
        }
        if (b.type === 'text2' && b.left) {
          return '<div class="blk blk--text blk--text2">' + tcell(b.left) + tcell(b.right) + '</div>';
        }
        if (b.type === 'side' && b.left) {
          return '<div class="blk blk--side">' + sidecell(b.left) + sidecell(b.right) + '</div>';
        }
        if (b.type === 'text2') {
          return '<div class="blk blk--text blk--text2"><h2 class="t-h"' + style(b.headingSize, b.headingWeight, 40, 400) + '>' + esc(b.heading) + '</h2>' +
                 '<p class="t-b"' + style(b.bodySize, b.bodyWeight, 20, 400) + '>' + esc(b.body) + '</p></div>';
        }
        if (b.type === 'side') {
          return '<div class="blk blk--side' + (b.side === 'right' ? ' is-right' : '') + '">' + m + '<div class="side__text">' +
                 (b.heading ? '<h2 class="t-h"' + style(b.headingSize, b.headingWeight, 40, 400) + '>' + esc(b.heading) + '</h2>' : '') +
                 '<p class="t-b"' + style(b.bodySize, b.bodyWeight, 20, 400) + '>' + esc(b.body) + '</p></div></div>';
        }
        return '<div class="blk blk--slide">' + m + '</div>';   /* default: "slide" */
      }).join('');
    }

  }

  /* ---- Top bar: hides/reappears on scroll, on every page ---- */
  var nav = document.querySelector('.nav'), lastY = window.scrollY;
  var coverEl = document.getElementById('pcover');
  function setNavH() { root.style.setProperty('--nav-h', nav.offsetHeight + 'px'); }
  function onScroll() {
    var y = window.scrollY;
    nav.classList.toggle('is-solid', page === 'project' && coverEl ? y > coverEl.offsetHeight - nav.offsetHeight : y > 4);
    if (Math.abs(y - lastY) > 6) {
      var down = y > lastY;
      nav.classList.toggle('is-hidden', y > 80 && (HIDE_NAV_ON_SCROLL === 'down' ? down : !down));
      lastY = y;
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', setNavH);
  setNavH(); onScroll();

  /* ---- Smooth scrolling (Lenis) ---- */
  var lenis = null;
  if (window.Lenis && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    lenis = new Lenis({ lerp: 0.08, smoothWheel: true });
    (function raf(t) { lenis.raf(t); requestAnimationFrame(raf); })(0);
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[href^="#"]');
      if (!a) return;
      var t = a.getAttribute('href') === '#top' ? 0 : document.querySelector(a.getAttribute('href'));
      if (t !== null) { e.preventDefault(); lenis.scrollTo(t, { duration: 1.4 }); }
    });
  }

  /* ---- Hero TV: Safari/iPhone can't show transparent WebM, so give them the HEVC-with-alpha .mov ---- */
  var tv = document.querySelector('video.hero__tv');
  var ua = navigator.userAgent;
  var isWebKit = /iPad|iPhone|iPod/.test(ua) || (/Safari/.test(ua) && !/Chrome|Chromium|Edg|OPR|Android|Firefox/.test(ua));
  if (tv && isWebKit) {
    while (tv.firstChild) tv.removeChild(tv.firstChild);
    tv.src = 'images/tv.mov';
    tv.load();
  }

  /* ---- Play looping videos only while on screen ---- */
  var vids = document.querySelectorAll('video');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.play().catch(function () {}); } else { e.target.pause(); } });
    }, { threshold: 0.25 });
    vids.forEach(function (v) { io.observe(v); });
  } else { vids.forEach(function (v) { v.autoplay = true; v.play().catch(function () {}); }); }

  /* ---- Make big text exactly fill the page width ---- */
  function fit(el) {
    if (!el) return;
    var span = el.firstElementChild;
    el.style.fontSize = '100px';
    el.style.fontSize = (100 * el.clientWidth / span.getBoundingClientRect().width) + 'px';
  }
  function fitAll() { fit(document.getElementById('heroName')); fit(document.getElementById('bigText')); }
  fitAll();
  window.addEventListener('resize', fitAll);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { fitAll(); setNavH(); });
})();
