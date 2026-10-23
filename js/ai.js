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
        id: p.id, k: p.k, level: p.level || 1, evo: p.evo || null,
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

    // 胜负赏金：玩家赢一场拿 4 + ⌊day/2⌋ 金，对手按赢一半折算
    var bounty = Math.floor((4 + Math.floor(run.day / 2)) / 2);
    run.gold += bounty;

    // 兵书三选一
    if (run.bookOffer && run.bookOffer.length && !GB.Run.skillFull(run)) {
      var pick = run.bookOffer[Math.floor(rnd() * run.bookOffer.length)];
      var sk = D.skillById(pick);
      GB.Run.chooseBook(run, pick, Math.min(GB.Run.skillTierMax(run), (sk && sk.tier) || 1));
    }

    // 扩建：留 3 金买棋子，一回合最多铺两块
    for (i = 0; i < 2; i++) {
      var price = GB.Run.nextCellPrice(run);
      if (!price || run.gold < price + 3) break;
      var own = GB.Run.ownedSet(run);
      var spot = null, list = MAP.playerCells();
      for (j = 0; j < list.length; j++) {
        if (!own[MAP.key(list[j].c, list[j].r)] && GB.Run.canUnlock(run, list[j].c, list[j].r)) { spot = list[j]; break; }
      }
      if (!spot) break;
      GB.Run.unlockCell(run, spot.c, spot.r);
    }

    // 买棋子：优先补同名（好合成），否则买最贵的
    for (i = 0; i < 3; i++) {
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
      var opts = D.evoOptions(pend.k) || [];
      if (!opts.length) { pend.pendingEvo = false; break; }
      GB.Run.chooseEvo(run, pend, opts[Math.floor(rnd() * opts.length)].id);
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
