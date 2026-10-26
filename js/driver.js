/* driver.js — 给无头浏览器 / AI 用的操作接口
   用法（页面里）：
     DRIVER.state()            → 结构化状态（与 UI 无关）
     DRIVER.actions()          → 当前可执行动作数组 [{name, args, label}]
     DRIVER.do(name, args)     → 执行；返回 {ok, msg}
   典型循环：state → 决策 → do → 截图，见 tools/play.mjs */
(function (root) {
  'use strict';
  var W = root;

  function GB() { return W.GB; }
  function run() { var g = GB(); return g && g.UI && g.UI.getRun ? g.UI.getRun() : null; }
  function def(k) { var g = GB(); return g && g.D ? g.D.pieceById(k) : null; }
  function D() { return GB().D; }

  function pieceBrief(p) {
    var d = def(p.k) || {};
    return {
      id: p.id, k: p.k, ch: d.ch || '?', name: d.name || p.k,
      size: d.size || 1, role: d.role || '', level: p.level || 1,
      evos: (p.evos || (p.evo ? [p.evo] : [])).slice(),
      ench: p.ench || null,
      cells: (p.cells || []).map(function (c) { return [c.c, c.r]; })
    };
  }

  function state() {
    var g = GB(), r = run();
    if (!g || !r) return { ready: false };
    var ui = W.__ui || {};
    var offers = (r.offers || []).map(function (o) {
      var d = o.type === 'piece' ? def(o.k) : null;
      return {
        id: o.id, type: o.type, price: o.price, sold: !!o.sold,
        k: o.k || null, ch: d ? d.ch : null, name: d ? d.name : (o.type === 'skill' ? '兵书' : '附魔'),
        tier: o.tier || null
      };
    });
    var st = {
      ready: true,
      day: r.day, phase: r.phase, gold: r.gold, prestige: r.prestige,
      wins: r.wins, losses: r.losses, faction: r.faction,
      cells: { used: g.Run.cellsUsed(r), n: g.Run.cellsN(r), max: g.Run.cellsMax ? g.Run.cellsMax() : null },
      bench: r.bench.filter(Boolean).map(pieceBrief),
      board: g.Run.boardPieces(r).map(pieceBrief),
      offers: offers,
      books: (r.skills || []).map(function (b) {
        var d = g.D.skillById ? g.D.skillById(b.id) : null;
        return { id: b.id, name: d ? d.name : b.id, tier: b.tier || 1 };
      }),
      bookOffer: (r.bookOffer || []).map(function (id) {
        var d = g.D.skillById ? g.D.skillById(id) : null;
        return { id: id, name: d ? d.name : id, tier: d ? d.tier : 1, desc: d ? d.desc : '' };
      }),
      modal: ui.modal ? { kind: ui.modal.kind, title: ui.modal.title || '' } : null,
      battle: null
    };
    // 流派二选一
    var pend = g.Run.pendingEvo ? g.Run.pendingEvo(r) : null;
    st.evoOffer = pend ? {
      pieceId: pend.id, name: (def(pend.k) || {}).name,
      options: (g.Run.evoChoices ? g.Run.evoChoices(pend) : []).map(function (o) {
        return { id: o.id, name: o.name, desc: o.desc };
      })
    } : null;
    // 对手
    if (r.opp) {
      st.opp = {
        name: r.opp.name, faction: r.opp.faction, cellsN: r.opp.cellsN,
        books: (r.opp.books || []).length,
        pieces: (r.opp.pieces || []).map(function (p) {
          var d = def(p.k) || {};
          return { k: p.k, name: d.name, size: d.size, level: p.level || 1, cells: (p.cells || []).length };
        })
      };
    }
    // 战斗内
    if (r.phase === 'battle' && g.UI.getBattle) {
      var b = g.UI.getBattle();
      if (b) {
        st.battle = {
          t: +b.t.toFixed(1), status: b.status,
          hpP: Math.round((b.stats && b.stats.hpP) || 0), hpO: Math.round((b.stats && b.stats.hpO) || 0),
          aliveP: b.p.filter(function (x) { return x.alive; }).length,
          aliveO: b.e.filter(function (x) { return x.alive; }).length,
          events: b.stats.ev || {}
        };
      }
    }
    return st;
  }

  function actions() {
    var g = GB(), r = run();
    if (!g || !r) return [];
    var out = [];
    var cells = g.MAP.playerCells().filter(function (c) { return g.Run.isOwned(r, c.c, c.r); });

    // 商店
    (r.offers || []).forEach(function (o) {
      if (o.sold || r.gold < o.price) return;
      out.push({ name: 'buy', args: { offerId: o.id }, label: '买 ' + (o.k || o.type) + '（' + o.price + '金）' });
    });
    if (r.gold >= (g.D.CFG ? g.D.CFG.rerollCost : 2)) out.push({ name: 'reroll', args: {}, label: '刷新商店' });

    // 扩建
    g.MAP.playerCells().forEach(function (c) {
      if (g.Run.canUnlock(r, c.c, c.r)) {
        out.push({ name: 'expand', args: { c: c.c, r: c.r }, label: '扩建 (' + c.c + ',' + c.r + ') ' + g.Run.nextCellPrice(r) + '金' });
      }
    });

    // 落子：备战席棋子 × 已解锁空格（只列空格，减少噪音）
    var occupied = {};
    g.Run.boardPieces(r).forEach(function (p) {
      (p.cells || []).forEach(function (c) { occupied[g.MAP.key(c.c, c.r)] = 1; });
    });
    var free = cells.filter(function (c) { return !occupied[g.MAP.key(c.c, c.r)]; });
    r.bench.filter(Boolean).forEach(function (p) {
      free.forEach(function (c) {
        out.push({ name: 'place', args: { pieceId: p.id, c: c.c, r: c.r }, label: '上阵 ' + p.k + ' → (' + c.c + ',' + c.r + ')' });
      });
    });

    // 合成
    var all = g.Run.allPieces(r);
    for (var i = 0; i < all.length; i++) {
      for (var j = i + 1; j < all.length; j++) {
        if (g.Run.canMerge(all[i], all[j])) {
          out.push({ name: 'merge', args: { a: all[i].id, b: all[j].id }, label: '合成 ' + all[i].k + ' Lv' + (all[i].level || 1) });
        }
      }
    }

    // 兵书 / 流派
    (r.bookOffer || []).forEach(function (id) {
      out.push({ name: 'chooseBook', args: { id: id }, label: '选兵书 ' + id });
    });
    if (r._pendEvoId) {
      out.push({ name: 'chooseEvo', args: { id: r._pendEvoId }, label: '选流派 ' + r._pendEvoId });
    }
    var pend = g.Run.pendingEvo ? g.Run.pendingEvo(r) : null;
    if (pend) {
      (g.Run.evoChoices ? g.Run.evoChoices(pend) : []).forEach(function (o) {
        out.push({ name: 'chooseEvo', args: { id: o.id }, label: '流派 ' + o.name });
      });
    }

    // 开战
    if (r.phase === 'shop' && g.Game && g.Game.startBattle) {
      out.push({ name: 'battle', args: {}, label: '出战' });
    }
    if (r.phase === 'battle' && g.UI && g.UI.getBattle) {
      out.push({ name: 'speed', args: {}, label: '加速' });
      out.push({ name: 'waitBattle', args: {}, label: '等战斗结束' });
    }
    return out;
  }

  function findPiece(id) {
    var r = run();
    var all = GB().Run.allPieces(r);
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }

  function doAction(name, args) {
    var g = GB(), r = run();
    args = args || {};
    if (!g || !r) return { ok: false, msg: 'not ready' };
    var res = { ok: false, msg: '' };
    try {
      if (name === 'buy') {
        var offer = (r.offers || []).filter(function (o) { return o.id === args.offerId; })[0];
        if (!offer) return { ok: false, msg: '没有这个商品' };
        var b = g.Shop.buy(r, offer);
        res = { ok: !!(b && b.ok), msg: b && b.ok ? '买到 ' + (offer.k || offer.type) : '买不了（钱/格子不够）' };
      } else if (name === 'reroll') {
        res = g.Shop.reroll(r) ? { ok: true, msg: '已刷新' } : { ok: false, msg: '钱不够' };
      } else if (name === 'expand') {
        var e = g.Run.unlockCell(r, args.c, args.r);
        res = e ? { ok: true, msg: '扩建成功' } : { ok: false, msg: '扩建不了' };
      } else if (name === 'place') {
        var p = findPiece(args.pieceId);
        if (!p) return { ok: false, msg: '找不到棋子' };
        res = g.Run.placeAt(r, p, args.c, args.r) ? { ok: true, msg: '上阵' } : { ok: false, msg: '放不下' };
      } else if (name === 'merge') {
        var a = findPiece(args.a), bb = findPiece(args.b);
        if (!a || !bb) return { ok: false, msg: '找不到棋子' };
        res = g.Run.mergeInto(r, a, bb) ? { ok: true, msg: '合成成功' } : { ok: false, msg: '合不了' };
      } else if (name === 'sell') {
        var sp = findPiece(args.pieceId);
        if (!sp || !g.Run.sellPiece) return { ok: false, msg: '卖不了' };
        res = g.Run.sellPiece(r, sp) ? { ok: true, msg: '卖掉' } : { ok: false, msg: '卖不了' };
      } else if (name === 'chooseBook') {
        var sk = g.D.skillById ? g.D.skillById(args.id) : null;
        res = g.Run.chooseBook(r, args.id, Math.min(g.Run.skillTierMax(r), (sk && sk.tier) || 1))
          ? { ok: true, msg: '得兵书' } : { ok: false, msg: '拿不了' };
      } else if (name === 'chooseEvo') {
        var pend = g.Run.pendingEvo(r);
        res = (pend && g.Run.chooseEvo(r, pend, args.id)) ? { ok: true, msg: '流派已选' } : { ok: false, msg: '选不了' };
      } else if (name === 'battle') {
        g.Game.startBattle();
        res = { ok: true, msg: '开战' };
      } else if (name === 'speed') {
        if (g.Game.cycleSpeed) g.Game.cycleSpeed();
        res = { ok: true, msg: '加速' };
      } else if (name === 'closeModal') {
        if (g.UI.closeModal) g.UI.closeModal();
        res = { ok: true, msg: '关闭弹窗' };
      } else {
        return { ok: false, msg: '未知动作 ' + name };
      }
    } catch (err) {
      return { ok: false, msg: '出错: ' + err.message };
    }
    if (g.UI.refresh) g.UI.refresh();
    return res;
  }

  // 等战斗结束（给 play.mjs 用）
  function waitBattle(limitMs) {
    var g = GB(), r = run();
    var t0 = Date.now();
    return new Promise(function (resolve) {
      (function tick() {
        var rr = run();
        if (!rr || rr.phase !== 'battle') return resolve({ ok: true, msg: '战斗结束' });
        if (Date.now() - t0 > (limitMs || 70000)) return resolve({ ok: false, msg: '战斗超时' });
        setTimeout(tick, 200);
      })();
    });
  }

  W.DRIVER = {
    state: state,
    actions: actions,
    do: doAction,
    waitBattle: waitBattle,
    getRun: run
  };
}(typeof window !== 'undefined' ? window : globalThis));
