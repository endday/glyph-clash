/* run.js — 一局的状态：天数、金币、声望、棋盘、备战席、兵书 */
(function (root) {
  'use strict';
  var GB = root.GB = root.GB || {};
  var D = GB.D, MAP = GB.MAP, U = GB.U, CFG = D.CFG;

  var seq = 1;

  function newPiece(k, opts) {
    opts = opts || {};
    var def = D.pieceById(k);
    return {
      id: 'p' + (seq++),
      k: k,
      def: def,
      level: opts.level || 1,
      cells: null,
      rot: 0,
      ench: opts.ench || null,
      heroId: opts.heroId || (def && def.heroId) || null,
      cd: 0
    };
  }

  function newRun(seed, factionId) {
    var run = {
      v: 3,
      seed: seed || Math.floor(Math.random() * 1e9),
      faction: factionId || 'dongwu',
      day: 1,
      phase: 'shop',
      prestige: CFG.prestigeMax,
      gold: CFG.startGold,
      wins: 0,
      losses: 0,
      board: {},
      bench: new Array(CFG.benchBase).fill(null),
      cellsOwned: null,   // 已解锁的格子 key（默认取解锁顺序的前 N 格）
      skills: [],
      bookOffer: null,
      offers: [],
      rerollCount: 0,
      log: [],
      opp: null,
      lastResult: null,
      counters: { merged: 0, bought: 0, best: 1 },
      lastIncome: null
    };

    var fac = D.FACTIONS[run.faction];
    (fac.start || ['dao', 'yi', 'flag_dmg']).forEach(function (k) {
      addToBench(run, newPiece(k));
    });
    startDay(run, true);
    pushLog(run, '开张 · ' + fac.name + '门下，' + fac.hero + '托付你二十点声望。');
    return run;
  }

  /* ---------------- 背包格（地图上直接解锁） ---------------- */
  function cellsMax() { return CFG.cellsMax || 9; }
  function initCells(run) {
    if (run.cellsOwned && run.cellsOwned.length) return run.cellsOwned;
    var start = Math.min(CFG.cellsStart || 4, cellsMax());
    var order = MAP.ownedOrder();
    run.cellsOwned = [];
    for (var i = 0; i < start && i < order.length; i++) run.cellsOwned.push(MAP.key(order[i].q, order[i].r));
    return run.cellsOwned;
  }
  function cellsN(run) { return initCells(run).length; }
  function ownedSet(run) {
    var list = initCells(run);
    if (run._ownLen === list.length && run._ownSet) return run._ownSet;
    var set = {};
    for (var i = 0; i < list.length; i++) set[list[i]] = true;
    run._ownLen = list.length;
    run._ownSet = set;
    return set;
  }
  function isOwned(run, c, r) {
    var cell = MAP.cell(c, r);
    return !!cell && !!ownedSet(run)[MAP.key(cell.q, r)];
  }
  // 下一格多少钱（已满返回 0）
  function nextCellPrice(run) {
    var bought = cellsN(run) - Math.min(CFG.cellsStart || 4, cellsMax());
    if (bought < 0) bought = 0;
    if (cellsN(run) >= cellsMax()) return 0;
    var tbl = CFG.expandPrices || [4, 7, 12, 20, 32];
    return tbl[Math.min(bought, tbl.length - 1)];
  }
  // 这格能不能解锁：没解锁 / 我方半场 / 挨着已有的格
  function canUnlock(run, c, r) {
    var cell = MAP.cell(c, r);
    if (!cell || cell.zone !== 'p') return false;
    if (isOwned(run, c, r)) return false;
    if (cellsN(run) >= cellsMax()) return false;
    var nb = MAP.neighbors(c, r);
    for (var i = 0; i < nb.length; i++) {
      if (isOwned(run, nb[i].c, nb[i].r)) return true;
    }
    return false;
  }
  function unlockCell(run, c, r) {
    if (!canUnlock(run, c, r)) return false;
    var price = nextCellPrice(run);
    if (run.gold < price) return { ok: false, why: 'gold', price: price };
    run.gold -= price;
    var cell = MAP.cell(c, r);
    initCells(run).push(MAP.key(cell.q, r));
    run._ownSet = null;
    pushLog(run, '扩建 · 花 ' + price + ' 金解锁一格（' + cellsN(run) + '/' + cellsMax() + '）。');
    return { ok: true, price: price, cells: cellsN(run) };
  }
  function cellsUsed(run) {
    var seen = {}, n = 0;
    for (var k in run.board) {
      if (!run.board.hasOwnProperty(k)) continue;
      var p = run.board[k];
      if (!p || seen[p.id]) continue;
      seen[p.id] = 1;
      n += (p.cells ? p.cells.length : 1);
    }
    return n;
  }

  /* ---------------- 备战席 ---------------- */
  // 战斗侧由 battle.js 读 booksP 自己算，这里不重复累加
  var BATTLE_KEYS = { atkMul: 1, spdMul: 1, armor: 1, healToShield: 1, rerollHit: 1, spreadAgain: 1 };

  function mods(run) {
    var key = run.faction + '|' + run.skills.map(function (s) { return s.id + ':' + (s.tier || 1); }).sort().join(',');
    if (run._mk === key && run._mv) return run._mv;
    var m = {
      dmgMul: 0, spd: 0, hp: 0, healBoost: 0, auraBoost: 0, arcSpd: 0, arcRange: 0,
      tankHp: 0, frontArmor: 0, pieceBurn: 0, killGold: 0, killCap: 99,
      income: 0, mergeGold: 0, bench: 0, shopSlot: 0, freeReroll: 0, shopDiscount: 0,
      goldPerBig: 0, mergeMulticast: 0,
      sellFull: false, alwaysUnit: false, rupture: 0, openingRush: 0, orders: 0
    };
    for (var i = 0; i < run.skills.length; i++) {
      var own = run.skills[i];
      var sk = D.skillById ? D.skillById(own.id) : D.SKILLS[own.id];
      if (!sk || !sk.give) continue;
      var tier = own.tier || sk.tier || 1;
      for (var k in sk.give) {
        if (!sk.give.hasOwnProperty(k)) continue;
        if (BATTLE_KEYS[k]) continue;
        var v = D.skillValue(sk.give[k], tier);
        if (k === 'sellFull' || k === 'alwaysUnit') m[k] = m[k] || !!v;
        else m[k] = (m[k] || 0) + v;
      }
    }
    var fac = D.FACTIONS[run.faction];
    if (fac) {
      if (fac.passive === 'burn') m.pieceBurn += 0.3;
      if (fac.passive === 'aura') m.auraBoost += 0.25;
      if (fac.passive === 'poison') m.pieceBurn += 0.2;
      if (fac.passive === 'gold') { m.income += 3; m.goldFac = true; }
      if (fac.passive === 'range') m.arcRange += 1;
    }
    run._mk = key; run._mv = m;
    return m;
  }

  /* ---------------- 兵书（遗物） ---------------- */
  function skillSlots(run) {
    var n = 0;
    for (var i = 0; i < CFG.skillSlots.length; i++) if (run.day >= CFG.skillSlots[i]) n++;
    return n;
  }
  function skillTierMax(run) {
    var t = 1;
    for (var i = 0; i < CFG.skillTierDay.length; i++) if (run.day >= CFG.skillTierDay[i]) t = i + 1;
    return t;
  }
  function skillPrice(tier) { return CFG.skillPrice[Math.max(0, Math.min(2, (tier || 1) - 1))]; }
  function hasSkill(run, id) {
    for (var i = 0; i < run.skills.length; i++) if (run.skills[i].id === id) return true;
    return false;
  }
  function skillFull(run) { return run.skills.length >= skillSlots(run); }
  // 三选一：从当天开放的档位里抽 3 条没拿过的
  function rollBooks(run, seed) {
    if (skillFull(run)) return [];
    var tmax = skillTierMax(run);
    var rnd = U.mulberry32(((seed || run.seed) + run.day * 3301) >>> 0);
    var pool = [];
    for (var id in D.SKILLS) {
      if (!D.SKILLS.hasOwnProperty(id)) continue;
      var sk = D.SKILLS[id];
      if (sk.tier > tmax || hasSkill(run, id)) continue;
      pool.push(id);
    }
    var out = [];
    while (out.length < 3 && pool.length) {
      var k = Math.floor(rnd() * pool.length);
      out.push(pool[k]);
      pool.splice(k, 1);
    }
    return out;
  }
  function chooseBook(run, id, tier) {
    if (!id || skillFull(run)) return false;
    var sk = D.skillById(id);
    if (!sk || hasSkill(run, id)) return false;
    var t = Math.max(1, Math.min(skillTierMax(run), tier || sk.tier || 1));
    run.skills.push({ id: id, tier: t });
    run.bookOffer = null;
    run._mk = null;
    pushLog(run, '得兵书 · ' + sk.name + '（' + ['铜', '银', '金'][t - 1] + '）。');
    return true;
  }

  // 备战席容量：按「个数」算（面积只影响显示）
  function benchSlots(run) { return CFG.benchBase + (mods(run).bench || 0); }

  function syncBench(run) {
    var n = benchSlots(run);
    while (run.bench.length < n) run.bench.push(null);
  }

  // 备战席按「格」算容量：棋子占它真实的格数
  function benchUsed(run) {
    var n = 0;
    for (var i = 0; i < run.bench.length; i++) {
      var p = run.bench[i];
      if (!p) continue;
      var d = p.def || D.pieceById(p.k);
      n += (d && d.size) || 1;
    }
    return n;
  }
  function benchFree(run) { return benchSlots(run) - benchUsed(run); }
  // 兼容旧调用：还有空位就返回真值（按个数）
  function freeSlotIndex(run) {
    syncBench(run);
    for (var i = 0; i < run.bench.length; i++) if (!run.bench[i]) return i;
    return -1;
  }
  function freeBenchSlot(run) { return freeSlotIndex(run); }

  function addToBench(run, p) {
    var i = freeSlotIndex(run);        // 只看有没有空位，不管棋子多占地方
    if (i < 0) return false;
    // 从棋盘拖回备战席：先清掉棋盘占位，否则会留下「看不见但占格」的残留
    clearCells(run, p);
    p.cells = [];
    if (i < 0) return false;
    run.bench[i] = p;
    p.cells = null;
    return true;
  }

  function clearCells(run, p) {
    if (!p.cells) return;
    for (var i = 0; i < p.cells.length; i++) {
      var key = MAP.key(p.cells[i].q, p.cells[i].r);
      if (run.board[key] === p) delete run.board[key];
    }
    p.cells = null;
  }

  function removePiece(run, p) {
    if (!p) return;
    clearCells(run, p);
    for (var i = 0; i < run.bench.length; i++) if (run.bench[i] === p) run.bench[i] = null;
  }

  function pieceAt(run, q, r) { return run.board[MAP.key(q, r)] || null; }

  function placeAt(run, p, q, r) {
    var def = p.def || D.pieceById(p.k);
    if (!def) return false;
    var old = p.cells;
    clearCells(run, p);
    var res = MAP.findPlacement(run.board, MAP.colOf(q, r), r, def.size, 'p', ownedSet(run));
    // 手机上拖放很难精准落在格心：落点失败时往四周吸一格再试（只吸已解锁的空格）
    if (!res) {
      var SNAP = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
      for (var ni = 0; ni < SNAP.length && !res; ni++) {
        res = MAP.findPlacement(run.board, q + SNAP[ni][0], r + SNAP[ni][1], def.size, 'p', ownedSet(run));
      }
    }
    if (!res) {
      if (old) {
        for (var i = 0; i < old.length; i++) run.board[MAP.key(old[i].q, old[i].r)] = p;
        p.cells = old;
      }
      return false;
    }
    p.cells = res.cells; p.rot = res.rot;
    for (var j = 0; j < res.cells.length; j++) run.board[MAP.key(res.cells[j].q, res.cells[j].r)] = p;
    for (var b = 0; b < run.bench.length; b++) if (run.bench[b] === p) run.bench[b] = null;
    return true;
  }

  function boardPieces(run) {
    var out = [], seen = {};
    for (var k in run.board) {
      if (!run.board.hasOwnProperty(k)) continue;
      var p = run.board[k];
      if (!p || seen[p.id]) continue;
      seen[p.id] = 1;
      out.push(p);
    }
    return out;
  }

  function allPieces(run) {
    return boardPieces(run).concat(run.bench.filter(Boolean));
  }

  /* ---------------- 合成 ---------------- */
  function canMerge(a, b) {
    if (!a || !b || a === b) return false;
    if (a.k !== b.k) return false;
    if (a.level !== b.level) return false;
    if (a.level >= CFG.maxLevel) return false;
    if (a.k === 'jiang' || b.k === 'jiang') return false;
    return true;
  }

  function mergeInto(run, dst, src) {
    if (!canMerge(dst, src)) return false;
    removePiece(run, src);
    dst.level++;
    dst.cd = 0;
    // 流派：2 级、3 级各选一次，可以叠加（最多 2 个）
    var evos = dst.evos || (dst.evo ? [dst.evo] : []);
    dst.evos = evos;
    if ((dst.level === 2 || dst.level === 3) && D.evoOptions(dst.k) && evos.length < 2) {
      dst.pendingEvo = true;
    }
    // 兵书「借箭」：每次合成给该棋子永久多重释放
    var mm = mods(run).mergeMulticast || 0;
    if (mm > 0) dst.multicast = Math.min(3, (dst.multicast || 0) + mm);
    run.counters.merged++;
    if (dst.level > run.counters.best) run.counters.best = dst.level;
    var g = mods(run).mergeGold || 0;
    if (g) run.gold += g;
    return true;
  }

  // 这枚棋子还能选哪些流派（已选过的不再出现）
  function evoChoices(p) {
    if (!p) return [];
    var all = D.evoOptions(p.k) || [];
    var have = p.evos || (p.evo ? [p.evo] : []);
    return all.filter(function (o) { return have.indexOf(o.id) < 0; });
  }

  // 选完进化：追加到流派数组（可叠加，最多 2 个）
  function chooseEvo(run, p, evoId) {
    if (!p) return false;
    var opt = D.evoDef(p.k, evoId);
    if (!opt) return false;
    p.evos = p.evos || (p.evo ? [p.evo] : []);
    if (p.evos.length >= 2) return false;
    if (p.evos.indexOf(evoId) >= 0) return false;
    p.evos.push(evoId);
    p.evo = p.evos[0];
    p.pendingEvo = false;
    var def = p.def || D.pieceById(p.k);
    pushLog(run, '流派 · ' + (def ? def.name : p.k) + ' 得「' + opt.name + '」。');
    return true;
  }

  function enchCount(run) {
    var n = 0, all = allPieces(run);
    for (var i = 0; i < all.length; i++) if (all[i].ench) n++;
    return n;
  }

  function pendingEvo(run) {
    var all = allPieces(run);
    for (var i = 0; i < all.length; i++) if (all[i].pendingEvo) return all[i];
    return null;
  }

  /* ---------------- 拼字觉醒 ---------------- */
  function checkHeroes(run) {
    var fused = [];
    var all = allPieces(run);
    var shards = {};
    for (var i = 0; i < all.length; i++) {
      var p = all[i];
      if (p.def && p.def.kind === 'shard') shards[p.def.ch] = p;
    }
    for (var hid in D.HEROES) {
      if (!D.HEROES.hasOwnProperty(hid)) continue;
      var h = D.HEROES[hid];
      var a = shards[h.chars[0]], b = shards[h.chars[1]];
      if (!a || !b || a === b) continue;
      removePiece(run, a); removePiece(run, b);
      var jiang = newPiece('jiang', { heroId: hid });
      if (!addToBench(run, jiang)) addToBench(run, jiang);
      fused.push(hid);
      pushLog(run, '名将觉醒 · ' + h.name + ' 可召。');
    }
    return fused;
  }

  function shardProgress(run) {
    var have = {}, out = {};
    allPieces(run).forEach(function (p) {
      if (p.def && p.def.kind === 'shard') have[p.def.ch] = true;
    });
    for (var hid in D.HEROES) {
      if (!D.HEROES.hasOwnProperty(hid)) continue;
      var h = D.HEROES[hid];
      var n = (have[h.chars[0]] ? 1 : 0) + (have[h.chars[1]] ? 1 : 0);
      if (n > 0) out[hid] = n;
    }
    return out;
  }

  /* ---------------- 日子 ---------------- */
  function startDay(run, first) {
    run.rerollCount = 0;
    run.phase = 'shop';
    var opp = GB.AI.makeOpponent(run.day, run.seed);
    run.opp = opp;
    GB.Shop.roll(run);
    // 新开一个兵书位 → 给一次三选一
    if (skillSlots(run) > run.skills.length && !run.bookOffer) {
      run.bookOffer = rollBooks(run);
      if (run.bookOffer.length) pushLog(run, '兵书位开启 · 三选一。');
    }
    if (!first) {
      var m = mods(run);
      var interest = Math.min(m.goldFac ? 6 : 3, Math.floor(run.gold / 10));
      var income = CFG.incomeBase + (m.income || 0) + interest;
      run.gold += income;
      run.lastIncome = { base: CFG.incomeBase, bonus: m.income || 0, interest: interest, total: income };
    }
  }

  function endBattle(run, win, battle) {
    var gold = 0;
    if (win) {
      run.wins++;
      gold = 4 + Math.floor(run.day / 2);
      run.gold += gold;
      pushLog(run, '论战得胜 · 第 ' + run.wins + ' 胜，赏 ' + gold + ' 金。');
    } else {
      run.losses++;
      var loss = run.day;
      run.prestige = Math.max(0, run.prestige - loss);
      pushLog(run, '论战失利 · 声望 −' + loss + '。');
    }
    var inc = mods(run).income || 0;
    if (inc) run.gold += inc;
    if (battle && battle.stats && battle.stats.gold) run.gold += battle.stats.gold;

    if (run.wins >= CFG.winsToFinish) { run.phase = 'win'; return; }
    if (run.prestige <= 0) { run.phase = 'over'; return; }
    if (run.day >= CFG.maxDays) { run.phase = 'over'; return; }
    run.day++;
    startDay(run, false);
  }

  function pushLog(run, t) {
    run.log.push({ d: run.day, t: t });
    if (run.log.length > 40) run.log.shift();
  }

  /* ---------------- 存档 ---------------- */
  function cloneForSave(run) {
    return JSON.stringify({
      v: run.v, seed: run.seed, faction: run.faction, day: run.day, phase: run.phase,
      prestige: run.prestige, gold: run.gold, wins: run.wins, losses: run.losses,
      board: run.board, bench: run.bench, cellsOwned: run.cellsOwned, skills: run.skills,
      bookOffer: run.bookOffer, offers: run.offers,
      rerollCount: run.rerollCount, log: run.log, counter: run.counters
    }, function (k, v) {
      if (k === 'def') return undefined;
      return v;
    });
  }

  function save(run) {
    if (!run || (run.phase !== 'shop')) return false;
    return U.save({ data: cloneForSave(run) });
  }

  function load() {
    var raw = U.load();
    if (!raw || !raw.data) return null;
    var run;
    try { run = JSON.parse(raw.data); } catch (e) { return null; }
    if (!run || !run.board) return null;
    run.counters = run.counter || { merged: 0, bought: 0, best: 1 };
    if (!run.cellsOwned || !run.cellsOwned.length) {
      if (run.cellsN) {   // 老存档：按数量补成 key 列表
        var order = MAP.ownedOrder();
        run.cellsOwned = [];
        for (var ci = 0; ci < Math.min(run.cellsN, order.length); ci++) run.cellsOwned.push(MAP.key(order[ci].q, order[ci].r));
      }
      initCells(run);
    }
    var i, j;
    var fix = function (p) {
      if (!p) return;
      p.def = D.pieceById(p.k);
      if (!p.cells) return;
      for (var m = 0; m < p.cells.length; m++) {
        var c = p.cells[m];
        var real = MAP.cell(c.q, c.r);
        if (real) p.cells[m] = real;
      }
    };
    for (var k in run.board) if (run.board.hasOwnProperty(k)) fix(run.board[k]);
    for (i = 0; i < run.bench.length; i++) fix(run.bench[i]);
    syncBench(run);
    run.opp = GB.AI.makeOpponent(run.day, run.seed);
    if (!run.offers || !run.offers.length) GB.Shop.roll(run);
    return run;
  }

  function clearSave() { U.clearSave(); }

  GB.Run = {
    newPiece: newPiece,
    newRun: newRun,
    mods: mods,
    benchSlots: benchSlots,
    syncBench: syncBench,
    freeBenchSlot: freeBenchSlot,
    benchUsed: benchUsed,
    benchFree: benchFree,
    addToBench: addToBench,
    removePiece: removePiece,
    pieceAt: pieceAt,
    placeAt: placeAt,
    cellsMax: cellsMax,
    cellsN: cellsN,
    cellsUsed: cellsUsed,
    ownedSet: ownedSet,
    isOwned: isOwned,
    initCells: initCells,
    nextCellPrice: nextCellPrice,
    canUnlock: canUnlock,
    unlockCell: unlockCell,
    boardPieces: boardPieces,
    allPieces: allPieces,
    canMerge: canMerge,
    mergeInto: mergeInto,
    chooseEvo: chooseEvo,
    evoChoices: evoChoices,
    skillSlots: skillSlots,
    skillTierMax: skillTierMax,
    skillPrice: skillPrice,
    skillFull: skillFull,
    hasSkill: hasSkill,
    rollBooks: rollBooks,
    chooseBook: chooseBook,
    pendingEvo: pendingEvo,
    enchCount: enchCount,
    checkHeroes: checkHeroes,
    shardProgress: shardProgress,
    startDay: startDay,
    endBattle: endBattle,
    pushLog: pushLog,
    save: save,
    load: load,
    clearSave: clearSave
  };
}(typeof window !== 'undefined' ? window : globalThis));
