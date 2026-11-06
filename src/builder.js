/* =====================================================================
   AURELIA · COURSE BUILDER  (library, map editor, courses of 9 and 18, round play)
   Holes are saved to the signed-in person's private space in the artifact's database
   (data/users/<id>/builder/...), one document per hole. Without that, this browser keeps them.
   ===================================================================== */
(function () {
  'use strict';
  var HW = HoleWorld, AG = AureliaGame, FT = 0.3048;
  function $(id) { return document.getElementById(id); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function newId(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function busy(on, text) { var b = $('bBusy'); b.textContent = text || 'Growing the forest…'; b.hidden = !on; }

  /* ---------------- storage ---------------- */
  var Store = { mode: 'memory', db: null, uid: null, mem: {} };
  function lsGet(k) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return Store.mem[k] || null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { Store.mem[k] = v; return false; } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { delete Store.mem[k]; } }
  Store.init = function () {
    return new Promise(function (resolve) {
      var done = false; function fin(m) { if (done) return; done = true; Store.mode = m; resolve(m); }
      function local() { try { localStorage.setItem('aub:t', '1'); localStorage.removeItem('aub:t'); fin('local'); } catch (e) { fin('memory'); } }
      if (!(window.claude && window.claude.use)) { local(); return; }
      var t = setTimeout(local, 6000);
      Promise.all([window.claude.use('user'), window.claude.use('db')]).then(function (r) {
        var u = r[0], d = r[1];
        if (!u || !d) { clearTimeout(t); local(); return; }
        u.id().then(function (id) { clearTimeout(t); if (id) { Store.db = d; Store.uid = id; fin('db'); } else local(); }, function () { clearTimeout(t); local(); });
      }, function () { clearTimeout(t); local(); });
    });
  };
  function coll(kind) { return Store.db.doc('data/users/' + Store.uid + '/builder').collection(kind); }
  var chains = {};
  function serial(key, fn) { var p = (chains[key] || Promise.resolve()).then(fn, fn); chains[key] = p.catch(function () {}); return p; }
  Store.list = function (kind) {
    if (Store.mode === 'db') return coll(kind).get().then(function (s) { return s.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }); });
    var idx = lsGet('aub:idx:' + kind) || {};
    return Promise.resolve(Object.keys(idx).map(function (id) { return Object.assign({ id: id }, idx[id]); }));
  };
  Store.get = function (kind, id) {
    if (Store.mode === 'db') return coll(kind).doc(id).get().then(function (s) { return s.exists ? s.data() : null; });
    return Promise.resolve(kind === 'holes' ? lsGet('aub:hole:' + id) : ((lsGet('aub:idx:' + kind) || {})[id] || null));
  };
  Store.put = function (kind, id, data) {
    if (Store.mode === 'db') return serial(kind + '/' + id, function () { return coll(kind).doc(id).set(data); });
    if (kind === 'holes') { if (!lsSet('aub:hole:' + id, data)) return Promise.reject(new Error('full')); return Promise.resolve(); }
    var idx = lsGet('aub:idx:' + kind) || {}; idx[id] = data; lsSet('aub:idx:' + kind, idx); return Promise.resolve();
  };
  Store.del = function (kind, id) {
    if (Store.mode === 'db') return serial(kind + '/' + id, function () { return coll(kind).doc(id).delete(); });
    if (kind === 'holes') lsDel('aub:hole:' + id); else { var idx = lsGet('aub:idx:' + kind) || {}; delete idx[id]; lsSet('aub:idx:' + kind, idx); }
    return Promise.resolve();
  };

  /* ---------------- state ---------------- */
  var S = { holes: [], courses: [], hole: null, holeId: null, group: 'sculpt', op: 'raise', size: 14, str: 0.5, undo: [], redo: [], course: null, round: null, dirty: false, saving: false,
    hand: false, tree: { age: 0.5, variety: 0.35, canopy: 0 }, pathW: 10, pathClear: 12, in3D: false, inspireHidden: false };
  var SVG = function (d) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>'; };
  var GROUPS = [
    { id: 'sculpt', label: 'Sculpt', icon: SVG('<path d="M2 19l6-9 4 5 3-4 7 8z"/><path d="M15 6l1.5-3L18 6"/>'), ops: [['raise', 'Raise'], ['lower', 'Lower'], ['smooth', 'Smooth'], ['flatten', 'Flatten']] },
    { id: 'paint', label: 'Paint', icon: SVG('<path d="M19 3l2 2-9 9-3 1 1-3z"/><path d="M8 16c-2 0-4 1.5-4 4 2 0 5-.5 5-3"/>'), ops: [['s1', 'Fairway', '#86c84e'], ['s2', 'Rough', '#5f9e3c'], ['s0', 'Forest floor', '#2f5a33'], ['s3', 'Sand', '#d9bf84'], ['s4', 'Rock', '#8b8a80'], ['s5', 'Stone path', '#b9a888'], ['s6', 'Mud', '#6b5236'], ['water', 'Dig water', '#3fa9c6'], ['fill', 'Fill water', '#c9a878']] },
    { id: 'plant', label: 'Trees', icon: SVG('<path d="M12 22v-6"/><path d="M12 2l6 9h-3l4 5H5l4-5H6z"/>'), ops: [['mixed', 'Mixed forest', '#3f8a3a'], ['guardian', 'Guardians', '#2c6650'], ['oak', 'Ancient oaks', '#7d9a3a'], ['pine', 'Pines', '#1f4d33'], ['broad', 'Broadleaf', '#4f9a3e'], ['palm', 'Palms', '#7cc04f'], ['bush', 'Bushes', '#4f8a3e'], ['fern', 'Ferns', '#5fae55'], ['shape', 'Reshape trees'], ['thin', 'Thin out'], ['erase', 'Clear']] },
    { id: 'paths', label: 'Paths', icon: SVG('<path d="M4 21c3-6 13-4 16-12"/><path d="M3 14c2-4 7-4 9-9" stroke-dasharray="2 3"/>'), ops: [['tunnel', 'Tunnel'], ['open', 'Open lane'], ['delpath', 'Remove path']] },
    { id: 'place', label: 'Build', icon: SVG('<path d="M3 21h18"/><path d="M5 21V10h4v11M10 21V6h4v15M15 21v-8h4v8"/>'), ops: [['tee', 'Tee', '#ffc93c'], ['basket', 'Basket', '#f2a13b'], ['guardian1', 'Guardian tree', '#2c6650'], ['oak1', 'Ancient oak', '#7d9a3a'], ['rock', 'Boulder', '#8b8a80'], ['log', 'Massive log', '#6b4a32'], ['wall', 'Moss wall', '#9c9786'], ['ruin', 'Ruin wall', '#b39d78'], ['col', 'Column', '#c8b892'], ['arch', 'Stone arch', '#b39d78'], ['mono', 'Monolith', '#4a4656'], ['head', 'Carved head', '#9b8e74'], ['ring', 'Stone ring', '#8f8a7c'], ['disc', 'Disc sculpture', '#e23a6a'], ['pyr', 'Step pyramid', '#a8946e'], ['delobj', 'Remove']] },
  ];
  var SURF_COL = ['#2f5a33', '#86c84e', '#5f9e3c', '#d9bf84', '#8b8a80', '#b9a888', '#6b5236'];
  var TREE_COL = { pine: '#1f4d33', broad: '#3f8a3a', palm: '#7cc04f', bush: '#4f8a3e', fern: '#5fae55', guardian: '#2c6650', oak: '#7d9a3a' };
  function holeFt(d) { return Math.round(Math.hypot(d.basket.x - d.tee.x, d.basket.y - d.tee.y) / FT); }
  function holeDropFt(d) { return Math.round((HW.hAt(d, d.tee.x, d.tee.y) - HW.hAt(d, d.basket.x, d.basket.y)) / FT); }
  function metaOf(id) { for (var i = 0; i < S.holes.length; i++) if (S.holes[i].id === id) return S.holes[i]; return null; }

  /* ---------------- screens ---------------- */
  function show(name) {
    ['lib', 'ed', 'crs'].forEach(function (n) { $(n).hidden = n !== name; });
    AG.setActive(false); AG.look(false); S.in3D = false; closeTreeSheet();
    $('ed3d').classList.remove('on'); $('ed3d').setAttribute('aria-pressed', 'false'); $('ed3d').textContent = '3D';
    if (name === 'ed') { sizeMap(); drawSoon(); }
  }

  /* ---------------- library ---------------- */
  function refreshLib() {
    return Promise.all([Store.list('holemeta'), Store.list('courses')]).then(function (r) {
      S.holes = r[0].sort(function (a, b) { return (b.updated || 0) - (a.updated || 0); });
      S.courses = r[1].sort(function (a, b) { return (b.updated || 0) - (a.updated || 0); });
      renderLib();
    }, function () { renderLib(); });
  }
  function renderLib() {
    var g = $('holeGrid'); g.innerHTML = '';
    var nb = el('button', 'card new'); nb.type = 'button'; nb.innerHTML = '<b>+ New hole</b><span>Start from a landscape</span>'; nb.addEventListener('click', templatePicker); g.appendChild(nb);
    S.holes.forEach(function (m) {
      var c = el('div', 'card');
      var open = el('button', ''); open.type = 'button'; open.style.cssText = 'all:unset;display:flex;flex-direction:column;cursor:pointer';
      var th = el('span', 'th'); if (m.thumb) th.style.backgroundImage = 'url(' + m.thumb + ')'; open.appendChild(th);
      var mt = el('span', 'meta'); mt.appendChild(el('b', '', m.name || 'Hole')); mt.appendChild(el('span', '', 'Par ' + (m.par || 3) + ' · ' + (m.ft || 0) + ' ft' + (m.trees ? ' · ' + m.trees + ' trees' : ''))); open.appendChild(mt);
      open.addEventListener('click', function () { openHole(m.id); });
      var more = el('button', 'more', '⋯'); more.type = 'button'; more.setAttribute('aria-label', 'More for ' + (m.name || 'this hole'));
      more.addEventListener('click', function (e) { e.stopPropagation(); holeMenu(m); });
      c.appendChild(open); c.appendChild(more); g.appendChild(c);
    });
    var cg = $('courseGrid'); cg.innerHTML = '';
    var nc = el('button', 'card new'); nc.type = 'button'; nc.innerHTML = '<b>+ New course</b><span>Collect holes into a 9 or an 18</span>'; nc.addEventListener('click', newCourse); cg.appendChild(nc);
    S.courses.forEach(function (c) {
      var b = el('button', 'card'); b.type = 'button';
      var first = metaOf((c.holes || []).filter(Boolean)[0]);
      var th = el('span', 'th'); if (first && first.thumb) th.style.backgroundImage = 'url(' + first.thumb + ')'; b.appendChild(th);
      var t = courseTotals(c), mt = el('span', 'meta'); mt.appendChild(el('b', '', c.name || 'Course')); mt.appendChild(el('span', '', c.size + ' holes · ' + t.filled + ' set · par ' + t.par)); b.appendChild(mt);
      b.addEventListener('click', function () { openCourse(c); });
      cg.appendChild(b);
    });
    if (!S.holes.length) { var p = el('p', 'empty', 'No holes yet. Pick a landscape to start your first one.'); g.appendChild(p); }
    var sm = $('saveMode');
    sm.textContent = Store.mode === 'db' ? 'Saved to your account' : Store.mode === 'local' ? 'Saved in this browser only' : 'Not saved: storage is blocked here';
    sm.classList.toggle('ok', Store.mode === 'db');
  }
  function tabs(which) {
    $('tabHoles').classList.toggle('on', which === 'holes'); $('tabCourses').classList.toggle('on', which === 'courses');
    $('tabHoles').setAttribute('aria-selected', which === 'holes'); $('tabCourses').setAttribute('aria-selected', which === 'courses');
    $('holesPane').hidden = which !== 'holes'; $('coursesPane').hidden = which !== 'courses';
  }
  $('tabHoles').addEventListener('click', function () { tabs('holes'); });
  $('tabCourses').addEventListener('click', function () { tabs('courses'); });

  /* ---------------- modal ---------------- */
  function modal(build) { var b = $('bBox'); b.innerHTML = ''; build(b); $('bModal').hidden = false; var f = b.querySelector('button'); if (f) f.focus(); }
  function closeModal() { $('bModal').hidden = true; }
  $('bModal').addEventListener('click', function (e) { if (e.target === $('bModal')) closeModal(); });
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('bModal').hidden) closeModal(); });
  function button(text, cls, fn) { var b = el('button', cls || 'chip', text); b.type = 'button'; b.addEventListener('click', fn); return b; }
  function confirmBox(title, text, yes, fn) {
    modal(function (b) {
      b.appendChild(el('h2', '', title)); b.appendChild(el('p', '', text));
      var r = el('div', 'mrow'); r.appendChild(button('Cancel', 'chip', closeModal)); r.appendChild(button(yes, 'danger', function () { closeModal(); fn(); })); b.appendChild(r);
    });
  }
  function templatePicker() {
    modal(function (b) {
      b.appendChild(el('h2', '', 'New hole')); b.appendChild(el('p', '', 'Start from a landscape, or let the randomizer build a hole for you. You can reshape every part of either.'));
      b.appendChild(el('div', 'tsec', 'Hole randomizer'));
      var g2 = el('div', 'tpl');
      var any = el('button', 'hot'); any.type = 'button'; any.appendChild(el('b', '', 'Surprise me')); any.appendChild(el('span', '', 'Any of the ideas below, rolled fresh.'));
      any.addEventListener('click', function () { closeModal(); createRandom(null); }); g2.appendChild(any);
      HW.ARCHETYPES.forEach(function (A) { var x = el('button'); x.type = 'button'; x.appendChild(el('b', '', A.name)); x.appendChild(el('span', '', A.inspired)); x.addEventListener('click', function () { closeModal(); createRandom(A.id); }); g2.appendChild(x); });
      b.appendChild(g2);
      b.appendChild(el('div', 'tsec', 'Landscapes'));
      var g = el('div', 'tpl');
      HW.TEMPLATES.forEach(function (t) { var x = el('button'); x.type = 'button'; x.appendChild(el('b', '', t.name)); x.appendChild(el('span', '', t.blurb)); x.addEventListener('click', function () { closeModal(); createHole(t.id); }); g.appendChild(x); });
      b.appendChild(g); var r = el('div', 'mrow'); r.appendChild(button('Cancel', 'chip', closeModal)); b.appendChild(r);
    });
  }
  function holeMenu(m) {
    modal(function (b) {
      b.appendChild(el('h2', '', m.name || 'Hole')); b.appendChild(el('p', '', 'Par ' + (m.par || 3) + ' · ' + (m.ft || 0) + ' ft'));
      var l = el('div', 'mlist');
      l.appendChild(button('Edit', '', function () { closeModal(); openHole(m.id); }));
      l.appendChild(button('Play it', '', function () { closeModal(); loadHoleData(m.id).then(function (d) { if (d) playSingle(d, function () { show('lib'); }); }); }));
      l.appendChild(button('Duplicate', '', function () { closeModal(); duplicateHole(m); }));
      l.appendChild(button('Share hole file', '', function () { closeModal(); shareHoles([m.id], m.name || 'hole', null); }));
      l.appendChild(button('Delete', '', function () { closeModal(); confirmBox('Delete this hole?', '"' + (m.name || 'Hole') + '" will be removed from your library and from any course that uses it.', 'Delete', function () { deleteHole(m.id); }); }));
      b.appendChild(l); var r = el('div', 'mrow'); r.appendChild(button('Close', 'chip', closeModal)); b.appendChild(r);
    });
  }

  /* ---------------- holes: create, load, save ---------------- */
  function createHole(tid) {
    busy(true, 'Shaping the land…');
    setTimeout(function () {
      var d = HW.fromTemplate(tid); d.id = newId('h');
      var n = 1, base = d.name, names = S.holes.map(function (h) { return h.name; });
      while (names.indexOf(d.name) >= 0) d.name = base + ' ' + (++n);
      S.hole = d; S.holeId = d.id;
      saveHole(true).then(function () { busy(false); openHoleData(d); }, function () { busy(false); openHoleData(d); });
    }, 30);
  }
  function uniqueName(d, skipId) { var n = 1, base = d.name, names = S.holes.filter(function (h) { return h.id !== skipId; }).map(function (h) { return h.name; }); while (names.indexOf(d.name) >= 0) d.name = base + ' ' + (++n); }
  function createRandom(arch) {
    busy(true, 'Rolling a hole…');
    setTimeout(function () {
      var seed = Math.floor(Math.random() * 1e9), d = HW.randomHole(arch, seed); d.id = newId('h'); d.seed = seed; uniqueName(d);
      S.hole = d; S.holeId = d.id; S.inspireHidden = false;
      saveHole(true).then(function () { busy(false); openHoleData(d); }, function () { busy(false); openHoleData(d); });
    }, 30);
  }
  function reroll() {
    var old = S.hole, arch = (old.template || '').split(':')[1]; if (!arch) return;
    busy(true, 'Rolling again…');
    setTimeout(function () {
      var d = HW.randomHole(arch, Math.floor(Math.random() * 1e9)); d.id = old.id; d.name = old.name; d.par = d.par;
      S.hole = d; S.undo = []; S.redo = []; updateUndo(); baseDirty = true; busy(false); refreshTitle(); showInspire(); markDirty(); drawSoon();
    }, 30);
  }
  function showInspire() { var d = S.hole, on = !!(d && d.inspired && !S.inspireHidden && /^random:/.test(d.template || '')); $('inspire').hidden = !on; if (on) { $('inspireT').textContent = d.inspired; $('reroll').hidden = !!S.undo.length; } }
  $('reroll').addEventListener('click', reroll);
  $('inspireX').addEventListener('click', function () { S.inspireHidden = true; showInspire(); });
  function loadHoleData(id) {
    busy(true, 'Loading the hole…');
    return Store.get('holes', id).then(function (e) { busy(false); if (!e) { alertBox('That hole could not be found.'); return null; } var d = HW.decode(e); d.id = id; return d; }, function () { busy(false); alertBox('The hole could not be loaded. Check your connection and try again.'); return null; });
  }
  function openHole(id) { loadHoleData(id).then(function (d) { if (d) openHoleData(d); }); }
  function openHoleData(d) {
    S.hole = d; S.holeId = d.id; S.undo = []; S.redo = []; S.dirty = false;
    refreshTitle(); setSaved('Saved'); S.inspireHidden = false;
    show('ed'); renderTools(); fitView(); baseDirty = true; drawSoon(); updateUndo(); showInspire(); tourFirstTime();
  }
  function duplicateHole(m) {
    loadHoleData(m.id).then(function (d) {
      if (!d) return; d.id = newId('h'); d.name = (d.name || 'Hole') + ' copy'; S.hole = d; S.holeId = d.id;
      saveHole(true).then(refreshLib);
    });
  }
  function deleteHole(id) {
    Store.del('holes', id).then(function () { return Store.del('holemeta', id); }).then(function () {
      var tasks = S.courses.filter(function (c) { return (c.holes || []).indexOf(id) >= 0; }).map(function (c) { c.holes = c.holes.map(function (h) { return h === id ? null : h; }); return Store.put('courses', c.id, courseDoc(c)); });
      return Promise.all(tasks);
    }).then(refreshLib, refreshLib);
  }
  function alertBox(text) { modal(function (b) { b.appendChild(el('h2', '', 'Heads up')); b.appendChild(el('p', '', text)); var r = el('div', 'mrow'); r.appendChild(button('OK', 'chip', closeModal)); b.appendChild(r); }); }
  function thumbOf(d) {
    var TW = Math.round(HW.NX * 160 / HW.NY), c = document.createElement('canvas'); c.width = TW; c.height = 160; var g = c.getContext('2d');
    var base = baseImage(d); g.imageSmoothingEnabled = true; g.drawImage(base, 0, 0, TW, 160);
    var sx = function (x) { return TW / 2 + x * 160 / 400; }, sy = function (y) { return 160 - (y - HW.PLOT.y0) * 160 / 400; };
    g.fillStyle = 'rgba(20,60,30,.85)'; d.trees.forEach(function (t, i) { if (i % 3) return; g.beginPath(); g.arc(sx(t[1]), sy(t[2]), 1.3, 0, 6.3); g.fill(); });
    g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 1.5; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(sx(d.tee.x), sy(d.tee.y)); g.lineTo(sx(d.basket.x), sy(d.basket.y)); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#ffc93c'; g.fillRect(sx(d.tee.x) - 3, sy(d.tee.y) - 3, 6, 6); g.beginPath(); g.arc(sx(d.basket.x), sy(d.basket.y), 4, 0, 6.3); g.fillStyle = '#f2a13b'; g.fill();
    try { return c.toDataURL('image/jpeg', 0.72); } catch (e) { return ''; }
  }
  function saveHole(now) {
    var d = S.hole; if (!d) return Promise.resolve();
    var meta = { name: d.name, par: d.par, ft: holeFt(d), trees: d.trees.length, updated: Date.now(), template: d.template || '', thumb: thumbOf(d) };
    S.saving = true; setSaved('Saving…');
    return Store.put('holes', d.id, HW.encode(d)).then(function () { return Store.put('holemeta', d.id, meta); }).then(function () {
      S.saving = false; if (!S.dirty) setSaved(Store.mode === 'memory' ? 'Not saved' : 'Saved');
      var m = metaOf(d.id); if (m) Object.assign(m, meta); else S.holes.unshift(Object.assign({ id: d.id }, meta));
    }, function () { S.saving = false; setSaved('Save failed'); });
  }
  var saveT = 0;
  function markDirty() { S.dirty = true; setSaved('Unsaved'); clearTimeout(saveT); saveT = setTimeout(function () { S.dirty = false; saveHole(); }, 1600); }
  function flushSave() { if (S.dirty) { clearTimeout(saveT); S.dirty = false; return saveHole(); } return Promise.resolve(); }
  function setSaved(t) { $('edSaved').textContent = t; }

  /* ---------------- editor header ---------------- */
  $('edBack').addEventListener('click', function () { flushSave().then(function () { show('lib'); refreshLib(); }); });
  function refreshTitle() { var d = S.hole; if (!d) return; $('edName').textContent = d.name || 'Hole'; var dr = holeDropFt(d); $('edMeta').textContent = 'Par ' + d.par + ' · ' + holeFt(d) + ' ft · ' + (dr >= 0 ? 'drops ' : 'climbs ') + Math.abs(dr) + ' ft · ' + d.trees.length + ' trees'; }
  function showPar() { refreshTitle(); }
  function holeSettings() {
    var d = S.hole;
    modal(function (b) {
      b.appendChild(el('h2', '', 'Hole settings'));
      var lab = el('label', 'tsec', 'Name'); lab.setAttribute('for', 'hsName'); b.appendChild(lab);
      var inp = el('input', 'field'); inp.id = 'hsName'; inp.type = 'text'; inp.maxLength = 40; inp.value = d.name; inp.autocomplete = 'off';
      inp.addEventListener('input', function () { d.name = inp.value.trim() || 'Untitled hole'; refreshTitle(); markDirty(); }); b.appendChild(inp);
      b.appendChild(el('div', 'tsec', 'Par'));
      var pr = el('div', 'row'); [3, 4, 5].forEach(function (n) { var x = button('Par ' + n, 'chip' + (d.par === n ? ' on' : ''), function () { d.par = n; [].forEach.call(pr.children, function (c) { c.classList.toggle('on', c === x); }); refreshTitle(); markDirty(); }); pr.appendChild(x); }); b.appendChild(pr);
      b.appendChild(el('p', '', '')).style.marginTop = '12px';
      b.lastChild.textContent = holeFt(d) + ' ft from tee to basket. Suggested par for that length: ' + HW.suggestPar(d) + '.';
      if (d.inspired) b.appendChild(el('p', '', d.inspired));
      var r = el('div', 'mrow'); r.appendChild(button('Done', 'cta', closeModal)); b.appendChild(r);
    });
  }
  $('edTitle').addEventListener('click', holeSettings);
  $('edUndo').addEventListener('click', undo); $('edRedo').addEventListener('click', redo);
  $('ed3d').addEventListener('click', function () { if (S.in3D) exit3D(); else enter3D(); });
  $('edFit').addEventListener('click', function () { fitView(); drawSoon(); });
  $('edHand').addEventListener('click', function () { S.hand = !S.hand; $('edHand').classList.toggle('on', S.hand); $('edHand').setAttribute('aria-pressed', S.hand); map.classList.toggle('hand', S.hand); });
  $('slMore').addEventListener('click', function () { var o = $('dock').classList.toggle('open'); $('slMore').textContent = o ? 'Less' : 'More'; $('slMore').setAttribute('aria-expanded', o); requestAnimationFrame(function () { sizeMap(); drawSoon(); }); });
  $('edPlay').addEventListener('click', function () { flushSave(); playSingle(S.hole, function () { show('ed'); }); });
  function makeWorld(d, extra) {
    var W = HW.world(d); extra = extra || {};
    W.HOLE = { number: extra.number || 1, name: (d.name || 'Hole').toUpperCase(), title: d.name || 'Hole', par: d.par || 3, course: extra.course || '', blurb: extra.blurb || (holeFt(d) + ' ft, par ' + d.par + '.') };
    return W;
  }
  function enter3D() {
    busy(true);
    setTimeout(function () {
      var d = S.hole; AG.load(makeWorld(d)); busy(false);
      var mx = (d.tee.x + d.basket.x) / 2, my = (d.tee.y + d.basket.y) / 2, L = Math.hypot(d.basket.x - d.tee.x, d.basket.y - d.tee.y);
      AG.look({ onTap: on3DTap }); AG.lookAt(mx, my, Math.max(90, L * 0.9), Math.atan2(d.basket.x - d.tee.x, d.basket.y - d.tee.y), 0.55, true);
      S.in3D = true; $('ed3d').classList.add('on'); $('ed3d').setAttribute('aria-pressed', 'true'); $('ed3d').textContent = 'Map'; syncLookbar();
    }, 30);
  }
  function exit3D() { closeTreeSheet(); AG.look(false); AG.setActive(false); S.in3D = false; $('ed3d').classList.remove('on'); $('ed3d').setAttribute('aria-pressed', 'false'); $('ed3d').textContent = '3D'; sizeMap(); drawSoon(); }
  // after an undo in 3D the hole object is a new one: rebuild the scene around it, camera where it was
  function reload3D() { if (!S.in3D) return; closeTreeSheet(); var st = AG.lookState(); AG.load(makeWorld(S.hole)); if (!st.walking) AG.lookAt(st.x, st.y, st.dist, st.yaw); }
  function syncLookbar() {
    var w = AG.isWalking(), see = AG.isSee();
    $('lkWalk').classList.toggle('on', w); $('lkWalk').setAttribute('aria-pressed', w); $('lkWalk').textContent = w ? 'Fly' : 'Walk';
    $('lkSee').classList.toggle('on', see); $('lkSee').setAttribute('aria-pressed', see);
    $('lkHint').textContent = w ? 'Joystick or WASD to walk · drag to look · tap a tree to edit it' : 'Tap a tree to edit it · drag to orbit · pinch to zoom';
  }
  $('lkWalk').addEventListener('click', function () { AG.walk(!AG.isWalking()); syncLookbar(); });
  $('lkSee').addEventListener('click', function () { AG.setSee(!AG.isSee()); syncLookbar(); });
  var TSH = { rec: null, undo: false, t: 0 };
  function on3DTap(p) { if (!p) { closeTreeSheet(); return; } openTreeSheet(p); }
  function treeLabel(type) { var D = HW.TS.DEF[type]; return D ? D.name : 'Tree'; }
  function ageWord(a) { return a < 0.2 ? 'Young' : a < 0.45 ? 'Grown' : a < 0.7 ? 'Mature' : a < 0.88 ? 'Old' : 'Ancient'; }
  function openTreeSheet(p) {
    var rec = p.rec, type = HW.TYPES[rec[0]] || 'pine', D = HW.TS.DEF[type];
    TSH.rec = rec; TSH.undo = false; AG.selectTree(rec);
    $('treeSheet').hidden = false; document.body.classList.add('sheet-open');
    $('tsName').textContent = treeLabel(type);
    var box = $('tsSliders'); box.innerHTML = '';
    function info() { var q = HW.TS.norm({ type: type, h: rec[3], age: rec[8], cb: rec[7] }); $('tsInfo').textContent = Math.round(rec[3] / FT) + ' ft tall · crown ' + Math.round(q.r * 2 / FT) + ' ft wide · ' + (q.base > 1.5 ? 'open underneath for ' + Math.round(q.base / FT) + ' ft' : 'leaves down to the ground') + ' · ' + ageWord(rec[8] == null ? 0.5 : rec[8]).toLowerCase(); }
    function sl(label, min, max, step, val, fmt, set) {
      var l = el('label'); l.appendChild(document.createTextNode(label));
      var i = el('input'); i.type = 'range'; i.min = min; i.max = max; i.step = step; i.value = val;
      var o = el('output', '', fmt(val));
      i.addEventListener('input', function () { if (!TSH.undo) { pushUndo(); TSH.undo = true; } set(+i.value); o.textContent = fmt(+i.value); info(); clearTimeout(TSH.t); TSH.t = setTimeout(function () { AG.refreshPlants(); markDirty(); drawSoon(); }, 110); });
      l.appendChild(i); l.appendChild(o); box.appendChild(l);
    }
    var small = type === 'bush' || type === 'fern';
    sl('Height', +(D.h[0] * 0.6).toFixed(1), +(D.h[1] * 1.3).toFixed(1), 0.1, rec[3], function (v) { return Math.round(v / FT) + ' ft'; }, function (v) { rec[3] = +v.toFixed(2); });
    if (!small && type !== 'palm') sl('Canopy starts', 0, type === 'pine' ? 0.7 : 0.85, 0.01, rec[7] != null ? rec[7] : D.cb, function (v) { return Math.round(v * rec[3] / FT) + ' ft up'; }, function (v) { rec[7] = +v.toFixed(3); });
    if (!small) sl('Age', 0, 1, 0.01, rec[8] != null ? rec[8] : 0.5, ageWord, function (v) { rec[8] = +v.toFixed(3); });
    info();
  }
  function closeTreeSheet() { if (TSH.rec) AG.selectTree(null); TSH.rec = null; clearTimeout(TSH.t); $('treeSheet').hidden = true; document.body.classList.remove('sheet-open'); }
  $('tsDone').addEventListener('click', function () { if (TSH.t) { clearTimeout(TSH.t); AG.refreshPlants(); } closeTreeSheet(); });
  $('tsRemove').addEventListener('click', function () {
    var rec = TSH.rec, d = S.hole, i = d.trees.indexOf(rec); if (i < 0) { closeTreeSheet(); return; }
    if (!TSH.undo) pushUndo();
    closeTreeSheet(); d.trees.splice(i, 1); AG.refreshPlants(); markDirty(); drawSoon(); refreshTitle();
  });
  function playSingle(d, back) {
    busy(true);
    setTimeout(function () {
      AG.load(makeWorld(d)); busy(false);
      AG.play({ onExit: function () { back(); }, nextLabel: 'Back to the builder' });
    }, 30);
  }

  /* ---------------- tools ---------------- */
  function renderTools() {
    var gr = $('groups'); gr.innerHTML = '';
    GROUPS.forEach(function (g) {
      var b = el('button', g.id === S.group ? 'on' : ''); b.type = 'button'; b.innerHTML = g.icon; b.appendChild(el('span', '', g.label));
      b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', g.id === S.group);
      b.addEventListener('click', function () { if (S.group !== g.id) { S.group = g.id; S.op = g.ops[0][0]; } renderTools(); drawSoon(); }); gr.appendChild(b);
    });
    var op = $('opts'); op.innerHTML = '';
    var G0 = GROUPS.filter(function (g) { return g.id === S.group; })[0], onBtn = null;
    G0.ops.forEach(function (o) {
      var b = el('button', o[0] === S.op ? 'on' : ''); b.type = 'button'; b.setAttribute('aria-pressed', o[0] === S.op);
      if (o[2]) { var i = el('i'); i.style.background = o[2]; b.appendChild(i); }
      b.appendChild(document.createTextNode(o[1]));
      b.addEventListener('click', function () { S.op = o[0]; renderTools(); drawSoon(); });
      op.appendChild(b); if (o[0] === S.op) onBtn = b;
    });
    if (onBtn) requestAnimationFrame(function () { var r = op.getBoundingClientRect(), q = onBtn.getBoundingClientRect(); if (q.left < r.left || q.right > r.right) op.scrollLeft += q.left - r.left - 16; });
    var sl = $('sliders'); sl.innerHTML = '';
    function slider(label, min, max, step, val, fmt, set) {
      var l = el('label'); l.appendChild(document.createTextNode(label));
      var i = el('input'); i.type = 'range'; i.min = min; i.max = max; i.step = step; i.value = val; i.id = 'sl' + label.replace(/\W/g, '');
      var o = el('output', '', fmt(val)); i.addEventListener('input', function () { set(+i.value); o.textContent = fmt(+i.value); });
      l.appendChild(i); l.appendChild(o); sl.appendChild(l);
    }
    var ft = function (v) { return Math.round(v / FT) + ' ft'; }, pct = function (v) { return Math.round(v * 100) + '%'; };
    if (S.group === 'sculpt') { slider('Brush', 2, 40, 1, S.size, ft, function (v) { S.size = v; drawSoon(); }); slider('Strength', 0.05, 1, 0.05, S.str, pct, function (v) { S.str = v; }); }
    else if (S.group === 'paint') {
      slider('Brush', 2, 40, 1, S.size, ft, function (v) { S.size = v; drawSoon(); }); slider('Strength', 0.05, 1, 0.05, S.str, pct, function (v) { S.str = v; });
      var d = S.hole, lo = 1e9, hi = -1e9; for (var k = 0; k < d.h.length; k += 7) { lo = Math.min(lo, d.h[k]); hi = Math.max(hi, d.h[k]); }
      slider('Water level', Math.floor(lo - 3), Math.ceil(hi), 0.1, d.water, function (v) { return v < lo ? 'none' : Math.round((v - lo) / FT) + ' ft up'; }, function (v) { d.water = v; baseDirty = true; markDirty(); drawSoon(); });
    } else if (S.group === 'plant') {
      slider('Brush', 2, 40, 1, S.size, ft, function (v) { S.size = v; drawSoon(); });
      if (S.op !== 'erase') {
        if (S.op !== 'shape') slider(S.op === 'thin' ? 'Thin by' : 'Density', 0.05, 1, 0.05, S.str, pct, function (v) { S.str = v; });
        if (S.op !== 'thin') {
          slider('Age', 0, 1, 0.01, S.tree.age, ageWord, function (v) { S.tree.age = v; });
          if (S.op !== 'shape') slider('Variety', 0, 1, 0.05, S.tree.variety, function (v) { return v < 0.1 ? 'Uniform' : v < 0.5 ? 'Some' : v < 0.8 ? 'Lots' : 'Wild'; }, function (v) { S.tree.variety = v; });
          slider('Canopy', 0, 0.85, 0.01, S.tree.canopy, function (v) { return v < 0.02 ? 'Natural' : 'opens ' + Math.round(v * 100) + '% up'; }, function (v) { S.tree.canopy = v; });
        }
      }
    } else if (S.group === 'paths') {
      if (S.op !== 'delpath') {
        slider('Width', 4, 24, 0.5, S.pathW, ft, function (v) { S.pathW = v; drawSoon(); });
        if (S.op === 'tunnel') slider('Ceiling', 3, 30, 0.5, S.pathClear, ft, function (v) { S.pathClear = v; });
      }
    } else if (S.group === 'place' && ['tee', 'basket', 'delobj'].indexOf(S.op) < 0) {
      var tr = S.op === 'guardian1' || S.op === 'oak1';
      slider(tr ? 'Age' : S.op === 'wall' ? 'Wall height' : 'Size', 2, 40, 1, S.size, function (v) { return tr ? ageWord(v / 40) : S.op === 'wall' ? (0.2 + v * 0.05).toFixed(1) + ' m' : elemSizeLabel(S.op, v); }, function (v) { S.size = v; drawSoon(); });
    }
    if (!sl.children.length) sl.appendChild(el('label', '', S.group === 'place' ? (S.op === 'delobj' ? 'Tap a piece to remove it' : 'Tap the map to place it') : 'Tap a path to remove it'));
    $('slMore').hidden = sl.children.length < 2;
    var hint = { paths: S.op === 'delpath' ? '' : 'Drag along the line you want through the trees', place: dragHint(S.op) }[S.group];
    if (hint) toastMsg(hint);
    requestAnimationFrame(function () { sizeMap(); drawSoon(); });
  }
  function dragHint(op) { return { log: 'Drag to lay a log, as long as you drag', ruin: 'Drag to set the ruin wall', wall: 'Drag to draw a wall', arch: 'Tap, or drag the way you throw through it', ring: 'Tap, or drag the way you throw through it', disc: 'Tap, or drag the way it faces', head: 'Tap, or drag the way it looks', mono: 'Tap, or drag the way it faces', pyr: 'Tap, or drag to turn it' }[op] || ''; }
  function elemSizeLabel(op, v) { var o = makeObj(op, 0, 0, 0, 0, v); if (!o) return ''; var m = o.k === 'rock' || o.k === 'ring' || o.k === 'disc' ? o.r * 2 : o.k === 'log' ? o.r * 2 : o.k === 'pyr' ? o.s * 2 : o.k === 'head' ? o.s : o.h != null ? o.h : o.w; return Math.round(m / FT) + ' ft'; }

  /* ---------------- the map ---------------- */
  var map = $('map'), mctx = map.getContext('2d'), VIEW = { sc: 1, ox: 0, oy: 0 }, dpr = 1, baseCanvas = null, baseDirty = true, drawPending = false, hover = null;
  // on a wide screen the hole lies on its side, tee on the left and basket on the right, so it fills the width.
  // Everything is drawn in an upright "virtual" map; ROT turns that a quarter turn onto the screen.
  var ROT = false, LANDQ = window.matchMedia ? window.matchMedia('(orientation: landscape) and (min-width: 820px)') : null;
  function vdims() { var r = map.getBoundingClientRect(); return ROT ? { width: r.height, height: r.width } : { width: r.width, height: r.height }; }
  function sizeMap() {
    var r = map.getBoundingClientRect(); dpr = Math.min(2, window.devicePixelRatio || 1);
    map.width = Math.max(10, Math.round(r.width * dpr)); map.height = Math.max(10, Math.round(r.height * dpr));
    var rot = !!(LANDQ && LANDQ.matches && r.width > r.height * 1.05);
    if (rot !== ROT) { ROT = rot; if (S.hole) fitView(); }
  }
  function fitView() {
    sizeMap(); var r = vdims(), P = HW.PLOT;
    var gut = ROT ? 64 : 0;   // keep the turned hole clear of the buttons down the right edge
    var sc = Math.min(r.width / (P.x1 - P.x0 + 10), (r.height - gut) / (P.y1 - P.y0 + 10));
    VIEW.sc = sc; VIEW.ox = r.width / 2 - (P.x0 + P.x1) / 2 * sc; VIEW.oy = (r.height + gut) / 2 + (P.y0 + P.y1) / 2 * sc;
  }
  // upright text on the turned map
  function label(g, t, x, y, stroke) { if (ROT) { g.save(); g.translate(x, y); g.rotate(-Math.PI / 2); x = 0; y = 0; } if (stroke) g.strokeText(t, x, y); g.fillText(t, x, y); if (ROT) g.restore(); }
  window.addEventListener('resize', function () { if (!$('ed').hidden) { sizeMap(); drawSoon(); } });
  function toS(x, y) { return [VIEW.ox + x * VIEW.sc, VIEW.oy - y * VIEW.sc]; }
  function toW(sx, sy) { return [(sx - VIEW.ox) / VIEW.sc, (VIEW.oy - sy) / VIEW.sc]; }
  function hex(c) { return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]; }
  var SC_RGB = SURF_COL.map(hex);
  // the painted base: surface colour, hillshade, contours every 2.5 m, water by depth
  function baseImage(d) {
    var NX = HW.NX, NY = HW.NY, c = document.createElement('canvas'); c.width = NX; c.height = NY;
    var g = c.getContext('2d'), img = g.createImageData(NX, NY), px = img.data, cell = HW.PLOT.cell;
    for (var j = 0; j < NY; j++) for (var i = 0; i < NX; i++) {
      var k = j * NX + i, h = d.h[k], o = ((NY - 1 - j) * NX + i) * 4;
      var hl = d.h[j * NX + Math.max(0, i - 1)], hr = d.h[j * NX + Math.min(NX - 1, i + 1)], hd = d.h[Math.max(0, j - 1) * NX + i], hu = d.h[Math.min(NY - 1, j + 1) * NX + i];
      var nx = (hl - hr) / (2 * cell), ny = (hd - hu) / (2 * cell), shade = clamp(0.86 + (-nx * 0.55 + ny * 0.75) * 0.9, 0.45, 1.3);
      var rgb;
      if (h < d.water - 0.02) { var dep = clamp((d.water - h) / 4, 0, 1); rgb = [lerp(92, 34, dep), lerp(190, 110, dep), lerp(212, 160, dep)]; shade = 1; }
      else rgb = SC_RGB[d.s[k]] || SC_RGB[2];
      var r = rgb[0] * shade, gg = rgb[1] * shade, b = rgb[2] * shade;
      var band = Math.floor(h / 2.5), cr = Math.floor(hr / 2.5) !== band || Math.floor(hu / 2.5) !== band;
      if (cr && h >= d.water) { var f = Math.floor(h / 10) !== Math.floor(hr / 10) || Math.floor(h / 10) !== Math.floor(hu / 10) ? 0.62 : 0.8; r *= f; gg *= f; b *= f; }
      px[o] = clamp(r, 0, 255); px[o + 1] = clamp(gg, 0, 255); px[o + 2] = clamp(b, 0, 255); px[o + 3] = 255;
    }
    g.putImageData(img, 0, 0); return c;
  }
  function drawSoon() { if (drawPending) return; drawPending = true; requestAnimationFrame(function () { drawPending = false; draw(); }); }
  function draw() {
    var d = S.hole; if (!d || $('ed').hidden) return;
    var g = mctx, vd = vdims(), W = vd.width, H = vd.height;
    g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#0e0c1f'; g.fillRect(0, 0, map.width, map.height);
    if (ROT) g.setTransform(0, dpr, -dpr, 0, map.width, 0); else g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (baseDirty || !baseCanvas) { baseCanvas = baseImage(d); baseDirty = false; }
    var P = HW.PLOT, cell = P.cell, a = toS(P.x0 - cell / 2, P.y1 + cell / 2);
    g.imageSmoothingEnabled = true; g.drawImage(baseCanvas, a[0], a[1], HW.NX * cell * VIEW.sc, HW.NY * cell * VIEW.sc);
    g.strokeStyle = 'rgba(255,255,255,.25)'; g.lineWidth = 1; var b0 = toS(P.x0, P.y1), b1 = toS(P.x1, P.y0); g.strokeRect(b0[0], b0[1], b1[0] - b0[0], b1[1] - b0[1]);
    // trees, batched by type
    var byType = {}; d.trees.forEach(function (t) { var ty = HW.TYPES[t[0]] || 'pine'; (byType[ty] = byType[ty] || []).push(t); });
    Object.keys(byType).forEach(function (ty) {
      g.beginPath();
      var big = ty === 'guardian' || ty === 'oak';
      byType[ty].forEach(function (t) { var p = toS(t[1], t[2]), r = Math.max(big ? 2.2 : 1.3, HW.crownR(ty, t[3], t[8]) * VIEW.sc * 0.5); if (p[0] < -r || p[1] < -r || p[0] > W + r || p[1] > H + r) return; g.moveTo(p[0] + r, p[1]); g.arc(p[0], p[1], r, 0, 6.2832); });
      g.globalAlpha = big ? 0.8 : 0.88; g.fillStyle = TREE_COL[ty] || '#3f8a3a'; g.fill(); g.globalAlpha = 1;
      if (big) { g.globalAlpha = 0.6; g.strokeStyle = ty === 'guardian' ? '#7dffcf' : '#e8d27a'; g.lineWidth = 1.2; g.stroke(); g.globalAlpha = 1; } else if (VIEW.sc > 1.2) { g.strokeStyle = 'rgba(8,20,12,.55)'; g.lineWidth = 1; g.stroke(); }
    });
    // paths, then every built piece
    d.objs.forEach(function (o) { if (o.k === 'path') drawPath(g, o.pts, o.w, o.mode, false); });
    d.objs.forEach(function (o) { if (o.k !== 'path') drawObj(g, o); });
    if (STROKE && STROKE.path && STROKE.path.length > 1) drawPath(g, STROKE.path, S.pathW, S.op, true);
    if (STROKE && STROKE.ghost) drawObj(g, STROKE.ghost, true);
    // tee, basket and the line between
    var tp = toS(d.tee.x, d.tee.y), bp = toS(d.basket.x, d.basket.y);
    g.setLineDash([6, 6]); g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 2; g.beginPath(); g.moveTo(tp[0], tp[1]); g.lineTo(bp[0], bp[1]); g.stroke(); g.setLineDash([]);
    var ft = holeFt(d); g.font = '800 13px "Alegreya Sans", sans-serif'; g.textAlign = 'center';
    var mx = (tp[0] + bp[0]) / 2, my = (tp[1] + bp[1]) / 2; g.lineWidth = 4; g.strokeStyle = 'rgba(14,12,31,.85)'; g.fillStyle = '#fff'; label(g, ft + ' FT', ROT ? mx : mx + 14, ROT ? my : my, true);
    g.fillStyle = '#ffc93c'; g.strokeStyle = '#15132a'; g.lineWidth = 2; g.fillRect(tp[0] - 7, tp[1] - 7, 14, 14); g.strokeRect(tp[0] - 7, tp[1] - 7, 14, 14);
    g.fillStyle = '#15132a'; g.font = '800 10px "Alegreya Sans", sans-serif'; g.textBaseline = 'middle'; label(g, 'T', tp[0], tp[1] + 0.5); g.textBaseline = 'alphabetic';
    g.beginPath(); g.arc(bp[0], bp[1], 8, 0, 6.2832); g.fillStyle = '#f2a13b'; g.fill(); g.lineWidth = 2.5; g.strokeStyle = '#15132a'; g.stroke(); g.beginPath(); g.arc(bp[0], bp[1], 3, 0, 6.2832); g.fillStyle = '#e9eef2'; g.fill();
    // brush
    if (hover && !S.hand && !(STROKE && (STROKE.ghost || STROKE.path)) && ['tee', 'basket'].indexOf(S.op) < 0) {
      var hp = toS(hover[0], hover[1]), rr = brushR() * VIEW.sc;
      g.beginPath(); g.arc(hp[0], hp[1], Math.max(4, rr), 0, 6.2832); g.lineWidth = 2; g.strokeStyle = 'rgba(14,12,31,.7)'; g.stroke(); g.lineWidth = 1.2; g.strokeStyle = '#fff'; g.stroke();
    }
    refreshTitle();
  }
  function brushR() {
    if (S.group === 'paths') return S.op === 'delpath' ? 4 : S.pathW / 2;
    if (S.group === 'place') { if (S.op === 'delobj') return 4; var o = makeObj(S.op, 0, 0, 0, 0, S.size); return o ? (o.r || o.s || (o.w || o.h || 3) / 2 || 1.5) : 1.5; }
    return S.size;
  }
  function drawPath(g, pts, w, mode, live) {
    if (pts.length < 2) return;
    g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath(); pts.forEach(function (q, i) { var p = toS(q[0], q[1]); if (i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); });
    g.strokeStyle = mode === 'tunnel' ? 'rgba(125,255,207,.28)' : 'rgba(255,201,60,.3)'; g.lineWidth = Math.max(4, w * VIEW.sc); g.stroke();
    g.setLineDash(mode === 'tunnel' ? [7, 6] : []); g.strokeStyle = mode === 'tunnel' ? '#7dffcf' : '#ffc93c'; g.lineWidth = live ? 2.5 : 1.8; g.stroke(); g.setLineDash([]);
  }
  // each built piece as a little plan drawing
  function drawObj(g, o, ghost) {
    var sc = VIEW.sc, p = toS(o.x, o.y), c = Math.cos(o.yaw || 0), s2 = Math.sin(o.yaw || 0), ink = '#2b2a26';
    function line(len, wid, col) { var a = toS(o.x - c * len / 2, o.y - s2 * len / 2), b = toS(o.x + c * len / 2, o.y + s2 * len / 2); g.lineCap = 'round'; g.strokeStyle = ink; g.lineWidth = Math.max(3, wid * sc + 2); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); g.strokeStyle = col; g.lineWidth = Math.max(1.6, wid * sc); g.stroke(); }
    function circ(r, col, stroke) { g.beginPath(); g.arc(p[0], p[1], Math.max(2.5, r * sc), 0, 6.2832); if (col) { g.fillStyle = col; g.fill(); } g.strokeStyle = stroke || ink; g.lineWidth = 1.4; g.stroke(); }
    function rect(hx, hy, col) { g.save(); g.translate(p[0], p[1]); g.rotate(-(o.yaw || 0)); g.fillStyle = col; g.strokeStyle = ink; g.lineWidth = 1.4; var w = Math.max(3, hx * 2 * sc), h = Math.max(3, hy * 2 * sc); g.fillRect(-w / 2, -h / 2, w, h); g.strokeRect(-w / 2, -h / 2, w, h); g.restore(); }
    function arrow(len) { var b = toS(o.x + c * len, o.y + s2 * len); g.strokeStyle = '#ffc93c'; g.lineWidth = 2; g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(b[0], b[1]); g.stroke(); }
    if (ghost) g.globalAlpha = 0.7;
    switch (o.k) {
      case 'wall': line(o.len, 1, '#9c9786'); break;
      case 'rock': circ(o.r, '#8b8a80'); break;
      case 'log': line(o.len, o.r * 2, '#6b4a32'); break;
      case 'ruin': g.setLineDash([Math.max(3, 1.4 * sc), Math.max(2, 0.6 * sc)]); line(o.len, 0.9, '#b39d78'); g.setLineDash([]); break;
      case 'col': circ(o.r, '#c8b892'); break;
      case 'arch': { var t = Math.max(0.8, o.w * 0.18), off = o.w / 2 + t / 2; [-1, 1].forEach(function (k) { var q = toS(o.x - s2 * off * k, o.y + c * off * k); g.fillStyle = '#b39d78'; g.strokeStyle = ink; var z = Math.max(3, t * sc); g.fillRect(q[0] - z / 2, q[1] - z / 2, z, z); g.strokeRect(q[0] - z / 2, q[1] - z / 2, z, z); }); arrow(o.w * 0.6); break; }
      case 'mono': rect(o.h * 0.07, o.h * 0.17, '#4a4656'); break;
      case 'head': circ(o.s * 0.5, '#9b8e74'); arrow(o.s * 0.9); break;
      case 'ring': case 'disc': { var a = toS(o.x - s2 * o.r, o.y + c * o.r), b = toS(o.x + s2 * o.r, o.y - c * o.r); g.lineCap = 'round'; g.strokeStyle = ink; g.lineWidth = 5; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); g.strokeStyle = o.k === 'ring' ? '#aaa392' : '#e23a6a'; g.lineWidth = 3; g.stroke(); arrow(o.r * 0.8); break; }
      case 'pyr': for (var i = 0; i < 5; i++) { var hs = o.s * (1 - i * 0.17); rect(hs, hs, i % 2 ? '#bca67f' : '#a8946e'); } break;
    }
    g.globalAlpha = 1;
  }
  function info(x, y) {
    var d = S.hole; if (!HW.inPlot(x, y)) { $('mapInfo').textContent = 'Outside the plot'; return; }
    var h = HW.hAt(d, x, y), wet = h < d.water - 0.02;
    $('mapInfo').textContent = (wet ? 'Water, ' + Math.round((d.water - h) / FT) + ' ft deep' : HW.SURF_NAME[HW.sAt(d, x, y)]) + ' · ' + Math.round((h - HW.hAt(d, d.tee.x, d.tee.y)) / FT) + ' ft from tee height · ' + Math.round(Math.hypot(x - d.tee.x, y - d.tee.y) / FT) + ' ft out';
  }

  /* ---------------- brushes ---------------- */
  function forCells(cx, cy, r, fn) {
    var P = HW.PLOT, i0 = Math.max(0, Math.floor(HW.gx(cx - r))), i1 = Math.min(HW.NX - 1, Math.ceil(HW.gx(cx + r))), j0 = Math.max(0, Math.floor(HW.gy(cy - r))), j1 = Math.min(HW.NY - 1, Math.ceil(HW.gy(cy + r)));
    for (var j = j0; j <= j1; j++) for (var i = i0; i <= i1; i++) {
      var x = HW.wx(i), y = HW.wy(j), dd = Math.hypot(x - cx, y - cy); if (dd > r) continue;
      var q = 1 - (dd / r) * (dd / r); fn(j * HW.NX + i, q * q, x, y, dd);
    }
  }
  var MINSP = { pine: 4.2, broad: 4.8, palm: 4.2, bush: 2.2, fern: 1.9, guardian: 9, oak: 10 };
  function treeOpts(type) { var o = { age: S.tree.age, variety: S.tree.variety }; if (S.tree.canopy >= 0.02 && type !== 'palm' && type !== 'bush' && type !== 'fern') o.cb = Math.min(type === 'pine' ? 0.7 : 0.85, S.tree.canopy); return o; }
  function apply(x, y) {
    var d = S.hole, r = S.size, st = S.str, op = S.op, changed = false;
    if (S.group === 'sculpt') {
      if (op === 'raise' || op === 'lower') { var sg = op === 'raise' ? 1 : -1; forCells(x, y, r, function (k, w) { d.h[k] += sg * st * 0.7 * w; }); }
      else if (op === 'smooth') { var src = new Float32Array(d.h); forCells(x, y, r, function (k, w) { var i = k % HW.NX, j = (k / HW.NX) | 0, sum = 0, n = 0; for (var b = -1; b <= 1; b++) for (var a = -1; a <= 1; a++) { var ii = i + a, jj = j + b; if (ii < 0 || jj < 0 || ii >= HW.NX || jj >= HW.NY) continue; sum += src[jj * HW.NX + ii]; n++; } d.h[k] = lerp(d.h[k], sum / n, st * w); }); }
      else if (op === 'flatten') { var h0 = STROKE.h0; forCells(x, y, r, function (k, w) { d.h[k] += (h0 - d.h[k]) * st * 0.6 * w; }); }
      baseDirty = true; changed = true;
    } else if (S.group === 'paint') {
      if (op === 'water') {
        var here = HW.hAt(d, x, y);
        if (d.water < here - 3) { d.water = Math.round((here - 0.9) * 10) / 10; toastMsg('Water level set at this spot'); }
        var tgt = d.water - 1.4; forCells(x, y, r, function (k, w) { if (d.h[k] > tgt) d.h[k] = lerp(d.h[k], tgt, w * (0.25 + st * 0.6)); });
      } else if (op === 'fill') { forCells(x, y, r, function (k, w) { var t2 = d.water + 0.7; if (d.h[k] < t2) d.h[k] = lerp(d.h[k], t2, w * (0.25 + st * 0.6)); }); }
      else { var code = +op.slice(1); forCells(x, y, r, function (k, w) { if (w > 0.08 + (Math.random() - 0.5) * 0.12) d.s[k] = code; }); }
      baseDirty = true; changed = true;
    } else if (S.group === 'plant') {
      if (op === 'erase') { var before = d.trees.length; d.trees = d.trees.filter(function (t) { return Math.hypot(t[1] - x, t[2] - y) > r; }); changed = d.trees.length !== before; }
      else if (op === 'thin' || op === 'shape') {
        var seen = STROKE.seen || (STROKE.seen = new Set()), keep = [];
        d.trees.forEach(function (t) {
          if (seen.has(t) || Math.hypot(t[1] - x, t[2] - y) > r) { keep.push(t); return; }
          seen.add(t);
          if (op === 'thin') { if (Math.random() < st * 0.7) { changed = true; return; } keep.push(t); return; }
          var ty = HW.TYPES[t[0]] || 'pine', D = HW.TS.DEF[ty], hv = HW.TS.heightFor(ty, S.tree.age, 0.15, Math.random);
          t[3] = +hv.h.toFixed(2); t[8] = +hv.age.toFixed(3);
          if (ty !== 'palm' && ty !== 'bush' && ty !== 'fern') t[7] = +(S.tree.canopy >= 0.02 ? Math.min(ty === 'pine' ? 0.7 : 0.85, S.tree.canopy) : D.cb).toFixed(3);
          keep.push(t); changed = true;
        });
        d.trees = keep;
      }
      else {
        var area = Math.PI * r * r, tries = Math.max(1, Math.round(area / 55 * st * 1.6)), Rr = Math.random;
        for (var q = 0; q < tries; q++) {
          var a2 = Rr() * 6.2832, rd = Math.sqrt(Rr()) * r, px = x + Math.cos(a2) * rd, py = y + Math.sin(a2) * rd;
          if (!HW.inPlot(px, py) || HW.hAt(d, px, py) < d.water + 0.25) continue;
          if (Math.hypot(px - d.tee.x, py - d.tee.y) < 8 || Math.hypot(px - d.basket.x, py - d.basket.y) < 3.5) continue;
          var type = op === 'mixed' ? HW.mixedType(d, px, py, Rr) : op, sp = MINSP[type] * (1.45 - st * 0.55), ok = true;
          var cells = STROKE.grid;
          var gi = Math.floor(px / 6), gj = Math.floor(py / 6);
          for (var b = -1; b <= 1 && ok; b++) for (var a = -1; a <= 1 && ok; a++) { var lst = cells[(gi + a) + ',' + (gj + b)]; if (lst) for (var z = 0; z < lst.length; z++) { if (Math.hypot(lst[z][1] - px, lst[z][2] - py) < Math.min(sp, MINSP[HW.TYPES[lst[z][0]]] || 3)) { ok = false; break; } } }
          if (!ok) continue;
          if (!HW.addTree(d, type, px, py, Rr, treeOpts(type))) { toastMsg('Tree limit reached (' + HW.MAX_TREES + ')'); break; }
          var t = d.trees[d.trees.length - 1], key = gi + ',' + gj; (cells[key] = cells[key] || []).push(t); changed = true;
        }
      }
    }
    if (changed) { STROKE.changed = true; drawSoon(); }
  }
  function treeGrid() { var g = {}; S.hole.trees.forEach(function (t) { var k = Math.floor(t[1] / 6) + ',' + Math.floor(t[2] / 6); (g[k] = g[k] || []).push(t); }); return g; }
  // an element from a tap (x, y) or a drag (x, y) to (x2, y2), sized by the slider value v
  function makeObj(op, x, y, x2, y2, v) {
    var d = S.hole, L = Math.hypot(x2 - x, y2 - y), dragged = L > 1.5, dir = Math.atan2(y2 - y, x2 - x);
    var line = d ? Math.atan2(d.basket.y - d.tee.y, d.basket.x - d.tee.x) : 1.5708, faceTee = d ? Math.atan2(d.tee.y - y, d.tee.x - x) : -1.5708;
    var yaw = dragged ? dir : line, r2 = function (q) { return +q.toFixed(2); }, a4 = function (q) { return +q.toFixed(4); };
    switch (op) {
      case 'rock': return { k: 'rock', x: r2(x), y: r2(y), r: r2(0.4 + v * 0.09) };
      case 'wall': return { k: 'wall', x: r2((x + x2) / 2), y: r2((y + y2) / 2), len: r2(dragged ? L : 3), yaw: a4(dragged ? dir : 0), h: r2(0.2 + v * 0.05) };
      case 'log': return { k: 'log', x: r2(dragged ? (x + x2) / 2 : x), y: r2(dragged ? (y + y2) / 2 : y), len: r2(dragged ? Math.max(4, L) : 6 + v * 0.25), yaw: a4(dragged ? dir : line + 1.5708), r: r2(0.5 + v * 0.03) };
      case 'ruin': return { k: 'ruin', x: r2(dragged ? (x + x2) / 2 : x), y: r2(dragged ? (y + y2) / 2 : y), len: r2(dragged ? Math.max(3, L) : 10), yaw: a4(dragged ? dir : line + 1.5708), h: r2(0.8 + v * 0.08) };
      case 'col': return { k: 'col', x: r2(x), y: r2(y), r: r2(0.4 + v * 0.02), h: r2(2 + v * 0.2) };
      case 'arch': { var w = 3 + v * 0.2; return { k: 'arch', x: r2(x), y: r2(y), yaw: a4(yaw), w: r2(w), h: r2(w * 0.9) }; }
      case 'mono': return { k: 'mono', x: r2(x), y: r2(y), yaw: a4(dragged ? dir : faceTee), h: r2(2 + v * 0.2) };
      case 'head': return { k: 'head', x: r2(x), y: r2(y), yaw: a4(dragged ? dir : faceTee), s: r2(1.5 + v * 0.15) };
      case 'ring': return { k: 'ring', x: r2(x), y: r2(y), yaw: a4(yaw), r: r2(1.5 + v * 0.12) };
      case 'disc': return { k: 'disc', x: r2(x), y: r2(y), yaw: a4(yaw), r: r2(1.5 + v * 0.12) };
      case 'pyr': return { k: 'pyr', x: r2(x), y: r2(y), yaw: a4(dragged ? dir : line), s: r2(4 + v * 0.5) };
    }
    return null;
  }
  function place(x, y, x2, y2) {
    var d = S.hole, op = S.op;
    if (!HW.inPlot(x, y)) return false;
    if (op === 'tee') { d.tee = { x: +x.toFixed(2), y: +y.toFixed(2) }; d.trees = d.trees.filter(function (t) { return Math.hypot(t[1] - x, t[2] - y) > 4; }); }
    else if (op === 'basket') { d.basket = { x: +x.toFixed(2), y: +y.toFixed(2) }; d.trees = d.trees.filter(function (t) { return Math.hypot(t[1] - x, t[2] - y) > 2.5; }); }
    else if (op === 'guardian1' || op === 'oak1') {
      var type = op === 'oak1' ? 'oak' : 'guardian', age = clamp(S.size / 40, 0, 1), room = HW.crownR(type, lerp(HW.TS.DEF[type].h[0], HW.TS.DEF[type].h[1], age), age) * 0.45;
      d.trees = d.trees.filter(function (t) { return Math.hypot(t[1] - x, t[2] - y) > Math.max(3, room); });
      if (!HW.addTree(d, type, x, y, Math.random, { age: age, variety: 0.05 })) { toastMsg('Tree limit reached'); return false; }
      toastMsg((type === 'oak' ? 'An ancient oak' : 'A guardian') + ' takes its place. Trees in its way were cleared.');
    }
    else if (op === 'delobj') { var best = -1, bd = 5; d.objs.forEach(function (o, i) { if (o.k === 'path') return; var dd = objDist(o, x, y); if (dd < bd) { bd = dd; best = i; } }); if (best < 0) return false; d.objs.splice(best, 1); }
    else { var o = makeObj(op, x, y, x2, y2, S.size); if (!o) return false; if (o.len > 80) return false; d.objs.push(o); }
    return true;
  }
  function objDist(o, x, y) {
    if (o.k === 'wall' || o.k === 'log' || o.k === 'ruin') return segDist(o, x, y) - (o.r || 0.5);
    var rr = o.r || (o.s ? o.s * 0.6 : 0) || (o.w ? o.w / 2 : 0) || (o.h ? o.h * 0.15 : 1);
    return Math.max(0, Math.hypot(o.x - x, o.y - y) - rr);
  }
  // a path drawn on the map: cut it through the forest
  function cutPath(pts) {
    var d = S.hole, keep = [pts[0]];
    for (var i = 1; i < pts.length; i++) { var a = keep[keep.length - 1]; if (Math.hypot(pts[i][0] - a[0], pts[i][1] - a[1]) >= 5 || i === pts.length - 1) keep.push(pts[i]); }
    var len = 0; for (i = 1; i < keep.length; i++) len += Math.hypot(keep[i][0] - keep[i - 1][0], keep[i][1] - keep[i - 1][1]);
    if (len < 6) { toastMsg('Drag a longer line to cut a path'); return false; }
    var o = { k: 'path', pts: keep.map(function (q) { return [+q[0].toFixed(2), +q[1].toFixed(2)]; }), w: S.pathW, mode: S.op === 'open' ? 'open' : 'tunnel', clear: S.pathClear };
    var before = d.trees.filter(function (t) { return t[7] != null; }).map(function (t) { return t[7]; }).join(), n = HW.applyPath(d, o);
    d.objs.push(o); baseDirty = true;
    toastMsg(o.mode === 'tunnel' ? 'Tunnel cut: ' + n + ' trees cleared, the canopy lifted to ' + Math.round(o.clear / FT) + ' ft over the lane' : 'Lane cut: ' + n + ' trees cleared');
    return true;
  }
  function delPath(x, y) {
    var d = S.hole, best = -1, bd = 6;
    d.objs.forEach(function (o, i) { if (o.k !== 'path') return; var q = HW.distToPath(o.pts, x, y).d - o.w / 2; if (q < bd) { bd = q; best = i; } });
    if (best < 0) return false; d.objs.splice(best, 1); toastMsg('Path removed. Cleared trees stay cleared (Undo brings them back).'); return true;
  }
  function segDist(o, x, y) { var c = Math.cos(o.yaw), s = Math.sin(o.yaw), u = clamp((x - o.x) * c + (y - o.y) * s, -o.len / 2, o.len / 2), px = o.x + c * u, py = o.y + s * u; return Math.hypot(x - px, y - py); }
  var toastT = 0;
  function toastMsg(t) { var m = $('mapInfo'); m.textContent = t; clearTimeout(toastT); toastT = setTimeout(function () { if (hover) info(hover[0], hover[1]); }, 1800); }

  /* ---------------- undo ---------------- */
  function pushUndo() { S.undo.push(HW.clone(S.hole)); if (S.undo.length > 25) S.undo.shift(); S.redo = []; updateUndo(); }
  function restore(snap) { var keep = { id: S.hole.id, name: S.hole.name, par: S.hole.par }; S.hole = snap; Object.assign(S.hole, keep); baseDirty = true; drawSoon(); markDirty(); updateUndo(); if (S.group === 'paint') renderTools(); refreshTitle(); showInspire(); reload3D(); }
  function undo() { if (!S.undo.length) return; S.redo.push(HW.clone(S.hole)); restore(S.undo.pop()); }
  function redo() { if (!S.redo.length) return; S.undo.push(HW.clone(S.hole)); restore(S.redo.pop()); }
  function updateUndo() { $('edUndo').disabled = !S.undo.length; $('edRedo').disabled = !S.redo.length; if (S.undo.length && !$('inspire').hidden) $('reroll').hidden = true; }
  window.addEventListener('keydown', function (e) {
    if ($('ed').hidden || document.body.classList.contains('mode-play')) return;
    if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) && e.target.type !== 'range') return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
  });

  /* ---------------- map input: one finger paints, two fingers pan and zoom ---------------- */
  var PTR = {}, STROKE = null, PINCH = null, PAN = null;
  function lp(e) { var r = map.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top; return ROT ? [y, r.width - x] : [x, y]; }
  map.addEventListener('pointerdown', function (e) {
    e.preventDefault(); try { map.setPointerCapture(e.pointerId); } catch (x) {}
    PTR[e.pointerId] = lp(e);
    var ids = Object.keys(PTR);
    if (ids.length === 2) {
      endStroke(true);
      var a = PTR[ids[0]], b = PTR[ids[1]];
      PINCH = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), m: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], v: Object.assign({}, VIEW) }; PAN = null; return;
    }
    if (ids.length > 2) return;
    var p = PTR[e.pointerId], w = toW(p[0], p[1]);
    if (S.hand || e.button === 1 || e.button === 2 || e.altKey) { PAN = { p: p, v: Object.assign({}, VIEW) }; return; }
    STROKE = { id: e.pointerId, start: p, w0: w, last: w, moved: false, changed: false, h0: HW.hAt(S.hole, w[0], w[1]), grid: null, undoPushed: false };
    if (S.group === 'place') { STROKE.ghost = makeObj(S.op, w[0], w[1], w[0], w[1], S.size); hover = w; drawSoon(); return; }
    if (S.group === 'paths') { if (S.op !== 'delpath') STROKE.path = [w]; hover = w; drawSoon(); return; }
    pushUndo(); STROKE.undoPushed = true; if (S.group === 'plant') STROKE.grid = treeGrid();
    apply(w[0], w[1]); hover = w;
  });
  map.addEventListener('pointermove', function (e) {
    var p = lp(e), w = toW(p[0], p[1]);
    if (!PTR[e.pointerId]) { if (e.pointerType === 'mouse') { hover = w; info(w[0], w[1]); drawSoon(); } return; }
    PTR[e.pointerId] = p;
    var ids = Object.keys(PTR);
    if (PINCH && ids.length >= 2) {
      var a = PTR[ids[0]], b = PTR[ids[1]], d = Math.hypot(a[0] - b[0], a[1] - b[1]), m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      var k = clamp(PINCH.v.sc * d / Math.max(10, PINCH.d), 0.4, 40) / PINCH.v.sc;
      VIEW.sc = PINCH.v.sc * k; VIEW.ox = m[0] - (PINCH.m[0] - PINCH.v.ox) * k; VIEW.oy = m[1] - (PINCH.m[1] - PINCH.v.oy) * k;
      drawSoon(); return;
    }
    if (PAN) { VIEW.ox = PAN.v.ox + p[0] - PAN.p[0]; VIEW.oy = PAN.v.oy + p[1] - PAN.p[1]; drawSoon(); return; }
    if (!STROKE || STROKE.id !== e.pointerId) return;
    if (Math.hypot(p[0] - STROKE.start[0], p[1] - STROKE.start[1]) > 6) STROKE.moved = true;
    hover = w; info(w[0], w[1]);
    if (S.group === 'place') { STROKE.ghost = makeObj(S.op, STROKE.w0[0], STROKE.w0[1], w[0], w[1], S.size); STROKE.end = w; drawSoon(); return; }
    if (S.group === 'paths') { if (STROKE.path) { var lst = STROKE.path[STROKE.path.length - 1]; if (Math.hypot(w[0] - lst[0], w[1] - lst[1]) > 1.2) STROKE.path.push(w); } drawSoon(); return; }
    // stamp along the drag so a fast stroke stays continuous
    var L = Math.hypot(w[0] - STROKE.last[0], w[1] - STROKE.last[1]), stepM = Math.max(1.2, S.size * 0.33);
    if (L < stepM) { drawSoon(); return; }
    var n = Math.floor(L / stepM);
    for (var i = 1; i <= n; i++) { var t = i / n; apply(lerp(STROKE.last[0], w[0], t), lerp(STROKE.last[1], w[1], t)); }
    STROKE.last = w;
  });
  function endStroke(cancelPlace) {
    if (!STROKE) return;
    var s = STROKE; STROKE = null;
    if (S.group === 'place' && !cancelPlace) {
      var w0 = s.w0, w1 = s.end || w0;
      pushUndo();
      if (place(w0[0], w0[1], w1[0], w1[1])) { markDirty(); if (S.op === 'tee' || S.op === 'basket') refreshTitle(); }
      else { S.undo.pop(); updateUndo(); }
      drawSoon(); return;
    }
    if (S.group === 'paths' && !cancelPlace) {
      pushUndo();
      if (S.op === 'delpath' ? delPath(s.w0[0], s.w0[1]) : cutPath(s.path || [])) markDirty(); else { S.undo.pop(); updateUndo(); }
      drawSoon(); return;
    }
    if (S.group === 'place' || S.group === 'paths') { drawSoon(); return; }
    if (s.changed) markDirty(); else if (s.undoPushed) { S.undo.pop(); updateUndo(); }
    drawSoon();
  }
  function ptrUp(e) {
    if (!PTR[e.pointerId]) return;
    delete PTR[e.pointerId];
    var n = Object.keys(PTR).length;
    if (n < 2) PINCH = null;
    if (!n) PAN = null;
    if (STROKE && STROKE.id === e.pointerId) endStroke(false);
  }
  map.addEventListener('pointerup', ptrUp); map.addEventListener('pointercancel', ptrUp);
  map.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse' && !PTR[e.pointerId]) { hover = null; drawSoon(); } });
  map.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  map.addEventListener('wheel', function (e) {
    e.preventDefault(); var p = lp(e), k = e.deltaY > 0 ? 0.88 : 1.14, sc = clamp(VIEW.sc * k, 0.4, 40); k = sc / VIEW.sc;
    VIEW.ox = p[0] - (p[0] - VIEW.ox) * k; VIEW.oy = p[1] - (p[1] - VIEW.oy) * k; VIEW.sc = sc; drawSoon();
  }, { passive: false });

  /* ---------------- courses ---------------- */
  function courseDoc(c) { return { name: c.name, size: c.size, holes: c.holes.slice(0, 18), updated: Date.now() }; }
  function courseTotals(c) {
    var par = 0, ft = 0, filled = 0;
    (c.holes || []).slice(0, c.size).forEach(function (id) { var m = id && metaOf(id); if (m) { filled++; par += m.par || 3; ft += m.ft || 0; } });
    return { par: par, ft: ft, filled: filled };
  }
  function newCourse() {
    var c = { id: newId('c'), name: 'New course', size: 18, holes: new Array(18).fill(null) };
    var n = 1; while (S.courses.some(function (x) { return x.name === c.name; })) c.name = 'New course ' + (++n);
    S.courses.unshift(c); Store.put('courses', c.id, courseDoc(c)); openCourse(c);
  }
  function openCourse(c) {
    c.holes = (c.holes || []).slice(); while (c.holes.length < 18) c.holes.push(null);
    S.course = c; $('cName').value = c.name; renderCourse(); show('crs');
  }
  var cSaveT = 0;
  function saveCourse() { var c = S.course; $('cSaved').textContent = 'Unsaved'; clearTimeout(cSaveT); cSaveT = setTimeout(function () { $('cSaved').textContent = 'Saving…'; Store.put('courses', c.id, courseDoc(c)).then(function () { $('cSaved').textContent = 'Saved'; }, function () { $('cSaved').textContent = 'Save failed'; }); }, 700); }
  function renderCourse() {
    var c = S.course, box = $('cSlots'); box.innerHTML = '';
    $('cSize').textContent = c.size + ' holes';
    for (var i = 0; i < c.size; i++) (function (i) {
      var row = el('div', 'slot'); row.appendChild(el('b', '', String(i + 1)));
      var sel = el('select'); sel.id = 'slot' + i; sel.setAttribute('aria-label', 'Hole ' + (i + 1));
      var o0 = el('option', '', 'Empty'); o0.value = ''; sel.appendChild(o0);
      S.holes.forEach(function (m) { var o = el('option', '', (m.name || 'Hole') + ' · par ' + (m.par || 3) + ' · ' + (m.ft || 0) + ' ft'); o.value = m.id; if (c.holes[i] === m.id) o.selected = true; sel.appendChild(o); });
      sel.addEventListener('change', function () { c.holes[i] = sel.value || null; saveCourse(); renderTotals(); renderCourseMeta(row, i); });
      row.appendChild(sel); row.appendChild(el('span', '', '')); renderCourseMeta(row, i); box.appendChild(row);
    })(i);
    renderTotals();
  }
  function renderCourseMeta(row, i) { var m = S.course.holes[i] && metaOf(S.course.holes[i]); row.lastChild.textContent = m ? 'Par ' + (m.par || 3) : ''; }
  function renderTotals() {
    var c = S.course, t = courseTotals(c), box = $('cTot'); box.innerHTML = '';
    [['Holes set', t.filled + ' of ' + c.size], ['Par', t.par], ['Length', t.ft.toLocaleString('en-US') + ' ft']].forEach(function (p) { var s = el('span'); s.appendChild(document.createTextNode(p[0] + ' ')); s.appendChild(el('b', '', String(p[1]))); box.appendChild(s); });
    $('cPlay').disabled = !t.filled;
  }
  $('cBack').addEventListener('click', function () { clearTimeout(cSaveT); Store.put('courses', S.course.id, courseDoc(S.course)).then(function () { show('lib'); refreshLib(); tabs('courses'); }); });
  $('cName').addEventListener('input', function () { S.course.name = $('cName').value.trim() || 'Untitled course'; saveCourse(); });
  $('cSize').addEventListener('click', function () { S.course.size = S.course.size === 18 ? 9 : 18; saveCourse(); renderCourse(); });
  $('cFill').addEventListener('click', function () {
    var c = S.course, used = c.holes.slice(0, c.size).filter(Boolean), pool = S.holes.map(function (m) { return m.id; }).filter(function (id) { return used.indexOf(id) < 0; }).reverse(), k = 0;
    if (!S.holes.length) return;
    for (var i = 0; i < c.size; i++) if (!c.holes[i]) { c.holes[i] = pool.length ? pool.shift() : S.holes[(k++) % S.holes.length].id; }
    saveCourse(); renderCourse();
  });
  $('cDelete').addEventListener('click', function () { var c = S.course; confirmBox('Delete this course?', 'The holes stay in your library.', 'Delete course', function () { Store.del('courses', c.id).then(function () { show('lib'); refreshLib(); tabs('courses'); }); }); });
  $('cPlay').addEventListener('click', function () { var c = S.course; var ids = c.holes.slice(0, c.size).filter(Boolean); if (ids.length) playRound(c, ids); });

  /* ---------------- a round ---------------- */
  function playRound(c, ids) { S.round = { c: c, ids: ids, i: 0, cards: [] }; roundHole(); }
  function roundHole() {
    var R0 = S.round, id = R0.ids[R0.i];
    busy(true, 'Hole ' + (R0.i + 1) + '…');
    Store.get('holes', id).then(function (e) {
      if (!e) { busy(false); R0.cards[R0.i] = { name: 'Missing hole', par: 0, strokes: 0 }; return nextOrCard(); }
      var d = HW.decode(e); d.id = id;
      setTimeout(function () {
        AG.load(makeWorld(d, { number: R0.i + 1, course: R0.c.name })); busy(false);
        var last = R0.i >= R0.ids.length - 1;
        AG.play({
          onDone: function (strokes, lines) { R0.cards[R0.i] = { name: d.name, par: d.par, strokes: strokes }; },
          endLine: function (strokes) { var tot = 0, par = 0; R0.cards.forEach(function (c2) { if (c2) { tot += c2.strokes; par += c2.par; } }); tot += strokes; par += d.par; var rel = tot - par; return strokes + ' on a par ' + d.par + '. Round: ' + tot + ' (' + (rel === 0 ? 'even' : (rel > 0 ? '+' : '') + rel) + ') through ' + (R0.i + 1) + '.'; },
          nextLabel: last ? 'Scorecard' : 'Next hole', onNext: nextOrCard,
          onExit: function () { show('crs'); },
        });
      }, 30);
    }, function () { busy(false); alertBox('A hole could not be loaded. Check your connection.'); show('crs'); });
  }
  function nextOrCard() {
    var R0 = S.round;
    if (R0.i < R0.ids.length - 1) { R0.i++; roundHole(); return; }
    AG.stop(); show('crs'); scorecard();
  }
  function scorecard() {
    var R0 = S.round, tot = 0, par = 0;
    modal(function (b) {
      b.appendChild(el('h2', '', R0.c.name)); var t = el('table', 'sc');
      t.innerHTML = '<thead><tr><th>#</th><th>Hole</th><th>Par</th><th>Score</th></tr></thead>';
      var tb = el('tbody');
      R0.cards.forEach(function (c2, i) { if (!c2) return; tot += c2.strokes; par += c2.par; var tr = el('tr'); [i + 1, c2.name, c2.par, c2.strokes].forEach(function (v) { tr.appendChild(el('td', '', String(v))); }); tb.appendChild(tr); });
      t.appendChild(tb); var rel = tot - par;
      b.appendChild(el('p', '', 'Total ' + tot + ' on a par ' + par + ' (' + (rel === 0 ? 'even' : (rel > 0 ? '+' : '') + rel) + ').'));
      b.appendChild(t);
      var r = el('div', 'mrow'); r.appendChild(button('Play again', 'chip', function () { closeModal(); playRound(R0.c, R0.ids); })); r.appendChild(button('Done', 'cta', closeModal)); b.appendChild(r);
    });
  }



  /* ---------------- sharing: holes and courses travel as small .aurelia.json files ---------------- */
  // one format for both: { aurelia: 1, holes: [encoded holes], course: { name, size, holes: [index into holes or null] } | null }
  var noteT = 0;
  function note(t) {
    if (!$('ed').hidden) { toastMsg(t); return; }
    var n = $('bNote'); if (!n) { n = el('div'); n.id = 'bNote'; n.setAttribute('role', 'status'); $('bApp').appendChild(n); }
    n.textContent = t; n.classList.add('show'); clearTimeout(noteT); noteT = setTimeout(function () { n.classList.remove('show'); }, 2600);
  }
  function fileName(name) { return (String(name || 'aurelia').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'aurelia') + '.aurelia.json'; }
  function offerFile(name, obj) {
    var txt = JSON.stringify(obj), fn = fileName(name);
    function plain() { var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: 'application/json' })); a.download = fn; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500); note('Saved ' + fn); }
    if (window.claude && window.claude.use) {
      // inside Claude the page offers the file through the downloads capability; elsewhere a normal download
      window.claude.use('downloads').then(function (dl) { if (!dl) { plain(); return; } dl.save({ filename: fn, data: txt }).then(function () { note('Saved ' + fn); }, function (e) { if (e && e.code !== 'declined') plain(); }); }, plain);
    } else plain();
  }
  function shareHoles(ids, name, course) {
    busy(true, 'Packing it up…');
    Promise.all(ids.map(function (id) { return id ? Store.get('holes', id) : Promise.resolve(null); })).then(function (encs) {
      busy(false);
      var holes = [], map = {};
      ids.forEach(function (id, i) { if (id && encs[i] && !(id in map)) { map[id] = holes.length; holes.push(encs[i]); } });
      if (!holes.length) { note('Nothing to share yet'); return; }
      offerFile(name, { aurelia: 1, made: new Date().toISOString().slice(0, 10), holes: holes, course: course ? { name: course.name, size: course.size, holes: course.holes.map(function (id) { return id && id in map ? map[id] : null; }) } : null });
    }, function () { busy(false); note('Could not read those holes'); });
  }
  function saveHoleData(d) {
    var meta = { name: d.name, par: d.par, ft: holeFt(d), trees: d.trees.length, updated: Date.now(), template: d.template || '', thumb: thumbOf(d) };
    return Store.put('holes', d.id, HW.encode(d)).then(function () { return Store.put('holemeta', d.id, meta); });
  }
  function importFile(file) {
    var rd = new FileReader();
    rd.onload = function () {
      var pack; try { pack = JSON.parse(rd.result); } catch (e) { pack = null; }
      if (!pack || pack.aurelia !== 1 || !Array.isArray(pack.holes)) { confirmBox('Not an Aurelia file', 'Pick a .aurelia.json file shared from the Course Builder.', 'OK', function () {}); return; }
      busy(true, 'Bringing it in…');
      var ids = [], tasks = [];
      pack.holes.forEach(function (enc) {
        var d; try { d = HW.decode(enc); } catch (e) { d = null; }
        if (!d) { ids.push(null); return; }
        d.id = newId('h'); d.name = d.name || 'Shared hole'; uniqueName(d); S.holes.push({ id: d.id, name: d.name });
        ids.push(d.id); tasks.push(saveHoleData(d));
      });
      Promise.all(tasks).then(function () {
        if (pack.course) {
          var c = { id: newId('c'), name: (pack.course.name || 'Shared course') + '', size: pack.course.size === 9 ? 9 : 18, holes: (pack.course.holes || []).map(function (k) { return k == null ? null : ids[k] || null; }) };
          return Store.put('courses', c.id, courseDoc(c)).then(function () { return 'course'; });
        }
        return 'holes';
      }).then(function (kind) {
        busy(false); refreshLib(); if (kind === 'course') tabs('courses');
        note(kind === 'course' ? 'Course imported with ' + tasks.length + ' holes' : (tasks.length === 1 ? 'Hole imported' : tasks.length + ' holes imported'));
      }, function () { busy(false); note('Import failed: storage may be full'); refreshLib(); });
    };
    rd.readAsText(file);
  }
  $('libImport').addEventListener('click', function () { $('importFile').value = ''; $('importFile').click(); });
  $('importFile').addEventListener('change', function () { var f = this.files && this.files[0]; if (f) importFile(f); });
  $('cShare').addEventListener('click', function () { var c = S.course; if (!c) return; shareHoles(c.holes.slice(0, c.size), c.name || 'course', c); });

  /* ---------------- the guided tour: one spotlight per idea ---------------- */
  var TOUR_STEPS = [
    { k: 'Welcome', h: 'This is your hole', p: 'The map is the hole from above. The gold square is the tee, the orange dot is the basket, and every circle is a tree. One finger works the tool, two fingers move and zoom the map.', at: '#stage' },
    { k: 'Your hole', h: 'Name and par', p: 'Tap the name to rename the hole or set its par. The line under it keeps score of the length, the drop and the tree count.', at: '#edTitle' },
    { k: 'Map controls', h: 'Undo, fit, move', p: 'Undo and Redo any change. Fit brings the whole hole back on screen. The hand lets one finger slide the map. The question mark brings this tour back.', at: '.fab' },
    { k: 'Sculpt', h: 'Shape the land', p: 'Raise hills, cut valleys, smooth slopes, or flatten a landing zone. The brush slider sets how wide you work.', at: '#groups button:nth-child(1)', group: 'sculpt' },
    { k: 'Paint', h: 'Fairway, rock, water', p: 'Paint fairway, rough, sand, stone paths and mud. Dig water anywhere, and slide the water level to flood the low ground.', at: '#groups button:nth-child(2)', group: 'paint' },
    { k: 'Trees', h: 'Sculpt the forest', p: 'Plant mixed forest, guardians, ancient oaks, pines, palms and more. Tap More for every slider: age runs young to ancient, variety mixes the sizes, and canopy sets where the leaves start. A high canopy leaves open air underneath to play under. Reshape trees brushes a new age and canopy onto trees already planted.', at: '#dock', group: 'plant' },
    { k: 'Paths', h: 'Cut a flightline', p: 'Drag a line through the woods. Tunnel clears the trunks and lifts the leaves to the ceiling you set. Open lane clears everything and lays fairway. Lanterns light every path at night.', at: '#dock', group: 'paths' },
    { k: 'Build', h: 'Ruins, relics, giants', p: 'Place the tee and basket, a lone guardian or ancient oak, boulders, massive logs, columns, arches, monoliths, carved heads, stone rings, disc sculptures and half buried step pyramids. Tap to place, or drag to aim it or set its length.', at: '#dock', group: 'place' },
    { k: '3D', h: 'Walk your hole', p: 'Fly over it, or tap Walk to stroll under the canopy with the joystick. Tap any tree to change its height, where its canopy starts and its age, or remove it.', at: '#ed3d' },
    { k: 'Play', h: 'Throw it', p: 'Flick to throw. VIEW cycles behind you, the whole hole, above the trees and from the pin. Land in the woods and the leaves fade so you can see out. See through does it any time.', at: '#edPlay' },
    { k: 'More', h: 'Roll, collect, repeat', p: 'New hole has a randomizer with ideas borrowed from famous holes, and Reroll until one grabs you. Back in the library, Courses collects your holes into a 9 or an 18.', at: null },
  ];
  var TOUR = { i: 0, on: false };
  function startTour() { if (S.in3D) exit3D(); closeModal(); TOUR.on = true; TOUR.i = 0; $('tour').hidden = false; tourStep(); try { localStorage.setItem('aub:toured', '1'); } catch (e) {} }
  function endTour() { TOUR.on = false; $('tour').hidden = true; }
  function tourStep() {
    var st = TOUR_STEPS[TOUR.i];
    if (st.group && S.group !== st.group) { S.group = st.group; S.op = GROUPS.filter(function (g) { return g.id === st.group; })[0].ops[0][0]; renderTools(); }
    if (st.group === 'plant' && !$('dock').classList.contains('open') && !$('slMore').hidden) $('slMore').click();
    if (st.group !== 'plant' && $('dock').classList.contains('open')) $('slMore').click();
    $('tourK').textContent = st.k + ' · ' + (TOUR.i + 1) + ' of ' + TOUR_STEPS.length; $('tourH').textContent = st.h; $('tourP').textContent = st.p;
    var dots = $('tourDots'); dots.innerHTML = ''; TOUR_STEPS.forEach(function (x, i) { dots.appendChild(el('i', i === TOUR.i ? 'on' : '')); });
    $('tourBack').hidden = TOUR.i === 0; $('tourNext').textContent = TOUR.i === TOUR_STEPS.length - 1 ? 'Start building' : 'Next';
    requestAnimationFrame(function () { requestAnimationFrame(placeTour); });
  }
  function placeTour() {
    if (!TOUR.on) return;
    var st = TOUR_STEPS[TOUR.i], t = st.at && document.querySelector(st.at), hole = $('tourHole'), card = $('tourCard'), H = window.innerHeight, ch = card.offsetHeight;
    if (!t) { hole.className = 'none'; card.style.top = Math.max(16, (H - ch) / 2) + 'px'; return; }
    var r = t.getBoundingClientRect(), pad = 6; hole.className = '';
    hole.style.left = (r.left - pad) + 'px'; hole.style.top = (r.top - pad) + 'px'; hole.style.width = (r.width + pad * 2) + 'px'; hole.style.height = (r.height + pad * 2) + 'px';
    var below = r.bottom + pad + 12, above = r.top - pad - 12 - ch;
    card.style.top = (below + ch < H - 8 ? below : above > 8 ? above : Math.max(8, (H - ch) / 2)) + 'px';
  }
  $('tourNext').addEventListener('click', function () { if (TOUR.i >= TOUR_STEPS.length - 1) { endTour(); return; } TOUR.i++; tourStep(); });
  $('tourBack').addEventListener('click', function () { if (TOUR.i > 0) { TOUR.i--; tourStep(); } });
  $('tourSkip').addEventListener('click', endTour);
  window.addEventListener('resize', function () { if (TOUR.on) placeTour(); });
  window.addEventListener('keydown', function (e) { if (!TOUR.on) return; if (e.key === 'Escape') endTour(); else if (e.key === 'ArrowRight') $('tourNext').click(); else if (e.key === 'ArrowLeft') $('tourBack').click(); });
  $('edTour').addEventListener('click', startTour);
  // from the library: open your latest hole (or roll one) and tour it
  $('libTour').addEventListener('click', function () {
    if (S.holes.length) { loadHoleData(S.holes[0].id).then(function (d) { if (d) { openHoleData(d); setTimeout(startTour, 250); } }); }
    else { createRandom('guardian'); var w = setInterval(function () { if (!$('ed').hidden && $('bBusy').hidden) { clearInterval(w); setTimeout(startTour, 250); } }, 200); }
  });
  function tourFirstTime() { var seen = null; try { seen = localStorage.getItem('aub:toured'); } catch (e) { seen = '1'; } if (!seen) setTimeout(startTour, 400); }

  /* ---------------- start ---------------- */
  AG.init();
  Store.init().then(function () {
    refreshLib();
    // your own discs travel with your builder account; the game keeps a copy on this device too
    Store.get('bag', 'mine').then(function (b) {
      if (b && b.discs && b.discs.length) AG.setBag(b.discs);
      else if (AG.getBag().length) Store.put('bag', 'mine', { discs: AG.getBag() });
    }, function () {});
    AG.onBag(function (list) { Store.put('bag', 'mine', { discs: list }).catch(function () {}); });
  });
  renderLib();
  window.__builder = { S: S, Store: Store, openHoleData: openHoleData, createHole: createHole, apply: function (x, y) { STROKE = { grid: treeGrid(), h0: HW.hAt(S.hole, x, y) }; apply(x, y); STROKE = null; markDirty(); }, enter3D: enter3D, exit3D: exit3D, createRandom: createRandom, place: place, cutPath: cutPath, renderTools: renderTools, makeObj: makeObj, openTreeSheet: openTreeSheet, startTour: startTour, TOUR: TOUR, VIEW: VIEW, toS: toS, playSingle: playSingle, openCourse: openCourse, newCourse: newCourse };
})();
