(function () {
'use strict';
var $ = function (s, r) { return (r || document).querySelector(s); };
var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
var app = $('#app');
var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
var enc = new TextEncoder(), dec = new TextDecoder();
var VID = /\.(mp4|webm|mov|m4v)$/i;
var cfg = null, data = { live: [], drafts: [] }, dirty = false, pending = {}, ed = null, kc = 0;

/* ---------- helpers ---------- */
function b64(buf) { var u = new Uint8Array(buf), s = ''; for (var i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return btoa(s); }
function unb64(s) { return Uint8Array.from(atob(s), function (c) { return c.charCodeAt(0); }); }
function toast(msg, err) { var t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (err ? ' err' : ''); clearTimeout(toast.t); toast.t = setTimeout(function () { t.className = 'toast'; }, err ? 7000 : 3500); }
function busy(msg) { var b = $('#busy'); if (msg) { b.textContent = msg; b.hidden = false; } else b.hidden = true; }
function slug(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project'; }
function pad2(n) { return (n < 10 ? '0' : '') + n; }
function pick(accept, multi) { return new Promise(function (res) { var i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.multiple = !!multi; i.onchange = function () { res(Array.prototype.slice.call(i.files)); }; i.click(); }); }
function fit(el) { if (!el) return; var sp = el.firstElementChild; el.style.fontSize = '100px'; el.style.fontSize = (100 * el.clientWidth / sp.getBoundingClientRect().width) + 'px'; }
function fitAll() { fit($('.hero .nm')); }
window.addEventListener('resize', fitAll);
function rep(k, v) { return k.charAt(0) === '_' ? undefined : v; }

/* ---------- login vault: GitHub token locked with your ID + password ---------- */
function deriveKey(id, pw, salt) {
  return crypto.subtle.importKey('raw', enc.encode(id.trim().toLowerCase() + ':' + pw), 'PBKDF2', false, ['deriveKey']).then(function (m) {
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt, iterations: 250000, hash: 'SHA-256' }, m, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  });
}
function seal(id, pw, obj) {
  var salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  return deriveKey(id, pw, salt).then(function (k) { return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, k, enc.encode(JSON.stringify(obj))); })
    .then(function (ct) { localStorage.setItem('adminVault', JSON.stringify({ salt: b64(salt), iv: b64(iv), ct: b64(ct) })); });
}
function unseal(id, pw) {
  var v = JSON.parse(localStorage.getItem('adminVault'));
  return deriveKey(id, pw, unb64(v.salt)).then(function (k) { return crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(v.iv) }, k, unb64(v.ct)); })
    .then(function (pt) { return JSON.parse(dec.decode(pt)); });
}

/* ---------- GitHub API ---------- */
function gh(path, opt) {
  opt = opt || {};
  var h = { Authorization: 'Bearer ' + cfg.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (opt.body) h['Content-Type'] = 'application/json';
  return fetch('https://api.github.com/repos/' + cfg.owner + '/' + cfg.repo + path, Object.assign({ cache: 'no-store' }, opt, { headers: h })).then(function (r) {
    if (r.ok) return r.status === 204 ? null : r.json();
    return r.json().catch(function () { return {}; }).then(function (j) { throw new Error(r.status + ' ' + (j.message || r.statusText)); });
  });
}
function readFile(path) {
  return gh('/contents/' + path + '?ref=' + cfg.branch).then(function (f) { return dec.decode(unb64(f.content.replace(/\n/g, ''))); })
    .catch(function (e) { if (/^404/.test(e.message)) return ''; throw e; });
}
function parse(txt) { var w = {}; if (txt.trim()) new Function('window', txt)(w); return w; }
function blobB64(blob) { return new Promise(function (r) { var f = new FileReader(); f.onload = function () { r(f.result.split(',')[1]); }; f.readAsDataURL(blob); }); }
function commit(files, msg, progress) {
  var head, base;
  return gh('/git/ref/heads/' + cfg.branch).then(function (ref) { head = ref.object.sha; return gh('/git/commits/' + head); })
    .then(function (hc) {
      base = hc.tree.sha; var entries = [], p = Promise.resolve();
      files.forEach(function (f, i) {
        p = p.then(function () { if (progress) progress(i + 1, files.length); return f.blob ? blobB64(f.blob) : b64(enc.encode(f.text)); })
          .then(function (c) { return gh('/git/blobs', { method: 'POST', body: JSON.stringify({ content: c, encoding: 'base64' }) }); })
          .then(function (b) { entries.push({ path: f.path, mode: '100644', type: 'blob', sha: b.sha }); });
      });
      return p.then(function () { return gh('/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: base, tree: entries }) }); });
    })
    .then(function (t) { return gh('/git/commits', { method: 'POST', body: JSON.stringify({ message: msg, tree: t.sha, parents: [head] }) }); })
    .then(function (c) { return gh('/git/refs/heads/' + cfg.branch, { method: 'PATCH', body: JSON.stringify({ sha: c.sha }) }); });
}

/* ---------- data ---------- */
var HDR = '/* Managed by the admin panel at /admin – use it to add, edit, reorder or delete projects. */\n';
function projectsJS() { return HDR + 'window.ALL_PROJECTS = ' + JSON.stringify(data.live, rep, 1) + ';\n'; }
function draftsJS() { return HDR + 'window.DRAFT_PROJECTS = ' + JSON.stringify(data.drafts, rep, 1) + ';\n'; }
function norm(b) {
  b._k = 'k' + (++kc);
  if (b.type === 'text2' && !b.left) {
    b.left = { text: b.heading || '', size: b.headingSize || 40, weight: b.headingWeight || 400 };
    b.right = { text: b.body || '', size: b.bodySize || 20, weight: b.bodyWeight || 400 };
  }
  if (b.type === 'side' && !b.left) {
    var t = { kind: 'text', text: [b.heading, b.body].filter(Boolean).join('\n\n'), size: b.bodySize || 20, weight: b.bodyWeight || 400 };
    var m = b.media ? { kind: 'media', src: b.media } : { kind: null };
    b.left = b.side === 'right' ? t : m; b.right = b.side === 'right' ? m : t;
  }
  if (b.left) ['heading', 'headingSize', 'headingWeight', 'body', 'bodySize', 'bodyWeight', 'media', 'side'].forEach(function (k) { delete b[k]; });
  if (b.type === 'side') ['left', 'right'].forEach(function (s) { if (b[s] && b[s].kind === 'media' && !b[s].src) b[s] = { kind: null }; });
  return b;
}
function load() {
  return Promise.all([readFile('projects.js'), readFile('drafts.js')]).then(function (r) {
    var A = parse(r[0]), B = parse(r[1]), hp = A.HOME_PROJECTS;
    var live = A.ALL_PROJECTS || [], drafts = B.DRAFT_PROJECTS || [];
    live.forEach(function (p) { if (p.pinned === undefined) p.pinned = hp ? hp.indexOf(p.id) > -1 : false; });
    live.concat(drafts).forEach(function (p) { p.conceptual = !!p.conceptual; p.upcoming = !!p.upcoming; p.blocks = p.blocks || []; p.blocks.forEach(norm); });
    data = { live: live, drafts: drafts }; dirty = false;
  });
}

/* ---------- media ---------- */
function mu(path) { var p = pending[path]; return p ? (p.url || (p.url = URL.createObjectURL(p.blob))) : '../' + path; }
function raw(path) { return 'https://raw.githubusercontent.com/' + cfg.owner + '/' + cfg.repo + '/' + cfg.branch + '/' + path; }
function mediaEl(path) {
  if (!path) return '';
  return VID.test(path) ? '<video src="' + esc(mu(path)) + '" muted loop autoplay playsinline></video>'
    : '<img src="' + esc(mu(path)) + '" alt="" onerror="this.onerror=null;this.src=\'' + esc(raw(path)) + '\'">';
}
function addMedia(file) {
  var isV = file.type.indexOf('video/') === 0, ext = (file.name.split('.').pop() || 'bin').toLowerCase(), blob = file, p = Promise.resolve();
  if (isV && file.size > 50 * 1048576) return Promise.reject(new Error(file.name + ' is over 50 MB. Please compress it first.'));
  if (!isV && /^image\/(jpeg|png)$/.test(file.type)) {
    p = createImageBitmap(file).then(function (bm) {
      var s = Math.min(1, 2880 / bm.width), c = document.createElement('canvas'); c.width = Math.round(bm.width * s); c.height = Math.round(bm.height * s);
      c.getContext('2d').drawImage(bm, 0, 0, c.width, c.height);
      return new Promise(function (r) { c.toBlob(r, 'image/webp', 0.88); });
    }).then(function (b) { if (b && b.type === 'image/webp') { blob = b; ext = 'webp'; } });
  }
  return p.then(function () {
    var path = 'images/projects/' + ed.proj.id + '/' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5) + '.' + ext;
    pending[path] = { blob: blob }; return dims(blob, isV).then(function (ar) { pending[path].ar = ar; return path; });
  });
}
function dims(blob, isV) {
  return new Promise(function (res) {
    var u = URL.createObjectURL(blob), done = function (w, h) { URL.revokeObjectURL(u); res(w && h ? Math.round(w / h * 10000) / 10000 : null); };
    if (isV) { var v = document.createElement('video'); v.preload = 'metadata'; v.muted = true; v.onloadedmetadata = function () { done(v.videoWidth, v.videoHeight); }; v.onerror = function () { done(); }; v.src = u; }
    else { var i = new Image(); i.onload = function () { done(i.naturalWidth, i.naturalHeight); }; i.onerror = function () { done(); }; i.src = u; }
  });
}
function arOf(path) { return pending[path] && pending[path].ar || undefined; }
function addAll(files) { var out = [], p = Promise.resolve(); files.forEach(function (f) { p = p.then(function () { return addMedia(f); }).then(function (x) { out.push(x); }); }); return p.then(function () { return out; }); }

/* ---------- icons ---------- */
var IMG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 5h18v14H3z" opacity=".35"/><path d="M5 17l4.5-6 3.5 4.5 2.5-3L19 17z"/><circle cx="8" cy="9" r="1.6"/></svg>';
var PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
var PEN = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25zM20.7 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';
var DOTS = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="8" cy="6" r="2"/><circle cx="16" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="8" cy="18" r="2"/><circle cx="16" cy="18" r="2"/></svg>';
var BAR = '<div class="bar">' + [
  ['img', IMG, 'Add image'], ['vid', PLAY, 'Add video'], ['t1', 'T', 'Text – one column'], ['t2', 'T/T', 'Text – two columns'],
  ['side', IMG + '<span>/T</span>', 'Image or video beside text'], ['embed', '&lt;/&gt;', 'Embed content']
].map(function (b) { return '<button data-act="ins-' + b[0] + '" title="' + b[2] + '">' + b[1] + '</button>'; }).join('') + '</div>';
var NAV = '<header class="anav"><button class="lnk out" data-act="logout">Log out</button></header>';
function sw(cls, on) { return '<label class="sw"><input type="checkbox" class="' + cls + '"' + (on ? ' checked' : '') + '><i></i></label>'; }

/* ---------- login ---------- */
function viewAuth() {
  ed = null;
  var has = !!localStorage.getItem('adminVault');
  if (!window.crypto || !crypto.subtle) { app.innerHTML = '<div class="auth"><h1>Admin</h1><p class="sub">This page needs a secure (https) connection. Open it from your live website address.</p></div>'; return; }
  if (has) {
    app.innerHTML = '<form class="auth" id="f"><h1>Admin</h1><p class="sub">Sign in to manage your projects.</p><label>ID</label><input id="i" autocomplete="username" required><label>Password</label><input id="p" type="password" autocomplete="current-password" required><div class="err" id="e"></div><button class="btn">Sign in</button><button type="button" class="lnk reset" data-act="reset">Set up this device again</button></form>';
    $('#f').onsubmit = function (e) {
      e.preventDefault(); $('#e').textContent = 'Checking…';
      unseal($('#i').value, $('#p').value).then(function (c) { cfg = c; sessionStorage.setItem('adminSession', JSON.stringify(c)); boot(); })
        .catch(function () { $('#e').textContent = 'Wrong ID or password.'; });
    };
  } else {
    app.innerHTML = '<form class="auth" id="f"><h1>Admin setup</h1><p class="sub">One-time setup on this device. Your ID and password lock your GitHub access key in this browser, and nothing is sent to anyone else.</p>' +
      '<label>Choose an ID</label><input id="i" required><label>Choose a password</label><input id="p" type="password" minlength="8" required><label>GitHub access token</label><input id="t" type="password" required>' +
      '<label>Your website repository (owner/name)</label><input id="r" placeholder="yourusername/yourusername.github.io" required><label>Branch</label><input id="b" value="main" required>' +
      '<details><summary>How do I get a token?</summary><ol><li>On GitHub: your profile picture → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token.</li><li>Under Repository access choose “Only select repositories” and pick your website repository.</li><li>Under Permissions → Repository permissions set <b>Contents</b> to <b>Read and write</b>.</li><li>Generate, copy the token and paste it above. Keep a copy in a password manager.</li></ol></details>' +
      '<div class="err" id="e"></div><button class="btn">Save and continue</button></form>';
    $('#f').onsubmit = function (e) {
      e.preventDefault(); var rp = $('#r').value.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').split('/');
      if (rp.length < 2) { $('#e').textContent = 'Write the repository as owner/name.'; return; }
      var c = { token: $('#t').value.trim(), owner: rp[0], repo: rp[1], branch: $('#b').value.trim() }; cfg = c; $('#e').textContent = 'Checking your token…';
      gh('').then(function () { return seal($('#i').value, $('#p').value, c); })
        .then(function () { sessionStorage.setItem('adminSession', JSON.stringify(c)); boot(); })
        .catch(function (er) { cfg = null; $('#e').textContent = 'GitHub said: ' + er.message + '. Check the token and repository name.'; });
    };
  }
}

/* ---------- dashboard ---------- */
function card(p, list) {
  return '<div class="pc" data-id="' + esc(p.id) + '" data-list="' + list + '">' + (list === 'live' ? '<div class="pc__drag"><i></i><i></i><i></i><i></i><i></i><i></i></div>' : '') +
    '<div class="pc__thumb">' + mediaEl(p.cover) + '</div><div class="pc__body"><div class="top"><button class="btn sm del" data-act="delcard">Delete project</button><button class="btn sm" data-act="edit">' + (list === 'live' ? 'Edit project' : 'Edit draft') + '</button></div>' +
    '<label class="l">Project name</label><input type="text" class="f-title" value="' + esc(p.title) + '">' +
    '<div class="opts"><div>Pin to homepage ' + sw('f-pin', p.pinned) + '</div><div>Personal project ' + sw('f-con', p.conceptual) + '</div><div>Coming soon ' + sw('f-up', p.upcoming) + '</div></div>' +
    '<label class="l">Project tags</label><input type="text" class="f-type" placeholder="e.g. Branding, UX" value="' + esc(p.type) + '"></div></div>';
}
function dashboard() {
  ed = null;
  app.innerHTML = NAV + '<section class="hero"><p class="hi">Hi I am</p><h1 class="nm"><span>GULSHAN SINGH</span></h1><div class="sk"><span>Art Direction &nbsp; | &nbsp; UX Design</span><em>A mumbai based designer experienced in Art direction<br>and User Experience design.</em></div></section>' +
    '<div class="sec"><h2>Live Projects <span class="count">' + pad2(data.live.length) + '</span></h2><button class="btn" data-act="new">Upload new project</button></div>' +
    '<div class="list" id="liveList">' + (data.live.map(function (p) { return card(p, 'live'); }).join('') || '<p class="empty">No live projects yet.</p>') + '</div>' +
    '<div class="sec"><h2>Draft <span class="count">' + pad2(data.drafts.length) + '</span></h2></div>' +
    '<div class="list" id="draftList" style="margin-bottom:8vw">' + (data.drafts.map(function (p) { return card(p, 'drafts'); }).join('') || '<p class="empty">No drafts.</p>') + '</div>' +
    '<div class="savebar" id="savebar" hidden>You have unsaved changes <button class="lnk" data-act="discard">Discard</button><button class="btn" data-act="savedash">Save changes</button></div>';
  fitAll(); if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitAll);
  if ($('#liveList .pc')) Sortable.create($('#liveList'), { handle: '.pc__drag', animation: 150, onEnd: function () {
    var ids = $$('#liveList .pc').map(function (c) { return c.dataset.id; });
    data.live = ids.map(function (id) { return data.live.filter(function (p) { return p.id === id; })[0]; }); mark();
  } });
  $('#savebar').hidden = !dirty;
}
function mark() { dirty = true; var s = $('#savebar'); if (s) s.hidden = false; }
function saveDash() {
  busy('Saving…');
  return commit([{ path: 'projects.js', text: projectsJS() }, { path: 'drafts.js', text: draftsJS() }], 'Update projects from admin')
    .then(function () { dirty = false; $('#savebar').hidden = true; toast('Saved. Your website updates in about a minute.'); })
    .catch(function (e) { toast('Could not save: ' + e.message, true); }).then(function () { busy(); });
}

/* ---------- editor ---------- */
var SIZES = [10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 36, 40, 44, 48, 52, 56, 60, 64, 72, 80, 96, 120];
var WTS = [[100, 'Thin'], [200, 'Extra light'], [300, 'Light'], [400, 'Regular'], [500, 'Medium'], [600, 'Semibold'], [700, 'Bold'], [800, 'Extra bold'], [900, 'Black']];
function ctl(c) {
  var sz = SIZES.indexOf(c.size) < 0 ? SIZES.concat([c.size]).sort(function (a, b) { return a - b; }) : SIZES;
  return '<div class="ctl"><span class="hint">Select words to change only them</span><select class="sz" title="Text size">' + sz.map(function (s) { return '<option' + (s == c.size ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select>' +
    '<select class="wt" title="Text weight">' + WTS.map(function (w) { return '<option value="' + w[0] + '"' + (w[0] == c.weight ? ' selected' : '') + '>' + w[1] + '</option>'; }).join('') + '</select><button type="button" class="clr" data-act="clearfmt" title="Remove the different sizes/weights you gave to single words">Reset words</button></div>';
}
function tcell(c, which, extra, ind) {
  return '<div class="tcell' + (ind ? ' ind' : '') + '" data-cell="' + which + '">' + (extra || '') + ctl(c) + '<div class="rt" contenteditable="true" spellcheck="true" data-ph="Type your text… (select some words to change just their size or weight)" style="--s:' + c.size + ';--w:' + c.weight + '">' + (c.html || esc(c.text)) + '</div></div>';
}
function tools(replace) {
  return '<div class="tools"><button class="tb" data-act="pen" title="Edit">' + PEN + '</button><div class="menu" hidden>' + (replace ? '<button data-act="replace">' + replace + '</button>' : '') + '<button class="d" data-act="del">Delete</button></div><button class="tb drag" title="Drag to reorder">' + DOTS + '</button></div>';
}
function sideCell(c, which) {
  if (c.kind === 'text') return tcell(c, which, '<button class="x" data-act="cellreset" title="Clear">×</button>');
  if (c.kind === 'media') return '<div data-cell="' + which + '" style="position:relative"><div class="blk__media sq nat"' + (c.ar ? ' style="aspect-ratio:' + Number(c.ar) + '"' : '') + '>' + mediaEl(c.src) + '</div><button class="x" data-act="cellreset" title="Clear">×</button></div>';
  return '<div class="chooser" data-cell="' + which + '"><button class="btn" data-act="celltext">Type text</button><button class="btn" data-act="cellmedia">Select image / video</button></div>';
}
function blockHTML(b) {
  var inner;
  if (b.type === 'slide') inner = '<div class="blk"><div class="blk__media nat"' + (b.ar ? ' style="aspect-ratio:' + Number(b.ar) + '"' : '') + '>' + mediaEl(b.media) + '</div>' + tools('Replace content') + '</div>';
  else if (b.type === 'embed') inner = '<div class="blk"><div class="blk__media"><iframe src="' + esc(b.src) + '" title="Embed preview"></iframe></div>' + tools('Edit embed') + '</div>';
  else if (b.type === 'text1') inner = '<div class="blk">' + tools() + tcell(b, '', '', true) + '</div>';
  else if (b.type === 'text2') inner = '<div class="blk">' + tools() + '<div class="cols">' + tcell(b.left, 'left', '', true) + tcell(b.right, 'right') + '</div></div>';
  else inner = '<div class="blk">' + tools() + '<div class="cols">' + sideCell(b.left, 'left') + sideCell(b.right, 'right') + '</div></div>';
  return '<div class="wrap" data-k="' + b._k + '">' + inner + BAR + '</div>';
}
function openEditor(id) {
  var p = null, isDraft = false;
  if (id) { p = data.live.filter(function (x) { return x.id === id; })[0]; if (!p) { p = data.drafts.filter(function (x) { return x.id === id; })[0]; isDraft = !!p; } }
  if (id && !p) { toast('That project was not found.', true); location.hash = '#/'; return; }
  ed = { isNew: !p, isDraft: isDraft, orig: p ? p.id : null, proj: p ? JSON.parse(JSON.stringify(p)) : { id: 'tmp' + Math.random().toString(36).slice(2, 7), title: '', type: '', conceptual: false, upcoming: false, pinned: true, cover: '', blocks: [] } };
  ed.proj.blocks.forEach(function (b, i) { b._k = p ? p.blocks[i]._k : b._k; });
  renderEditor();
}
function renderEditor() {
  var p = ed.proj, y = window.scrollY;
  app.innerHTML = NAV + '<div class="ehead"><h1>' + (p.title ? esc(p.title) : 'Create project') + '</h1><div class="acts"><a class="lnk" href="#/">← Back to projects</a>' + (ed.isNew ? '' : '<button class="lnk" data-act="delproj">Delete project</button>') +
    '<button class="btn grey" data-act="draft">Save as draft</button><button class="btn" data-act="publish">' + (ed.isDraft || ed.isNew ? 'Publish project' : 'Publish changes') + '</button></div></div>' +
    (p.cover ? '<div class="cover wrap" id="cover"><div style="position:absolute;inset:0">' + mediaEl(p.cover) + '</div><div class="tools"><button class="tb" data-act="pen">' + PEN + '</button><div class="menu" hidden><button data-act="cover-pick">Replace cover</button></div></div></div><div id="coverbar">' + BAR + '</div>'
      : '<div class="up"><div><div><h3>Upload cover</h3><p>You can upload jpeg, png or video here</p></div><button class="btn" data-act="cover-pick">Select Files</button></div></div>') +
    '<div class="blocks" id="blocks">' + p.blocks.map(blockHTML).join('') + '</div>' +
    (p.blocks.length ? '' : '<div class="up drop" id="drop"><div><h3>Drop your files to upload</h3><p>or select your file here.</p><button class="btn" data-act="drop-pick">Select Files</button><p>Drop all your images &amp; videos here</p></div></div>') +
    '<div style="height:10vw"></div>';
  window.scrollTo(0, y);
  if ($('#blocks .wrap')) Sortable.create($('#blocks'), { handle: '.drag', animation: 150, onEnd: function () {
    ed.proj.blocks = $$('#blocks > .wrap').map(function (w) { return ed.proj.blocks.filter(function (b) { return b._k === w.dataset.k; })[0]; });
  } });
  var d = $('#drop'); if (d) { d.ondragover = function (e) { e.preventDefault(); d.classList.add('over'); }; d.ondragleave = function () { d.classList.remove('over'); };
    d.ondrop = function (e) { e.preventDefault(); d.classList.remove('over'); addSlides(Array.prototype.slice.call(e.dataTransfer.files), 0); }; }
}
function grow(t) { t.style.height = 'auto'; t.style.height = t.scrollHeight + 4 + 'px'; }
function embedSrc(v) {
  v = (v || '').trim(); if (!v) return null; var m = v.match(/src=["']([^"']+)["']/i); if (m) v = m[1];
  if (!/^https:\/\//i.test(v)) return null;
  var y = v.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,})/); if (y) return 'https://www.youtube.com/embed/' + y[1];
  var vi = v.match(/vimeo\.com\/(\d+)/); if (vi && v.indexOf('player.vimeo') < 0) return 'https://player.vimeo.com/video/' + vi[1];
  if (/figma\.com\/(file|design|proto|board)/.test(v)) return 'https://www.figma.com/embed?embed_host=share&url=' + encodeURIComponent(v);
  return v;
}
function newKey(b) { b._k = 'k' + (++kc); return b; }
function insert(idx, blocks) { Array.prototype.splice.apply(ed.proj.blocks, [idx, 0].concat(blocks)); renderEditor(); }
function addSlides(files, idx) {
  files = files.filter(function (f) { return /^(image|video)\//.test(f.type); }); if (!files.length) return;
  busy('Preparing files…');
  addAll(files).then(function (paths) { insert(idx, paths.map(function (p) { return newKey({ type: 'slide', media: p, ar: arOf(p) }); })); }).catch(function (e) { toast(e.message, true); }).then(function () { busy(); });
}

/* ---------- publish / draft ---------- */
function dialog(mode) {
  var p = ed.proj;
  if (mode === 'publish' && !p.cover) { toast('Please upload a cover first.', true); return; }
  var m = document.createElement('div'); m.className = 'modal';
  m.innerHTML = '<div class="pc"><h3>' + (mode === 'publish' ? 'Publish project' : 'Save as draft') + '</h3><p class="n">These details show on your project cards.</p><label class="l">Project name</label><input type="text" id="d-title" value="' + esc(p.title) + '">' +
    '<div class="opts"><div>Pin to homepage ' + sw('d-pin', p.pinned) + '</div><div>Personal project ' + sw('d-con', p.conceptual) + '</div><div>Coming soon ' + sw('d-up', p.upcoming) + '</div></div><label class="l">Project tags</label><input type="text" id="d-type" placeholder="e.g. Branding, UX" value="' + esc(p.type) + '">' +
    (mode === 'draft' && !ed.isNew && !ed.isDraft ? '<p class="n"><b>Note:</b> saving a live project as a draft removes it from your website until you publish it again.</p>' : '') +
    '<div class="row"><button class="btn grey" id="d-cancel">Cancel</button><button class="btn" id="d-ok">' + (mode === 'publish' ? 'Publish' : 'Save draft') + '</button></div></div>';
  document.body.appendChild(m); $('#d-title').focus();
  $('#d-cancel').onclick = function () { m.remove(); };
  $('#d-ok').onclick = function () {
    var t = $('#d-title').value.trim(); if (!t) { toast('Please give the project a name.', true); return; }
    var vals = { title: t, type: $('#d-type').value.trim(), pinned: $('.d-pin', m).checked, conceptual: $('.d-con', m).checked, upcoming: $('.d-up', m).checked };
    m.remove(); finalize(mode, vals);
  };
}
function finalize(mode, vals) {
  var p = ed.proj; Object.assign(p, vals);
  if (ed.isNew) {
    var taken = {}; data.live.concat(data.drafts).forEach(function (x) { taken[x.id] = 1; });
    var base = slug(p.title), id = base, n = 2; while (taken[id]) id = base + '-' + n++;
    var o = 'images/projects/' + p.id + '/', nw = 'images/projects/' + id + '/';
    p = ed.proj = JSON.parse(JSON.stringify(p), function (k, v) { return typeof v === 'string' ? v.split(o).join(nw) : v; }); p.id = id;
    Object.keys(pending).forEach(function (k) { if (k.indexOf(o) === 0) { pending[nw + k.slice(o.length)] = pending[k]; delete pending[k]; } });
  }
  var live = data.live.filter(function (x) { return x.id !== ed.orig && x.id !== p.id; }), drafts = data.drafts.filter(function (x) { return x.id !== ed.orig && x.id !== p.id; });
  var idx = data.live.map(function (x) { return x.id; }).indexOf(ed.orig);
  if (mode === 'publish') { if (idx > -1) live.splice(Math.min(idx, live.length), 0, p); else live.unshift(p); } else drafts.unshift(p);
  var js = JSON.stringify(p, rep), files = [];
  Object.keys(pending).forEach(function (k) { if (!pending[k].done && js.indexOf(k) > -1) files.push({ path: k, blob: pending[k].blob }); });
  var saved = { live: data.live, drafts: data.drafts }; data = { live: live, drafts: drafts };
  files.push({ path: 'projects.js', text: projectsJS() }, { path: 'drafts.js', text: draftsJS() });
  busy('Uploading…');
  commit(files, (mode === 'publish' ? 'Publish ' : 'Save draft of ') + p.title, function (i, n) { busy('Uploading ' + i + ' of ' + n + '…'); })
    .then(function () {
      files.forEach(function (f) { if (pending[f.path]) pending[f.path].done = true; });
      toast(mode === 'publish' ? 'Published. Your website updates in about a minute.' : 'Draft saved.');
      ed = null; if (location.hash === '#/') dashboard(); else location.hash = '#/';
    })
    .catch(function (e) { data = saved; toast('Could not save: ' + e.message, true); }).then(function () { busy(); });
}
function delCard(id) {
  var p = data.live.concat(data.drafts).filter(function (x) { return x.id === id; })[0];
  if (!confirm('Delete "' + (p && p.title || 'this project') + '"? This cannot be undone.')) return;
  var saved = { live: data.live, drafts: data.drafts };
  data.live = data.live.filter(function (x) { return x.id !== id; }); data.drafts = data.drafts.filter(function (x) { return x.id !== id; });
  busy('Deleting…');
  commit([{ path: 'projects.js', text: projectsJS() }, { path: 'drafts.js', text: draftsJS() }], 'Delete project')
    .then(function () { dirty = false; toast('Project deleted.'); dashboard(); })
    .catch(function (e) { data = saved; toast('Could not delete: ' + e.message, true); }).then(function () { busy(); });
}
function delProject() {
  if (!confirm('Delete this project from your website? This cannot be undone.')) return;
  var saved = { live: data.live, drafts: data.drafts };
  data.live = data.live.filter(function (x) { return x.id !== ed.orig; }); data.drafts = data.drafts.filter(function (x) { return x.id !== ed.orig; });
  busy('Deleting…');
  commit([{ path: 'projects.js', text: projectsJS() }, { path: 'drafts.js', text: draftsJS() }], 'Delete project')
    .then(function () { toast('Project deleted.'); ed = null; if (location.hash === '#/') dashboard(); else location.hash = '#/'; })
    .catch(function (e) { data = saved; toast('Could not delete: ' + e.message, true); }).then(function () { busy(); });
}

document.addEventListener('load', function (e) { var t = e.target; if (t.tagName === 'IMG' && t.parentNode.classList && t.parentNode.classList.contains('nat')) t.parentNode.style.aspectRatio = t.naturalWidth + ' / ' + t.naturalHeight; }, true);
document.addEventListener('loadedmetadata', function (e) { var t = e.target; if (t.tagName === 'VIDEO' && t.parentNode.classList && t.parentNode.classList.contains('nat') && t.videoWidth) t.parentNode.style.aspectRatio = t.videoWidth + ' / ' + t.videoHeight; }, true);

/* ---------- rich text (size / weight for selected words) ---------- */
var selRange = null;
function rtClean(node) {
  var out = '';
  node.childNodes.forEach(function (n) {
    if (n.nodeType === 3) out += esc(n.nodeValue);
    else if (n.nodeName === 'BR') out += '<br>';
    else if (n.nodeName === 'SPAN' && (n.classList.contains('sz') || n.classList.contains('wt'))) {
      var k = n.classList.contains('sz') ? 'sz' : 'wt', v = parseFloat(n.style.getPropertyValue(k === 'sz' ? '--s' : '--w'));
      out += v > 0 ? '<span class="' + k + '" style="--' + (k === 'sz' ? 's' : 'w') + ':' + v + '">' + rtClean(n) + '</span>' : rtClean(n);
    } else {
      var inner = rtClean(n);
      out += (n.nodeName === 'DIV' || n.nodeName === 'P') ? (n.previousSibling ? '<br>' : '') + inner : inner;
    }
  });
  return out;
}
function plain(node) {
  var out = '';
  node.childNodes.forEach(function (n) {
    if (n.nodeType === 3) out += n.nodeValue; else if (n.nodeName === 'BR') out += '\n';
    else { var inner = plain(n); out += (n.nodeName === 'DIV' || n.nodeName === 'P') ? (n.previousSibling ? '\n' : '') + inner : inner; }
  });
  return out;
}
function syncRT(c, el) {
  c.text = plain(el).replace(/\n+$/, ''); var h = rtClean(el).replace(/(<br>)+$/, '');
  if (/<span /.test(h)) c.html = h; else delete c.html;
}
function setSel(sel, val) {
  val = String(val);
  if (!Array.prototype.some.call(sel.options, function (o) { return o.value === val; })) {
    var o = document.createElement('option'); o.value = val; o.textContent = val; sel.appendChild(o);
  }
  sel.value = val;
}
function baseOf(host) { return { s: +host.style.getPropertyValue('--s') || 20, w: +host.style.getPropertyValue('--w') || 400 }; }
/* what size / weight is the text at this spot? (closest word-style around it, else the whole-text value) */
function effective(node, host) {
  var b = baseOf(host), s = null, w = null;
  if (node && node.nodeType === 3) node = node.parentNode;
  while (node && node !== host) {
    if (node.nodeType === 1 && node.tagName === 'SPAN') {
      if (s === null && node.classList.contains('sz')) s = parseFloat(node.style.getPropertyValue('--s')) || null;
      if (w === null && node.classList.contains('wt')) w = parseFloat(node.style.getPropertyValue('--w')) || null;
    }
    node = node.parentNode;
  }
  return { s: s || b.s, w: w || b.w };
}
function showValues(host, node) {
  var cell = host.closest('.tcell'), v = effective(node, host);
  setSel(cell.querySelector('select.sz'), v.s); setSel(cell.querySelector('select.wt'), v.w);
}
function unwrap(el) { while (el.firstChild) el.parentNode.insertBefore(el.firstChild, el); el.remove(); }
function applySpan(range, kind, val, host) {
  var frag = range.extractContents();
  frag.querySelectorAll('span.' + kind).forEach(unwrap);
  var span = document.createElement('span'); span.className = kind; span.style.setProperty(kind === 'sz' ? '--s' : '--w', val);
  span.appendChild(frag); range.insertNode(span);
  host.querySelectorAll('span:empty').forEach(function (x) { x.remove(); });
  var next = document.createRange(); next.selectNodeContents(span);
  var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(next);
  return next;
}
function liveRange(host) {
  var sel = window.getSelection();
  if (sel.rangeCount && !sel.isCollapsed && host.contains(sel.anchorNode) && host.contains(sel.focusNode)) return sel.getRangeAt(0);
  if (selRange && selRange.node === host && !selRange.range.collapsed && host.contains(selRange.range.commonAncestorContainer)) return selRange.range;
  return null;
}
document.addEventListener('selectionchange', function () {
  var sel = window.getSelection(); if (!sel.rangeCount) return;
  var n = sel.anchorNode, host = n && (n.nodeType === 1 ? n : n.parentNode); host = host && host.closest && host.closest('.rt');
  if (!host) return;
  if (sel.isCollapsed) { selRange = null; showValues(host, sel.anchorNode); return; }
  if (host.contains(sel.focusNode)) { selRange = { node: host, range: sel.getRangeAt(0).cloneRange() }; showValues(host, sel.getRangeAt(0).startContainer.nodeType === 1 ? (sel.getRangeAt(0).startContainer.childNodes[sel.getRangeAt(0).startOffset] || sel.getRangeAt(0).startContainer) : sel.getRangeAt(0).startContainer); }
});
app.addEventListener('keydown', function (e) {
  if (!(e.target.classList && e.target.classList.contains('rt'))) return;
  if (e.key === 'Enter') { e.preventDefault(); document.execCommand('insertLineBreak'); }
});
app.addEventListener('paste', function (e) {
  if (!(e.target.classList && e.target.classList.contains('rt'))) return;
  e.preventDefault(); document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text/plain'));
});

/* ---------- events ---------- */
function ctxBlock(el) { var w = el.closest('.wrap'); return w ? ed.proj.blocks.filter(function (b) { return b._k === w.dataset.k; })[0] : null; }
function cellOf(b, el) { var c = el.closest('[data-cell]'); var w = c ? c.dataset.cell : ''; return { w: w, c: w ? b[w] : b }; }
function withMedia(fn) { return function (f) { if (!f[0]) return; busy('Preparing…'); return addMedia(f[0]).then(fn).catch(function (er) { toast(er.message, true); }).then(function () { busy(); }); }; }
app.addEventListener('click', function (e) {
  var a = e.target.closest('[data-act]'); if (!a) { $$('.menu').forEach(function (m) { m.hidden = true; }); return; }
  var act = a.dataset.act, b = ed && ctxBlock(a), idx = ed ? (b ? ed.proj.blocks.indexOf(b) + 1 : 0) : 0;
  if (act === 'logout') { sessionStorage.removeItem('adminSession'); cfg = null; viewAuth(); }
  else if (act === 'reset') { if (confirm('This removes the saved login from this device. You will need your GitHub token again.')) { localStorage.removeItem('adminVault'); viewAuth(); } }
  else if (act === 'delcard') delCard(a.closest('.pc').dataset.id);
  else if (act === 'clearfmt') { var cell0 = a.closest('.tcell'), host0 = cell0.querySelector('.rt'), cc = cellOf(b, a).c; host0.querySelectorAll('span').forEach(unwrap); host0.normalize(); syncRT(cc, host0); setSel(cell0.querySelector('select.sz'), cc.size); setSel(cell0.querySelector('select.wt'), cc.weight); }
  else if (act === 'new') location.hash = '#/new';
  else if (act === 'edit') location.hash = '#/edit/' + a.closest('.pc').dataset.id;
  else if (act === 'discard') { busy('Reloading…'); load().then(dashboard).then(function () { busy(); }); }
  else if (act === 'savedash') saveDash();
  else if (act === 'pen') { var mn = a.parentNode.querySelector('.menu'), was = mn.hidden; $$('.menu').forEach(function (m) { m.hidden = true; }); mn.hidden = !was; }
  else if (act === 'cover-pick') pick('image/jpeg,image/png,image/webp,image/gif,video/*').then(withMedia(function (p) { ed.proj.cover = p; renderEditor(); }));
  else if (act === 'drop-pick') pick('image/*,video/*', true).then(function (f) { addSlides(f, 0); });
  else if (act === 'ins-img') pick('image/*', true).then(function (f) { addSlides(f, idx); });
  else if (act === 'ins-vid') pick('video/*', true).then(function (f) { addSlides(f, idx); });
  else if (act === 'ins-t1') insert(idx, [newKey({ type: 'text1', text: '', size: 20, weight: 400 })]);
  else if (act === 'ins-t2') insert(idx, [newKey({ type: 'text2', left: { text: '', size: 40, weight: 400 }, right: { text: '', size: 20, weight: 400 } })]);
  else if (act === 'ins-side') insert(idx, [newKey({ type: 'side', left: { kind: null }, right: { kind: null } })]);
  else if (act === 'ins-embed') { var raw0 = prompt('Paste a link (YouTube, Vimeo, Figma…) or an embed code:'); if (raw0 === null) return; var s = embedSrc(raw0); if (s) insert(idx, [newKey({ type: 'embed', src: s })]); else toast('That does not look like a valid https link.', true); }
  else if (act === 'del') { if (confirm('Delete this card and its content?')) { ed.proj.blocks.splice(ed.proj.blocks.indexOf(b), 1); renderEditor(); } }
  else if (act === 'replace') {
    if (b.type === 'embed') { var s2 = embedSrc(prompt('Paste a link or embed code:', b.src)); if (s2) { b.src = s2; renderEditor(); } }
    else pick('image/*,video/*').then(withMedia(function (p) { b.media = p; b.ar = arOf(p); renderEditor(); }));
  }
  else if (act === 'cellreset') { b[cellOf(b, a).w] = { kind: null }; renderEditor(); }
  else if (act === 'celltext') { b[cellOf(b, a).w] = { kind: 'text', text: '', size: 20, weight: 400 }; renderEditor(); }
  else if (act === 'cellmedia') { var wch = cellOf(b, a).w; pick('image/*,video/*').then(withMedia(function (p) { b[wch] = { kind: 'media', src: p, ar: arOf(p) }; renderEditor(); })); }
  else if (act === 'draft') dialog('draft');
  else if (act === 'publish') dialog('publish');
  else if (act === 'delproj') delProject();
});
app.addEventListener('input', function (e) {
  var t = e.target, pc = t.closest('.pc');
  if (pc) {
    var p = (pc.dataset.list === 'live' ? data.live : data.drafts).filter(function (x) { return x.id === pc.dataset.id; })[0]; if (!p) return;
    if (t.classList.contains('f-title')) p.title = t.value; else if (t.classList.contains('f-type')) p.type = t.value;
    else if (t.classList.contains('f-pin')) p.pinned = t.checked; else if (t.classList.contains('f-con')) p.conceptual = t.checked; else if (t.classList.contains('f-up')) p.upcoming = t.checked;
    mark(); return;
  }
  if (!ed) return; var b = ctxBlock(t); if (!b) return; var c = cellOf(b, t).c;
  if (t.classList.contains('rt')) syncRT(c, t);
  else if (t.classList.contains('sz') || t.classList.contains('wt')) {
    var isSz = t.classList.contains('sz'), cell = t.closest('.tcell'), host = cell.querySelector('.rt'), val = +t.value, rg = liveRange(host);
    if (rg) {            /* some words are selected: style only those */
      selRange = { node: host, range: applySpan(rg, isSz ? 'sz' : 'wt', val, host).cloneRange() }; syncRT(c, host);
    } else if (isSz) { c.size = val; host.style.setProperty('--s', val); }
    else { c.weight = val; host.style.setProperty('--w', val); }
  }
});

/* ---------- routing ---------- */
function route() {
  if (!cfg) return; var h = location.hash;
  if (h === '#/new') openEditor(null); else if (h.indexOf('#/edit/') === 0) openEditor(decodeURIComponent(h.slice(7))); else dashboard();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
function boot() { busy('Loading your projects…'); load().then(route).catch(function (e) { toast('Could not load: ' + e.message, true); sessionStorage.removeItem('adminSession'); cfg = null; viewAuth(); }).then(function () { busy(); }); }
try { var s = sessionStorage.getItem('adminSession'); if (s) { cfg = JSON.parse(s); boot(); } else viewAuth(); } catch (e) { viewAuth(); }
})();
