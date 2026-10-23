/* render.js — 六边形阵型盘：棋子有血条，抛物线越过前排 */
(function (root) {
  'use strict';
  var GB = root.GB = root.GB || {};
  var MAP = GB.MAP, D = GB.D, U = GB.U;

  var cv = null, ctx = null;
  var cw = 48, W = 0, H = 0, ox = 0, oy = 0, dpr = 1;   // cw = 单格边长
  var bg = null, noise = null;
  var run = null, battle = null, view = { drag: null, hover: null };
  var showEnemy = false;
  var parts = [], rings = [], pending = null;

  var P_TINT = 'rgba(255,252,242,0.62)';
  var E_TINT = 'rgba(165,52,42,0.13)';

  function makeNoise() {
    var n = document.createElement('canvas');
    n.width = 96; n.height = 96;
    var g = n.getContext('2d');
    var img = g.createImageData(96, 96), d = img.data;
    for (var i = 0; i < d.length; i += 4) {
      var v = 190 + Math.random() * 60;
      d[i] = v; d[i + 1] = v - 8; d[i + 2] = v - 22; d[i + 3] = 12 + Math.random() * 26;
    }
    g.putImageData(img, 0, 0);
    return n;
  }

  function init(canvas) {
    if (!canvas) { cv = null; ctx = null; return; }
    if (cv === canvas && ctx) { layout(); draw(); return; }
    cv = canvas;
    ctx = cv.getContext('2d');
    noise = ctx.createPattern(makeNoise(), 'repeat');
    layout();
    watchSize();
    draw();
  }

  // 面板高度/屏幕尺寸变化时自动重算棋盘（Vue 布局驱动）
  function watchSize() {
    if (!cv || !cv.parentNode) return;
    var wrap = cv.parentNode;
    if (!root.ResizeObserver) return;
    var lastW = 0, lastH = 0, pending = false;
    var ro = new root.ResizeObserver(function () {
      var w = wrap.clientWidth, h = wrap.clientHeight;
      if (Math.abs(w - lastW) < 3 && Math.abs(h - lastH) < 3) return;
      if (pending) return;
      pending = true;
      root.requestAnimationFrame(function () {
        pending = false;
        var w2 = wrap.clientWidth, h2 = wrap.clientHeight;
        lastW = w2; lastH = h2;
        layout();
        draw();
      });
    });
    lastW = wrap.clientWidth; lastH = wrap.clientHeight;
    ro.observe(wrap);
  }

  function layout() {
    if (!cv) return;
    var wrap = cv.parentNode;
    var aw = Math.max(240, wrap.clientWidth || root.innerWidth);
    var ah = wrap.clientHeight || 0;
    if (!ah || ah < 160) ah = root.innerHeight * (showEnemy ? 0.55 : 0.32);
    var rows = showEnemy ? MAP.ROWS + 0.5 : 4.2;
    cw = Math.floor(Math.min(aw / (MAP.COLS + 0.5), ah / rows));
    cw = Math.max(16, Math.min(cw, 120));
    W = Math.round(MAP.COLS * cw);
    H = Math.round((showEnemy ? MAP.ROWS : 4) * cw);
    ox = W / 2;
    // 晨市只显示我方半场（行 4~7），此时不需要下移
    oy = showEnemy ? H / 2 : 0;
    dpr = Math.min(2.5, root.devicePixelRatio || 1);
    cv.style.width = W + 'px';
    cv.style.height = H + 'px';
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildBg();
  }

  function px(x) { return ox + x * cw; }
  function py(y) { return oy + y * cw; }
  function toUnit(sx, sy) { return { x: (sx - ox) / cw, y: (sy - oy) / cw }; }

  // 圆角矩形：左上角 (x,y) + 宽高
  function rectPath(g, x, y, w, h, rad) {
    var r = Math.max(2, Math.min(rad || 4, Math.min(w, h) / 2));
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  // 圆角方块：以 (cx,cy) 为中心、半径 r（r = 半格边长）
  function sqPath(g, cx, cy, r) {
    var rad = Math.max(2, r * 0.22);
    var x = cx - r, y = cy - r, w = r * 2, h = r * 2;
    g.beginPath();
    g.moveTo(x + rad, y);
    g.arcTo(x + w, y, x + w, y + h, rad);
    g.arcTo(x + w, y + h, x, y + h, rad);
    g.arcTo(x, y + h, x, y, rad);
    g.arcTo(x, y, x + w, y, rad);
    g.closePath();
  }

  function buildBg() {
    bg = document.createElement('canvas');
    bg.width = Math.round(W * dpr); bg.height = Math.round(H * dpr);
    var g = bg.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#e9dfc7';
    g.fillRect(0, 0, W, H);

    var s = cw / 2, i, c;
    var owned = GB.Run && GB.Run.ownedSet && run ? GB.Run.ownedSet(run) : null;
    // 对手的背包格也一样是买出来的：把它没解锁的格子同样画成虚线暗格
    var ownedE = null;
    if (run && run.opp && run.opp.cellsN) {
      var order = MAP.ownedOrder();
      ownedE = {};
      for (var oi = 0; oi < Math.min(run.opp.cellsN, order.length); oi++) {
        ownedE[MAP.key(order[oi].c, MAP.ROWS - 1 - order[oi].r)] = true;
      }
    }
    for (i = 0; i < MAP.CELLS.length; i++) {
      c = MAP.CELLS[i];
      if (!showEnemy && c.zone === 'e') continue;
      var mine = c.zone === 'p'
        ? (!owned || !!owned[MAP.key(c.c, c.r)])
        : (!ownedE || !!ownedE[MAP.key(c.c, c.r)]);
      sqPath(g, px(c.x), py(c.y), s * 0.99);
      g.fillStyle = c.zone === 'p' ? (mine ? P_TINT : 'rgba(120,95,60,.05)') : E_TINT;
      g.fill();
      g.strokeStyle = c.zone === 'p'
        ? (mine ? 'rgba(150,110,40,.34)' : 'rgba(140,115,80,.22)')
        : 'rgba(150,50,40,.26)';
      g.lineWidth = 1;
      if (!mine) g.setLineDash([3, 5]);
      g.stroke();
      g.setLineDash([]);
    }

    if (showEnemy) {
    var y = py(0);
    g.save();
    g.strokeStyle = 'rgba(60,40,24,.45)';
    g.lineWidth = 2;
    g.setLineDash([7, 6]);
    g.beginPath();
    g.moveTo(px(-3.1), y);
    g.lineTo(px(3.1), y);
    g.stroke();
    g.restore();
    }

    g.save();
    g.globalAlpha = 0.5;
    g.fillStyle = noise;
    g.fillRect(0, 0, W, H);
    g.restore();

    var vg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.32, W / 2, H / 2, Math.max(W, H) * 0.8);
    vg.addColorStop(0, 'rgba(90,68,38,0)');
    vg.addColorStop(1, 'rgba(90,68,38,.18)');
    g.fillStyle = vg;
    g.fillRect(0, 0, W, H);
  }

  function update(dt, runState, battleState, viewState) {
    run = runState; battle = battleState;
    if (viewState) view = viewState;
    for (var i = parts.length - 1; i >= 0; i--) {
      var p = parts[i];
      p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 220 * dt;
      if (p.life <= 0) parts.splice(i, 1);
    }
    for (var j = rings.length - 1; j >= 0; j--) {
      rings[j].life -= dt;
      if (rings[j].life <= 0) rings.splice(j, 1);
    }
  }

  var lastCells = -1;

  function draw() {
    if (!ctx) return;
    var cellsNow = run && GB.Run && GB.Run.cellsN ? GB.Run.cellsN(run) : 0;
    if (run && cellsNow !== lastCells) { lastCells = cellsNow; buildBg(); }
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(bg, 0, 0, W, H);
    if (view.hover && !view.drag) {
      var s = cw / 2;
      sqPath(ctx, px(view.hover.x), py(view.hover.y), s * 0.92);
      ctx.fillStyle = 'rgba(63,107,87,.10)';
      ctx.fill();
    }
    if (showEnemy) drawSide('e');
    drawSide('p');
    if (showEnemy) drawBadges('e');
    drawBadges('p');
    drawUnlockHints();
    if (battle) drawShots();
    if (battle) drawFloats();
    drawParticles();
    drawDrag();
  }

  function pieceList(side) {
    if (battle) return side === 'p' ? battle.p : battle.e;
    var out = [], seen = {};
    if (side !== 'p' || !run) return out;
    for (var k in run.board) {
      if (!run.board.hasOwnProperty(k)) continue;
      var p = run.board[k];
      if (!p || seen[p.id]) continue;
      seen[p.id] = 1;
      out.push(p);
    }
    return out;
  }

  function drawSide(side) {
    var list = pieceList(side);
    for (var i = 0; i < list.length; i++) drawPiece(list[i], side);
  }

  // 覆盖层：血条 + 等级角标，永远盖在所有棋子上面
  function drawBadges(side) {
    var list = pieceList(side), s = cw / 2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (!p.cells || !p.cells.length) continue;
      if (battle && !p.alive) continue;

      // 血条（无血挂件不画）
      if (battle && !p.structure) {
        var bw = s * 1.55, bh = Math.max(3, s * 0.11);
        var pct = U.clamp(p.hp / p.maxHp, 0, 1);
        var ax0 = p.cells[0];
        var bx0 = px(ax0.x), by0 = py(ax0.y) + s * 0.66;
        ctx.fillStyle = 'rgba(24,18,12,.62)';
        ctx.fillRect(bx0 - bw / 2, by0, bw, bh);
        ctx.fillStyle = side === 'e' ? '#c0503c' : '#7ea86a';
        ctx.fillRect(bx0 - bw / 2, by0, bw * pct, bh);
      }

      if ((p.level || 1) < 2) continue;
      var a = p.cells[0];
      var cx = px(a.x), cy = py(a.y);
      var bx = cx + s * 0.62, by = cy - s * 0.62;
      ctx.beginPath();
      ctx.arc(bx, by, s * 0.28, 0, 6.284);
      ctx.fillStyle = '#e8c877';
      ctx.fill();
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = 'rgba(40,28,10,.55)';
      ctx.stroke();
      ctx.fillStyle = '#241a06';
      ctx.font = 'bold ' + (s * 0.4) + 'px "Songti SC",serif';
      ctx.fillText(String(p.level), bx, by + 0.5);
    }
  }

  // 晨市阶段：未解锁格子画「+」，选中的那格显示价格
  function drawUnlockHints() {
    if (!run || battle || showEnemy) return;
    if (!GB.Run || !GB.Run.ownedSet) return;
    var own = GB.Run.ownedSet(run);
    var price = GB.Run.nextCellPrice ? GB.Run.nextCellPrice(run) : 0;
    var s = cw / 2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (var i = 0; i < MAP.CELLS.length; i++) {
      var c = MAP.CELLS[i];
      if (c.zone !== 'p') continue;
      if (own[MAP.key(c.q, c.r)]) continue;
      var isPend = pending && pending.c === c.c && pending.r === c.r;
      var ok = GB.Run.canUnlock ? GB.Run.canUnlock(run, c.c, c.r) : false;
      if (!ok && !isPend) continue;
      var x = px(c.x), y = py(c.y);
      if (isPend) {
        sqPath(ctx, x, y, s * 0.92);
        ctx.fillStyle = 'rgba(169,129,47,.28)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(169,129,47,.95)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#7a5c14';
        ctx.font = 'bold ' + (s * 0.62) + 'px "Songti SC",serif';
        ctx.fillText(price + ' 金', x, y);
      } else {
        ctx.beginPath();
        ctx.arc(x, y, s * 0.34, 0, 6.284);
        ctx.strokeStyle = 'rgba(150,118,60,.42)';
        ctx.lineWidth = 1.6;
        ctx.setLineDash([4, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(120,92,50,.5)';
        ctx.font = (s * 0.5) + 'px "Songti SC",serif';
        ctx.fillText('+', x, y + 1);
      }
    }
  }

  function setPending(c) { pending = c || null; }
  function getPending() { return pending; }

  function drawPiece(p, side) {
    var def = p.def || D.pieceById(p.k);
    if (!def || !p.cells) return;
    var s = cw / 2;
    var isOpp = side === 'e';
    var dead = battle ? !p.alive : false;
    var isHero = p.k === 'jiang';
    var isFlag = def.role === 'flag' || def.role === 'shard';

    ctx.save();
    if (dead) ctx.globalAlpha = 0.22;

    // 多格棋子画成一整块（1×2 / 2×2 / 2×3 / 3×3）
    var minC = 99, maxC = -1, minR = 99, maxR = -1;
    for (var k = 0; k < p.cells.length; k++) {
      var cc = p.cells[k];
      if (cc.c < minC) minC = cc.c;
      if (cc.c > maxC) maxC = cc.c;
      if (cc.r < minR) minR = cc.r;
      if (cc.r > maxR) maxR = cc.r;
    }
    var pad = Math.max(1.5, cw * 0.05);
    var bx = px(minC + 0.5 - MAP.CX) - cw / 2 + pad;
    var by = py(minR + 0.5 - MAP.CY) - cw / 2 + pad;
    var bw = (maxC - minC + 1) * cw - pad * 2;
    var bh = (maxR - minR + 1) * cw - pad * 2;
    var cx = bx + bw / 2, cy = by + bh / 2;
    s = Math.min(bw, bh) / 2;             // 之后所有特效环都按整块缩放
    var rad = Math.max(3, Math.min(bw, bh) * 0.16);

    var grd = ctx.createLinearGradient(bx, by, bx + bw, by + bh);
    if (isOpp) { grd.addColorStop(0, '#6b3a2c'); grd.addColorStop(1, '#3a1c14'); }
    else if (isHero) { grd.addColorStop(0, '#e0c076'); grd.addColorStop(1, '#96701f'); }
    else if (isFlag) { grd.addColorStop(0, '#5a5044'); grd.addColorStop(1, '#332c24'); }
    else { grd.addColorStop(0, '#3b342b'); grd.addColorStop(1, '#1c1814'); }
    rectPath(ctx, bx, by, bw, bh, rad);
    ctx.fillStyle = grd;
    ctx.fill();
    ctx.strokeStyle = isHero ? 'rgba(255,240,200,.85)' : (isOpp ? 'rgba(255,180,160,.35)' : 'rgba(255,250,236,.22)');
    ctx.lineWidth = 1.2;
    ctx.stroke();
    if (p.structure) {   // 无血挂件：虚线外环
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(240,214,138,.5)';
      ctx.lineWidth = 1.4;
      rectPath(ctx, bx, by, bw, bh, rad);
      ctx.stroke();
      ctx.restore();
    }

    var txt = isHero ? (D.HEROES[p.heroId] ? D.HEROES[p.heroId].name : '将') : def.ch;
    var fs = Math.min(bw, bh) * (txt.length > 1 ? 0.44 : 0.62);
    ctx.font = fs + 'px "KaiTi","STKaiti","Kaiti SC",serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = isHero ? '#2a2008' : '#f4ecda';
    ctx.fillText(txt, cx, cy - (battle ? s * 0.12 : 0));

    if (p.ench) {
      var ecol = p.ench === 'yan' ? '#d4693a' : p.ench === 'shuang' ? '#5d8fa8'
        : p.ench === 'du' ? '#6a8c46' : p.ench === 'lei' ? '#7a5fa8' : p.ench === 'jin' ? '#c9a24b' : '#8a8a8a';
      ctx.beginPath(); ctx.arc(cx - s * 0.66, cy + s * 0.6, s * 0.15, 0, 6.284);
      ctx.fillStyle = ecol; ctx.fill();
    }

    if (battle) {
      if (p.atk && p.def.role !== 'flag') {
        var cdk = 1 - U.clamp(p.cd / p.atk, 0, 1);
        ctx.beginPath();
        ctx.arc(cx, cy, s * 0.99, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * cdk);
        ctx.strokeStyle = 'rgba(240,214,138,.7)';
        ctx.lineWidth = 2.2;
        ctx.lineCap = 'round';
        ctx.stroke();
      }
      if (p.canUlt) {
        if (p.ultReady) {
          var pulse = 0.55 + 0.45 * Math.sin(performance.now() / 220);
          ctx.beginPath();
          ctx.arc(cx, cy, s * (1.06 + 0.05 * pulse), 0, 6.284);
          ctx.strokeStyle = 'rgba(240,214,138,' + (0.55 + 0.45 * pulse) + ')';
          ctx.lineWidth = 3;
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.arc(cx, cy, s * 1.04, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (p.ultT || 0));
          ctx.strokeStyle = 'rgba(240,214,138,.45)';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
      if (p.shield > 0) {
        ctx.strokeStyle = 'rgba(150,200,230,.9)';
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(cx, cy, s * 0.86, 0, 6.284); ctx.stroke();
      }
      if (p.hitT > 0) {
        ctx.globalAlpha = (dead ? 0.1 : p.hitT * 0.5);
        sqPath(ctx, cx, cy, s * 0.94);
        ctx.fillStyle = '#fff'; ctx.fill();
        ctx.globalAlpha = dead ? 0.22 : 1;
      }
      if (p.healT > 0) {
        ctx.beginPath(); ctx.arc(cx, cy, s * (0.9 + 0.2 * p.healT), 0, 6.284);
        ctx.strokeStyle = 'rgba(120,200,140,' + p.healT + ')';
        ctx.lineWidth = 2; ctx.stroke();
      }
      if (p.burnUntil > battle.t) {
        ctx.beginPath(); ctx.arc(cx, cy, s * 1.0, 0, 6.284);
        ctx.strokeStyle = 'rgba(220,110,50,.75)'; ctx.lineWidth = 2; ctx.stroke();
      }
      if (p.hasteUntil > battle.t) {
        ctx.beginPath(); ctx.arc(cx, cy, s * 1.08, 0, 6.284);
        ctx.strokeStyle = 'rgba(240,210,120,.8)'; ctx.lineWidth = 1.5; ctx.stroke();
      }
    }

    ctx.restore();
  }

  function drawShots() {
    for (var i = 0; i < battle.shots.length; i++) {
      var sh = battle.shots[i];
      var k = U.clamp(sh.t / sh.dur, 0, 1);
      var x1 = px(sh.x1), y1 = py(sh.y1), x2 = px(sh.x2), y2 = py(sh.y2);
      var arcH = sh.arc ? Math.min(90, Math.abs(y2 - y1) * 0.55 + 34) : 0;
      var x = x1 + (x2 - x1) * k;
      var y = y1 + (y2 - y1) * k - Math.sin(Math.PI * k) * arcH;

      if (sh.arc) {
        ctx.save();
        ctx.globalAlpha = 0.25;
        ctx.strokeStyle = sh.side === 'p' ? '#8a6b2e' : '#a8432e';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        for (var j = 0; j <= 10; j++) {
          var kk = j / 10;
          var xx = x1 + (x2 - x1) * kk;
          var yy = y1 + (y2 - y1) * kk - Math.sin(Math.PI * kk) * arcH;
          if (j === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
        }
        ctx.stroke();
        ctx.restore();
      }

      ctx.save();
      ctx.globalAlpha = 0.95;
      ctx.beginPath();
      ctx.arc(x, y, sh.arc ? cw * 0.10 : cw * 0.075, 0, 6.284);
      ctx.fillStyle = sh.kind === '雷' ? '#8f74c9' : sh.kind === '火' ? '#d4693a'
        : sh.kind === '医' ? '#7ea86a' : (sh.side === 'p' ? '#e8c877' : '#d97a5a');
      ctx.fill();
      ctx.restore();
    }
  }

  function drawFloats() {
    var s = cw / 2;
    for (var i = 0; i < battle.floats.length; i++) {
      var f = battle.floats[i];
      var a = U.clamp(f.life / 0.55, 0, 1);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.font = (s * 0.5) + 'px "Songti SC",serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = f.good ? 'rgba(60,130,80,.95)' : 'rgba(150,40,30,.9)';
      ctx.fillText(String(f.v), px(f.x), py(f.y) - (1 - a) * cw * 0.55);
      ctx.restore();
    }
  }

  function drawParticles() {
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      var a = U.clamp(p.life / p.max, 0, 1);
      ctx.globalAlpha = a * 0.9;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * (0.4 + a * 0.6), 0, 6.284);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (var j = 0; j < rings.length; j++) {
      var r = rings[j];
      var k = 1 - r.life / r.max;
      ctx.globalAlpha = (1 - k) * 0.65;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r0 + k * r.r1, 0, 6.284);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawDrag() {
    var d = view.drag;
    if (!d || !d.cells) return;
    var s = cw / 2;
    for (var i = 0; i < d.cells.length; i++) {
      var c = d.cells[i];
      sqPath(ctx, px(c.x), py(c.y), s * 0.94);
      ctx.fillStyle = d.valid ? 'rgba(63,107,87,.32)' : 'rgba(165,52,42,.28)';
      ctx.fill();
      ctx.strokeStyle = d.valid ? 'rgba(63,107,87,.9)' : 'rgba(165,52,42,.8)';
      ctx.lineWidth = 2; ctx.stroke();
    }
  }

  function onEvent(ev) {
    if (ev.type === 'kill') {
      var x = px(ev.x), y = py(ev.y);
      for (var i = 0; i < 9; i++) {
        var a = Math.random() * 6.284, sp = 30 + Math.random() * 110;
        parts.push({
          x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 30,
          r: 1.3 + Math.random() * 2.4, life: 0.35 + Math.random() * 0.4, max: 0.75,
          color: ev.side === 'p' ? 'rgba(90,70,45,.75)' : 'rgba(150,45,30,.85)'
        });
      }
      rings.push({ x: x, y: y, r0: 3, r1: 30, life: 0.4, max: 0.4, color: 'rgba(120,60,40,.6)' });
    } else if (ev.type === 'heal') {
      rings.push({ x: px(ev.x1), y: py(ev.y1), r0: 2, r1: 16, life: 0.3, max: 0.3, color: 'rgba(120,200,140,.8)' });
    } else if (ev.type === 'shield' || ev.type === 'haste') {
      rings.push({
        x: px(ev.x), y: py(ev.y), r0: 4, r1: cw * (ev.r || 2), life: 0.45, max: 0.45,
        color: ev.type === 'shield' ? 'rgba(130,180,220,.7)' : 'rgba(240,210,120,.7)'
      });
    } else if (ev.type === 'order') {
      rings.push({ x: px(ev.x), y: py(ev.y), r0: 4, r1: 34, life: 0.4, max: 0.4, color: 'rgba(240,214,138,.95)' });
    } else if (ev.type === 'ultready') {
      rings.push({ x: px(ev.x), y: py(ev.y), r0: 4, r1: 28, life: 0.5, max: 0.5, color: 'rgba(240,214,138,.95)' });
    } else if (ev.type === 'ult') {
      rings.push({
        x: px(ev.x), y: py(ev.y), r0: 6, r1: cw * 1.6, life: 0.6, max: 0.6,
        color: ev.kind === 'heal' ? 'rgba(120,200,140,.9)' : ev.kind === 'gold' ? 'rgba(201,162,75,.9)' : 'rgba(240,214,138,.95)'
      });
    } else if (ev.type === 'laststand') {
      rings.push({ x: px(0), y: py(ev.side === 'p' ? 2.2 : -2.2), r0: 8, r1: 90, life: 0.8, max: 0.8, color: 'rgba(200,60,40,.85)' });
    }
  }

  function cellAtPx(sx, sy) {
    var u = toUnit(sx, sy);
    return MAP.cellAt(u.x, u.y);
  }

  function setMode(full) {
    if (showEnemy === !!full) return;
    showEnemy = !!full;
    layout();
    draw();
  }

  GB.Render = {
    init: init,
    setMode: setMode,
    layout: layout,
    update: update,
    draw: draw,
    setHover: function (c) { view.hover = c || null; },
    setPending: setPending,
    getPending: getPending,
    onEvent: onEvent,
    cellAtPx: cellAtPx,
    toUnit: toUnit,
    pxOf: function (c) { return { x: px(c.x), y: py(c.y) }; },
    metrics: function () { return { W: W, H: H, cw: cw }; }
  };
}(typeof window !== 'undefined' ? window : globalThis));
