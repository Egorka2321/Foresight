/* Заставка: случайные точки-сигналы, которые собираются в тренды, затем в миры, затем в устойчивые решения. */
(function () {
  'use strict';
  var BLUES = ['#5AA9FF', '#8CC8FF', '#2F7BFF', '#BFE3FF', '#49D3F5', '#7FA8FF'];
  var TRENDS = ['Старение', 'Автоматизация', 'Удалёнка', 'Отток молодёжи', 'Климат', 'Господдержка', 'Цены на сталь'];
  var WORLDS = [['A', 'Новая сталь'], ['C', 'Перезапуск'], ['B', 'Тихий цех'], ['D', 'Последний гудок'], ['E', 'Инерция']];

  function Swarm(n) {
    this.n = n || 220;
    this.dots = [];
    this.step = -1;
    this.t0 = performance.now();
    this.canvas = null;
    this.clusters = [];
    for (var i = 0; i < this.n; i++) {
      this.dots.push({
        x: Math.random(), y: Math.random(), tx: 0, ty: 0, vx: 0, vy: 0,
        r: 1.2 + Math.random() * 2.6, c: BLUES[Math.floor(Math.random() * BLUES.length)],
        born: Math.random() * 2600, ph: Math.random() * Math.PI * 2, g: 0, robust: Math.random() < 0.16,
      });
    }
    this.setStep(0);
  }

  Swarm.prototype.setStep = function (step) {
    if (step === this.step) return;
    this.step = step;
    this.stepAt = performance.now();
    var self = this;
    if (step === 0) {
      this.dots.forEach(function (d) { d.tx = 0.04 + Math.random() * 0.92; d.ty = 0.06 + Math.random() * 0.88; d.g = -1; });
      this.clusters = [];
    } else if (step === 1) {
      // кластеры трендов в случайных местах, но не друг на друге
      var cs = [];
      for (var tries = 0; cs.length < TRENDS.length && tries < 3000; tries++) {
        var c = { x: 0.12 + Math.random() * 0.76, y: 0.18 + Math.random() * 0.66 };
        var gap = tries > 1500 ? 0.12 : 0.2;
        if (cs.every(function (o) { return Math.hypot(o.x - c.x, (o.y - c.y) * 0.6) > gap; })) cs.push(c);
      }
      while (cs.length < TRENDS.length) cs.push({ x: 0.12 + Math.random() * 0.76, y: 0.18 + Math.random() * 0.66 });
      this.clusters = cs.map(function (c, i) { return { x: c.x, y: c.y, label: TRENDS[i] }; });
      this.dots.forEach(function (d, i) {
        d.g = i % TRENDS.length;
        var cl = self.clusters[d.g], a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * 0.075;
        d.tx = cl.x + Math.cos(a) * rr; d.ty = cl.y + Math.sin(a) * rr * 1.5;
      });
    } else {
      var pos = [{ x: 0.27, y: 0.28 }, { x: 0.73, y: 0.28 }, { x: 0.27, y: 0.74 }, { x: 0.73, y: 0.74 }, { x: 0.5, y: 0.51 }];
      this.clusters = pos.map(function (p, i) { return { x: p.x, y: p.y, label: WORLDS[i][0] + ' · ' + WORLDS[i][1] }; });
      this.dots.forEach(function (d, i) {
        d.g = i % 5;
        var cl = self.clusters[d.g], a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * (d.g === 4 ? 0.06 : 0.11);
        d.tx = cl.x + Math.cos(a) * rr; d.ty = cl.y + Math.sin(a) * rr * 1.4;
      });
    }
  };

  Swarm.prototype.attach = function (canvas) { this.canvas = canvas; };

  Swarm.prototype.frame = function (now) {
    var cv = this.canvas;
    if (!cv || !cv.isConnected) return;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H) return;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    var t = now - this.t0, ts = now - this.stepAt;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var k = reduce ? 1 : 0.035, step = this.step, self = this;

    // оси матрицы
    if (step >= 2) {
      var a = Math.min(1, ts / 900);
      ctx.strokeStyle = 'rgba(140,200,255,' + (0.45 * a) + ')';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(W * 0.5, H * 0.06); ctx.lineTo(W * 0.5, H * 0.96); ctx.moveTo(W * 0.04, H * 0.51); ctx.lineTo(W * 0.96, H * 0.51); ctx.stroke();
      ctx.fillStyle = 'rgba(190,227,255,' + (0.7 * a) + ')';
      ctx.font = '500 ' + Math.max(10, Math.round(W / 70)) + 'px Unbounded, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Внимание государства', W * 0.5, H * 0.04);
      ctx.save(); ctx.translate(W * 0.985, H * 0.51); ctx.rotate(Math.PI / 2); ctx.fillText('Судьба комбината', 0, 0); ctx.restore();
    }
    // связи устойчивых решений
    if (step === 3) {
      var core = { x: W * 0.5, y: H * 0.51 };
      var la = Math.min(1, ts / 1200);
      this.dots.forEach(function (d) {
        if (!d.robust || d.g === 4) return;
        ctx.strokeStyle = 'rgba(120,220,255,' + (0.22 * la) + ')';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(d.x * W, d.y * H); ctx.lineTo(core.x, core.y); ctx.stroke();
      });
      var pr = 18 + Math.sin(t / 380) * 4;
      var grd = ctx.createRadialGradient(core.x, core.y, 0, core.x, core.y, pr * 3);
      grd.addColorStop(0, 'rgba(160,230,255,' + (0.55 * la) + ')'); grd.addColorStop(1, 'rgba(160,230,255,0)');
      ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(core.x, core.y, pr * 3, 0, Math.PI * 2); ctx.fill();
    }
    // точки
    this.dots.forEach(function (d) {
      var appear = Math.min(1, Math.max(0, (t - d.born) / 500));
      if (appear <= 0) return;
      var jx = Math.sin(t / 900 + d.ph) * 0.004, jy = Math.cos(t / 1100 + d.ph) * 0.004;
      if (step === 0) { jx *= 3; jy *= 3; }
      d.vx = (d.vx + (d.tx + jx - d.x) * k) * 0.82;
      d.vy = (d.vy + (d.ty + jy - d.y) * k) * 0.82;
      d.x += d.vx; d.y += d.vy;
      var alpha = appear * (step === 3 && !d.robust ? 0.35 : 0.9);
      var r = d.r * (step === 3 && d.robust ? 1.6 : 1);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = step === 3 && d.robust ? '#E8FBFF' : d.c;
      ctx.beginPath(); ctx.arc(d.x * W, d.y * H, r, 0, Math.PI * 2); ctx.fill();
      if (step === 0 && Math.sin(t / 300 + d.ph * 7) > 0.985) {
        ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.arc(d.x * W, d.y * H, r * 4, 0, Math.PI * 2); ctx.fill();
      }
    });
    ctx.globalAlpha = 1;
    // подписи кластеров
    if (step >= 1) {
      var la2 = Math.min(1, Math.max(0, (ts - 600) / 700));
      ctx.font = '600 ' + Math.max(11, Math.round(W / 62)) + 'px Golos, sans-serif';
      ctx.textAlign = 'center';
      this.clusters.forEach(function (c, i) {
        var y = c.y * H - (step >= 2 ? H * (i === 4 ? 0.1 : 0.17) : H * 0.12);
        var w = ctx.measureText(c.label).width + 20;
        ctx.globalAlpha = la2;
        ctx.fillStyle = 'rgba(8,28,60,.78)';
        roundRect(ctx, c.x * W - w / 2, y - 15, w, 24, 12); ctx.fill();
        ctx.fillStyle = '#DDF0FF';
        ctx.fillText(c.label, c.x * W, y + 2);
      });
      ctx.globalAlpha = 1;
    }
  };

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  window.Swarm = Swarm;
})();
