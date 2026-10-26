/* ai.js — 幽灵对手：和玩家同一套规则跑一局，但每一步都做「搜索出来的最优解」
   决策顺序：开书 → 扩建 → 买子 → 合成 → 选流派 → 摆位，全部由 evalBoard() 打分决定。
   不做的事：不给免费属性、不给免费等级、不给更大的棋盘。 */
(function (root) {
  'use strict';
  var GB = root.GB = root.GB || {};
  var D = GB.D, MAP = GB.MAP, U = GB.U;

  var NAMES = ['无名阵', '虎豹骑', '连弩营', '长枪阵', '药王谷', '火神庙',
               '三连射', '五虎将', '铁壁营', '双骑冲', '雷池', '空营计'];

  var simulating = 0;
  var HP_SCALE = 1.6;

  /* ---------------- 棋子价值 ---------------- */
  function stats(def, level, run) {
    var m = GB.Run.mods(run);
    var lv = level || 1;
    var hp = (def.hp || 0) * lv * HP_SCALE * (1 + (m.hp || 0));
    var dps = def.dmg ? (def.dmg * lv * (1 + (m.dmgMul || 0))) / (def.atk || 1.5) : 0;
    if (def.splash) dps *= 1.55;
    if (def.pierce) dps *= 1.30;
    if (def.arc) dps *= 1.10;
    var heal = def.heal ? (def.heal * lv) / (def.atk || 1.5) : 0;
    var shield = (def.shield || 0) * lv;
    return { hp: hp, dps: dps, heal: heal, shield: shield, size: def.size || 1 };
  }

  function adjacent(a, b) {
    if (!a.cells || !b.cells || !a.cells.length || !b.cells.length) return false;
    for (var i = 0; i < a.cells.length; i++) {
      var nb = MAP.neighbors(a.cells[i].c, a.cells[i].r);
      for (var j = 0; j < b.cells.length; j++) {
        for (var k = 0; k < nb.length; k++) {
          if (nb[k].c === b.cells[j].c && nb[k].r === b.cells[j].r) return true;
        }
      }
    }
    return false;
  }

  /* ---------------- 阵容强度分 ---------------- */
  function evalBoard(run, board) {
    var i, j;
    var units = [], hitRate = 0, teamHp = 0, big = 0, lvl3 = 0;
    for (i = 0; i < board.length; i++) {
      var p = board[i];
      var def = D.pieceById(p.k);
      if (!def) continue;
      var st = stats(def, p.level, run);
      units.push({ p: p, def: def, st: st });
      if (def.role !== 'flag' && def.role !== 'shard') {
        teamHp += st.hp;
        if ((def.size || 1) >= 4) big++;
        if ((p.level || 1) >= 3) lvl3++;
      }
    }
    for (i = 0; i < units.length; i++) {
      if (units[i].def.dmg) hitRate += (units[i].p.level || 1) / (units[i].def.atk || 1.5);
    }

    var total = 0;
    for (i = 0; i < units.length; i++) {
      var a = units[i], def2 = a.def, st2 = a.st;
      var v = st2.hp * 0.5 + st2.dps * 9 + st2.heal * 26 + st2.shield * 2.2;
      var mult = 1;

      if (def2.role === 'flag' || def2.role === 'shard') {
        // 引擎：必须贴着「能打的人」才值钱
        var near = 0;
        for (j = 0; j < units.length; j++) {
          if (units[j] === a || units[j].def.role === 'flag') continue;
          if (a.p.cells && a.p.cells.length && adjacent(a.p, units[j].p)) near += units[j].st.dps;
        }
        var kind = def2.on ? Object.keys(def2.on)[0] : '';
        if (def2.aura) mult = 0.5 + Math.min(2.0, near / 260);
        else if (kind === 'burn_tick') mult = 0.4 + Math.min(2.2, near / 220);
        else if (kind === 'hit') mult = 0.8 + Math.min(1.8, hitRate * 0.35);
        else if (kind === 'trigger') mult = 0.8 + Math.min(1.6, hitRate * 0.30);
        else mult = 0.6 + Math.min(1.6, near / 260);
        v = 260 * mult;
      } else if (def2.heal) {
        v = st2.hp * 0.5 + st2.heal * 26 * (1 + Math.min(1.5, teamHp / 4000));
      }
      // 承伤反击：把「挨打」变成伤害，血越厚越值钱
      if (def2.on && def2.on.hurt) {
        v += st2.hp * 0.22 + Math.max(st2.dps, 120) * 3.5;
        if (def2.tags && def2.tags.indexOf('shield') >= 0) v += 300;
      }
      total += v * mult;
    }

    var has = function (id) { return GB.Run.hasSkill(run, id); };
    if (has('changqu')) total *= 1 + 0.06 * big;
    if (has('poshu')) total *= 1 + 0.08 * lvl3;
    if (has('beishui') && units.length <= 4) total *= 1.20;
    if (has('tiebi')) total *= 1.06;
    if (has('jifeng')) total *= 1 + Math.min(0.25, hitRate * 0.05);
    if (has('lianu')) total *= 1.08;
    // 标签类兵书：数一数场上带这个标签的棋子
    var tagCount = function (tag) {
      var n = 0;
      for (var ti = 0; ti < board.length; ti++) {
        var td = D.pieceById(board[ti].k);
        if (td && td.tags && td.tags.indexOf(tag) >= 0) n++;
      }
      return n;
    };
    if (has('qixie')) total *= 1 + 0.08 * tagCount('machine');
    if (has('tongpao')) total *= 1 + 0.05 * tagCount('flag');
    if (has('xuezhai')) total *= 1 + 0.05 * tagCount('melee');
    return total;
  }

  /* ---------------- 摆位搜索：逐颗试所有位置，取全队分最高的 ---------------- */
  function bestLayout(run, pieces) {
    var cells = MAP.playerCells();
    var owned = GB.Run.ownedSet(run);          // 只能摆在已解锁的格子上
    var occ = {}, placed = [], order = pieces.slice();
    order.sort(function (a, b) {
      var da = D.pieceById(a.k), db = D.pieceById(b.k);
      return ((db ? db.size : 1) - (da ? da.size : 1)) || ((db ? db.price : 0) - (da ? da.price : 0));
    });
    for (var i = 0; i < order.length; i++) {
      var p = order[i], def = D.pieceById(p.k);
      if (!def) continue;
      var rows = MAP.rowsFor('p', def.role);
      var best = null, bestScore = -1;
      for (var ri = 0; ri < rows.length; ri++) {
        for (var ci = 0; ci < cells.length; ci++) {
          var c = cells[ci];
          if (c.r !== rows[ri]) continue;
          var res = MAP.findPlacement(occ, c.c, c.r, def.size, 'p', owned);
          if (!res) continue;
          var cand = placed.concat([{ k: p.k, level: p.level, cells: res.cells }]);
          var sc = evalBoard(run, cand);
          if (sc > bestScore) { bestScore = sc; best = res.cells; }
        }
      }
      if (best) {
        for (var bi = 0; bi < best.length; bi++) occ[MAP.key(best[bi].c, best[bi].r)] = true;
        placed.push({ k: p.k, level: p.level, cells: best });
      }
    }
    return placed;
  }

  /* 把搜索出来的摆位落到 run 上 */
  function applyLayout(run, layout) {
    // 只清占位、不删棋子：清空 run.board，再按搜索出来的布局逐个 placeAt
    var all = GB.Run.allPieces(run);
    run.board = {};
    for (var i = 0; i < all.length; i++) all[i].cells = [];
    var used = {};
    for (var L = 0; L < layout.length; L++) {
      var want = layout[L], pick = null;
      for (i = 0; i < all.length; i++) {
        var ap = all[i];
        if (used[ap.id]) continue;
        if (ap.k === want.k && (ap.level || 1) === (want.level || 1)) { pick = ap; break; }
      }
      if (!pick) continue;
      used[pick.id] = 1;
      GB.Run.placeAt(run, pick, want.cells[0].c, want.cells[0].r);
    }
  }

  function bookMult(id, run) {
    var pieces = GB.Run.allPieces(run);
    var units = 0, big = 0, lvl3 = 0, arc = 0, heal = 0;
    for (var i = 0; i < pieces.length; i++) {
      var def = D.pieceById(pieces[i].k) || {};
      if (def.role === 'flag') continue;
      units++;
      if ((def.size || 1) >= 4) big++;
      if ((pieces[i].level || 1) >= 3) lvl3++;
      if (def.arc) arc++;
      if (def.heal) heal++;
    }
    if (id === 'changqu') return 1 + 0.12 * big;
    if (id === 'poshu') return 1 + 0.16 * lvl3;
    if (id === 'beishui') return units <= 4 ? 1.40 : 1.0;
    if (id === 'kongcheng') return 1 + 0.08 * Math.min(6, Math.max(0, GB.Run.cellsN(run) - GB.Run.cellsUsed(run)));
    if (id === 'tiebi') return 1.22;
    if (id === 'zuofeng') return 1.18;
    if (id === 'lianu') return 1 + 0.12 * Math.min(3, arc);
    if (id === 'jifeng') return 1.15;
    if (id === 'liaoyuan') return 1.12;
    if (id === 'miaoshou') return heal ? 1.25 : 1.02;
    if (id === 'jiejian') return 1.20;
    if (id === 'tuntian') return 1.10;
    if (id === 'cangbing') return 1.12;
    if (id === 'tianji') return 1.14;
    if (id === 'caochuan') return 1.16;
    if (id === 'wenjiu') return 1.04;
    return 1.05;
  }

  /* ---------------- 一回合：全部走搜索 ---------------- */
  function aiTurn(run, rnd) {
    var i, j;

    // 1) 兵书：把每本的效果折成系数，取增益最大的
    if (run.bookOffer && run.bookOffer.length && !GB.Run.skillFull(run)) {
      var base = evalBoard(run, bestLayout(run, GB.Run.allPieces(run)));
      var bestBook = null, bestGain = -1;
      for (i = 0; i < run.bookOffer.length; i++) {
        var gain = base * bookMult(run.bookOffer[i], run) - base;
        if (gain > bestGain) { bestGain = gain; bestBook = run.bookOffer[i]; }
      }
      if (bestBook) {
        var sk2 = D.skillById(bestBook);
        GB.Run.chooseBook(run, bestBook, Math.min(GB.Run.skillTierMax(run), (sk2 && sk2.tier) || 1));
      }
    }

    // 2) 赏金（按「赢了」算：它代表一个打得不错的幽灵）
    run.gold += 4 + Math.floor(run.day / 2);

    // 3) 扩建：摆不下或格子快满才铺，留 2 金买子
    for (i = 0; i < 2; i++) {
      var price = GB.Run.nextCellPrice(run);
      if (!price || run.gold < price + 8) break;
      // 只有「棋盘快满了」才铺格子——别把买棋子的钱全花在扩建上
      var used = GB.Run.cellsUsed(run), cap = GB.Run.cellsN(run);
      if (!(used >= cap - 1)) break;
      var own = GB.Run.ownedSet(run), spot = null, list = MAP.playerCells();
      for (j = 0; j < list.length; j++) {
        if (!own[MAP.key(list[j].c, list[j].r)] && GB.Run.canUnlock(run, list[j].c, list[j].r)) { spot = list[j]; break; }
      }
      if (!spot) break;
      GB.Run.unlockCell(run, spot.c, spot.r);
    }

    // 3.5) 凑合成：手里有同名同级的棋子、货架却没有第二颗 → 花 2 金刷新（最多两次）
    for (var rr = 0; rr < 2; rr++) {
      var have = GB.Run.allPieces(run);
      var offerKeys = {};
      (run.offers || []).forEach(function (o) {
        if (!o.sold && o.type === 'piece') offerKeys[o.k] = 1;
      });
      var pairOnShelf = false;
      for (var hi = 0; hi < have.length; hi++) {
        if (offerKeys[have[hi].k]) { pairOnShelf = true; break; }
      }
      if (pairOnShelf) break;
      if (run.gold < 8) break;
      if (!GB.Shop.reroll(run)) break;
    }

    // 4) 买子：逐个试「买下并重新摆位」的增益，按性价比买
    var guard = 0;
    while (guard++ < 6) {
      if (GB.Run.freeBenchSlot(run) < 0) break;
      var cur = GB.Run.allPieces(run);
      var curScore = evalBoard(run, bestLayout(run, cur));
      var offers = (run.offers || []).filter(function (o) {
        return o.type === 'piece' && !o.sold && run.gold >= o.price;
      });
      if (!offers.length) break;
      var bestOffer = null, bestValue = 0;
      for (i = 0; i < offers.length; i++) {
        if (!D.pieceById(offers[i].k)) continue;
        var cand = cur.concat([{ k: offers[i].k, level: 1, cells: [] }]);
        var gain2 = evalBoard(run, cand) - curScore;
        // 凑合成：手里有同名同级的，买到手就能合 → 额外加一档价值
        for (var dq = 0; dq < cur.length; dq++) {
          if (cur[dq].k === offers[i].k && (cur[dq].level || 1) === 1) { gain2 += 1600; break; }
        }
        var value = gain2 / Math.max(1, offers[i].price);
        if (gain2 > 0 && value > bestValue) { bestValue = value; bestOffer = offers[i]; }
      }
      if (!bestOffer) break;
      if (!GB.Shop.buy(run, bestOffer).ok) break;
    }

    // 5) 合成：只在「合完更强」时合
    var merged = true, mg = 0;
    while (merged && mg++ < 30) {
      merged = false;
      var all = GB.Run.allPieces(run);
      var boardNow = GB.Run.allPieces(run);
      var baseScore = evalBoard(run, bestLayout(run, boardNow));
      for (i = 0; i < all.length && !merged; i++) {
        for (j = i + 1; j < all.length; j++) {
          if (!GB.Run.canMerge(all[i], all[j])) continue;
          var after = boardNow.filter(function (x) { return x !== all[j]; }).map(function (x) {
            return x === all[i]
              ? { k: x.k, level: (x.level || 1) + 1, cells: [] }
              : { k: x.k, level: x.level, cells: [] };
          });
          if (evalBoard(run, after) >= baseScore * 0.92) { GB.Run.mergeInto(run, all[i], all[j]); merged = true; }
          break;
        }
      }
    }

    // 6) 流派：选让阵容分最高的那一支
    guard = 0;
    while (guard++ < 10) {
      var pend = GB.Run.pendingEvo(run);
      if (!pend) break;
      var opts = GB.Run.evoChoices ? GB.Run.evoChoices(pend) : [];
      if (!opts.length) { pend.pendingEvo = false; break; }
      var bestOpt = opts[0], bestSc = -1;
      for (i = 0; i < opts.length; i++) {
        var saved = pend.evos ? pend.evos.slice() : [];
        pend.evos = saved.concat([opts[i].id]);
        var sc3 = evalBoard(run, bestLayout(run, GB.Run.allPieces(run)));
        pend.evos = saved;
        if (sc3 > bestSc) { bestSc = sc3; bestOpt = opts[i]; }
      }
      GB.Run.chooseEvo(run, pend, bestOpt.id);
    }

    // 7) 摆位
    applyLayout(run, bestLayout(run, GB.Run.allPieces(run)));
  }

  /* ---------------- 镜像到对面 ---------------- */
  function mirror(pieces) {
    return pieces.map(function (p) {
      var out = {
        id: p.id, k: p.k, level: p.level || 1,
        evo: p.evo || null, evos: (p.evos || (p.evo ? [p.evo] : [])).slice(0, 2),
        ench: p.ench || null, heroId: p.heroId || null,
        multicast: p.multicast || 0, cells: []
      };
      for (var i = 0; i < p.cells.length; i++) {
        var c = p.cells[i];
        out.cells.push(MAP.cell(c.c, MAP.ROWS - 1 - c.r));
      }
      return out;
    });
  }

  /* ---------------- 造对手 ---------------- */
  function makeOpponent(day, seed) {
    if (simulating) return null;
    simulating++;
    try {
      var rnd = U.mulberry32(((seed | 0) + day * 7919) >>> 0);
      var facIds = Object.keys(D.FACTIONS);
      var fac = facIds[Math.floor(rnd() * facIds.length)] || 'dongwu';

      var run = GB.Run.newRun((seed | 0) + day * 131, fac);
      run.opp = null;
      aiTurn(run, rnd);
      for (var d = 1; d < day; d++) {
        run.day++;
        GB.Run.startDay(run, false);
        run.opp = null;
        aiTurn(run, rnd);
      }

      var pieces = mirror(GB.Run.boardPieces(run));   // 只镜像上阵的（备战席没有格子）
      var f = D.FACTIONS[fac];
      return {
        name: NAMES[(day + (seed | 0)) % NAMES.length],
        faction: fac,
        factionName: f ? f.name : '无名',
        pieces: pieces,
        books: (run.skills || []).slice(),
        cellsN: GB.Run.cellsN(run),
        mods: GB.Run.mods(run),
        power: Math.round(evalBoard(run, GB.Run.boardPieces(run)))
      };
    } finally {
      simulating--;
    }
  }

  function gridFrom(pieces) {
    var g = {};
    for (var i = 0; i < pieces.length; i++) {
      for (var j = 0; j < pieces[i].cells.length; j++) {
        g[MAP.key(pieces[i].cells[j].c, pieces[i].cells[j].r)] = pieces[i];
      }
    }
    return g;
  }

  GB.AI = {
    makeOpponent: makeOpponent,
    gridFrom: gridFrom,
    mirror: mirror,
    evalBoard: evalBoard,
    bestLayout: bestLayout
  };
}(typeof window !== 'undefined' ? window : globalThis));
