/* Карта Северогорска: процедурно сгенерированный генплан (детерминированный — у всех одинаковый). */
(function () {
  'use strict';

  var ZONES = {
    z6: [[0, 0], [130, 0], [110, 180], [140, 400], [0, 400]],
    z4: [[130, 0], [200, 0], [185, 120], [204, 260], [190, 400], [140, 400], [110, 180]],
    z3: [[200, 0], [370, 0], [370, 120], [185, 120]],
    z8: [[370, 0], [600, 0], [600, 120], [370, 120]],
    z2: [[185, 120], [370, 120], [370, 260], [204, 260]],
    z1: [[370, 120], [600, 120], [600, 280], [370, 280]],
    z5: [[204, 260], [370, 260], [370, 280], [380, 400], [190, 400]],
    z7: [[370, 280], [600, 280], [600, 400], [380, 400]],
  };
  // где ставить подпись зоны и метки проектов
  var AT = { z1: [490, 205], z2: [292, 196], z3: [292, 70], z4: [158, 300], z5: [262, 352], z6: [52, 120], z7: [492, 345], z8: [492, 66] };

  // ---------- генератор случайных чисел с зерном ----------
  function rng(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function inPoly(x, y, poly) {
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }

  function bez(p0, p1, p2, p3, n) {
    var out = [];
    for (var i = 0; i <= n; i++) {
      var t = i / n, u = 1 - t;
      out.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
        u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]);
    }
    return out;
  }
  var RIVER = bez([165, 0], [150, 90], [205, 170], [188, 255], 30).concat(bez([188, 255], [171, 340], [160, 350], [168, 400], 20));
  var RIVER_D = 'M165,0 C150,90 205,170 188,255 S160,350 168,400';

  // дороги: [ширина, точки]
  var ROADS = {
    main: [[0, 206], [120, 200], [190, 194], [240, 195], [370, 195], [405, 198]],
    ns: [[285, 0], [285, 262], [292, 318], [300, 400]],
    highway: [[0, 392], [190, 388], [380, 380], [600, 372]],
    north: [[200, 62], [370, 62], [600, 58]],
    c1: [[195, 158], [370, 158]],
    c2: [[202, 232], [370, 232]],
    v1: [[240, 0], [240, 260]],
    v2: [[330, 0], [330, 260]],
    plant: [[370, 250], [600, 250]],
    whs: [[480, 280], [480, 376]],
    whs2: [[380, 330], [600, 330]],
    lake: [[120, 200], [100, 235], [70, 268]],
    sta: [[292, 318], [345, 300], [372, 290]],
  };
  var MAIN = ['main', 'ns', 'highway'];

  function distSeg(px, py, a, b) {
    var dx = b[0] - a[0], dy = b[1] - a[1];
    var t = ((px - a[0]) * dx + (py - a[1]) * dy) / (dx * dx + dy * dy || 1);
    t = Math.max(0, Math.min(1, t));
    var x = a[0] + t * dx, y = a[1] + t * dy;
    return Math.hypot(px - x, py - y);
  }
  function distLine(px, py, pts) {
    var d = 1e9;
    for (var i = 1; i < pts.length; i++) d = Math.min(d, distSeg(px, py, pts[i - 1], pts[i]));
    return d;
  }
  function nearRoad(x, y, m) {
    for (var k in ROADS) if (distLine(x, y, ROADS[k]) < m + (MAIN.indexOf(k) >= 0 ? 5 : 3)) return true;
    return false;
  }
  function nearRiver(x, y, m) { return distLine(x, y, RIVER) < m; }
  function inLake(x, y) { return Math.pow((x - 64) / 44, 2) + Math.pow((y - 236) / 31, 2) < 1; }
  var RAIL_Y = 322;

  function pts(a) { return a.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' '); }
  function poly(a) { return pts(a); }
  function rect(x, y, w, h, cls, rot) {
    return '<rect class="' + cls + '" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + h.toFixed(1) + '"' +
      (rot ? ' transform="rotate(' + rot.toFixed(1) + ' ' + (x + w / 2).toFixed(1) + ' ' + (y + h / 2).toFixed(1) + ')"' : '') + '/>';
  }

  var BASE = null;
  function base() {
    if (BASE) return BASE;
    var R = rng(20400);
    var s = '';
    // ---------- подложка по зонам ----------
    s += '<rect x="0" y="0" width="600" height="400" class="m-land"/>';
    s += '<polygon class="m-forest" points="' + poly(ZONES.z6) + '"/>';
    s += '<polygon class="m-meadow" points="' + poly(ZONES.z4) + '"/>';
    s += '<polygon class="m-resi" points="' + poly(ZONES.z3) + '"/>';
    s += '<polygon class="m-waste" points="' + poly(ZONES.z8) + '"/>';
    s += '<polygon class="m-center" points="' + poly(ZONES.z2) + '"/>';
    s += '<polygon class="m-ind" points="' + poly(ZONES.z1) + '"/>';
    s += '<polygon class="m-ind2" points="' + poly(ZONES.z7) + '"/>';
    s += '<polygon class="m-sta" points="' + poly(ZONES.z5) + '"/>';

    // пустырь: пятна грунта, межевание
    for (var i = 0; i < 14; i++) {
      var cx = 385 + R() * 200, cy = 10 + R() * 100;
      if (nearRoad(cx, cy, 8)) continue;
      s += '<ellipse class="m-dirt" cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" rx="' + (6 + R() * 16).toFixed(1) + '" ry="' + (4 + R() * 8).toFixed(1) + '"/>';
    }
    s += '<path class="m-parcel" d="M440,70 L440,118 M510,70 L510,118 M560,4 L560,118 M440,90 L600,90"/>';

    // пойма: кустарник и старица
    s += '<path class="m-oxbow" d="M140,300 C128,320 150,345 172,338"/>';
    for (i = 0; i < 90; i++) {
      var x = 112 + R() * 92, y = R() * 400;
      if (!inPoly(x, y, ZONES.z4) || nearRiver(x, y, 11) || nearRoad(x, y, 5) || Math.abs(y - RAIL_Y) < 6) continue;
      s += '<circle class="m-bush" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + (1.6 + R() * 2.2).toFixed(1) + '"/>';
    }

    // река с берегами
    s += '<path class="m-bank" d="' + RIVER_D + '"/><path class="m-river" d="' + RIVER_D + '"/>';
    // озеро и пляж
    s += '<path class="m-beach" d="M24,222 C28,190 92,182 106,208 C122,236 100,272 64,272 C34,272 20,250 24,222Z"/>';
    s += '<path class="m-water" d="M30,222 C35,195 88,188 100,210 C113,234 96,264 65,264 C40,264 26,246 30,222Z"/>';
    s += '<path class="m-pier" d="M96,226 L110,222"/>';

    // лес: деревья
    for (i = 0; i < 520; i++) {
      x = R() * 140; y = R() * 400;
      if (!inPoly(x, y, ZONES.z6) || inLake(x, y) || Math.pow((x - 64) / 50, 2) + Math.pow((y - 236) / 37, 2) < 1 || nearRoad(x, y, 4) || Math.abs(y - RAIL_Y) < 6) continue;
      var r = 2.2 + R() * 2.8;
      s += '<circle class="m-tree' + (R() < .35 ? ' d' : '') + '" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + r.toFixed(1) + '"/>';
    }
    // турбаза у озера
    s += rect(84, 268, 8, 6, 'm-house') + rect(96, 272, 8, 6, 'm-house') + rect(74, 278, 8, 6, 'm-house');

    // ---------- Северный: панельки ----------
    var cells = [[200, 0, 240, 62], [240, 0, 285, 62], [285, 0, 330, 62], [330, 0, 370, 62], [194, 62, 240, 120], [240, 62, 285, 120], [285, 62, 330, 120], [330, 62, 370, 120]];
    cells.forEach(function (c, k) {
      var x0 = c[0] + 6, y0 = c[1] + 7, w = c[2] - c[0] - 12, h = c[3] - c[1] - 13;
      if (k % 2 === 0) {
        s += rect(x0, y0, w, 6, 'm-panel') + rect(x0, y0 + h - 6, w, 6, 'm-panel') + rect(x0, y0 + 9, 6, h - 18, 'm-panel');
      } else {
        s += rect(x0, y0, 6, h, 'm-panel') + rect(x0 + w - 6, y0, 6, h, 'm-panel') + rect(x0 + 10, y0 + h / 2 - 3, w - 20, 6, 'm-panel');
      }
      for (var q = 0; q < 4; q++) s += '<circle class="m-tree" cx="' + (x0 + 12 + R() * (w - 22)).toFixed(1) + '" cy="' + (y0 + 12 + R() * (h - 24)).toFixed(1) + '" r="2.4"/>';
    });
    s += rect(296, 72, 26, 16, 'm-school') + '<rect class="m-pitch" x="298" y="92" width="22" height="12"/>';

    // ---------- Старый центр: кварталы с дворами ----------
    var blocks = [[192, 124, 236, 154], [244, 124, 281, 154], [289, 124, 326, 154], [334, 124, 366, 154], [200, 162, 236, 228], [334, 162, 366, 228], [206, 236, 236, 258], [244, 236, 281, 258], [289, 236, 326, 258], [334, 236, 366, 258]];
    blocks.forEach(function (b) {
      s += '<rect class="m-block" x="' + b[0] + '" y="' + b[1] + '" width="' + (b[2] - b[0]) + '" height="' + (b[3] - b[1]) + '"/>';
      s += '<rect class="m-yard" x="' + (b[0] + 6) + '" y="' + (b[1] + 6) + '" width="' + Math.max(2, b[2] - b[0] - 12) + '" height="' + Math.max(2, b[3] - b[1] - 12) + '"/>';
    });
    // площадь, администрация, парк
    s += '<rect class="m-plaza" x="244" y="162" width="82" height="66"/>';
    s += '<circle class="m-fountain" cx="285" cy="196" r="9"/>';
    s += rect(252, 166, 26, 14, 'm-civic') + rect(296, 211, 24, 12, 'm-civic');
    for (i = 0; i < 9; i++) s += '<circle class="m-tree" cx="' + (250 + R() * 70).toFixed(1) + '" cy="' + (186 + R() * 38).toFixed(1) + '" r="2.4"/>';

    // ---------- Комбинат ----------
    s += '<polygon class="m-fence" points="378,128 596,128 596,244 378,244"/>';
    s += rect(392, 140, 74, 36, 'm-factory') + rect(478, 136, 52, 60, 'm-factory') + rect(540, 140, 46, 34, 'm-factory');
    s += rect(398, 186, 58, 46, 'm-factory') + rect(540, 186, 46, 50, 'm-factory');
    s += '<circle class="m-tank" cx="492" cy="222" r="11"/><circle class="m-tank" cx="518" cy="222" r="11"/>';
    [[420, 150], [432, 150], [502, 148], [560, 152]].forEach(function (c) {
      s += '<circle class="m-smoke" cx="' + (c[0] + 7) + '" cy="' + (c[1] - 9) + '" r="7"/><circle class="m-smoke" cx="' + (c[0] + 14) + '" cy="' + (c[1] - 15) + '" r="5"/>';
      s += '<circle class="m-chimney" cx="' + c[0] + '" cy="' + c[1] + '" r="3.4"/>';
    });
    s += '<path class="m-conveyor" d="M466,160 L478,160 M530,170 L540,170 M456,210 L481,215"/>';

    // ---------- Склады ----------
    [[386, 286, 84, 18], [386, 308, 84, 16], [492, 286, 96, 16], [492, 306, 44, 18], [544, 306, 46, 18], [392, 340, 70, 16], [392, 360, 54, 12], [492, 340, 98, 14], [500, 358, 40, 12]].forEach(function (b) {
      s += rect(b[0], b[1], b[2], b[3], 'm-wh');
    });
    for (i = 0; i < 10; i++) s += rect(548 + R() * 40, 356 + R() * 10, 5, 2.4, 'm-truck');

    // ---------- Вокзал ----------
    s += rect(296, 296, 40, 14, 'm-station') + rect(300, 326, 54, 3, 'm-platform') + rect(230, 326, 50, 3, 'm-platform');
    s += '<rect class="m-parking" x="236" y="290" width="44" height="22"/>';
    for (i = 0; i < 14; i++) s += rect(238 + (i % 7) * 6, 292 + Math.floor(i / 7) * 11, 4, 7, 'm-car');
    for (i = 0; i < 6; i++) s += rect(216 + i * 9, 346, 7, 10, 'm-garage');
    for (i = 0; i < 5; i++) s += rect(312 + i * 9, 346, 7, 10, 'm-garage');
    // частные дома у вокзала
    for (i = 0; i < 18; i++) {
      x = 214 + R() * 150; y = 264 + R() * 26;
      if (nearRoad(x, y, 4)) continue;
      s += rect(x, y, 5, 5, 'm-house', R() * 20 - 10);
    }

    // ---------- дороги ----------
    var roadsCasing = '', roadsFill = '';
    Object.keys(ROADS).forEach(function (k) {
      var main = MAIN.indexOf(k) >= 0, hw = k === 'highway';
      var d = 'M' + ROADS[k].map(function (p) { return p[0] + ',' + p[1]; }).join(' L');
      roadsCasing += '<path class="m-road-c' + (main ? ' main' : '') + (hw ? ' hw' : '') + (k === 'lake' ? ' path' : '') + '" d="' + d + '"/>';
      roadsFill += '<path class="m-road' + (main ? ' main' : '') + (hw ? ' hw' : '') + (k === 'lake' ? ' path' : '') + '" d="' + d + '"/>';
    });
    s += roadsCasing + roadsFill;
    // мосты
    s += '<path class="m-bridge" d="M178,188 L198,186 M178,200 L198,198"/>';
    s += '<path class="m-bridge" d="M152,383 L176,382 M152,395 L176,394"/>';
    s += '<path class="m-bridge" d="M150,317 L174,317 M150,327 L174,327"/>';

    // ---------- железная дорога ----------
    var rail = 'M0,' + RAIL_Y + ' L600,' + RAIL_Y + ' M420,' + RAIL_Y + ' C440,' + RAIL_Y + ' 448,300 456,286 L470,248';
    s += '<path class="m-rail-b" d="' + rail + '"/><path class="m-rail" d="' + rail + '"/>';

    BASE = s;
    return s;
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  // opts: { pins:[{zone,color,label,bad}], pick:bool, names:{z1:'…'}, labels:bool }
  function svg(opts) {
    opts = opts || {};
    var s = '<svg class="citymap' + (opts.pick ? ' picking' : '') + '" viewBox="0 0 600 400" role="img" aria-label="Карта города">' + base();
    Object.keys(ZONES).forEach(function (z) {
      s += '<polygon class="zone" data-zone="' + z + '" points="' + poly(ZONES[z]) + '"' +
        (opts.pick ? ' data-act="placeZone" tabindex="0" role="button" aria-label="Зона ' + esc(opts.names ? opts.names[z] : z) + '"' : '') + '/>';
    });
    if (opts.labels !== false && opts.names) {
      Object.keys(AT).forEach(function (z) {
        var p = AT[z], nm = opts.names[z], w = nm.length * 6.6 + 14;
        s += '<g class="zl" pointer-events="none"><rect x="' + (p[0] - w / 2).toFixed(1) + '" y="' + (p[1] - 31) + '" width="' + w.toFixed(1) + '" height="17" rx="8.5"/><text x="' + p[0] + '" y="' + (p[1] - 19) + '" text-anchor="middle">' + esc(nm) + '</text></g>';
      });
    }
    var byZone = {};
    (opts.pins || []).forEach(function (pn) { (byZone[pn.zone] = byZone[pn.zone] || []).push(pn); });
    Object.keys(byZone).forEach(function (z) {
      var list = byZone[z], at = AT[z];
      var per = Math.min(list.length, 5);
      list.forEach(function (pn, i) {
        var col = i % per, row = Math.floor(i / per);
        var x = at[0] + (col - (per - 1) / 2) * 22, y = at[1] + 4 + row * 24;
        s += '<g class="pin' + (pn.bad ? ' bad' : '') + '" pointer-events="none" transform="translate(' + x.toFixed(1) + ' ' + y.toFixed(1) + ')">' +
          '<path d="M0,10 C-4,4 -10,0 -10,-6 A10,10 0 1 1 10,-6 C10,0 4,4 0,10Z" fill="' + pn.color + '"/>' +
          (pn.label ? '<text y="-2" text-anchor="middle">' + esc(pn.label) + '</text>' : '') +
          (pn.bad ? '<circle cx="9" cy="-14" r="5.5" class="pin-bad"/><text x="9" y="-11" text-anchor="middle" class="pin-bad-t">!</text>' : '') + '</g>';
      });
    });
    return s + '</svg>';
  }

  window.CityMap = { svg: svg, zones: Object.keys(ZONES) };
})();
