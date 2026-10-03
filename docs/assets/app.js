/* «Город в 5 мирах» — клиент. Роли: игрок (по умолчанию), #host, #screen, #curator. */
(function () {
  'use strict';
  var G = window.GAME;
  var CFG = window.FORSIGHT_CONFIG || {};
  var qs = new URLSearchParams(location.search);
  var API = qs.get('api') || CFG.API_URL || '';
  if (API && API.indexOf('ВСТАВЬТЕ') >= 0) API = '';

  var PHASES = ['intro', 'lobby', 'signals', 'factors', 'teams', 'world', 'map', 'overlay', 'auction', 'reveal', 'shock', 'results'];
  var PHASE_NAME = { intro: 'Заставка', lobby: 'Сбор', signals: 'Сигналы', factors: 'Факторы', teams: 'Команды', world: 'Миры', map: 'Карта', overlay: 'Наложение', auction: 'Аукцион', reveal: 'Судьба', shock: 'Шок', results: 'Итоги' };
  var W = G.worldOrder;
  var FK = Object.keys(G.factors);
  var SPIN_MS = 6500;

  // ---------- хранилище браузера (может быть недоступно) ----------
  var store = {
    get: function (k) { try { return localStorage.getItem('f5:' + k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem('f5:' + k, v); } catch (e) { } },
    del: function (k) { try { localStorage.removeItem('f5:' + k); } catch (e) { } },
  };

  var role = 'play';
  function readRole() {
    var h = location.hash.replace('#', '');
    role = ['host', 'screen', 'curator'].indexOf(h) >= 0 ? h : 'play';
    document.body.dataset.role = role;
  }
  readRole();

  var S = null;           // состояние игры с сервера
  var offset = 0;         // серверное время − время устройства
  var pid = store.get('pid');
  var pin = store.get('pin') || '';
  var drafts = {};        // несохранённый текст в полях: key → value
  var saveTimers = {};
  var ui = {
    pending: null, bid: null, busy: false, conn: true, curTeam: Number(store.get('curTeam') || 0), spinDone: null, lotSeen: null,
    closing: null, autoClose: true, lotSeconds: 40, toastT: null, sigType: 'trend', rate: null, rateEdit: false, renaming: false,
  };
  var root = document.getElementById('app');
  var swarm = null;

  function now() { return Date.now() + offset; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function plural(n, a, b, c) { n = Math.abs(n) % 100; var n1 = n % 10; if (n > 10 && n < 20) return c; if (n1 > 1 && n1 < 5) return b; if (n1 === 1) return a; return c; }
  function signed(n) { return n > 0 ? '+' + n : String(n).replace('-', '−'); }
  function cut(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function world(id) { return G.worlds[id]; }
  function teamWorld(ti) { return S.teams[ti].world; }
  function tColor(ti) { var w = teamWorld(ti); return w ? world(w).color : G.teamColors[ti]; }
  function tSoft(ti) { var w = teamWorld(ti); return w ? world(w).soft : '#DCE8F8'; }
  function tNo(ti) { return S.teams[ti].no || ti + 1; }
  function tLabel(ti) { return 'Команда ' + tNo(ti); }
  function tName(ti) { var t = S.teams[ti]; return t.title || (t.world ? world(t.world).name : tLabel(ti)); }
  function me() { return S && pid ? S.players[pid] : null; }
  function myTeam() { var p = me(); return p && p.team != null ? S.teams[p.team] : null; }
  function members(ti) { return S.order.filter(function (id) { return S.players[id] && S.players[id].team === ti; }).map(function (id) { return S.players[id]; }); }
  function players() { return S.order.filter(function (id) { return S.players[id]; }).map(function (id) { return S.players[id]; }); }
  function teamStyle(ti) { return '--c:' + tColor(ti) + ';--cs:' + tSoft(ti); }
  function worldStyle(wid) { var w = world(wid); return '--c:' + w.color + ';--cs:' + w.soft; }
  function teamOfWorld(wid) { for (var i = 0; i < S.teams.length; i++) if (S.teams[i].world === wid) return i; return null; }
  function rule(project, zone) { var r = S.zoneRules && S.zoneRules[project]; return r && r[zone] ? { v: r[zone][0], text: r[zone][1] } : null; }
  function chip(ti, big) { return '<span class="tno' + (big ? ' big' : '') + '" style="' + teamStyle(ti) + '">' + tNo(ti) + '</span>'; }

  // ---------- сеть ----------
  function apiUrl(q) { return API + (API.indexOf('?') >= 0 ? '&' : '?') + q; }

  function api(body) {
    body = Object.assign({}, body);
    if (role === 'play' && pid && !('pid' in body)) body.pid = pid;
    if (role !== 'play' && pin) body.pin = pin;
    // text/plain без заголовков — Apps Script принимает такой запрос без CORS-preflight
    return fetch(API, { method: 'POST', body: JSON.stringify(body), redirect: 'follow' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.now) offset = d.now - Date.now();
        if (d.state) applyState(d.state);
        if (!d.ok) throw new Error(d.error || 'Ошибка сервера');
        setConn(true);
        return d;
      }, function (e) {
        if (e && e.message && !/fetch|network|Failed|JSON/i.test(e.message)) throw e;
        setConn(false);
        throw new Error('Нет связи с сервером. Повторите через пару секунд.');
      });
  }

  var pollTimer = null;
  function poll() {
    clearTimeout(pollTimer);
    if (!API) return;
    var q = new URLSearchParams({ a: 'state' });
    if (S) q.set('v', S.v);
    if (role === 'play' && pid) q.set('pid', pid);
    if (role !== 'play' && pin) q.set('pin', pin);
    fetch(apiUrl(q.toString()), { redirect: 'follow' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.now) offset = d.now - Date.now();
        if (d.state) applyState(d.state);
        setConn(true);
        pollTimer = setTimeout(poll, role === 'play' ? (CFG.POLL_PLAYER_MS || 2000) : (CFG.POLL_HOST_MS || 1500));
      })
      .catch(function () {
        setConn(false);
        pollTimer = setTimeout(poll, 3000);
      });
  }

  function setConn(ok) {
    if (ui.conn === ok) return;
    ui.conn = ok;
    var b = document.getElementById('conn');
    if (b) b.hidden = ok;
  }

  function applyState(st) {
    if (S && st.v < S.v) return;
    var prevPhase = S && S.phase;
    S = st;
    if (prevPhase && prevPhase !== S.phase) { ui.pending = null; window.scrollTo(0, 0); lastHtml = ''; }
    render();
  }

  function toast(msg, kind, ms) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(ui.toastT);
    ui.toastT = setTimeout(function () { t.className = 'toast'; }, ms || 3200);
  }

  function run(body, okMsg) {
    ui.busy = true; render();
    return api(body).then(function (d) {
      ui.busy = false; render();
      if (okMsg) toast(okMsg, 'ok');
      return d;
    }, function (e) {
      ui.busy = false; render();
      toast(e.message, 'err');
      throw e;
    });
  }

  // ---------- отрисовка с сохранением фокуса и черновиков ----------
  var lastHtml = '';
  function render() {
    var html;
    try { html = view(); } catch (e) { console.error(e); html = '<div class="pad"><p>Ошибка отрисовки: ' + esc(e.message) + '</p></div>'; }
    if (html === lastHtml) return;
    lastHtml = html;
    var a = document.activeElement;
    var key = a && a.dataset ? a.dataset.key : null;
    var sel = null;
    if (key && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT')) { try { sel = [a.selectionStart, a.selectionEnd]; } catch (e) { } }
    var sy = window.scrollY;
    var scrollers = {};
    root.querySelectorAll('[data-scroll]').forEach(function (el) { scrollers[el.dataset.scroll] = el.scrollTop; });
    root.innerHTML = html;
    root.querySelectorAll('[data-key]').forEach(function (el) { if (drafts[el.dataset.key] !== undefined) el.value = drafts[el.dataset.key]; });
    if (key) {
      var el = root.querySelector('[data-key="' + key + '"]');
      if (el) { el.focus({ preventScroll: true }); if (sel) { try { el.setSelectionRange(sel[0], sel[1]); } catch (e) { } } }
    }
    root.querySelectorAll('[data-scroll]').forEach(function (el2) { if (scrollers[el2.dataset.scroll]) el2.scrollTop = scrollers[el2.dataset.scroll]; });
    window.scrollTo(0, sy);
    var rw = root.querySelector('.routewrap'), rn = rw && rw.querySelector('li.now');
    if (rn) rw.scrollLeft = Math.max(0, rn.offsetLeft - rw.clientWidth / 2 + rn.clientWidth / 2);
    var cv = root.querySelector('canvas.swarm');
    if (cv) {
      if (!swarm) swarm = new window.Swarm(role === 'screen' ? 240 : 120);
      swarm.attach(cv);
      swarm.setStep(Number(cv.dataset.step || 0));
    }
    tick();
  }

  function view() {
    if (!API) return viewNoApi();
    if (!S) return '<div class="loading"><div class="loader"></div><p>Подключаемся к игре…</p></div>';
    if (role === 'screen') return viewScreen();
    if (role === 'host') return pinOk() ? viewHost() : viewPin('Пульт ведущего');
    if (role === 'curator') return pinOk() ? viewCurator() : viewPin('Оценки кураторов');
    return viewPlayer();
  }

  function pinOk() { return !!(S && S.isHost); }

  function viewNoApi() {
    return '<div class="pad narrow"><h1 class="h1">Сервер не подключён</h1><p>Откройте файл <b>config.js</b> и вставьте в <b>API_URL</b> адрес веб-приложения Google Apps Script (заканчивается на <code>/exec</code>). Инструкция — в README репозитория.</p></div>';
  }

  function viewPin(title) {
    return '<div class="pad narrow"><h1 class="h1">' + esc(title) + '</h1>' +
      '<form class="stack" data-form="pin"><label class="lbl" for="pin">PIN ведущего</label>' +
      '<input id="pin" class="inp" data-key="pin" inputmode="numeric" autocomplete="off" placeholder="Например, 2040" value="' + esc(pin) + '">' +
      '<button class="btn primary" type="submit">Войти</button></form>' +
      (pin && !pinOk() ? '<p class="muted small">Этот PIN не подошёл. Он задаётся в начале файла Code.gs.</p>' : '') + '</div>';
  }

  // ---------- общие элементы ----------
  function mapSvg(opts) {
    opts = opts || {};
    var names = {}; Object.keys(G.zones).forEach(function (z) { names[z] = G.zones[z].name; });
    opts.names = names;
    return window.CityMap.svg(opts);
  }

  function route(current) {
    var idx = PHASES.indexOf(current);
    return '<ol class="route" aria-label="Этапы игры">' + PHASES.map(function (p, i) {
      return '<li class="' + (i < idx ? 'done' : i === idx ? 'now' : '') + '"' + (i === idx ? ' aria-current="step"' : '') + '><span class="st"></span><span class="nm">' + PHASE_NAME[p] + '</span></li>';
    }).join('') + '</ol>';
  }

  function worldCard(wid, opts) {
    var w = world(wid);
    opts = opts || {};
    return '<article class="wcard" style="' + worldStyle(wid) + '">' +
      '<div class="wband"><span class="wletter">' + wid + '</span><div>' + (opts.kicker ? '<p class="wkick">' + esc(opts.kicker) + '</p>' : '') + '<h2 class="wname">' + esc(w.name) + '</h2><p class="waxes">' + esc(w.axes) + '</p></div></div>' +
      (opts.short ? '' : '<p class="wstory">' + esc(w.story) + '</p><dl class="wdata">' + w.data.map(function (d) { return '<div><dt>' + esc(d[0]) + '</dt><dd>' + esc(d[1]) + '</dd></div>'; }).join('') + '</dl><p class="tiny muted">Данные учебные, город вымышленный.</p>') +
      '</article>';
  }

  function dots(teamIds) {
    return '<span class="dots">' + S.teams.map(function (t) {
      var on = teamIds.indexOf(t.id) >= 0;
      return '<i class="' + (on ? 'on' : '') + '" style="--c:' + tColor(t.id) + '" title="' + (on ? tLabel(t.id) : '') + '"></i>';
    }).join('') + '</span>';
  }

  function overlayData() {
    var map = {};
    Object.keys(G.projects).forEach(function (p) { map[p] = { project: p, teams: [], zones: {} }; });
    S.teams.forEach(function (t) {
      Object.keys(t.placements || {}).forEach(function (p) {
        if (!map[p]) return;
        map[p].teams.push(t.id);
        map[p].zones[t.placements[p]] = (map[p].zones[t.placements[p]] || 0) + 1;
      });
    });
    return Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) { return b.teams.length - a.teams.length || a.project.localeCompare(b.project); });
  }

  function allPins() {
    var pins = [];
    S.teams.forEach(function (t) {
      Object.keys(t.placements || {}).forEach(function (p) {
        var r = rule(p, t.placements[p]);
        pins.push({ zone: t.placements[p], color: tColor(t.id), label: String(tNo(t.id)), bad: r && r.v < 0 });
      });
    });
    return pins;
  }

  function soldMap() { var m = {}; S.auction.results.forEach(function (r) { m[r.project] = r; }); return m; }

  function countdownHtml(cur, big) {
    var r = big ? 54 : 30, sw = big ? 9 : 6, c = 2 * Math.PI * r, size = (r + sw) * 2;
    return '<div class="timer' + (big ? ' big' : '') + '"><svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '"><circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" class="tr-bg" stroke-width="' + sw + '"/>' +
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" class="tr-fg" stroke-width="' + sw + '" stroke-dasharray="' + c.toFixed(1) + '" data-ring="' + cur.endsAt + '" data-total="' + cur.seconds * 1000 + '" data-len="' + c.toFixed(1) + '" transform="rotate(-90 ' + size / 2 + ' ' + size / 2 + ')"/></svg>' +
      '<span class="tnum" data-countdown="' + cur.endsAt + '">' + Math.max(0, Math.ceil((cur.endsAt - now()) / 1000)) + '</span></div>';
  }

  function wheelHtml(size) {
    var n = W.length, r = 100;
    var s = '<div class="wheel-wrap" style="width:' + size + 'px;height:' + size + 'px"><svg class="pointer" viewBox="0 0 40 30" aria-hidden="true"><path d="M20,30 L4,2 L36,2 Z"/></svg>' +
      '<svg id="wheel" viewBox="-110 -110 220 220" width="' + size + '" height="' + size + '" aria-label="Колесо судьбы">';
    W.forEach(function (wid, i) {
      var a0 = (i * 360 / n - 90 - 180 / n) * Math.PI / 180, a1 = ((i + 1) * 360 / n - 90 - 180 / n) * Math.PI / 180;
      var x0 = r * Math.cos(a0), y0 = r * Math.sin(a0), x1 = r * Math.cos(a1), y1 = r * Math.sin(a1);
      var am = (i * 360 / n - 90) * Math.PI / 180;
      s += '<path d="M0,0 L' + x0.toFixed(2) + ',' + y0.toFixed(2) + ' A' + r + ',' + r + ' 0 0 1 ' + x1.toFixed(2) + ',' + y1.toFixed(2) + ' Z" fill="' + world(wid).color + '" stroke="#F4F8FD" stroke-width="2"/>' +
        '<text x="' + (66 * Math.cos(am)).toFixed(1) + '" y="' + (66 * Math.sin(am) + 9).toFixed(1) + '" text-anchor="middle" class="wl">' + wid + '</text>';
    });
    s += '<circle r="16" fill="#F4F8FD"/><circle r="6" fill="#0C2340"/></svg></div>';
    return s;
  }

  function spinState() {
    if (!S.reveal) return null;
    var elapsed = now() - S.reveal.at;
    return { done: elapsed >= SPIN_MS, elapsed: elapsed };
  }

  function wheelAngle() {
    var i = W.indexOf(S.reveal.world);
    var h = 0; String(S.reveal.spinId || '').split('').forEach(function (ch) { h = (h * 31 + ch.charCodeAt(0)) % 1000; });
    var jitter = (h / 1000 - 0.5) * 40;
    var target = 360 * 7 - i * 72 + jitter;
    var t = Math.min(1, Math.max(0, (now() - S.reveal.at) / SPIN_MS));
    return target * (1 - Math.pow(1 - t, 4));
  }

  // ---------- тик: таймеры, колесо, заставка, автозакрытие лота ----------
  function tick() {
    if (!S) return;
    var n = now();
    root.querySelectorAll('[data-countdown]').forEach(function (el) {
      var left = Math.max(0, Math.ceil((Number(el.dataset.countdown) - n) / 1000));
      if (el.textContent !== String(left)) el.textContent = left;
      el.parentNode.classList.toggle('hurry', left <= 5);
    });
    root.querySelectorAll('[data-ring]').forEach(function (el) {
      var left = Math.max(0, Number(el.dataset.ring) - n), tot = Number(el.dataset.total), len = Number(el.dataset.len);
      el.setAttribute('stroke-dashoffset', (len * (1 - left / tot)).toFixed(1));
    });
    var wh = document.getElementById('wheel');
    if (wh && S.reveal) wh.style.transform = 'rotate(' + wheelAngle().toFixed(2) + 'deg)';
    if (S.reveal) {
      var st = spinState();
      var key = S.reveal.spinId + (st.done ? ':done' : '');
      if (ui.spinDone !== key) { ui.spinDone = key; if (st.done) render(); }
    }
    var cur = S.auction && S.auction.current;
    if (role === 'host' && pinOk() && cur && ui.autoClose && n > cur.endsAt + 1600 && ui.closing !== cur.project) {
      ui.closing = cur.project;
      api({ a: 'closeLot', project: cur.project }).then(function (d) { if (d.result) toast(resultText(d.result), 'ok'); }, function (e) { ui.closing = null; toast(e.message, 'err'); });
    }
  }
  function loop(t) { tick(); if (swarm) swarm.frame(t); requestAnimationFrame(loop); }

  function resultText(r) {
    var p = G.projects[r.project].name;
    return r.team == null ? '«' + p + '» никто не купил' : '«' + p + '» — ' + tLabel(r.team).toLowerCase() + ' за ' + r.price;
  }

  // ---------- агрегаты ----------
  function factorStats() {
    var sums = {}, n = 0;
    FK.forEach(function (f) { sums[f] = [0, 0]; });
    Object.keys(S.ratings || {}).forEach(function (id) {
      var r = S.ratings[id]; if (!r) return; n++;
      FK.forEach(function (f) { if (r[f]) { sums[f][0] += r[f][0]; sums[f][1] += r[f][1]; } });
    });
    var out = FK.map(function (f) { return { f: f, inf: n ? sums[f][0] / n : 0, unc: n ? sums[f][1] / n : 0 }; });
    out.sort(function (a, b) { return (b.inf + b.unc) - (a.inf + a.unc); });
    return { n: n, list: out };
  }

  function scatter(big) {
    var st = factorStats();
    var Wd = 760, Hd = 520, L = 70, R = 24, T = 44, B = 62;
    var x = function (v) { return L + (v - 1) / 4 * (Wd - L - R); };
    var y = function (v) { return T + (1 - (v - 1) / 4) * (Hd - T - B); };
    var s = '<svg class="scatter' + (big ? ' big' : '') + '" viewBox="0 0 ' + Wd + ' ' + Hd + '" role="img" aria-label="Карта факторов: влияние и неопределённость">';
    s += '<rect class="q crit" x="' + x(3) + '" y="' + y(5) + '" width="' + (x(5) - x(3)) + '" height="' + (y(3) - y(5)) + '"/>';
    s += '<rect class="q trend" x="' + x(1) + '" y="' + y(5) + '" width="' + (x(3) - x(1)) + '" height="' + (y(3) - y(5)) + '"/>';
    s += '<text class="qt" x="' + x(5) + '" y="' + (y(5) - 14) + '" text-anchor="end">Критические неопределённости ↗</text>';
    s += '<text class="qt" x="' + x(1) + '" y="' + (y(5) - 14) + '">↖ Тренды: учесть во всех мирах</text>';
    s += '<text class="qt dim" x="' + (x(5) - 10) + '" y="' + (y(1) - 12) + '" text-anchor="end">Джокеры: следить</text>';
    s += '<text class="qt dim" x="' + (x(1) + 10) + '" y="' + (y(1) - 12) + '">Второстепенное</text>';
    for (var v = 1; v <= 5; v++) {
      s += '<line class="gl" x1="' + x(v) + '" x2="' + x(v) + '" y1="' + y(1) + '" y2="' + y(5) + '"/><line class="gl" x1="' + x(1) + '" x2="' + x(5) + '" y1="' + y(v) + '" y2="' + y(v) + '"/>';
      s += '<text class="tk" x="' + x(v) + '" y="' + (y(1) + 20) + '" text-anchor="middle">' + v + '</text><text class="tk" x="' + (x(1) - 12) + '" y="' + (y(v) + 5) + '" text-anchor="end">' + v + '</text>';
    }
    s += '<text class="ax" x="' + ((x(1) + x(5)) / 2) + '" y="' + (Hd - 12) + '" text-anchor="middle">Неопределённость →</text>';
    s += '<text class="ax" transform="translate(18 ' + ((y(1) + y(5)) / 2) + ') rotate(-90)" text-anchor="middle">Влияние на город →</text>';
    if (st.n) {
      // подписи раскладываем так, чтобы они не наезжали друг на друга и на подписи четвертей
      var boxes = [
        { x0: x(1), x1: x(1) + 260, y0: y(5) - 32, y1: y(5) - 6 }, { x0: x(5) - 270, x1: x(5), y0: y(5) - 32, y1: y(5) - 6 },
        { x0: x(1), x1: x(1) + 150, y0: y(1) - 30, y1: y(1) - 4 }, { x0: x(5) - 160, x1: x(5), y0: y(1) - 30, y1: y(1) - 4 },
      ];
      var hit = function (b) { return boxes.some(function (o) { return b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0; }); };
      var placedPts = [];
      st.list.forEach(function (p) {
        var cx = x(p.unc), cy = y(p.inf);
        // точки с одинаковыми координатами чуть разводим
        placedPts.forEach(function (q) { if (Math.abs(q[0] - cx) < 6 && Math.abs(q[1] - cy) < 6) { cx += 9; cy -= 9; } });
        placedPts.push([cx, cy]);
        boxes.push({ x0: cx - 9, x1: cx + 9, y0: cy - 9, y1: cy + 9 });
      });
      st.list.forEach(function (p, idx) {
        var cx = placedPts[idx][0], cy = placedPts[idx][1], axis = S.axesShown && G.axisFactors.indexOf(p.f) >= 0;
        var label = G.factors[p.f].name + (axis ? ' — ось матрицы' : '');
        var w = label.length * 8.4 + 6;
        var opts = [[14, 0], [-14, 0], [14, -20], [14, 20], [-14, -20], [-14, 20], [14, -38], [14, 38], [-14, -38], [-14, 38], [0, -24], [0, 26]];
        var pick = null;
        for (var oi = 0; oi < opts.length && !pick; oi++) {
          var dx = opts[oi][0], dy = opts[oi][1];
          var ax0 = dx > 0 ? cx + dx : dx < 0 ? cx + dx - w : cx - w / 2;
          var b = { x0: ax0, x1: ax0 + w, y0: cy + dy - 11, y1: cy + dy + 11 };
          if (b.x0 < 4 || b.x1 > Wd - 4 || b.y0 < 2 || b.y1 > Hd - 40) continue;
          if (!hit(b)) pick = { b: b, dx: dx, dy: dy };
        }
        if (!pick) { var fx = cx + 14 + w > Wd ? cx - 14 - w : cx + 14; pick = { b: { x0: fx, x1: fx + w, y0: cy - 11, y1: cy + 11 }, dx: 14, dy: 0 }; }
        boxes.push(pick.b);
        s += '<g class="pt' + (axis ? ' axis' : '') + '"><circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + (axis ? 11 : 8) + '"/>' +
          (pick.dy ? '<line class="lead" x1="' + cx.toFixed(1) + '" y1="' + cy.toFixed(1) + '" x2="' + (pick.dx >= 0 ? pick.b.x0 : pick.b.x1).toFixed(1) + '" y2="' + (cy + pick.dy).toFixed(1) + '"/>' : '') +
          '<text x="' + pick.b.x0.toFixed(1) + '" y="' + (cy + pick.dy + 5).toFixed(1) + '">' + esc(label) + '</text></g>';
      });
    } else {
      s += '<text class="qt" x="' + Wd / 2 + '" y="' + Hd / 2 + '" text-anchor="middle">Ждём первые оценки…</text>';
    }
    return s + '</svg>';
  }

  // =====================================================================
  //                               ИГРОК
  // =====================================================================
  function viewPlayer() {
    var p = me();
    if (!p || ui.renaming) return viewJoin();
    var t = myTeam();
    var head = '<header class="bar"' + (t ? ' style="' + teamStyle(t.id) + '"' : '') + '>' +
      '<span class="logo">Город в 5 мирах</span>' +
      '<span class="who">' + esc(p.name) + (t ? chip(t.id) : '') + '</span></header>';
    var body;
    var ph = S.phase;
    if (ph === 'intro') body = viewIntroPlayer(p);
    else if (ph === 'lobby') body = viewWait(p);
    else if (ph === 'signals') body = viewSignalsPlayer(p);
    else if (ph === 'factors') body = viewFactorsPlayer(p);
    else if (ph === 'teams') body = viewTeamsPlayer(p);
    else if (!t) body = '<section class="pad center"><div class="pulse"></div><h1 class="h2">Вы пока не в команде</h1><p class="muted">Ведущий скоро добавит вас. Экран обновится сам.</p></section>';
    else if (!t.world) body = '<section class="pad center"><div class="pulse"></div><h1 class="h2">Раздаём миры…</h1></section>';
    else if (ph === 'world') body = viewWorldPlayer(t);
    else if (ph === 'map') body = viewMapPlayer(t);
    else if (ph === 'overlay') body = viewOverlayPlayer(t);
    else if (ph === 'auction') body = viewAuctionPlayer(t);
    else if (ph === 'reveal') body = viewRevealPlayer(t);
    else if (ph === 'shock') body = viewShockPlayer(t);
    else body = viewResultsPlayer(t);
    return head + '<div class="routewrap">' + route(ph) + '</div>' + body;
  }

  function viewJoin() {
    return '<section class="join">' +
      '<div class="joinhero"><canvas class="swarm" data-step="0" aria-hidden="true"></canvas><h1 class="title">Город в&nbsp;5&nbsp;мирах</h1></div>' +
      '<p class="lead">Форсайт-сессия про будущее учебного моногорода ' + G.city + '. Вы не угадываете будущее, а ищете решения, которые сработают в любом из пяти миров.</p>' +
      '<form class="stack" data-form="join"><label class="lbl" for="name">Как вас зовут?</label>' +
      '<input id="name" class="inp" data-key="name" maxlength="40" autocomplete="name" placeholder="Имя и фамилия">' +
      '<button class="btn primary" type="submit"' + (ui.busy ? ' disabled' : '') + '>' + (ui.renaming ? 'Сохранить имя' : 'Войти в игру') + '</button></form></section>';
  }

  function viewIntroPlayer(p) {
    var sl = G.intro[S.introStep || 0];
    return '<section class="pad center wait"><div class="introcanvas"><canvas class="swarm" data-step="' + (S.introStep || 0) + '" aria-hidden="true"></canvas></div>' +
      '<h1 class="h2">Смотрите на экран</h1><p class="muted">Сейчас ведущие расскажут, что такое форсайт.</p>' +
      '<p class="slidecap">' + esc(sl.title) + '</p></section>';
  }

  function viewWait(p) {
    var n = players().length;
    return '<section class="pad center wait"><div class="introcanvas"><canvas class="swarm" data-step="0" aria-hidden="true"></canvas></div>' +
      '<h1 class="h2">Вы в игре, ' + esc(p.name.split(' ')[0]) + '</h1>' +
      '<p class="muted">Ждём, пока ведущий начнёт. Экран переключится сам.</p>' +
      '<p class="count"><b>' + n + '</b> ' + plural(n, 'человек', 'человека', 'человек') + ' в комнате</p>' +
      '<button class="link" data-act="rename">Изменить имя</button></section>';
  }

  function viewSignalsPlayer(p) {
    var mine = (S.signals || []).filter(function (x) { return x.pid === p.id; });
    var left = 2 - mine.length;
    var html = '<section class="pad"><h1 class="h2">Сигналы будущего</h1>' +
      '<p class="muted">Что меняется вокруг Северогорска — в стране, в технологиях, в жизни людей? Предложите ' + (mine.length ? 'ещё ' + left : 'до двух') + ' ' + plural(left || 2, 'фактор', 'фактора', 'факторов') + ' и определите, что это.</p>';
    if (left > 0) {
      html += '<div class="types" role="radiogroup" aria-label="Тип сигнала">' + G.signalOrder.map(function (k) {
        var ty = G.signalTypes[k];
        return '<button class="type' + (ui.sigType === k ? ' on' : '') + '" role="radio" aria-checked="' + (ui.sigType === k) + '" data-act="sigType" data-type="' + k + '"><b>' + esc(ty.name) + '</b><span>' + esc(ty.hint) + '</span></button>';
      }).join('') + '</div>' +
        '<form class="stack" data-form="signal"><label class="lbl" for="sig">Ваш ' + esc(G.signalTypes[ui.sigType].name.toLowerCase()) + '</label>' +
        '<input id="sig" class="inp" data-key="sig" maxlength="140" placeholder="Например: ' + esc(G.signalTypes[ui.sigType].example) + '">' +
        '<button class="btn primary" type="submit"' + (ui.busy ? ' disabled' : '') + '>Отправить на общий экран</button></form>';
    } else {
      html += '<div class="notice ok">Оба ваших сигнала на экране. Посмотрите, что прислали другие.</div>';
    }
    if (mine.length) {
      html += '<h2 class="h3">Ваши сигналы</h2><ul class="siglist">' + mine.map(function (x) {
        return '<li><span class="stype ' + x.type + '">' + esc(G.signalTypes[x.type].name) + '</span><span>' + esc(x.text) + '</span><button class="x" data-act="delSignal" data-id="' + x.id + '" aria-label="Удалить сигнал">×</button></li>';
      }).join('') + '</ul>';
    }
    var all = (S.signals || []).length;
    html += '<p class="count"><b>' + all + '</b> ' + plural(all, 'сигнал', 'сигнала', 'сигналов') + ' от группы</p></section>';
    return html;
  }

  function viewFactorsPlayer(p) {
    var saved = S.ratings && S.ratings[p.id];
    if (!ui.rate) ui.rate = saved ? JSON.parse(JSON.stringify(saved)) : {};
    if (saved && !ui.rateEdit) {
      return '<section class="pad"><h1 class="h2">Оценки отправлены</h1><p class="muted">Посмотрите на общий экран: какие факторы оказались одновременно сильными и непредсказуемыми? Это кандидаты в оси сценариев.</p>' +
        '<div class="scbox">' + scatter(false) + '</div><button class="link" data-act="rateEdit">Изменить мои оценки</button></section>';
    }
    var done = FK.filter(function (f) { return ui.rate[f] && ui.rate[f][0] && ui.rate[f][1]; }).length;
    var html = '<section class="pad"><h1 class="h2">Что сильнее всего изменит город?</h1>' +
      '<p class="muted">Оцените каждый фактор от 1 до 5 по двум шкалам. <b>Влияние</b> — насколько сильно он изменит Северогорск. <b>Неопределённость</b> — насколько трудно предсказать, как он сложится.</p>';
    FK.forEach(function (f) {
      var v = ui.rate[f] || [0, 0];
      var row = function (axis, lbl) {
        var o = ''; for (var k = 1; k <= 5; k++) o += '<button class="' + (v[axis] === k ? 'on' : '') + '" data-act="rate" data-f="' + f + '" data-axis="' + axis + '" data-v="' + k + '" aria-label="' + lbl + ' ' + k + '">' + k + '</button>';
        return '<div class="rrow"><span>' + lbl + '</span><div class="seg num">' + o + '</div></div>';
      };
      html += '<div class="fcard' + (v[0] && v[1] ? ' done' : '') + '"><h3>' + esc(G.factors[f].name) + '</h3><p>' + esc(G.factors[f].text) + '</p>' + row(0, 'Влияние') + row(1, 'Неопределённость') + '</div>';
    });
    html += '<button class="btn primary wide" data-act="sendRates"' + (done < FK.length || ui.busy ? ' disabled' : '') + '>' + (done < FK.length ? 'Оценено ' + done + ' из ' + FK.length : 'Отправить оценки') + '</button></section>';
    return html;
  }

  function viewTeamsPlayer(p) {
    if (S.teamMode === 'host') {
      if (p.team == null) return '<section class="pad center"><div class="pulse"></div><h1 class="h2">Ведущий распределяет команды</h1><p class="muted">Подождите немного — вы увидите свою команду здесь.</p></section>';
      return '<section class="pad">' + teamIntro(p.team) + '<p class="muted">Скоро каждая команда получит случайный мир будущего.</p></section>';
    }
    var html = '<section class="pad"><h1 class="h2">Выберите команду</h1><p class="muted">В команде до ' + S.teamSize + ' человек. Миры будущего раздадут командам случайно.</p><div class="teamgrid">';
    S.teams.forEach(function (t) {
      var m = members(t.id), mine = p.team === t.id, full = m.length >= S.teamSize && !mine;
      html += '<button class="teamtile' + (mine ? ' mine' : '') + '" style="' + teamStyle(t.id) + '" data-act="pickTeam" data-team="' + t.id + '"' + (full || ui.busy ? ' disabled' : '') + '>' +
        '<span class="tl">' + tNo(t.id) + '</span><span class="tc">' + m.length + '/' + S.teamSize + '</span>' +
        '<span class="tm">' + (m.length ? m.map(function (x) { return esc(x.name); }).join(', ') : 'Пока пусто') + '</span>' +
        (mine ? '<span class="tmark">Ваша команда</span>' : full ? '<span class="tmark">Мест нет</span>' : '') + '</button>';
    });
    html += '</div>' + (p.team != null ? '<button class="link" data-act="pickTeam" data-team="">Выйти из команды</button>' : '') + '</section>';
    return html;
  }

  function teamIntro(ti) {
    var m = members(ti);
    return '<div class="teamintro" style="' + teamStyle(ti) + '"><span class="tl">' + tNo(ti) + '</span><div><h1 class="h2">Ваша ' + tLabel(ti).toLowerCase() + '</h1><p>' + m.map(function (x) { return esc(x.name); }).join(', ') + '</p></div></div>';
  }

  function field(t, key, label, hint, rows) {
    var e = t.edits && t.edits[key];
    var saving = drafts['f:' + key] !== undefined;
    return '<div class="field"><label class="lbl" for="f-' + key + '">' + label + '</label>' + (hint ? '<p class="hint">' + hint + '</p>' : '') +
      (rows === 1 ? '<input id="f-' + key + '" class="inp" data-key="f:' + key + '" data-field="' + key + '" maxlength="60" value="' + esc(t[key]) + '">'
        : '<textarea id="f-' + key + '" class="inp" rows="' + (rows || 3) + '" data-key="f:' + key + '" data-field="' + key + '" maxlength="600">' + esc(t[key]) + '</textarea>') +
      '<p class="meta">' + (saving ? 'Сохраняем…' : e ? 'Последняя правка: ' + esc(e.by) : 'Пишите вместе — текст виден всей команде') + '</p></div>';
  }

  function viewWorldPlayer(t) {
    return '<section class="pad">' + worldCard(t.world, { kicker: tLabel(t.id) + ' получила мир' }) +
      '<h2 class="h3">Задание команды</h2><p class="muted">Представьте, что этот мир наступил. Что он значит для города? Пишите коротко и по делу.</p>' +
      field(t, 'title', 'Своё название мира', 'Например, «Город инженеров» или «Тихая гавань»', 1) +
      field(t, 'residents', 'Что изменится для жителей', '', 3) +
      field(t, 'business', 'Что изменится для бизнеса', '', 3) +
      field(t, 'government', 'Что изменится для городской власти', '', 3) +
      field(t, 'signposts', 'Ранние признаки', 'По каким новостям в 2027–2030 годах мы поймём, что движемся именно в этот мир?', 3) +
      '</section>';
  }

  function effectHtml(r) {
    if (!r) return '';
    return '<p class="effect ' + (r.v < 0 ? 'neg' : 'pos') + '"><b>' + signed(r.v) + '</b> ' + esc(r.text) + '</p>';
  }

  function viewMapPlayer(t) {
    var placed = Object.keys(t.placements || {});
    var limit = G.mapLimit;
    var full = placed.length >= limit;
    var pins = placed.map(function (p, i) { var r = rule(p, t.placements[p]); return { zone: t.placements[p], color: tColor(t.id), label: String(i + 1), bad: r && r.v < 0 }; });
    var pend = ui.pending && !t.submitted ? G.projects[ui.pending] : null;
    var effSum = placed.reduce(function (a, p) { var r = rule(p, t.placements[p]); return a + (r ? r.v : 0); }, 0);
    var html = '<section class="pad">' +
      '<div class="maphead"><h1 class="h2">Город в мире «' + esc(tName(t.id)) + '»</h1><p class="muted">Выберите ' + limit + ' проектов, которые нужны городу в вашем мире, и поставьте их на карту. Место имеет значение: жители могут быть против.</p></div>' +
      '<div class="mapbox' + (pend ? ' picking' : '') + '">' + mapSvg({ pins: pins, pick: !!pend }) + '</div>';
    if (pend) {
      html += '<div class="pickbar" role="status"><p>Куда поставить «' + esc(pend.name) + '»? Нажмите на зону на карте или выберите здесь:</p><div class="zonechips">' +
        Object.keys(G.zones).map(function (z) { return '<button class="chip zbtn" data-act="placeZone" data-zone="' + z + '"' + (ui.busy ? ' disabled' : '') + '>' + esc(G.zones[z].name) + '</button>'; }).join('') +
        '</div><button class="link" data-act="cancelPick">Отмена</button></div>';
    }
    html += '<div class="counter"><b>' + placed.length + '</b> из ' + limit + ' проектов' + (effSum ? ' · последствия размещения: <b class="' + (effSum < 0 ? 'neg' : 'pos') + '">' + signed(effSum) + '</b>' : '') + (t.submitted ? ' · план отправлен' : '') + '</div>';
    if (placed.length) {
      html += '<ol class="placed">' + placed.map(function (p, i) {
        var r = rule(p, t.placements[p]);
        return '<li class="' + (r ? (r.v < 0 ? 'neg' : 'pos') : '') + '"><span class="num" style="--c:' + tColor(t.id) + '">' + (i + 1) + '</span><div class="pbody"><b>' + esc(G.projects[p].name) + '</b><span class="muted small">' + esc(G.zones[t.placements[p]].name) + '</span>' + effectHtml(r) + '</div>' +
          (t.submitted ? '' : '<span class="acts"><button class="link" data-act="pick" data-project="' + p + '">Переставить</button><button class="link" data-act="unplace" data-project="' + p + '">Убрать</button></span>') + '</li>';
      }).join('') + '</ol>';
    }
    if (t.submitted) {
      html += '<div class="notice ok">План отправил(а) ' + esc(t.submittedBy) + '. Ждите следующего этапа.</div>';
    } else {
      html += '<h2 class="h3">Библиотека проектов</h2><ul class="projects">' + Object.keys(G.projects).map(function (p) {
        var pr = G.projects[p], on = !!t.placements[p];
        return '<li class="proj' + (on ? ' on' : '') + (ui.pending === p ? ' sel' : '') + '"><div><span class="tag">' + esc(pr.tag) + '</span><h3>' + esc(pr.name) + '</h3><p>' + esc(pr.text) + '</p></div>' +
          (on ? '<span class="state">На карте</span>' : '<button class="btn small" data-act="pick" data-project="' + p + '"' + (full || ui.busy ? ' disabled' : '') + '>' + (full ? 'Лимит ' + limit : 'Поставить') + '</button>') + '</li>';
      }).join('') + '</ul>';
      html += field(t, 'rationale', 'Почему именно эти проекты?', 'Одно-два предложения: как они помогают городу в вашем мире', 3);
      html += '<button class="btn primary wide" data-act="submitMap"' + (placed.length === 0 || ui.busy ? ' disabled' : '') + '>Отправить план команды</button><p class="hint center">После отправки план нельзя менять — договоритесь в команде.</p>';
    }
    return html + '</section>';
  }

  function overlayList(limit) {
    var data = overlayData().filter(function (x) { return x.teams.length > 0; });
    if (limit) data = data.slice(0, limit);
    if (!data.length) return '<p class="muted">Команды пока не поставили проекты на карту.</p>';
    return '<ol class="overlay">' + data.map(function (x) {
      var robust = x.teams.length >= 3;
      return '<li class="' + (robust ? 'robust' : '') + '"><span class="ovn">' + x.teams.length + '</span><span class="ovt">' + esc(G.projects[x.project].name) + (robust ? '<em>кандидат в устойчивые</em>' : '') + '</span>' + dots(x.teams) + '</li>';
    }).join('') + '</ol>';
  }

  function viewOverlayPlayer(t) {
    return '<section class="pad"><h1 class="h2">Пять карт наложены</h1><p class="muted">Каждая метка — проект одной из команд. Проекты, которые выбрали три команды и больше, нужны сразу в нескольких мирах — это кандидаты в устойчивые решения.</p>' +
      '<div class="mapbox">' + mapSvg({ pins: allPins() }) + '</div>' + overlayList() + '</section>';
  }

  function viewAuctionPlayer(t) {
    var cur = S.auction.current;
    var sold = S.auction.results;
    var mine = sold.filter(function (r) { return r.team === t.id; });
    var html = '<section class="pad"><div class="budget" style="' + teamStyle(t.id) + '"><span>Бюджет команды</span><b>' + t.budget + '</b><span>' + plural(t.budget, 'монета', 'монеты', 'монет') + '</span></div>';
    if (cur) {
      var pr = G.projects[cur.project];
      var ov = overlayData().filter(function (x) { return x.project === cur.project; })[0];
      var open = now() < cur.endsAt + 1500;
      if (ui.lotSeen !== cur.project) { ui.lotSeen = cur.project; ui.bid = Math.min(t.budget, 10); }
      var b = t.bid;
      var myZone = t.placements[cur.project];
      html += '<article class="lot"><div class="lothead"><div><span class="tag">' + esc(pr.tag) + '</span><h2 class="h2">' + esc(pr.name) + '</h2></div>' + countdownHtml(cur, false) + '</div><p>' + esc(pr.text) + '</p>' +
        '<p class="small muted">На картах выбрали: ' + dots(ov ? ov.teams : []) + '</p>' +
        (myZone ? '<p class="small">На вашей карте: <b>' + esc(G.zones[myZone].name) + '</b></p>' + effectHtml(rule(cur.project, myZone)) : '') + '</article>';
      if (open) {
        var v = Math.max(0, Math.min(t.budget, ui.bid == null ? 10 : ui.bid));
        html += '<div class="bidbox"><p class="lbl">Ставка команды</p><div class="stepper">' +
          '<button class="btn round" data-act="bidStep" data-d="-5" aria-label="Минус 5">−5</button><output class="bidval">' + v + '</output>' +
          '<button class="btn round" data-act="bidStep" data-d="5" aria-label="Плюс 5">+5</button><button class="btn round" data-act="bidStep" data-d="25" aria-label="Плюс 25">+25</button></div>' +
          '<div class="bidacts"><button class="btn primary" data-act="bid"' + (v < 5 || ui.busy ? ' disabled' : '') + '>Поставить ' + v + '</button><button class="btn" data-act="pass"' + (ui.busy ? ' disabled' : '') + '>Пас</button></div>' +
          '<p class="meta">' + (b ? (b.pass ? 'Команда пасует' : 'Ставка команды: <b>' + b.amount + '</b>') + (b.by ? ' — ' + esc(b.by) : '') + '. Можно изменить до конца времени.' : 'Ставки закрытые: другие команды не видят сумму. Побеждает самая высокая ставка.') + '</p></div>';
      } else {
        html += '<div class="notice">Время вышло, подводим итог…</div>';
      }
      html += '<div class="others">' + S.teams.map(function (tt) {
        return '<span class="ob' + (tt.bid ? ' made' : '') + '" style="' + teamStyle(tt.id) + '">' + tNo(tt.id) + (tt.bid ? ' ✓' : '') + '</span>';
      }).join('') + '<span class="muted small">— кто уже сделал ставку</span></div>';
    } else {
      var last = sold[sold.length - 1];
      html += '<div class="notice">' + (last ? resultText(last) + '. ' : '') + 'Ждём следующий лот.</div>';
    }
    html += '<h2 class="h3">Куплено командой</h2>' + (mine.length ? '<ul class="bought">' + mine.map(function (r) { return '<li>' + esc(G.projects[r.project].name) + '<span>' + r.price + '</span></li>'; }).join('') + '</ul>' : '<p class="muted">Пока ничего. Неиспользованные монеты в конце сгорают — как бюджет в конце года.</p>');
    return html + '</section>';
  }

  function viewRevealPlayer(t) {
    if (!S.reveal) return '<section class="pad center"><div class="pulse"></div><h1 class="h2">Торги окончены</h1><p class="muted">Сейчас ведущий раскрутит колесо судьбы и узнаем, какой мир наступил.</p></section>';
    var st = spinState();
    var html = '<section class="pad center">' + wheelHtml(260);
    if (!st.done) return html + '<p class="h3">Какой мир наступит?</p></section>';
    var sc = S.score.teams[t.id];
    html += worldCard(S.reveal.world, { short: true, kicker: 'Наступил мир' + (S.reveal.world === t.world ? ' — ваш!' : '') }) + '</section>';
    html += '<section class="pad">' + scoreBlock(t, sc, false) + '</section>';
    return html;
  }

  function scoreBlock(t, sc, withShock) {
    var wi = W.indexOf(S.reveal.world);
    var total = withShock ? sc.actual : sc.base;
    var html = '<div class="score" style="' + teamStyle(t.id) + '"><span>Результат: ' + tLabel(t.id).toLowerCase() + '</span><b>' + signed(total) + '</b></div>';
    if (!sc.projects.length) return html + '<p class="muted">Команда ничего не купила на аукционе.</p>';
    html += '<ul class="bought score-list">' + sc.projects.map(function (pp) {
      var base = S.payoff[pp.project][wi], v = withShock ? pp.value : base + pp.place;
      var r = rule(pp.project, pp.zone);
      return '<li><div><b>' + esc(G.projects[pp.project].name) + '</b><span class="small muted">в этом мире ' + signed(base) + (pp.place ? ' · место ' + signed(pp.place) : '') + (withShock && v !== base + pp.place ? ' · шок ' + signed(v - base - pp.place) : '') + '</span>' +
        (r && r.v < 0 ? '<span class="small neg">' + esc(r.text) + '</span>' : '') + '</div><span class="' + (v > 0 ? 'pos' : v < 0 ? 'neg' : '') + '">' + signed(v) + '</span></li>';
    }).join('') + '</ul>';
    return html;
  }

  function viewShockPlayer(t) {
    var sh = S.shock ? G.shocks[S.shock] : null;
    var html = '<section class="pad">';
    if (sh) html += '<article class="shock"><span class="shk">Неожиданное событие</span><h1 class="h2">' + esc(sh.name) + '</h1><p>' + esc(sh.text) + '</p></article>';
    if (S.score) html += scoreBlock(t, S.score.teams[t.id], true);
    html += field(t, 'shockAnswer', 'Как вы скорректируете стратегию?', 'Что бы вы купили или не купили, зная про это событие? Был ли среди ваших «ранних признаков» намёк на него?', 4);
    return html + '</section>';
  }

  function ranking() {
    var arr = S.score.teams.slice().sort(function (a, b) { return b.actual - a.actual || b.min - a.min || b.avg - a.avg; });
    var withProj = S.score.teams.filter(function (x) { return x.projects.length > 0; });
    var robust = (withProj.length ? withProj : S.score.teams).slice().sort(function (a, b) { return b.min - a.min || b.avg - a.avg; })[0];
    return { arr: arr, robust: robust };
  }

  function viewResultsPlayer(t) {
    if (!S.score) return '<section class="pad center"><h1 class="h2">Игра окончена</h1><p class="muted">Спасибо!</p></section>';
    var rk = ranking();
    var place = rk.arr.map(function (x) { return x.team; }).indexOf(t.id) + 1;
    var sc = S.score.teams[t.id];
    return '<section class="pad"><div class="score" style="' + teamStyle(t.id) + '"><span>Место: ' + tLabel(t.id).toLowerCase() + '</span><b>' + place + '</b><span>из ' + S.teams.length + '</span></div>' +
      '<p>В наступившем мире' + (S.shock ? ' с учётом шока' : '') + ': <b>' + signed(sc.actual) + '</b>. В худшем из пяти миров ваша стратегия дала бы <b>' + signed(sc.min) + '</b>' + (rk.robust.team === t.id ? ' — <b>это самая устойчивая стратегия</b>.' : '.') + '</p>' +
      '<h2 class="h3">Ваши проекты во всех мирах</h2>' + worldsTable(sc.projects, t.id) + '</section>';
  }

  function worldsTable(projects) {
    if (!projects.length) return '<p class="muted">Нет купленных проектов.</p>';
    var html = '<div class="tablewrap"><table class="wt"><thead><tr><th>Проект</th>' + W.map(function (w) { return '<th style="' + worldStyle(w) + '"><span class="wdot">' + w + '</span></th>'; }).join('') + '</tr></thead><tbody>';
    var sums = W.map(function () { return 0; });
    projects.forEach(function (pp) {
      html += '<tr><td>' + esc(G.projects[pp.project].name) + (pp.place ? ' <span class="small ' + (pp.place < 0 ? 'neg' : 'pos') + '">место ' + signed(pp.place) + '</span>' : '') + '</td>' + W.map(function (w, i) { var v = S.payoff[pp.project][i] + pp.place; sums[i] += v; return '<td class="' + (v > 0 ? 'pos' : v < 0 ? 'neg' : '') + (w === S.reveal.world ? ' cur' : '') + '">' + signed(v) + '</td>'; }).join('') + '</tr>';
    });
    html += '<tr class="sum"><td>Итого</td>' + sums.map(function (v, i) { return '<td class="' + (W[i] === S.reveal.world ? 'cur' : '') + '">' + signed(v) + '</td>'; }).join('') + '</tr></tbody></table></div>';
    return html;
  }

  // =====================================================================
  //                         ЭКРАН ПРОЕКТОРА
  // =====================================================================
  function joinUrl() {
    var u = location.origin + location.pathname;
    if (qs.get('api')) u += '?api=' + encodeURIComponent(qs.get('api'));
    return u;
  }

  function qrSvg(text) {
    try { var q = window.qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 6, margin: 2, scalable: true }); } catch (e) { return ''; }
  }

  function viewScreen() {
    var ph = S.phase, body = '';
    if (ph === 'intro') return screenIntro();
    if (ph === 'lobby') body = screenLobby();
    else if (ph === 'signals') body = screenSignals();
    else if (ph === 'factors') body = screenFactors();
    else if (ph === 'teams') body = screenTeams();
    else if (ph === 'world') body = screenMatrix();
    else if (ph === 'map') body = screenMap();
    else if (ph === 'overlay') body = screenOverlay();
    else if (ph === 'auction') body = screenAuction();
    else if (ph === 'reveal') body = screenReveal();
    else if (ph === 'shock') body = screenShock();
    else body = screenResults();
    return '<div class="screen"><header class="sbar"><span class="logo">Город в 5 мирах · ' + G.city + '</span>' + route(ph) + '</header><main class="sbody">' + body + '</main></div>';
  }

  function screenIntro() {
    var step = S.introStep || 0, sl = G.intro[step];
    return '<div class="sintro"><canvas class="swarm" data-step="' + step + '" aria-hidden="true"></canvas>' +
      '<div class="ipanel"><p class="istep">' + (step + 1) + ' / ' + G.intro.length + '</p><h1 class="title xl">' + esc(sl.title) + '</h1><p class="lead">' + esc(sl.text) + '</p>' +
      '<ul class="ipoints">' + sl.points.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul></div>' +
      '<p class="ibrand">Город в 5 мирах · форсайт-сессия</p></div>';
  }

  function screenLobby() {
    var ps = players();
    return '<div class="slobby"><div class="sjoin"><h1 class="title xl">Город в&nbsp;5&nbsp;мирах</h1><p class="lead">Отсканируйте код, введите имя — и ждите старта.</p>' +
      '<div class="qr">' + qrSvg(joinUrl()) + '</div><p class="url">' + esc(joinUrl().replace(/^https?:\/\//, '')) + '</p></div>' +
      '<div class="snames"><p class="count"><b>' + ps.length + '</b> ' + plural(ps.length, 'участник', 'участника', 'участников') + '</p><div class="names">' +
      ps.map(function (p) { return '<span class="nm">' + esc(p.name) + '</span>'; }).join('') + '</div></div></div>';
  }

  function screenSignals() {
    var sig = S.signals || [];
    return '<div class="ssig"><div class="shead"><h1 class="h2">Сигналы будущего</h1><p class="count"><b>' + sig.length + '</b> ' + plural(sig.length, 'сигнал', 'сигнала', 'сигналов') + '</p></div><div class="sigcols">' +
      G.signalOrder.map(function (k) {
        var list = sig.filter(function (x) { return x.type === k; });
        return '<div class="sigcol ' + k + '"><h2>' + esc(G.signalTypes[k].name) + '<small>' + esc(G.signalTypes[k].hint) + '</small></h2><ul>' +
          list.slice(-9).reverse().map(function (x) { return '<li>' + esc(x.text) + '<span>' + esc(x.name) + '</span></li>'; }).join('') +
          (list.length > 9 ? '<li class="more">и ещё ' + (list.length - 9) + '</li>' : '') + '</ul></div>';
      }).join('') + '</div></div>';
  }

  function screenFactors() {
    var st = factorStats();
    return '<div class="sfac"><div class="scbox dark">' + scatter(true) + '</div><div class="facside"><h1 class="h2">Какие силы определят будущее?</h1>' +
      '<p class="lead">Каждая точка — среднее по оценкам группы. Самые сильные и непредсказуемые факторы — в правом верхнем углу: из них строят сценарии.</p>' +
      '<p class="count"><b>' + st.n + '</b> ' + plural(st.n, 'участник оценил', 'участника оценили', 'участников оценили') + '</p>' +
      (S.axesShown ? '<div class="axnote"><b>Оси нашей матрицы:</b> «' + esc(G.factors[G.axisFactors[0]].name) + '» и «' + esc(G.factors[G.axisFactors[1]].name) + '». Совпало ли с вашим выбором?</div>' : '') + '</div></div>';
  }

  function screenTeams() {
    var free = players().filter(function (p) { return p.team == null; });
    return '<div class="steams">' + S.teams.map(function (t) {
      var m = members(t.id);
      return '<div class="scol" style="' + teamStyle(t.id) + '"><span class="tl">' + tNo(t.id) + '</span><p class="tc">' + m.length + ' / ' + S.teamSize + '</p><ul>' + m.map(function (x) { return '<li>' + esc(x.name) + '</li>'; }).join('') + '</ul></div>';
    }).join('') + '</div>' + (free.length ? '<p class="sfree">Без команды: ' + free.map(function (p) { return esc(p.name); }).join(', ') + '</p>' : '') +
      (S.teamMode === 'self' ? '<p class="shint">Выберите команду на телефоне. Миры раздадим случайно.</p>' : '');
  }

  function cell(wid) {
    var ti = teamOfWorld(wid);
    var w = world(wid);
    var t = ti == null ? {} : S.teams[ti];
    var line = function (lbl, v) { return v ? '<p><b>' + lbl + '</b> ' + esc(cut(v, 110)) + '</p>' : ''; };
    return '<div class="mcell" style="' + worldStyle(wid) + '"><div class="mhead"><span class="tl">' + wid + '</span><div><h3>' + esc(t.title || w.name) + '</h3><p class="small">' + (t.title ? esc(w.name) + ' · ' : '') + (ti != null ? tLabel(ti) : '') + '</p></div></div>' +
      line('Жители:', t.residents) + line('Бизнес:', t.business) + line('Власть:', t.government) + line('Признаки:', t.signposts) +
      (!t.residents && !t.business && !t.government ? '<p class="muted">Команда думает…</p>' : '') + '</div>';
  }

  function screenMatrix() {
    var ax = G.axes;
    return '<div class="matrix">' +
      '<div class="ax top">' + esc(ax.y.name) + ': ' + esc(ax.y.top) + '</div><div class="ax bottom">' + esc(ax.y.name) + ': ' + esc(ax.y.bottom) + '</div>' +
      '<div class="ax left">' + esc(ax.x.name) + ' ' + esc(ax.x.left) + '</div><div class="ax right">' + esc(ax.x.name) + ' ' + esc(ax.x.right) + '</div>' +
      '<div class="mgrid">' + cell('A') + cell('C') + cell('B') + cell('D') + '<div class="mcenter">' + cell('E') + '</div></div></div>';
  }

  function screenMap() {
    return '<div class="ssplit"><div class="mapbox">' + mapSvg({ pins: allPins() }) + '</div><div class="sprog"><h2 class="h2">Команды строят город</h2>' + S.teams.map(function (t) {
      var n = Object.keys(t.placements || {}).length;
      return '<div class="prow" style="' + teamStyle(t.id) + '"><span class="tl s">' + tNo(t.id) + '</span><span class="pname">' + esc(tName(t.id)) + '</span><span class="pbar"><i style="width:' + (n / G.mapLimit * 100) + '%"></i></span><span class="pn">' + (t.submitted ? 'готово' : n + '/' + G.mapLimit) + '</span></div>';
    }).join('') + '<p class="small muted">Метка с восклицательным знаком — проект в неудачном месте: жители против.</p></div></div>';
  }

  function screenOverlay() {
    return '<div class="ssplit"><div class="mapbox">' + mapSvg({ pins: allPins() }) + '</div><div><h2 class="h2">Что совпало у команд</h2>' + overlayList(10) + '</div></div>';
  }

  function screenAuction() {
    var cur = S.auction.current, res = S.auction.results;
    var left = '';
    if (cur) {
      var pr = G.projects[cur.project];
      var ov = overlayData().filter(function (x) { return x.project === cur.project; })[0];
      left = '<div class="slot"><span class="tag">Лот ' + (res.length + 1) + ' · ' + esc(pr.tag) + '</span><h1 class="title">' + esc(pr.name) + '</h1><p class="lead">' + esc(pr.text) + '</p><p>На картах выбрали: ' + dots(ov ? ov.teams : []) + '</p>' + countdownHtml(cur, true) + '</div>';
    } else {
      var last = res[res.length - 1];
      left = '<div class="slot">' + (last ? '<span class="tag">Лот ' + res.length + ' закрыт</span><h1 class="title">' + esc(G.projects[last.project].name) + '</h1>' +
        (last.team != null ? '<p class="winner" style="' + teamStyle(last.team) + '">Покупает <b>' + tLabel(last.team).toLowerCase() + '</b> за ' + last.price + '</p>' : '<p class="lead">Никто не сделал ставку — проект не будет построен.</p>') +
        '<p class="small muted">Ставки: ' + S.teams.map(function (t) { var b = last.bids[t.id]; return tNo(t.id) + ' — ' + (b == null ? 'нет' : b === 0 ? 'пас' : b); }).join(', ') + '</p>'
        : '<h1 class="title">Аукцион проектов</h1><p class="lead">У каждой команды ' + G.budget + ' монет. Ставки закрытые, побеждает самая высокая. Неиспользованные монеты в конце сгорают.</p>') + '</div>';
    }
    var right = '<div class="steamsbar">' + S.teams.map(function (t) {
      var won = res.filter(function (r) { return r.team === t.id; }).length;
      return '<div class="tbud' + (cur && t.bid ? ' made' : '') + '" style="' + teamStyle(t.id) + '"><span class="tl s">' + tNo(t.id) + '</span><span class="tb">' + t.budget + '<small>' + plural(t.budget, 'монета', 'монеты', 'монет') + '</small></span><span class="small">' + won + ' ' + plural(won, 'проект', 'проекта', 'проектов') + '</span>' + (cur ? '<span class="bstat">' + (t.bid ? 'ставка есть' : '…') + '</span>' : '') + '</div>';
    }).join('') + '</div>';
    return '<div class="sauction">' + left + right + '</div>';
  }

  function screenReveal() {
    if (!S.reveal) return '<div class="center sfull"><h1 class="title xl">Какой мир наступит?</h1><p class="lead">Сейчас раскрутим колесо судьбы.</p></div>';
    var st = spinState();
    if (!st.done) return '<div class="center sfull"><h1 class="title">Какой мир наступит?</h1>' + wheelHtml(440) + '</div>';
    var ti = teamOfWorld(S.reveal.world);
    return '<div class="ssplit"><div>' + worldCard(S.reveal.world, { kicker: 'Наступил мир' + (ti != null ? ' команды ' + tNo(ti) : '') }) + '</div><div>' + scoreboard(false) + '</div></div>';
  }

  function scoreboard(withShock) {
    var arr = S.score.teams.slice().sort(function (a, b) { return (withShock ? b.actual - a.actual : b.base - a.base); });
    return '<h2 class="h2">Результаты команд</h2><ol class="board">' + arr.map(function (x) {
      var v = withShock ? x.actual : x.base;
      var bad = x.projects.filter(function (p) { return p.place < 0; }).length;
      return '<li style="' + teamStyle(x.team) + '"><span class="tl s">' + tNo(x.team) + '</span><span class="bn">' + esc(tName(x.team)) + '<small>' + (x.projects.map(function (p) { return esc(G.projects[p.project].name); }).join(', ') || 'ничего не купили') + (bad ? ' · штрафы за место: ' + bad : '') + '</small></span><b>' + signed(v) + '</b></li>';
    }).join('') + '</ol>';
  }

  function screenShock() {
    var sh = S.shock ? G.shocks[S.shock] : null;
    return '<div class="ssplit"><div>' + (sh ? '<article class="shock big"><span class="shk">Неожиданное событие</span><h1 class="title">' + esc(sh.name) + '</h1><p class="lead">' + esc(sh.text) + '</p></article>' : '') + '</div><div>' + (S.score ? scoreboard(true) : '') + '</div></div>';
  }

  function screenResults() {
    if (!S.score) return '<div class="center sfull"><h1 class="title xl">Итоги</h1></div>';
    var rk = ranking();
    return '<div class="sres"><div class="awards">' +
      '<div class="award" style="' + teamStyle(rk.arr[0].team) + '"><span>Лучший результат в мире «' + esc(world(S.reveal.world).name) + '»' + (S.shock ? ' с учётом шока' : '') + '</span><b>' + tLabel(rk.arr[0].team) + '</b><em>' + signed(rk.arr[0].actual) + '</em></div>' +
      '<div class="award" style="' + teamStyle(rk.robust.team) + '"><span>Самая устойчивая стратегия — лучший результат в худшем мире</span><b>' + tLabel(rk.robust.team) + '</b><em>' + signed(rk.robust.min) + '</em></div></div>' +
      '<div class="tablewrap"><table class="wt big"><thead><tr><th>Команда</th>' + W.map(function (w) { return '<th style="' + worldStyle(w) + '"><span class="wdot">' + w + '</span><small>' + esc(world(w).name) + '</small></th>'; }).join('') + '<th>Худший</th></tr></thead><tbody>' +
      S.score.teams.map(function (x) {
        return '<tr><td>' + chip(x.team) + ' ' + esc(tName(x.team)) + '</td>' + x.byWorld.map(function (v, i) { return '<td class="' + (v > 0 ? 'pos' : v < 0 ? 'neg' : '') + (W[i] === S.reveal.world ? ' cur' : '') + '">' + signed(v) + '</td>'; }).join('') + '<td class="minc">' + signed(x.min) + '</td></tr>';
      }).join('') + '</tbody></table></div><p class="small muted">Очки с учётом места на карте, без карты-шока. Столбец выделен для наступившего мира.</p></div>';
  }

  // =====================================================================
  //                               ВЕДУЩИЙ
  // =====================================================================
  function viewHost() {
    var ph = S.phase;
    var html = '<header class="bar host"><span class="logo">Пульт ведущего</span><span class="who"><a href="#screen" target="_blank" rel="noopener" class="link">Экран проектора</a> <a href="#curator" target="_blank" rel="noopener" class="link">Оценки</a></span></header>';
    html += '<nav class="hphases">' + PHASES.map(function (p, i) {
      return '<button class="hph' + (p === ph ? ' now' : '') + '" data-act="phase" data-phase="' + p + '"><span>' + (i + 1) + '</span>' + PHASE_NAME[p] + '</button>';
    }).join('') + '</nav>';
    var i = PHASES.indexOf(ph);
    var nxt = PHASES[Math.min(PHASES.length - 1, i + 1)];
    html += '<div class="hnav"><button class="btn" data-act="phase" data-phase="' + PHASES[Math.max(0, i - 1)] + '"' + (i === 0 ? ' disabled' : '') + '>Назад</button><button class="btn primary" data-act="phase" data-phase="' + nxt + '"' + (i === PHASES.length - 1 ? ' disabled' : '') + '>Дальше: ' + PHASE_NAME[nxt] + '</button></div>';
    html += '<div class="hgrid"><div class="hmain">' + hostPanel(ph) + '</div><aside class="hside">' + hostPlayers() + '</aside></div>';
    html += '<details class="danger"><summary>Сброс игры</summary><p class="small">Начать заново: все ответы, ставки и оценки будут удалены.</p><button class="btn" data-act="reset" data-keep="1">Заново, игроков оставить</button> <button class="btn bad" data-act="reset" data-keep="0">Полный сброс</button></details>';
    return html;
  }

  function progressRow(ti, n, total, label, extra) {
    return '<div class="prow" style="' + teamStyle(ti) + '"><span class="tl s">' + tNo(ti) + '</span><span class="pname">' + esc(tName(ti)) + '</span><span class="pbar"><i style="width:' + (n / total * 100) + '%"></i></span><span class="pn">' + label + '</span>' + (extra || '') + '</div>';
  }

  function hostPanel(ph) {
    if (ph === 'intro') {
      var step = S.introStep || 0, sl = G.intro[step];
      return '<h2 class="h2">Заставка: что такое форсайт</h2><p class="muted">Слайды идут на экране проектора поверх анимации. Ниже — подсказка, что рассказать.</p>' +
        '<div class="row">' + G.intro.map(function (x, k) { return '<button class="btn' + (k === step ? ' primary' : '') + '" data-act="intro" data-step="' + k + '">' + (k + 1) + '. ' + esc(x.title) + '</button>'; }).join('') + '</div>' +
        '<div class="notes"><h3 class="h3">' + esc(sl.title) + '</h3><p>' + esc(sl.text) + '</p><ul>' + sl.points.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul></div>' +
        (step < G.intro.length - 1 ? '<button class="btn primary" data-act="intro" data-step="' + (step + 1) + '">Следующий слайд</button>' : '<button class="btn primary" data-act="phase" data-phase="lobby">К сбору участников</button>');
    }
    if (ph === 'lobby') return '<h2 class="h2">Сбор участников</h2><p>Покажите на проекторе экран с QR-кодом (ссылка «Экран проектора» вверху). Ссылка для игроков:</p><p class="url">' + esc(joinUrl()) + '</p><div class="qr small">' + qrSvg(joinUrl()) + '</div><p class="muted">Когда все зашли — переходите к сигналам.</p>';
    if (ph === 'signals') {
      var sig = S.signals || [];
      return '<h2 class="h2">Сигналы будущего · ' + sig.length + '</h2><p class="muted">Каждый участник присылает до двух факторов и сам определяет их тип. Неуместные можно скрыть с экрана.</p><ul class="hsig">' +
        sig.slice().reverse().map(function (x) { return '<li class="' + (x.hidden ? 'hid' : '') + '"><span class="stype ' + x.type + '">' + esc(G.signalTypes[x.type].name) + '</span><span>' + esc(x.text) + ' <span class="muted small">' + esc(x.name) + '</span></span><button class="link" data-act="hideSignal" data-id="' + x.id + '">' + (x.hidden ? 'Показать' : 'Скрыть') + '</button></li>'; }).join('') + '</ul>' +
        '<p class="muted small">Для обсуждения: какие из сигналов — действительно тренды, а какие — слабые сигналы? Что из этого может стать джокером?</p>';
    }
    if (ph === 'factors') {
      var st = factorStats();
      return '<h2 class="h2">Оценка факторов</h2><p>Оценили: <b>' + st.n + '</b> из ' + players().length + '</p><div class="scbox">' + scatter(false) + '</div>' +
        '<button class="btn' + (S.axesShown ? '' : ' primary') + '" data-act="showAxes">' + (S.axesShown ? 'Скрыть оси матрицы' : 'Показать оси нашей матрицы') + '</button>' +
        '<p class="muted small">Обсудите: что попало в правый верхний угол? В нашем кейсе оси — «Судьба комбината» и «Внимание государства».</p>';
    }
    if (ph === 'teams') {
      return '<h2 class="h2">Команды</h2><div class="seg"><button class="' + (S.teamMode === 'self' ? 'on' : '') + '" data-act="teamMode" data-mode="self">Игроки выбирают сами</button><button class="' + (S.teamMode === 'host' ? 'on' : '') + '" data-act="teamMode" data-mode="host">Распределяю я</button></div>' +
        '<label class="lbl">Мест в команде <select class="inp sm" data-act-change="teamSize">' + [3, 4, 5, 6].map(function (n) { return '<option' + (n === S.teamSize ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></label>' +
        '<div class="row"><button class="btn primary" data-act="autoTeams" data-keep="0">Раздать всех случайно</button><button class="btn" data-act="autoTeams" data-keep="1">Раздать только тех, кто без команды</button></div>' +
        '<div class="hteams">' + S.teams.map(function (t) { return '<div class="ht" style="' + teamStyle(t.id) + '"><b>' + tNo(t.id) + '</b> · ' + members(t.id).length + ' чел.</div>'; }).join('') + '</div><p class="muted small">Миры раздадутся командам случайно при переходе к этапу «Миры».</p>';
    }
    if (ph === 'world') return '<h2 class="h2">Миры</h2><p class="muted">Миры розданы случайно. Команды описывают последствия и ранние признаки, на проекторе собирается сценарная матрица.</p>' +
      S.teams.map(function (t) {
        var n = ['title', 'residents', 'business', 'government', 'signposts'].filter(function (k) { return t[k]; }).length;
        return progressRow(t.id, n, 5, n + '/5', '<span class="small">мир ' + (t.world || '—') + '</span>');
      }).join('') + '<button class="btn" data-act="dealWorlds">Перераздать миры заново</button>';
    if (ph === 'map') return '<h2 class="h2">Карта</h2>' + S.teams.map(function (t) {
      var n = Object.keys(t.placements || {}).length;
      var bad = Object.keys(t.placements || {}).filter(function (p) { var r = rule(p, t.placements[p]); return r && r.v < 0; }).length;
      return progressRow(t.id, n, G.mapLimit, t.submitted ? 'отправлен' : n + '/' + G.mapLimit, (bad ? '<span class="small neg">штрафов: ' + bad + '</span>' : '') + (t.submitted ? '<button class="link" data-act="unlockMap" data-team="' + t.id + '">Открыть</button>' : ''));
    }).join('');
    if (ph === 'overlay') return '<h2 class="h2">Наложение карт</h2>' + overlayList();
    if (ph === 'auction') return hostAuction();
    if (ph === 'reveal') {
      var sp = S.reveal ? spinState() : null;
      return '<h2 class="h2">Колесо судьбы</h2><div class="row"><button class="btn primary" data-act="spin"' + (ui.busy ? ' disabled' : '') + '>' + (S.reveal ? 'Крутить ещё раз' : 'Крутить колесо') + '</button>' +
        '<label class="lbl">или назначить мир <select class="inp sm" data-act-change="spinWorld"><option value="">—</option>' + W.map(function (w) { return '<option value="' + w + '">' + w + ' · ' + esc(world(w).name) + '</option>'; }).join('') + '</select></label></div>' +
        (S.reveal ? '<p>' + (sp.done ? 'Наступил мир <b>' + S.reveal.world + ' · ' + esc(world(S.reveal.world).name) + '</b>' : 'Колесо крутится…') + '</p>' : '') +
        (S.reveal && sp.done ? scoreboard(false) : '');
    }
    if (ph === 'shock') return '<h2 class="h2">Карта-шок</h2><p class="muted">Выберите событие — очки команд пересчитаются.</p><div class="shocks">' + Object.keys(G.shocks).map(function (k) {
      return '<button class="shockbtn' + (S.shock === k ? ' on' : '') + '" data-act="shock" data-shock="' + k + '"><b>' + esc(G.shocks[k].name) + '</b><span>' + esc(G.shocks[k].text) + '</span></button>';
    }).join('') + '</div><button class="btn" data-act="shock" data-shock="random">Случайная карта</button>' + (S.score && S.shock ? scoreboard(true) : '') +
      (!S.reveal ? '<p class="notice">Сначала раскрутите колесо на этапе «Судьба».</p>' : '');
    return '<h2 class="h2">Итоги</h2><p>Сохраните оценки кураторов и результаты команд.</p><div class="row"><button class="btn primary" data-act="export">Выгрузить в Google Таблицу</button><button class="btn" data-act="csv">Скачать оценки (CSV)</button></div>' + gradeSummary() +
      '<div class="notes"><h3 class="h3">Вопросы для рефлексии</h3><ul><li>Почему команда купила именно эти проекты?</li><li>Какие проекты оказались полезны во всех мирах — и почему?</li><li>Сработали ли ваши «ранние признаки»? Можно ли было предвидеть шок?</li><li>Где форсайт упрощён в игре, а где в реальной стратегии города всё сложнее?</li></ul></div>';
  }

  function hostAuction() {
    var cur = S.auction.current, sold = soldMap();
    var ov = {}; overlayData().forEach(function (x) { ov[x.project] = x.teams; });
    var html = '<h2 class="h2">Аукцион</h2>';
    if (cur) {
      html += '<div class="hlot"><div><span class="tag">Идёт лот</span><h3 class="h3">' + esc(G.projects[cur.project].name) + '</h3></div>' + countdownHtml(cur, false) + '</div>' +
        '<table class="mini"><tbody>' + S.teams.map(function (t) { return '<tr><td>' + chip(t.id) + '</td><td>' + (t.bid ? (t.bid.amount === 0 ? 'пас' : '<b>' + t.bid.amount + '</b>') + ' <span class="muted small">' + esc(t.bid.by) + '</span>' : '<span class="muted">нет ставки</span>') + '</td><td class="muted small">бюджет ' + t.budget + '</td></tr>'; }).join('') + '</tbody></table>' +
        '<div class="row"><button class="btn primary" data-act="closeLot">Закрыть сейчас</button><button class="btn" data-act="cancelLot">Отменить лот</button></div>';
    }
    html += '<div class="row"><label class="lbl">Время на лот <select class="inp sm" data-act-change="lotSeconds">' + [20, 30, 40, 60, 90].map(function (n) { return '<option value="' + n + '"' + (n === ui.lotSeconds ? ' selected' : '') + '>' + n + ' с</option>'; }).join('') + '</select></label>' +
      '<label class="lbl chk"><input type="checkbox" data-act-change="autoClose"' + (ui.autoClose ? ' checked' : '') + '> закрывать лот автоматически</label></div>';
    html += '<ul class="lots">' + Object.keys(G.projects).map(function (p) {
      var r = sold[p];
      return '<li class="' + (r ? 'sold' : '') + (cur && cur.project === p ? ' live' : '') + '"><span class="ln">' + esc(G.projects[p].name) + '</span>' + dots(ov[p] || []) +
        (r ? '<span class="small">' + (r.team == null ? 'не продан' : tLabel(r.team) + ' · ' + r.price) + '</span>' : cur ? '<span></span>' : '<button class="btn small" data-act="startLot" data-project="' + p + '">Открыть лот</button>') + '</li>';
    }).join('') + '</ul>' + (S.auction.results.length ? '<button class="link" data-act="undoLot">Отменить результат последнего лота</button>' : '');
    return html;
  }

  function hostPlayers() {
    var ps = players();
    return '<h2 class="h3">Игроки · ' + ps.length + '</h2><ul class="plist" data-scroll="plist">' + ps.map(function (p) {
      return '<li><span class="plname">' + esc(p.name) + '</span><select class="inp sm" data-act-change="assign" data-pid="' + p.id + '" aria-label="Команда игрока ' + esc(p.name) + '"><option value="">—</option>' + S.teams.map(function (t) { return '<option value="' + t.id + '"' + (p.team === t.id ? ' selected' : '') + '>' + tNo(t.id) + '</option>'; }).join('') + '</select>' +
        '<button class="x" data-act="kick" data-pid="' + p.id + '" aria-label="Удалить ' + esc(p.name) + '">×</button></li>';
    }).join('') + '</ul>';
  }

  function gradeTotal(g) { return G.criteria.reduce(function (a, c) { return a + (Number(g && g[c.key]) || 0); }, 0); }

  function gradeSummary() {
    var ps = players();
    var done = ps.filter(function (p) { return S.grades && S.grades[p.id]; }).length;
    return '<p class="muted">Оценено ' + done + ' из ' + ps.length + ' участников.</p>';
  }

  function csv() {
    var rows = [['Игрок', 'Команда'].concat(G.criteria.map(function (c) { return c.name + ' (0–' + c.max + ')'; }), ['Итог (0–10)', 'Комментарий', 'Куратор'])];
    players().forEach(function (p) {
      var g = (S.grades || {})[p.id] || {};
      rows.push([p.name, p.team == null ? '' : tLabel(p.team)].concat(G.criteria.map(function (c) { return g[c.key] == null ? '' : g[c.key]; }), [gradeTotal(g), g.note || '', g.by || '']));
    });
    var text = '﻿' + rows.map(function (r) { return r.map(function (v) { v = String(v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(';'); }).join('\n');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    a.download = 'оценки-форсайт.csv';
    document.body.appendChild(a); a.click(); a.remove();
  }

  // =====================================================================
  //                               КУРАТОР
  // =====================================================================
  function viewCurator() {
    var ti = Math.min(ui.curTeam, S.teams.length - 1);
    var t = S.teams[ti];
    var by = store.get('curName') || '';
    var html = '<header class="bar" style="' + teamStyle(ti) + '"><span class="logo">Оценки куратора</span><span class="who">Этап: ' + PHASE_NAME[S.phase] + '</span></header>';
    html += '<div class="pad"><div class="tabs">' + S.teams.map(function (tt) { return '<button class="tab' + (tt.id === ti ? ' on' : '') + '" style="' + teamStyle(tt.id) + '" data-act="curTeam" data-team="' + tt.id + '">' + tNo(tt.id) + '</button>'; }).join('') + '</div>' +
      '<label class="lbl" for="curname">Ваше имя (куратор)</label><input id="curname" class="inp" data-key="curName" value="' + esc(by) + '" placeholder="Например, Егор">' +
      '<h2 class="h2">' + tLabel(ti) + (t.world ? ' · мир ' + t.world + ' «' + esc(tName(ti)) + '»' : '') + '</h2>';
    var ms = members(ti);
    html += '<p class="muted small">Шкала: ' + G.criteria.map(function (c) { return esc(c.name) + ' 0–' + c.max; }).join(', ') + '. Итог — до 10 баллов.</p>';
    html += ms.length ? ms.map(function (p) {
      var g = (S.grades || {})[p.id] || {};
      var sigs = (S.signals || []).filter(function (x) { return x.pid === p.id; }).length;
      var rated = S.ratings && S.ratings[p.id] ? 'да' : 'нет';
      return '<div class="gcard"><div class="ghead"><b>' + esc(p.name) + '</b><span class="gt">' + gradeTotal(g) + '<small>/10</small></span></div>' +
        '<p class="small muted">Сигналов: ' + sigs + ' · оценил факторы: ' + rated + '</p>' +
        G.criteria.map(function (c) {
          var opts = ''; for (var k = 0; k <= c.max; k++) opts += '<button class="' + (g[c.key] === k ? 'on' : '') + '" data-act="grade" data-pid="' + p.id + '" data-k="' + c.key + '" data-v="' + k + '">' + k + '</button>';
          return '<div class="crit"><span>' + esc(c.name) + '</span><div class="seg num">' + opts + '</div></div>';
        }).join('') +
        '<input class="inp sm" data-key="note:' + p.id + '" data-note="' + p.id + '" placeholder="Комментарий (необязательно)" value="' + esc(g.note || '') + '"></div>';
    }).join('') : '<p class="muted">В команде пока никого.</p>';
    html += '<h2 class="h3">Работа команды</h2><div class="cwork">' + ['title', 'residents', 'business', 'government', 'signposts', 'rationale', 'shockAnswer'].map(function (k) {
      var lbl = { title: 'Название мира', residents: 'Жители', business: 'Бизнес', government: 'Власть', signposts: 'Ранние признаки', rationale: 'Обоснование плана', shockAnswer: 'Реакция на шок' }[k];
      return t[k] ? '<p><b>' + lbl + ':</b> ' + esc(t[k]) + '</p>' : '';
    }).join('') + (Object.keys(t.placements || {}).length ? '<p><b>На карте:</b> ' + Object.keys(t.placements).map(function (p) { var r = rule(p, t.placements[p]); return esc(G.projects[p].name) + ' (' + esc(G.zones[t.placements[p]].name) + (r ? ', ' + signed(r.v) : '') + ')'; }).join(', ') + '</p>' : '') + '</div></div>';
    return html;
  }

  // =====================================================================
  //                              СОБЫТИЯ
  // =====================================================================
  root.addEventListener('submit', function (e) {
    var f = e.target.closest('[data-form]');
    if (!f) return;
    e.preventDefault();
    if (f.dataset.form === 'join') {
      var name = (root.querySelector('[data-key="name"]').value || '').trim();
      if (!name) { toast('Введите имя', 'err'); return; }
      delete drafts.name;
      run({ a: 'join', name: name, pid: pid || '' }).then(function (d) { pid = d.pid; ui.renaming = false; store.set('pid', pid); lastHtml = ''; render(); }, function () { });
    }
    if (f.dataset.form === 'pin') {
      pin = (root.querySelector('[data-key="pin"]').value || '').trim();
      delete drafts.pin;
      store.set('pin', pin);
      api({ a: 'checkPin' }).then(function () { S = null; lastHtml = ''; poll(); }, function (er) { toast(er.message, 'err'); render(); });
    }
    if (f.dataset.form === 'signal') {
      var inp = root.querySelector('[data-key="sig"]');
      var text = (inp.value || '').trim();
      if (text.length < 3) { toast('Опишите сигнал хотя бы парой слов', 'err'); return; }
      run({ a: 'signal', type: ui.sigType, text: text }, 'Сигнал на экране').then(function () { delete drafts.sig; lastHtml = ''; render(); }, function () { });
    }
  });

  root.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    var a = el.dataset.act, d = el.dataset;
    switch (a) {
      case 'rename': ui.renaming = true; drafts.name = me() ? me().name : ''; lastHtml = ''; render(); break;
      case 'sigType': ui.sigType = d.type; render(); break;
      case 'delSignal': run({ a: 'delSignal', id: d.id }).catch(function () { }); break;
      case 'rate': { var f = d.f; ui.rate[f] = ui.rate[f] || [0, 0]; ui.rate[f][Number(d.axis)] = Number(d.v); render(); break; }
      case 'sendRates': run({ a: 'rate', ratings: ui.rate }, 'Оценки отправлены').then(function () { ui.rateEdit = false; render(); }, function () { }); break;
      case 'rateEdit': ui.rateEdit = true; render(); break;
      case 'pickTeam': run({ a: 'pickTeam', team: d.team === '' ? null : Number(d.team) }).catch(function () { }); break;
      case 'pick': ui.pending = d.project; render(); var mb = root.querySelector('.mapbox'); if (mb) mb.scrollIntoView({ behavior: 'smooth', block: 'start' }); break;
      case 'cancelPick': ui.pending = null; render(); break;
      case 'placeZone': {
        if (!ui.pending) return;
        var zone = d.zone || (e.target.dataset && e.target.dataset.zone);
        var proj = ui.pending; ui.pending = null;
        run({ a: 'place', project: proj, zone: zone }).then(function (r) {
          var ef = r.effect;
          if (ef && ef.value < 0) toast('Жители против (' + signed(ef.value) + '): ' + ef.text, 'err', 6500);
          else if (ef && ef.value > 0) toast('Удачное место (' + signed(ef.value) + '): ' + ef.text, 'ok', 5000);
          else toast('«' + G.projects[proj].name + '» → ' + G.zones[zone].name, 'ok');
        }, function () { });
        break;
      }
      case 'unplace': run({ a: 'place', project: d.project, zone: '' }).catch(function () { }); break;
      case 'submitMap': if (confirm('Отправить план команды? После этого его нельзя будет изменить.')) run({ a: 'submitMap' }, 'План отправлен').catch(function () { }); break;
      case 'bidStep': { var t = myTeam(); ui.bid = Math.max(0, Math.min(t ? t.budget : 0, (ui.bid == null ? 10 : ui.bid) + Number(d.d))); if (ui.bid > 0 && ui.bid < 5) ui.bid = 5; render(); break; }
      case 'bid': run({ a: 'bid', amount: ui.bid }, 'Ставка принята: ' + ui.bid).catch(function () { }); break;
      case 'pass': run({ a: 'bid', amount: 0 }, 'Команда пасует').catch(function () { }); break;
      // ведущий
      case 'phase': run({ a: 'setPhase', phase: d.phase }).catch(function () { }); break;
      case 'intro': run({ a: 'setIntro', step: Number(d.step) }).catch(function () { }); break;
      case 'hideSignal': run({ a: 'hideSignal', id: d.id }).catch(function () { }); break;
      case 'showAxes': run({ a: 'showAxes' }).catch(function () { }); break;
      case 'dealWorlds': if (confirm('Раздать миры командам заново? Тексты команд сохранятся, но будут относиться к новому миру.')) run({ a: 'dealWorlds' }, 'Миры розданы заново').catch(function () { }); break;
      case 'teamMode': run({ a: 'setTeamMode', mode: d.mode }).catch(function () { }); break;
      case 'autoTeams': run({ a: 'autoTeams', keep: d.keep === '1' }, 'Команды распределены').catch(function () { }); break;
      case 'kick': if (confirm('Удалить игрока из игры?')) run({ a: 'kick', pid: d.pid }).catch(function () { }); break;
      case 'unlockMap': run({ a: 'unlockMap', team: Number(d.team) }).catch(function () { }); break;
      case 'startLot': ui.closing = null; run({ a: 'startLot', project: d.project, seconds: ui.lotSeconds }).catch(function () { }); break;
      case 'closeLot': { var c = S.auction.current; if (c) { ui.closing = c.project; run({ a: 'closeLot', project: c.project }).then(function (r) { if (r.result) toast(resultText(r.result), 'ok'); }, function () { ui.closing = null; }); } break; }
      case 'cancelLot': run({ a: 'cancelLot' }).catch(function () { }); break;
      case 'undoLot': if (confirm('Отменить результат последнего лота и вернуть монеты?')) run({ a: 'undoLot' }).catch(function () { }); break;
      case 'spin': run({ a: 'spin' }).catch(function () { }); break;
      case 'shock': { var k = d.shock; if (k === 'random') { var ks = Object.keys(G.shocks); k = ks[Math.floor(Math.random() * ks.length)]; } run({ a: 'setShock', shock: k }).catch(function () { }); break; }
      case 'export': run({ a: 'export' }, 'Выгружено в листы «Итоги», «Оценки» и «Сигналы»').catch(function () { }); break;
      case 'csv': csv(); break;
      case 'reset': if (confirm(d.keep === '1' ? 'Начать игру заново? Игроки останутся, всё остальное удалится.' : 'Полностью сбросить игру? Удалятся все игроки и ответы.')) run({ a: 'reset', keepPlayers: d.keep === '1' }, 'Игра сброшена').catch(function () { }); break;
      // куратор
      case 'curTeam': ui.curTeam = Number(d.team); store.set('curTeam', String(ui.curTeam)); render(); break;
      case 'grade': {
        var body = { a: 'grade', pid: d.pid, by: store.get('curName') || '' };
        body[d.k] = Number(d.v);
        api(body).catch(function (er) { toast(er.message, 'err'); });
        break;
      }
    }
  });

  root.addEventListener('change', function (e) {
    var el = e.target.closest('[data-act-change]');
    if (!el) return;
    var a = el.dataset.actChange;
    if (a === 'teamSize') run({ a: 'setTeamMode', size: Number(el.value) }).catch(function () { });
    if (a === 'assign') run({ a: 'assign', pid: el.dataset.pid, team: el.value === '' ? null : Number(el.value) }).catch(function () { });
    if (a === 'lotSeconds') { ui.lotSeconds = Number(el.value); render(); }
    if (a === 'autoClose') { ui.autoClose = el.checked; render(); }
    if (a === 'spinWorld' && el.value) { if (confirm('Назначить мир ' + el.value + ' вместо случайного?')) run({ a: 'spin', world: el.value }).catch(function () { }); else el.value = ''; }
  });

  // текстовые поля команды: черновик сразу, сохранение через паузу и при уходе с поля
  function saveField(key, name, value) {
    clearTimeout(saveTimers[key]);
    api({ a: 'field', field: name, value: value }).then(function () {
      if (drafts[key] === value) { delete drafts[key]; render(); }
    }, function (er) { toast(er.message, 'err'); });
  }
  function saveNote(pidX, value) {
    var key = 'note:' + pidX;
    clearTimeout(saveTimers[key]);
    api({ a: 'grade', pid: pidX, note: value, by: store.get('curName') || '' }).then(function () {
      if (drafts[key] === value) { delete drafts[key]; render(); }
    }, function (er) { toast(er.message, 'err'); });
  }
  root.addEventListener('input', function (e) {
    var el = e.target;
    var key = el.dataset && el.dataset.key;
    if (!key) return;
    drafts[key] = el.value;
    if (el.dataset.field) {
      clearTimeout(saveTimers[key]);
      saveTimers[key] = setTimeout(function () { saveField(key, el.dataset.field, drafts[key]); }, 1200);
      var m = el.parentNode.querySelector('.meta'); if (m) m.textContent = 'Сохраняем…';
    } else if (el.dataset.note) {
      clearTimeout(saveTimers[key]);
      saveTimers[key] = setTimeout(function () { saveNote(el.dataset.note, drafts[key]); }, 1200);
    } else if (key === 'curName') {
      store.set('curName', el.value);
    }
  });
  root.addEventListener('focusout', function (e) {
    var el = e.target;
    var key = el.dataset && el.dataset.key;
    if (!key || drafts[key] === undefined) return;
    if (el.dataset.field) saveField(key, el.dataset.field, drafts[key]);
    else if (el.dataset.note) saveNote(el.dataset.note, drafts[key]);
    else if (key === 'curName') delete drafts[key];
  });
  root.addEventListener('keydown', function (e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('polygon[data-act]')) { e.preventDefault(); e.target.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
  });

  window.addEventListener('hashchange', function () { readRole(); S = null; lastHtml = ''; render(); poll(); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });

  render();
  poll();
  requestAnimationFrame(loop);
})();
