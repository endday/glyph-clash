/* ai.js — 幽灵对手：和玩家用同一套规则跑一遍（同经济、同格子、同商店、同合成）
   不再给免费属性、免费等级或超大棋盘：对手的强度来自它的「打法」，不是暗改数值。 */
(function (root) {
  'use strict';
  var GB = root.GB = root.GB || {};
  var D = GB.D, MAP = GB.MAP, U = GB.U;

  // 只用来取名字的阵营风味（没有任何数值作用）
  var NAMES = ['无名阵', '虎豹骑', '连弩营', '长枪阵', '药王谷', '火神庙',
               '三连射', '五虎将', '铁壁营', '双骑冲', '雷池', '空营计'];

  var simulating = 0;

  /* 把「我方半场」摆好的阵镜像到对面（8 行 → r' = 7 - r） */
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

  /* 对手的一回合：开书 → 领赏金 → 扩建 → 买子 → 合成 → 上阵（和玩家做的事一样） */
  function aiTurn(run, rnd) {
    var i, j;

    // 胜负赏金：玩家赢一场拿 4 + ⌊day/2⌋ 金。对手按「赢了」算——
    // 它代表的是一个打得不错的幽灵，不是「输一半」的幽灵
    run.gold += 4 + Math.floor(run.day / 2);

    // 水平档：前 3 天打得松（少买、留钱），第 4 天起收紧
    var tight = run.day >= 4;
    var buyCap = tight ? 4 : 2;
    var keepGold = tight ? 2 : 6;

    // 兵书三选一：按自己阵型挑一本（有脑子，但不作弊）
    if (run.bookOffer && run.bookOffer.length && !GB.Run.skillFull(run)) {
      var mine = GB.Run.boardPieces(run);
      var big = 0, lvl3 = 0, arc = 0, heal = 0, units = 0;
      for (var mi = 0; mi < mine.length; mi++) {
        var md = D.pieceById(mine[mi].k) || {};
        if (md.role === 'flag') continue;
        units++;
        if ((md.size || 1) >= 4) big++;
        if ((mine[mi].level || 1) >= 3) lvl3++;
        if (md.arc) arc++;
        if (md.heal) heal++;
      }
      function bookScore(id) {
        if (id === 'changqu') return big * 2;
        if (id === 'poshu') return lvl3 * 2;
        if (id === 'lianu') return arc * 2;
        if (id === 'miaoshou') return heal * 3;
        if (id === 'beishui') return units <= 4 ? 4 : 0;
        if (id === 'kongcheng') return Math.max(0, 10 - units);
        if (id === 'tiebi' || id === 'jifeng') return 2;
        if (id === 'tuntian' || id === 'cangbing') return 3;   // 经济类先拿
        return 1;
      }
      var bestId = run.bookOffer[0], bestScore = -1;
      for (var bi2 = 0; bi2 < run.bookOffer.length; bi2++) {
        var sc = bookScore(run.bookOffer[bi2]);
        if (sc > bestScore) { bestScore = sc; bestId = run.bookOffer[bi2]; }
      }
      var sk = D.skillById(bestId);
      GB.Run.chooseBook(run, bestId, Math.min(GB.Run.skillTierMax(run), (sk && sk.tier) || 1));
    }

    // 扩建：留 3 金买棋子，一回合最多铺两块
    for (i = 0; i < 2; i++) {
      var price = GB.Run.nextCellPrice(run);
      if (!price || run.gold < price + keepGold) break;
      var own = GB.Run.ownedSet(run);
      var spot = null, list = MAP.playerCells();
      for (j = 0; j < list.length; j++) {
        if (!own[MAP.key(list[j].c, list[j].r)] && GB.Run.canUnlock(run, list[j].c, list[j].r)) { spot = list[j]; break; }
      }
      if (!spot) break;
      GB.Run.unlockCell(run, spot.c, spot.r);
    }

    // 买棋子：优先补同名（好合成），否则买最贵的
    for (i = 0; i < buyCap; i++) {
      if (GB.Run.freeBenchSlot(run) < 0) break;
      var offers = (run.offers || []).filter(function (o) {
        return o.type === 'piece' && !o.sold && run.gold >= o.price + 3;
      });
      if (!offers.length) break;
      var owned = {};
      GB.Run.allPieces(run).forEach(function (p) { owned[p.k] = (owned[p.k] || 0) + 1; });
      var dup = offers.filter(function (o) { return owned[o.k]; });
      var pickOffer;
      if (dup.length && rnd() < 0.65) pickOffer = dup[0];
      else {
        offers.sort(function (a, z) {
          return (D.pieceById(z.k).price || 0) - (D.pieceById(a.k).price || 0);
        });
        pickOffer = offers[0];
      }
      var res = GB.Shop.buy(run, pickOffer);
      if (!res || !res.ok) break;
    }

    // 合成（能合就合）
    var merged = true, guard = 0;
    while (merged && guard++ < 30) {
      merged = false;
      var all = GB.Run.allPieces(run);
      outer: for (i = 0; i < all.length; i++) {
        for (j = i + 1; j < all.length; j++) {
          if (GB.Run.canMerge(all[i], all[j])) {
            GB.Run.mergeInto(run, all[i], all[j]);
            merged = true;
            break outer;
          }
        }
      }
    }
    // 进化也照选（随机，不挑）
    guard = 0;
    while (guard++ < 10) {
      var pend = GB.Run.pendingEvo(run);
      if (!pend) break;
      var opts = GB.Run.evoChoices ? GB.Run.evoChoices(pend) : (D.evoOptions(pend.k) || []);
      if (!opts.length) { pend.pendingEvo = false; break; }
      // 优先「加伤害/加攻速」的那一支，其次按表里顺序
      var score = { fast: 3, heavy: 2, rapid: 3, sunder: 2, blaze: 3, storm: 3,
                    pierce: 2, loud: 2, urgent: 3, long: 2, gale: 2, precise: 2, link: 2,
                    wall: 1, swift: 2, armor: 1, wide: 1, firstaid: 1, deep: 2, fork: 2 };
      var best = opts[0];
      for (var oi = 1; oi < opts.length; oi++) {
        if ((score[opts[oi].id] || 0) > (score[best.id] || 0)) best = opts[oi];
      }
      GB.Run.chooseEvo(run, pend, best.id);
    }

    // 上阵：按角色分行（近战在前、远程在后）
    run.bench.filter(Boolean).forEach(function (p) {
      var def = D.pieceById(p.k) || {};
      var rows = MAP.rowsFor('p', def.role);
      var cells = MAP.playerCells();
      var placed = false;
      for (var q = 0; q < rows.length && !placed; q++) {
        for (var k = 0; k < cells.length; k++) {
          if (cells[k].r !== rows[q]) continue;
          if (GB.Run.placeAt(run, p, cells[k].c, cells[k].r)) { placed = true; break; }
        }
      }
    });
  }

  /* 造对手：从第 1 天开始，用和玩家一样的规则打到第 day 天 */
  function makeOpponent(day, seed) {
    if (simulating) return null;      // 模拟自己时不要再造对手（防递归）
    simulating++;
    try {
      var rnd = U.mulberry32(((seed | 0) + day * 7919) >>> 0);
      var facIds = Object.keys(D.FACTIONS);
      var fac = facIds[Math.floor(rnd() * facIds.length)] || 'dongwu';

      var run = GB.Run.newRun((seed | 0) + day * 131, fac);
      run.opp = null;
      aiTurn(run, rnd);                       // 第 1 天
      for (var d = 1; d < day; d++) {
        run.day++;                            // 推进天数（解锁表、兵书位、货架都看它）
        GB.Run.startDay(run, false);          // 发收入、开兵书位、刷新货架
        aiTurn(run, rnd);
      }

      var pieces = mirror(GB.Run.boardPieces(run));
      var f = D.FACTIONS[fac];
      return {
        name: NAMES[(day + (seed | 0)) % NAMES.length],
        faction: fac,
        factionName: f ? f.name : '无名',
        pieces: pieces,
        books: (run.skills || []).slice(),
        cellsN: GB.Run.cellsN(run),
        mods: GB.Run.mods(run),               // 只带它自己买到的兵书效果
        power: pieces.reduce(function (a, x) {
          var def = D.pieceById(x.k);
          return a + (x.level || 1) * (def ? def.size : 1);
        }, 0)
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
    mirror: mirror
  };
}(typeof window !== 'undefined' ? window : globalThis));
