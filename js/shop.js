/* shop.js — 集市：池子、货架、刷新、买卖、附魔 */
(function (root) {
  'use strict';
  var GB = root.GB = root.GB || {};
  var D = GB.D, U = GB.U, CFG = D.CFG;

  var seq = 1;

  function tierMax(day) {
    if (day >= 6) return 3;
    if (day >= 3) return 2;
    return 1;
  }

  function shardPool(run) {
    if (run.day < 5) return [];
    var out = [];
    for (var k in D.PIECES) {
      if (!D.PIECES.hasOwnProperty(k)) continue;
      if (D.PIECES[k].kind === 'shard') out.push(k);
    }
    return out;
  }

  function pieceOffer(run, rnd) {
    var pool = D.poolFor(run.faction, run.day);
    var shards = shardPool(run);
    var useShard = shards.length && rnd() < 0.12;
    var k;
    // 45% 几率刷出你已有的棋子 —— 不然永远合不出二级
    var owned = GB.Run.allPieces(run).map(function (p) { return p.k; }).filter(function (x) { return x !== 'jiang'; });
    if (!useShard && owned.length && rnd() < 0.45) {
      k = owned[Math.floor(rnd() * owned.length)];
    } else {
      k = useShard ? shards[Math.floor(rnd() * shards.length)] : pool[Math.floor(rnd() * pool.length)];
    }
    var def = D.pieceById(k);
    if (!def) return null;
    return { id: 'o' + (seq++), type: 'piece', k: k, price: def.price, sold: false };
  }

  function skillOffer(run, rnd) {
    // 兵书＝遗物：槽位满了就不上架；档位受天数门禁；价格按档位
    if (GB.Run.skillFull(run)) return null;
    var tmax = GB.Run.skillTierMax(run);
    var pool = [];
    for (var id in D.SKILLS) {
      if (!D.SKILLS.hasOwnProperty(id)) continue;
      var sk = D.SKILLS[id];
      if (sk.tier > tmax || GB.Run.hasSkill(run, id)) continue;
      pool.push(id);
    }
    if (!pool.length) return null;
    var k = pool[Math.floor(rnd() * pool.length)];
    var sk2 = D.SKILLS[k];
    var tier = Math.min(tmax, sk2.tier || 1);
    return { id: 'o' + (seq++), type: 'skill', skillId: k, tier: tier, price: GB.Run.skillPrice(tier), sold: false };
  }

  function enchOffer(run, rnd) {
    var tmax = tierMax(run.day);
    var pool = [];
    for (var id in D.ENCHANTS) {
      if (!D.ENCHANTS.hasOwnProperty(id)) continue;
      if (D.ENCHANTS[id].tier > tmax) continue;
      pool.push(id);
    }
    if (!pool.length) return null;
    var k = pool[Math.floor(rnd() * pool.length)];
    return { id: 'o' + (seq++), type: 'ench', enchId: k, price: D.ENCHANTS[k].price, sold: false };
  }

  function makeOffer(run, rnd, forcePiece) {
    var r = forcePiece ? 0 : rnd();
    if (r < 0.60) return pieceOffer(run, rnd) || skillOffer(run, rnd);
    if (r < 0.88) return enchOffer(run, rnd) || pieceOffer(run, rnd);
    return skillOffer(run, rnd) || pieceOffer(run, rnd);   // 兵书很少见（12%）
  }

  function roll(run) {
    var rnd = U.mulberry32(U.hash(run.seed + ':' + run.day + ':' + run.rerollCount));
    var m = GB.Run.mods(run);
    var n = CFG.offersBase + (m.shopSlot || 0);
    var offers = [];
    for (var i = 0; i < n; i++) {
      var of = makeOffer(run, rnd, false);
      if (of) offers.push(of);
    }
    var hasPiece = offers.some(function (o) { return o.type === 'piece'; });
    if (m.alwaysUnit && !hasPiece && offers.length) {
      offers[offers.length - 1] = pieceOffer(run, rnd) || offers[offers.length - 1];
    }
    run.offers = offers;
    return offers;
  }

  function reroll(run) {
    if (run.gold < CFG.rerollCost) return false;
    run.gold -= CFG.rerollCost;
    run.rerollCount++;
    roll(run);
    return true;
  }

  function buy(run, offer) {
    if (!offer || offer.sold) return { ok: false, why: 'sold' };
    if (run.gold < offer.price) return { ok: false, why: 'gold' };

    if (offer.type === 'piece') {
      if (GB.Run.freeBenchSlot(run) < 0) return { ok: false, why: 'bench' };
      var p = GB.Run.newPiece(offer.k);
      p.cost = offer.price;
      GB.Run.addToBench(run, p);
      run.gold -= offer.price;
      offer.sold = true;
      run.counters.bought++;
      return { ok: true, piece: p };
    }
    if (offer.type === 'skill') {
      run.gold -= offer.price;
      offer.sold = true;
      run.skills.push({ id: offer.skillId, tier: offer.tier || 1 });
      run._mk = null;
      GB.Run.pushLog(run, '得兵书 · ' + D.SKILLS[offer.skillId].name + '。');
      return { ok: true, skill: offer.skillId };
    }
    if (offer.type === 'ench') {
      return { ok: 'pick', offer: offer };
    }

    return { ok: false, why: 'type' };
  }

  function buyEnchant(run, offer, piece) {
    if (!offer || offer.sold || !piece) return false;
    if (run.gold < offer.price) return false;
    if (piece.ench) return false;
    run.gold -= offer.price;
    offer.sold = true;
    piece.ench = offer.enchId;
    GB.Run.pushLog(run, '附魔 · ' + D.ENCHANTS[offer.enchId].name + ' 烙在「' + displayName(piece) + '」上。');
    return true;
  }

  function sellValue(run, p) {
    var def = p.def || D.pieceById(p.k);
    var base = (p.cost || (def ? def.price : 3));
    var v = base * Math.pow(1.85, (p.level || 1) - 1);
    if (p.ench) v += D.ENCHANTS[p.ench].price * 0.5;
    var m = GB.Run.mods(run);
    return Math.max(1, Math.floor(v * (m.sellFull ? 1 : 0.5)));
  }

  function displayName(p) {
    if (!p) return '';
    if (p.k === 'jiang' && p.heroId && D.HEROES[p.heroId]) return D.HEROES[p.heroId].name + '台';
    var def = p.def || D.pieceById(p.k);
    return def ? def.name : p.k;
  }

  GB.Shop = {
    roll: roll,
    reroll: reroll,
    rerollCost: function () { return CFG.rerollCost; },
    buy: buy,
    buyEnchant: buyEnchant,
    sellValue: sellValue,
    displayName: displayName,
    tierMax: tierMax
  };
}(typeof window !== 'undefined' ? window : globalThis));
