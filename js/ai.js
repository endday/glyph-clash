/* ai.js — 预置幽灵阵：12 套有名有姓的模板 */
(function (root) {
  'use strict';
  var GB = root.GB = root.GB || {};
  var D = GB.D, MAP = GB.MAP, U = GB.U;

  var TEMPLATES = [
    { id: 'wuming', name: '无名阵', faction: 'mojia', from: 1, core: ['dao', 'dao'], fill: ['dao', 'yi', 'gu'] },
    { id: 'hubao', name: '虎豹骑', faction: 'dongwu', from: 2, core: ['qi', 'dao'], fill: ['dao', 'gu', 'flag_dmg'] },
    { id: 'lianu', name: '连弩营', faction: 'wolong', from: 2, core: ['gong', 'lou'], fill: ['gong', 'flag_dmg', 'qiang'] },
    { id: 'changqiang', name: '长枪阵', faction: 'mojia', from: 3, core: ['qiang', 'gu'], fill: ['qiang', 'ji', 'dao'] },
    { id: 'yaowang', name: '药王谷', faction: 'miaoyu', from: 3, core: ['yi', 'lu'], fill: ['dao', 'dun', 'flag_armor'] },
    { id: 'huoshen', name: '火神庙', faction: 'dongwu', from: 4, core: ['huo', 'feng'], fill: ['dao', 'flag_burn', 'yi'] },
    { id: 'sanlian', name: '三连射', faction: 'wolong', from: 4, core: ['gong', 'gong'], fill: ['lou', 'flag_dmg', 'yi'] },
    { id: 'wuhu', name: '五虎将', faction: 'wolong', from: 5, core: ['jiang', 'dao'], fill: ['lou', 'gong', 'gu'] },
    { id: 'tiebi', name: '铁壁营', faction: 'mojia', from: 5, core: ['dun', 'ji'], fill: ['dao', 'flag_armor', 'yi'] },
    { id: 'shuangqi', name: '双骑冲', faction: 'dongwu', from: 5, core: ['qi', 'liuma'], fill: ['qi', 'gu', 'flag_dmg'] },
    { id: 'leich', name: '雷池', faction: 'miaoyu', from: 6, core: ['lei', 'shuang'], fill: ['du', 'dao', 'lu'] },
    { id: 'kongying', name: '空营计', faction: 'taozhu', from: 6, core: ['piao', 'jin'], fill: ['dao', 'yi', 'flag_dmg'] }
  ];

  var HERO_IDS = ['zhaoyun', 'guanyu', 'zhangfei', 'huangzhong', 'machao'];

  function pickTemplate(day, rnd) {
    var pool = TEMPLATES.filter(function (t) { return t.from <= day; });
    if (!pool.length) pool = [TEMPLATES[0]];
    return pool[Math.floor(rnd() * pool.length)];
  }

  function placePiece(occ, k, level, rnd, cells) {
    var def = D.pieceById(k);
    if (!def) return null;
    var rows = MAP.rowsFor('e', def.role);
    var list = [];
    for (var q = 0; q < rows.length; q++) {
      var band = cells.filter(function (c) { return c.r === rows[q]; });
      list = list.concat(U.shuffle(band, rnd));
    }
    for (var i = 0; i < list.length; i++) {
      var res = MAP.findPlacement(occ, list[i].c, list[i].r, def.size, 'e');
      if (!res) continue;
      var p = {
        id: 'o' + k + '_' + Math.floor(rnd() * 1e6),
        k: k,
        level: level,
        cells: res.cells,
        rot: res.rot,
        ench: null,
        heroId: null
      };
      if (k === 'jiang') p.heroId = HERO_IDS[Math.floor(rnd() * HERO_IDS.length)];
      for (var j = 0; j < res.cells.length; j++) occ[MAP.key(res.cells[j].q, res.cells[j].r)] = p;
      return p;
    }
    return null;
  }

  function makeOpponent(day, seed) {
    var rnd = U.mulberry32(((seed | 0) + day * 7919) >>> 0);
    var tpl = pickTemplate(day, rnd);
    var budget = 2.6 + day * 1.15;
    var occ = {}, pieces = [];
    var cells = MAP.enemyCells();

    var baseLv = U.clamp(1 + Math.floor(day / 3), 1, 3);
    function lvFor() {
      var lv = baseLv;
      if (day >= 2 && rnd() < 0.5) lv++;
      return U.clamp(lv, 1, 3);
    }

    var i, p;
    for (i = 0; i < tpl.core.length; i++) {
      var def = D.pieceById(tpl.core[i]);
      if (!def || def.size > budget) continue;
      p = placePiece(occ, tpl.core[i], lvFor(), rnd, cells);
      if (p) { pieces.push(p); budget -= def.size; }
    }

    var guard = 0;
    while (budget >= 1 && pieces.length < 12 && guard++ < 40) {
      var k = tpl.fill[Math.floor(rnd() * tpl.fill.length)];
      var d2 = D.pieceById(k);
      if (!d2 || d2.size > budget) { budget -= 0; guard++; if (guard > 12) break; continue; }
      p = placePiece(occ, k, lvFor(), rnd, cells);
      if (p) { pieces.push(p); budget -= d2.size; }
    }

    var fac = D.FACTIONS[tpl.faction] || D.FACTIONS.mojia;
    var mods = {
      dmgMul: 0.05 * (day - 1),
      spd: 0.025 * (day - 1),
      hp: 0.09 * (day - 1),
      auraBoost: tpl.faction === 'mojia' ? 0.25 : 0,
      pieceBurn: tpl.faction === 'dongwu' ? 0.25 : (tpl.faction === 'miaoyu' ? 0.18 : 0),
      arcRange: tpl.faction === 'wolong' ? 1 : 0,
      healBoost: 0, tankHp: 0, frontArmor: 0, arcSpd: 0, openingRush: 0,
      killGold: 0, killCap: 99, income: 0, mergeGold: 0, bench: 0, shopSlot: 0,
      sellFull: false, alwaysUnit: false, rupture: 0
    };

    return {
      template: tpl.id,
      name: tpl.name,
      faction: tpl.faction,
      factionName: fac.name,
      pieces: pieces,
      mods: mods,
      power: pieces.reduce(function (a, x) { return a + x.level * D.pieceById(x.k).size; }, 0)
    };
  }

  function gridFrom(pieces) {
    var g = {};
    for (var i = 0; i < pieces.length; i++) {
      for (var j = 0; j < pieces[i].cells.length; j++) {
        g[MAP.key(pieces[i].cells[j].q, pieces[i].cells[j].r)] = pieces[i];
      }
    }
    return g;
  }

  GB.AI = {
    TEMPLATES: TEMPLATES,
    makeOpponent: makeOpponent,
    gridFrom: gridFrom
  };
}(typeof window !== 'undefined' ? window : globalThis));
