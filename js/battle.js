/* battle.js — 静态自走棋对轰：走位定生死，抛物线切后排 */
(function (root) {
  'use strict';
  var GB = root.GB = root.GB || {};
  var D = GB.D, MAP = GB.MAP, U = GB.U;
  var CFG = D.CFG, LVL = D.LVL;

  var seq = 0;

  function center(cells) {
    var x = 0, y = 0;
    for (var i = 0; i < cells.length; i++) { x += cells[i].x; y += cells[i].y; }
    return { x: x / cells.length, y: y / cells.length };
  }

  // 光环强度：等级每 +1 提升 40%（射程/金币这类整数光环不缩放）
  function auraValue(def, level) {
    var lv = Math.max(1, level || 1);
    if (def.aura === 'range' || def.aura === 'gold') return def.value;
    // 方格是 4 邻（六边形是 6 邻），相邻收益少约 1/3，这里补偿回来
    return def.value * 1.3 * (1 + 0.4 * (lv - 1));
  }

  function mkPiece(src, side, b) {
    var def = src.def || D.pieceById(src.k);
    if (!def) return null;
    var m = side === 'p' ? b.modsP : b.modsO;
    var pos = center(src.cells);
    var p = {
      id: src.id, k: src.k, def: def, level: src.level || 1, side: side,
      cells: src.cells, c: src.cells[0].c, q: src.cells[0].q, r: src.cells[0].r,
      x: pos.x, y: pos.y,
      role: def.role, arc: !!def.arc,
      structure: def.role === 'flag',   // 无血挂件：打不掉、不提供血量、只占格子
      ench: src.ench ? D.ENCHANTS[src.ench].fx : null,
      aura: {}, alive: true, cd: 0.2 + b.rng() * 0.6,
      hitT: 0, healT: 0, shield: 0,
      slowMul: 0, slowUntil: 0,
      burnDps: 0, burnUntil: 0,
      hasteUntil: 0,
      stunned: 0,
      evo: src.evo || null,
      evos: (src.evos || (src.evo ? [src.evo] : [])).slice(0, 2),
      evoDef: null, evoDefs: [],
      on: null,
      skillDef: D.ULTS[def.id] || null,
      skillT: 0,
      canUlt: (src.level || 1) >= 3 && !!D.ROLE_ULT[def.role],
      ultDef: ((src.level || 1) >= 3 ? D.ROLE_ULT[def.role] : null) || null,
      ultT: 0, ultReady: false
    };
    pos.c = p.c; pos.r = p.r;
    // 有效钩子表 = 棋子自带 on + 进化覆盖
    p.on = {};
    if (def.on) for (var hk in def.on) if (def.on.hasOwnProperty(hk)) p.on[hk] = def.on[hk];
    // 多个流派叠加：钩子依次覆盖合并
    for (var ei = 0; ei < p.evos.length; ei++) {
      var ed = D.evoDef ? D.evoDef(def.id, p.evos[ei]) : null;
      if (!ed) continue;
      p.evoDefs.push(ed);
      if (!ed.on) continue;
      for (var ek in ed.on) if (ed.on.hasOwnProperty(ek)) {
        p.on[ek] = Object.assign({}, p.on[ek] || {}, ed.on[ek]);
      }
    }
    p.evoDef = p.evoDefs[0] || null;
    return p;
  }

  function sidesOf(b) {
    return [{ list: b.p, m: b.modsP, side: 'p' }, { list: b.e, m: b.modsO, side: 'o' }];
  }

  // 一次算好「没有光环时」的数值，挂在 p.raw 上
  function baseStats(b) {
    var sides = sidesOf(b);
    for (var s = 0; s < sides.length; s++) {
      var list = sides[s].list, m = sides[s].m;
      for (var i = 0; i < list.length; i++) {
        var p = list[i], d = p.def, lv = LVL[p.level] || 1;
        p.aura = { dmg: 0, spd: 0, hp: 0, range: 0, burn: 0, slow: 0, gold: 0, poison: 0 };
        var es = {};
        for (var si = 0; si < p.evoDefs.length; si++) {
          var st = p.evoDefs[si].stats || {};
          for (var sk in st) {
            if (!st.hasOwnProperty(sk)) continue;
            if (sk === 'rangeAdd' || sk === 'splashAdd') es[sk] = (es[sk] || 0) + st[sk];
            else es[sk] = (es[sk] || 1) * st[sk];
          }
        }
        p.raw = {
          hp: (p.structure ? 0 : (d.hp || 100)) * lv * (CFG.hpScale || 1) * (1 + (m.hp || 0)) * (d.role === 'tank' ? 1 + (m.tankHp || 0) : 1) * (es.hpMul || 1),
          dmg: (d.dmg || 0) * lv * (1 + (m.dmgMul || 0)) * (es.dmgMul || 1),
          atkBase: (d.atk || 1.5) * (es.atkMul || 1),
          spdMul: 1 + (m.spd || 0) + (d.arc ? (m.arcSpd || 0) : 0),
          range: (d.range || 1) + (es.rangeAdd || 0) + (d.arc ? (m.arcRange || 0) : 0),
          burn: (d.burn || 0) + (m.pieceBurn || 0),
          slow: (d.slow || 0),
          gold: (d.role === 'gold' ? 0 : (m.killGold || 0))
        };
        p.heal = (d.heal || 0) * lv * (1 + (m.healBoost || 0)) * (es.healMul || 1);
        p.shieldAmt = (d.shield || 0) * lv;
        p.goldAmt = (d.gold || 0);
        p.targets = d.chain ? d.chain + 1 : 1;
        p.pierce = d.pierce === true ? 1 : (d.pierce | 0);
        p.splash = (d.splash === true ? 1 : (d.splash | 0)) + (es.splashAdd || 0);
        p.armor = (m.frontArmor && (p.r === (p.side === 'p' ? 4 : 3))) ? m.frontArmor : 0;
        if (p.ench && p.ench.dmgTaken) p.armor = Math.max(p.armor, p.ench.dmgTaken);
        applyAura(p);
        p.maxHp = Math.round(p.maxHp);
        p.hp = p.maxHp;
      }
    }
  }

  // 把光环增量套到基础值上
  function applyAura(p) {
    var a = p.aura, r = p.raw;
    if (p.structure) { p.maxHp = 0; p.hp = 0; p.dmg = 0; p.atk = 999; p.range = 0; return; }
    var ratio = p.maxHp ? Math.max(0, p.hp || 0) / p.maxHp : 1;
    p.maxHp = Math.round(r.hp * (1 + a.hp));
    if (p.maxHp < 1) p.maxHp = 1;
    if (p.hp !== undefined) p.hp = Math.max(1, Math.min(p.maxHp, Math.round(p.maxHp * ratio)));
    p.dmg = r.dmg * (1 + a.dmg);
    p.atk = Math.max(0.25, r.atkBase / (r.spdMul + a.spd));
    p.range = r.range + a.range;
    p.burn = r.burn + a.burn;
    p.slow = r.slow + a.slow;
    p.poison = a.poison;
    p.goldOnKill = r.gold + a.gold;
  }

  // 重新分配光环并刷新（阵旗死了，加成就没了）
  function refreshAuras(b) {
    var sides = sidesOf(b);
    for (var s = 0; s < sides.length; s++) {
      var list = sides[s].list, m = sides[s].m, i, j;
      for (i = 0; i < list.length; i++) {
        if (!list[i].aura) list[i].aura = { dmg: 0, spd: 0, hp: 0, range: 0, burn: 0, slow: 0, gold: 0, poison: 0 };
        else {
          for (var k in list[i].aura) if (list[i].aura.hasOwnProperty(k)) list[i].aura[k] = 0;
        }
      }
      var byCell = {};
      for (i = 0; i < list.length; i++) {
        if (!list[i].alive) continue;
        for (j = 0; j < list[i].cells.length; j++) byCell[MAP.key(list[i].cells[j].c, list[i].cells[j].r)] = list[i];
      }
      for (i = 0; i < list.length; i++) {
        var src = list[i];
        if (!src.alive || !src.def.aura) continue;
        var kind = src.def.aura;
        // 光环降级（ITERATION.md §4）：只保留 血/攻速/射程 三条属性光环，
        // 燃烧、减速、中毒、金币这些改成事件规则（见各棋子的 on 钩子）
        if (kind !== 'hp' && kind !== 'spd' && kind !== 'range') continue;
        var val = auraValue(src.def, src.level) * (1 + (m.auraBoost || 0));
        var touched = {};
        for (j = 0; j < src.cells.length; j++) {
          var nb = MAP.neighbors(src.cells[j].c, src.cells[j].r);
          for (var n = 0; n < nb.length; n++) {
            var tgt = byCell[MAP.key(nb[n].c, nb[n].r)];
            if (!tgt || tgt === src || touched[tgt.id]) continue;
            touched[tgt.id] = 1;
            tgt.aura[src.def.aura] = (tgt.aura[src.def.aura] || 0) + val;
          }
        }
      }
      for (i = 0; i < list.length; i++) applyAura(list[i]);
    }
  }

  // 兵书里「条件式」的那几条：开局按阵型算一次
  function applyBooks(b) {
    if (!b.books || !b.books.length) return;
    applyBooksSide(b, b.p, 'p', b.frontRowP || 4, b.ownedCells || 0);
    applyBooksSide(b, b.e, 'o', MAP.frontRow('e'), b.ownedCellsO || 0);
  }

  function applyBooksSide(b, list, side, frontRow, ownedCells) {
    var books = [];
    for (var bi = 0; bi < b.books.length; bi++) if ((b.books[bi].side || 'p') === side) books.push(b.books[bi]);
    if (!books.length) return;
    var units = 0, big = 0, lvl3 = 0, used = 0;
    var minC = 99, maxC = -1;
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (!p.alive || p.structure) continue;
      units++;
      var def = p.def;
      if ((def.size || 1) >= 4) big++;
      if ((p.level || 1) >= 3) lvl3++;
      used += (def.size || 1);
      for (var j = 0; j < (p.cells || []).length; j++) {
        if (p.cells[j].c < minC) minC = p.cells[j].c;
        if (p.cells[j].c > maxC) maxC = p.cells[j].c;
      }
    }
    var empty = Math.max(0, ownedCells - used);

    for (var k = 0; k < books.length; k++) {
      var bk = books[k], when = bk.def.when, give = bk.def.give;
      if (!when || !give) continue;
      var tier = bk.tier;
      var stacks = 1;
      if (when.maxUnits !== undefined && units > when.maxUnits) continue;
      if (when.perBig) stacks = big;
      if (when.perLevel3) stacks = lvl3;
      if (when.perEmpty) stacks = Math.min(when.cap || 6, empty);
      if (stacks <= 0) continue;

      for (var gk in give) {
        if (!give.hasOwnProperty(gk)) continue;
        var v = (D.skillValue ? D.skillValue(give[gk], tier) : give[gk]) * stacks;
        if (gk === 'atkMul') {
          for (i = 0; i < list.length; i++) {
            var q = list[i];
            if (!q.alive || q.structure) continue;
            if (when.leftmost && q.cells && q.cells.length) {
              var qmin = 99;
              for (j = 0; j < q.cells.length; j++) if (q.cells[j].c < qmin) qmin = q.cells[j].c;
              if (qmin !== minC) continue;
            }
            q.raw.dmg *= (1 + v);
          }
        } else if (gk === 'spdMul') {
          for (i = 0; i < list.length; i++) {
            var q2 = list[i];
            if (!q2.alive || q2.structure) continue;
            q2.raw.spdMul += v;
          }
        } else if (gk === 'armor') {
          for (i = 0; i < list.length; i++) {
            var q3 = list[i];
            if (!q3.alive || q3.structure) continue;
            var onFront = false;
            for (j = 0; j < (q3.cells || []).length; j++) if (q3.cells[j].r === frontRow) onFront = true;
            if (onFront) q3.armor = Math.max(q3.armor || 0, v);
          }
        } else if (gk === 'healToShield') {
          if (side === 'p') b.healToShield = Math.max(b.healToShield || 0, v);
          else b.healToShieldO = Math.max(b.healToShieldO || 0, v);
        }
      }
    }
    // 重新套用（raw 改过了）
    for (i = 0; i < list.length; i++) applyAura(list[i]);
  }

  function stats(b) {
    baseStats(b);
    applyBooks(b);
    refreshAuras(b);
  }

  /* ---------------- 创建 ---------------- */
  function create(o) {
    var b = {
      id: ++seq,
      t: 0,
      day: o.day || 1,
      rng: U.mulberry32((o.seed | 0) || 7),
      modsP: o.modsP || {},
      modsO: o.modsO || {},
      factionP: o.factionP || 'dongwu',
      factionO: o.factionO || 'dongwu',
      p: [], e: [],
      shots: [], floats: [], events: [],
      q: [], hooks: {}, trace: [], evSeq: 0, overflow: 0,
      status: 'run',
      autoUlt: o.autoUlt !== false,
      stats: { dmgP: 0, dmgO: 0, killsP: 0, killsO: 0, gold: 0 },
      lastStandP: false, lastStandO: false,
      books: []
    };
    var i, piece;
    for (i = 0; i < (o.piecesP || []).length; i++) {
      piece = mkPiece(o.piecesP[i], 'p', b);
      if (piece) b.p.push(piece);
    }
    for (i = 0; i < (o.piecesO || []).length; i++) {
      piece = mkPiece(o.piecesO[i], 'o', b);
      if (piece) b.e.push(piece);
    }
    // 兵书（遗物）：双方各一份，规则完全对等
    function loadBooks(src, side) {
      for (var bi = 0; bi < (src || []).length; bi++) {
        var bkDef = D.skillById ? D.skillById(src[bi].id) : null;
        if (!bkDef) continue;
        b.books.push({ id: src[bi].id, tier: src[bi].tier || bkDef.tier || 1, def: bkDef, side: side });
      }
    }
    loadBooks(o.booksP, 'p');
    loadBooks(o.booksO, 'o');
    stats(b);
    b.startHpP = sumHp(b.p) || 1;
    b.startHpO = sumHp(b.e) || 1;
    rebuildHooks(b);
    return b;
  }

  /* ---------------- 事件总线（见 ITERATION.md） ----------------
     规则：深度 ≤ CFG.events.maxDepth；每个引擎有 limits.rate 限频；
          charge 事件不再触发任何 charge（防自循环）。            */
  var EV = (CFG && CFG.events) || {};

  function emit(b, type, o) {
    o = o || {};
    var ev = {
      type: type,
      src: o.src || null,
      tgt: o.tgt || null,
      side: o.side || (o.src ? o.src.side : (o.tgt ? o.tgt.side : null)),
      dmg: o.dmg || 0,
      v: o.v,
      dur: o.dur,
      depth: o.depth || 0
    };
    if (ev.depth > (EV.maxDepth || 3)) { b.overflow++; return; }
    if (b.q.length > (EV.queueMax || 240)) { b.overflow++; return; }
    b.q.push(ev);
    b.stats.ev = b.stats.ev || {};
    b.stats.ev[type] = (b.stats.ev[type] || 0) + 1;
    b.trace.push({
      t: +b.t.toFixed(1), type: type,
      src: ev.src && ev.src.def ? ev.src.def.ch : '',
      tgt: ev.tgt && ev.tgt.def ? ev.tgt.def.ch : ''
    });
    if (b.trace.length > (EV.traceMax || 24)) b.trace.shift();
  }

  // 谁对哪类事件感兴趣（棋子阵亡后要重建）
  function rebuildHooks(b) {
    b.hooks = {};
    // 兵书（遗物）没有位置概念（scope 只有 team 有意义），两侧各挂一份
    for (var bi = 0; bi < (b.books || []).length; bi++) {
      var bk = b.books[bi];
      if (!bk.def.on) continue;
      var fake = {
        book: bk, side: bk.side || 'p', alive: true, structure: true, cells: null,
        def: { limits: bk.def.limits, on: bk.def.on, ch: bk.def.ch, role: 'book' },
        on: bk.def.on, isBook: true
      };
      for (var bkType in bk.def.on) {
        if (!bk.def.on.hasOwnProperty(bkType)) continue;
        if (!b.hooks[bkType]) b.hooks[bkType] = [];
        b.hooks[bkType].push(fake);
      }
    }
    var lists = [b.p, b.e];
    for (var s = 0; s < lists.length; s++) {
      for (var i = 0; i < lists[s].length; i++) {
        var p = lists[s][i];
        if (!p.alive || !p.on) continue;
        for (var k in p.on) {
          if (!p.on.hasOwnProperty(k)) continue;
          if (!b.hooks[k]) b.hooks[k] = [];
          b.hooks[k].push(p);
        }
      }
    }
  }

  function rateOk(b, p, type) {
    var lim = (p.def.limits && p.def.limits.rate) || 3;
    for (var li = 0; li < (p.evoDefs || []).length; li++) {
      lim += (p.evoDefs[li].limits && p.evoDefs[li].limits.rate) || 0;
    }
    if (lim < 1) lim = 1;
    var w = EV.rateWindow || 1;
    p._rate = p._rate || {};
    var rec = p._rate[type];
    if (!rec || b.t - rec.t0 > w) { p._rate[type] = { t0: b.t, n: 1 }; return true; }
    if (rec.n >= lim) return false;
    rec.n++;
    return true;
  }

  function adjacentTo(a, z) {
    if (!a || !z || !a.cells || !z.cells) return false;
    for (var i = 0; i < a.cells.length; i++) {
      var nb = MAP.neighbors(a.cells[i].c, a.cells[i].r);
      for (var j = 0; j < nb.length; j++) {
        for (var k = 0; k < z.cells.length; k++) {
          if (nb[j].c === z.cells[k].c && nb[j].r === z.cells[k].r) return true;
        }
      }
    }
    return false;
  }

  function foeList(b, p) { return p.side === 'p' ? b.e : b.p; }
  function allyList(b, p) { return p.side === 'p' ? b.p : b.e; }

  // 燃烧可叠加（这是循环的收益来源），上限 = 目标最大生命的 8%/秒
  function applyBurn(b, tgt, dmg, dur) {
    if (!tgt || !tgt.alive || tgt.structure) return;
    var cap = (tgt.maxHp || 1000) * 0.13;
    tgt.burnDps = Math.min((tgt.burnDps || 0) + dmg, cap);
    tgt.burnUntil = Math.max(tgt.burnUntil, b.t + (dur || 2.5));
  }

  // 兵书的 v 是 [铜,银,金]，按档位取值
  function specV(p, spec) {
    if (p.isBook) return D.skillValue ? D.skillValue(spec.v, p.book.tier) : spec.v;
    return spec.v;
  }

  function runHook(b, p, ev, spec) {
    var src = ev.src, tgt = ev.tgt;
    if (p.isBook && spec.scope !== 'team') return;
    if (spec.scope === 'team' && ev.side !== p.side) return;
    if (spec.scope === 'self' && p !== src) return;
    if (spec.scope === 'adjacent') {
      var anchor = src || tgt;
      if (anchor === p) return;
      if (!adjacentTo(p, anchor)) return;
    }
    if (!rateOk(b, p, ev.type)) return;

    var i, a, list;
    if (spec.do === 'burn') {
      if (!tgt || tgt.side === p.side) return;
      applyBurn(b, tgt, (ev.dmg || p.dmg) * specV(p, spec), spec.dur);
      emit(b, 'trigger', { src: p, tgt: tgt, depth: ev.depth + 1 });
      return;
    }
    if (spec.do === 'slow') {
      if (!tgt || tgt.side === p.side) return;
      tgt.slowMul = spec.v; tgt.slowUntil = Math.max(tgt.slowUntil, b.t + (spec.dur || 2.5));
      emit(b, 'trigger', { src: p, tgt: tgt, depth: ev.depth + 1 });
      return;
    }
    if (spec.do === 'chain') {
      if (!tgt) return;
      list = alliesAround(b, tgt, 1.6).slice(0, specV(p, spec) || 2);
      for (i = 0; i < list.length; i++) {
        a = list[i];
        if (a.side === p.side) continue;
        hit(b, p, a, (ev.dmg || p.dmg) * specV(p, spec), p.side === 'p', ev.depth + 1);
      }
      emit(b, 'trigger', { src: p, tgt: tgt, depth: ev.depth + 1 });
      return;
    }
    if (spec.do === 'spread') {
      if (!tgt) return;
      list = alliesAround(b, tgt, 1.6);
      for (i = 0; i < list.length; i++) {
        a = list[i];
        if (a.side === tgt.side) applyBurn(b, a, (ev.dmg || 0) * (specV(p, spec) || 0.5), 2.5);
      }
      emit(b, 'trigger', { src: p, tgt: tgt, depth: ev.depth + 1 });
      return;
    }
    if (spec.do === 'charge') {
      // 燃烧跳伤 → 给相邻战斗单位减冷却（不再派发 charge 事件，防自循环）
      list = allyList(b, p);
      for (i = 0; i < list.length; i++) {
        a = list[i];
        if (!a.alive || a.structure || a.def.role === 'flag') continue;
        if (!adjacentTo(p, a)) continue;
        a.cd = Math.max(0, (a.cd || 0) - (spec.v || 1));
        a.charged = 1;
      }
      emit(b, 'trigger', { src: p, tgt: tgt, depth: ev.depth + 1 });
      return;
    }
    if (spec.do === 'combo') {
      // 全队累计命中：满 need 次 → 出手者立刻再打一次（额外攻击不计入累计）
      p._combo = (p._combo || 0) + 1;
      if (p._combo < (spec.need || 3)) return;
      p._combo = 0;
      if (src && src.alive && !src.structure) {
        var foe = candidates(b, src);                 // 立刻补一刀（会再派发一次 hit，深度 +1）
        if (foe.length) {
          hit(b, src, foe[0], src.dmg * (spec.mul || 1.3), src.side === 'p', ev.depth + 1);
        }
        src.extra = (src.extra || 0) + 1;
      }
      // 鼓点让全队都提前出手：人越多收益越大（连击循环奖励「宽阵」）
      list = allyList(b, p);
      for (i = 0; i < list.length; i++) {
        a = list[i];
        if (!a.alive || a.structure) continue;
        a.cd = Math.max(0, (a.cd || 0) - 0.6);
        a.hasteUntil = Math.max(a.hasteUntil || 0, b.t + 1.5);
        a.hasteMul = Math.max(a.hasteMul || 0, 0.35);
      }
      emit(b, 'trigger', { src: p, tgt: tgt, depth: ev.depth + 1 });
      return;
    }
    if (spec.do === 'rerollHit') {
      // 连弩：命中后按概率立刻再打一次（深度 +1，受上限约束）
      if (!src || !src.alive || src.structure) return;
      if (spec.arcOnly && !src.arc) return;
      if (!tgt || !tgt.alive) return;
      if (b.rng() >= specV(p, spec)) return;
      hit(b, src, tgt, ev.dmg || src.dmg, src.side === 'p', ev.depth + 1);
      return;
    }
    if (spec.do === 'haste') {
      list = allyList(b, p);
      for (i = 0; i < list.length; i++) {
        a = list[i];
        if (!a.alive) continue;
        a.hasteUntil = Math.max(a.hasteUntil || 0, b.t + (spec.dur || 2));
        a.hasteMul = Math.max(a.hasteMul || 0, specV(p, spec) || 0.35);
      }
      return;
    }
  }

  function flush(b) {
    var guard = 0;
    while (b.q.length && guard++ < (EV.queueMax || 240)) {
      var ev = b.q.shift();
      var hooks = b.hooks[ev.type];
      if (!hooks) continue;
      for (var i = 0; i < hooks.length; i++) {
        var p = hooks[i];
        if (!p.alive) continue;
        var spec = p.on[ev.type];
        if (spec) runHook(b, p, ev, spec);
      }
    }
  }

  /* ---------------- 目标 ---------------- */
  function depthOf(b, p, e) { return p.side === 'p' ? e.r : (MAP.ROWS - 1 - e.r); }

  function candidates(b, p) {
    var list = p.side === 'p' ? b.e : b.p;
    var living = [], i, e, d, minD = 99;
    for (i = 0; i < list.length; i++) {
      e = list[i];
      if (!e.alive || e.structure) continue;
      living.push(e);
      d = Math.abs(p.r - e.r);
      if (d < minD) minD = d;
    }
    if (!living.length) return [];
    var out = [];
    for (i = 0; i < living.length; i++) {
      e = living[i];
      d = Math.abs(e.r - p.r);
      if (p.arc) {
        // 抛射：越过前排，后排也够得到（不限距离）
        out.push(e);
      } else {
        // 近战/长兵：最前排永远够得着；多出来的射程才能往深处扎
        if (d - minD < p.range) out.push(e);
      }
    }
    return out;
  }

  // 方格距离：Chebyshev（方形扩散圈）
  function cellDist(a, z) { return MAP.cellDist(a, z); }

  // 溅射：以命中点为中心扩一圈，按距离衰减，总体最多 splashCap 格
  function splashTargets(b, p, e) {
    var list = e.side === 'p' ? b.p : b.e;
    var near = [];
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (!a.alive || a === e || a.structure) continue;
      var d = cellDist(e, a);
      if (d <= p.splash) near.push({ u: a, d: d });
    }
    near.sort(function (x, z) { return x.d - z.d; });
    var cap = Math.max(0, (CFG.splashCap || 3) - 1);
    return near.slice(0, cap);
  }

  // 穿透：同列，沿「离自己更远」的方向再打 1~2 格
  function pierceTargets(b, p, e) {
    var list = e.side === 'p' ? b.p : b.e;
    var dir = p.side === 'p' ? -1 : 1;   // 敌人越远，r 越「深」
    var out = [], k, rr, a;
    for (k = 1; k <= p.pierce; k++) {
      rr = e.r + dir * k;
      for (var i = 0; i < list.length; i++) {
        a = list[i];
        if (!a.alive || a === e || a.structure) continue;
        if (a.r === rr && a.c === e.c) { out.push({ u: a, d: k }); break; }
      }
    }
    return out;
  }

  function pickTargets(b, p) {
    var c = candidates(b, p);
    if (!c.length) return [];
    c.sort(function (a, z) {
      var dd = depthOf(b, p, z) - depthOf(b, p, a);
      if (dd) return dd;
      return Math.abs(a.c - p.c) - Math.abs(z.c - p.c);
    });
    // 非抛物线：打最靠前的；抛物线：打最靠后的
    if (!p.arc) return c.slice(0, p.targets);
    c.reverse();
    return c.slice(0, p.targets);
  }

  function allyInRange(b, p) {
    var list = p.side === 'p' ? b.p : b.e;
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (!a.alive || a === p || a.structure) continue;
      if (Math.abs(p.r - a.r) <= p.range) out.push(a);
    }
    return out;
  }

  /* ---------------- 主循环 ---------------- */
  function step(b, dt) {
    if (b.status !== 'run') return;
    if (dt > 0.05) dt = 0.05;
    b.t += dt;

    // 阵旗阵亡 → 光环立即消失
    b.auraT = (b.auraT || 0) + dt;
    if (b.auraT >= 0.25) {
      b.auraT = 0;
      var sig = 0;
      for (var ai = 0; ai < b.p.length; ai++) if (b.p[ai].alive && b.p[ai].def.aura) sig++;
      for (var bi = 0; bi < b.e.length; bi++) if (b.e[bi].alive && b.e[bi].def.aura) sig += 100;
      if (sig !== b.auraSig) { b.auraSig = sig; refreshAuras(b); }
    }

    var rushP = b.t < 15 ? (b.modsP.openingRush || 0) : 0;
    var rushO = b.t < 15 ? (b.modsO.openingRush || 0) : 0;

    tick(b, b.p, dt, rushP, true);
    tick(b, b.e, dt, rushO, false);

    for (var i = b.shots.length - 1; i >= 0; i--) {
      b.shots[i].t += dt;
      if (b.shots[i].t >= b.shots[i].dur) b.shots.splice(i, 1);
    }
    for (var j = b.floats.length - 1; j >= 0; j--) {
      b.floats[j].life -= dt;
      if (b.floats[j].life <= 0) b.floats.splice(j, 1);
    }

    if (unitsLeft(b.p) === 0) { b.status = 'lose'; return; }
    if (unitsLeft(b.e) === 0) { b.status = 'win'; return; }
    if (b.t >= CFG.battleTime) {
      // 超时比剩余总血量（试过按百分比比，结果养出「龟缩流」，回退）
      var hpP = sumHp(b.p), hpO = sumHp(b.e);
      b.status = hpP > hpO ? 'win' : (hpP < hpO ? 'lose' : 'draw');
      if (b.status === 'draw') b.status = b.stats.dmgP >= b.stats.dmgO ? 'win' : 'lose';
      b.timeUp = true;
    }
    // 背水一战：只剩最后一个棋子时攻速暴涨
    if (!b.lastStandP && aliveCount(b.p) <= 1) { b.lastStandP = true; b.events.push({ type: 'laststand', side: 'p' }); }
    if (!b.lastStandO && aliveCount(b.e) <= 1) { b.lastStandO = true; b.events.push({ type: 'laststand', side: 'o' }); }
    flush(b);
  }

  function aliveCount(list) {
    var n = 0;
    for (var i = 0; i < list.length; i++) if (list[i].alive && !list[i].structure) n++;
    return n;
  }

  // 全队是否只剩挂件（用来判定胜负）
  function unitsLeft(list) {
    var n = 0;
    for (var i = 0; i < list.length; i++) if (list[i].alive && !list[i].structure) n++;
    return n;
  }

  function sumHp(list) {
    var s = 0;
    for (var i = 0; i < list.length; i++) if (list[i].alive) s += Math.max(0, list[i].hp);
    return s;
  }

  function tick(b, list, dt, rush, isP) {
    var m = isP ? b.modsP : b.modsO;
    var lastStand = isP ? b.lastStandP : b.lastStandO;
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (!p.alive) continue;
      p.hitT = Math.max(0, p.hitT - dt * 3);
      p.healT = Math.max(0, p.healT - dt * 2);

      if (p.burnUntil > b.t) {
        hurt(b, p, p.burnDps * dt, true);
        p._bt = (p._bt || 0) + dt;
        if (p._bt >= 0.5) {
          p._bt = 0;
          emit(b, 'burn_tick', { src: p, tgt: p, dmg: p.burnDps * 0.5, side: p.side === 'p' ? 'o' : 'p' });
        }
      }
      if (!p.alive) continue;
      if (p.stunned > 0) { p.stunned -= dt; continue; }
      if (p.def.role === 'flag') continue;

      var haste = p.hasteUntil > b.t ? (1 + (p.hasteMul || 0.35)) : 1;
      var slow = p.slowUntil > b.t ? (1 + p.slowMul) : 1;
      var ls = lastStand ? (1 + CFG.lastStandBonus) : 1;
      if (p.skillDef) {
        p.skillT += dt * haste / ((p.skillDef.cd || 10) * 0.55);
        if (p.skillT >= 1) { p.skillT = 0; cast(b, p, p.skillDef, 'skill'); }
      }
      if (p.ultDef) {
        if (!p.ultReady) {
          p.ultT += dt * haste / (p.ultDef.cd || 18);
          if (p.ultT >= 1) {
            p.ultT = 1; p.ultReady = true;
            b.events.push({ type: 'ultready', x: p.x, y: p.y, side: p.side });
          }
        } else if (b.autoUlt) {
          p.ultReady = false; p.ultT = 0;
          cast(b, p, p.ultDef, 'ult');
        }
      }
      p.cd -= dt * haste * ls / slow;

      if (p.cd > 0) continue;
      p.cd = p.atk;
      act(b, p, isP, m);
    }
  }

  function act(b, p, isP, m) {
    var role = p.def.role;
    if (role === 'heal') {
      var allies = allyInRange(b, p).filter(function (a) { return a.hp < a.maxHp; });
      if (!allies.length) return;
      allies.sort(function (a, z) { return (a.hp / a.maxHp) - (z.hp / z.maxHp); });
      var t = allies[0];
      var before = t.hp;
      t.hp = Math.min(t.maxHp, t.hp + p.heal);
      var h2s = p.side === 'p' ? b.healToShield : b.healToShieldO;
      if (h2s > 0 && t.hp > before) {
        var over = (before + p.heal) - t.maxHp;
        if (over > 0) t.shield = Math.min(t.maxHp * 0.6, t.shield + over * h2s);
      }
      t.healT = 1;
      if (p.def.emits === 'trigger') emit(b, 'trigger', { src: p, tgt: t, depth: 0 });
      b.events.push({ type: 'heal', x1: p.x, y1: p.y, x2: t.x, y2: t.y, side: p.side });
      b.floats.push({ x: t.x, y: t.y, v: '+' + Math.round(p.heal), life: 0.7, good: true });
      return;
    }
    if (role === 'support' && p.def.shield) {
      var a2 = allyInRange(b, p);
      if (!a2.length) return;
      for (var i = 0; i < a2.length; i++) a2[i].shield = Math.min(a2[i].maxHp * 0.6, a2[i].shield + p.shieldAmt);
      b.events.push({ type: 'shield', x: p.x, y: p.y, r: p.range, side: p.side });
      return;
    }
    if (role === 'support' && p.def.haste) {
      var a3 = allyInRange(b, p);
      for (var j = 0; j < a3.length; j++) a3[j].hasteUntil = b.t + 3;
      b.events.push({ type: 'haste', x: p.x, y: p.y, r: p.range, side: p.side });
      return;
    }
    if (role === 'gold') {
      b.stats.gold += p.goldAmt;
      b.events.push({ type: 'gold', x: p.x, y: p.y, n: p.goldAmt });
      return;
    }

    var tg = pickTargets(b, p);
    if (!tg.length) { p.cd = Math.min(p.cd, p.atk * 0.35); return; }

    var reps = 1 + (p.multicast || 0);
    for (var k = 0; k < tg.length; k++) {
      var e = tg[k];
      for (var rp = 1; rp < reps; rp++) {
        hit(b, p, e, p.dmg * 0.7, isP);     // 多重释放：后续几发七成伤害
      }
      b.shots.push({
        x1: p.x, y1: p.y, x2: e.x, y2: e.y,
        t: 0, dur: p.arc ? 0.26 : 0.16,
        arc: p.arc, kind: p.def.ch, side: p.side,
        mul: k === 0 ? 1 : 0.75
      });
      hit(b, p, e, p.dmg * (k === 0 ? 1 : 0.75), isP);

      var extra = [], n;
      if (p.pierce) extra = extra.concat(pierceTargets(b, p, e));
      if (p.splash) extra = extra.concat(splashTargets(b, p, e));
      for (n = 0; n < extra.length; n++) {
        var tbl = p.splash ? (CFG.splashMul || [1, 0.5, 0.28]) : (CFG.pierceMul || [1, 0.6, 0.38]);
        var mul = tbl[Math.min(extra[n].d, tbl.length - 1)] || 0.25;
        hit(b, p, extra[n].u, p.dmg * mul * (k === 0 ? 1 : 0.75), isP);
      }
    }
  }

  function hit(b, p, e, dmg, isP, depth) {
    if (!e.alive) return;
    if (depth === undefined) depth = 0;
    hurt(b, e, dmg, false, p);
    if (p.burn > 0) { e.burnDps = Math.max(e.burnDps, dmg * p.burn); e.burnUntil = Math.max(e.burnUntil, b.t + 2.5); }
    if (p.slow > 0) { e.slowMul = p.slow; e.slowUntil = Math.max(e.slowUntil, b.t + 2.5); }
    if (p.poison > 0) { e.burnDps = Math.max(e.burnDps, dmg * p.poison); e.burnUntil = Math.max(e.burnUntil, b.t + 2.5); }
    if (p.ench) {
      if (p.ench.burn) { e.burnDps = Math.max(e.burnDps, dmg * p.ench.burn); e.burnUntil = Math.max(e.burnUntil, b.t + 2.5); }
      if (p.ench.slow) { e.slowMul = p.ench.slow; e.slowUntil = Math.max(e.slowUntil, b.t + 2.5); }
      if (p.ench.chain && b.rng() < p.ench.chain) {
        var near = alliesAround(b, e, 1.6);
        if (near.length) hurt(b, near[0], dmg * 0.5, false, p);
      }
    }
    if (isP) b.stats.dmgP += dmg; else b.stats.dmgO += dmg;
    if (b.floats.length < 24) b.floats.push({ x: e.x, y: e.y, v: Math.round(dmg), life: 0.55 });
    b.stats.hits = (b.stats.hits || 0) + 1;
    emit(b, 'hit', { src: p, tgt: e, dmg: dmg, side: p.side, depth: depth });
  }

  function alliesAround(b, e, radius) {
    var list = e.side === 'p' ? b.p : b.e;
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (!a.alive || a === e || a.structure) continue;
      if (Math.abs(e.r - a.r) <= radius) out.push(a);
    }
    return out;
  }

  function hurt(b, t, dmg, dot, from) {
    if (!t.alive) return;
    var real = dmg * (1 - (t.armor || 0));
    if (t.shield > 0) {
      var ab = Math.min(t.shield, real);
      t.shield -= ab;
      real -= ab;
    }
    t.hp -= real;
    if (t.canUlt && !t.ultReady) t.ultT = Math.min(1, t.ultT + dmg * 0.0004);
    if (!dot) t.hitT = 1;
    if (t.hp <= 0) {
      t.hp = 0;
      t.alive = false;
      if (t.side === 'p') b.stats.killsO++; else b.stats.killsP++;
      b.events.push({ type: 'kill', x: t.x, y: t.y, ch: t.def.ch, side: t.side });
      if (from && from.goldOnKill && b.stats.gold < 15) b.stats.gold += from.goldOnKill;
      rebuildHooks(b);
    }
  }

  function cast(b, p, u, tag) {
    if (!p.alive) return;
    var i, a, e;
    function done(kind) { b.events.push({ type: tag, x: p.x, y: p.y, kind: kind, n: u.name }); }

    if (u.kind === 'gold') { b.stats.gold += u.v; done('gold'); return; }
    if (u.kind === 'heal') {
      for (i = 0; i < b.p.length; i++) {
        a = b.p[i]; if (!a.alive) continue;
        a.hp = Math.min(a.maxHp, a.hp + a.maxHp * u.v); a.healT = 1;
      }
      done('heal'); return;
    }
    if (u.kind === 'shield') {
      for (i = 0; i < b.p.length; i++) {
        a = b.p[i]; if (!a.alive) continue;
        a.shield = Math.min(a.maxHp * 0.8, a.shield + a.maxHp * u.v);
      }
      done('shield'); return;
    }
    if (u.kind === 'haste') {
      for (i = 0; i < b.p.length; i++) {
        a = b.p[i]; if (!a.alive) continue;
        a.hasteUntil = b.t + u.dur;
      }
      done('haste'); return;
    }
    if (u.kind === 'slow') {
      for (i = 0; i < b.e.length; i++) {
        e = b.e[i]; if (!e.alive || e.structure) continue;
        e.slowMul = u.v; e.slowUntil = b.t + u.dur;
      }
      done('slow'); return;
    }
    var list = [];
    var foe = p.side === 'p' ? b.e : b.p;
    for (i = 0; i < foe.length; i++) {
      e = foe[i];
      if (!e.alive || e.structure) continue;
      if (u.kind !== 'rear' && Math.abs(p.r - e.r) > p.range) continue;
      list.push(e);
    }
    list.sort(function (x, y) { return u.kind === 'rear' ? x.r - y.r : y.r - x.r; });
    var n = u.n || list.length;
    for (i = 0; i < list.length && i < n; i++) {
      e = list[i];
      b.shots.push({ x1: p.x, y1: p.y, x2: e.x, y2: e.y, t: 0, dur: 0.24, arc: true, kind: p.def.ch, side: p.side, mul: 1 });
      hit(b, p, e, p.dmg * u.v * 0.5, p.side === 'p');
      if (u.stun) e.stunned = Math.max(e.stunned || 0, u.stun);
      if (u.burn) { e.burnDps = Math.max(e.burnDps, p.dmg * 0.35); e.burnUntil = Math.max(e.burnUntil, b.t + 3); }
    }
    done('dmg');
  }

  function useUlt(b, piece) {
    if (b.status !== 'run' || !piece) return false;
    var p = null;
    for (var i = 0; i < b.p.length; i++) if (b.p[i].id === piece.id) p = b.p[i];
    if (!p || !p.alive || !p.canUlt || !p.ultReady) return false;
    p.ultReady = false; p.ultT = 0;
    cast(b, p, p.ultDef, 'ult');
    return true;
  }

  GB.Battle = {
    create: create,
    step: step,
    auraValue: auraValue,
    emit: emit,
    rebuildHooks: rebuildHooks,
    trace: function (b) { return b ? b.trace.slice(-6) : []; },
    useUlt: useUlt,
    sumHp: sumHp,
    aliveCount: aliveCount,
    unitsLeft: unitsLeft,
    center: function (p) { return { x: p.x, y: p.y }; }
  };
}(typeof window !== 'undefined' ? window : globalThis));
