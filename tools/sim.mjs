#!/usr/bin/env node
/* sim.mjs — 无头对局模拟器（PvP 同规则对打）
   把两套「构筑」（棋子 + 等级 + 流派 + 兵书）放进同一场战斗，跑 N 局算胜率。
   用途：验证《大巴扎》式「触发 → 传递 → 收益」链条是否真的比纯堆数值强。
   用法：node tools/sim.mjs [--n 60] [--day 6] [--json]
*/
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['core.js', 'data.js', 'map.js', 'battle.js', 'shop.js', 'run.js', 'ai.js'];

function loadGB() {
  const ctx = vm.createContext({ console });
  ctx.window = ctx;
  ctx.globalThis = ctx;
  for (const f of FILES) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'), ctx, { filename: f });
  }
  return ctx.GB;
}

const G = loadGB();
const D = G.D, MAP = G.MAP;

/* ---------------- 布阵：大件先放，按角色选排；near 表示要贴着谁 ---------------- */
function placeAll(run, pieces) {
  const occ = {};
  const owned = G.Run.ownedSet(run);
  const order = pieces.slice().sort((a, b) => {
    const da = D.pieceById(a.k), db = D.pieceById(b.k);
    return ((db.size || 1) - (da.size || 1)) || ((db.price || 0) - (da.price || 0));
  });
  const placed = {};
  for (const p of order) {
    const def = D.pieceById(p.k);
    const rows = MAP.rowsFor('p', def.role);
    const near = p.near ? placed[p.near] : null;
    let best = null, bestScore = 1e9;
    for (const anchor of MAP.playerCells()) {
      const res = MAP.findPlacement(occ, anchor.c, anchor.r, def.size || 1, 'p', owned);
      if (!res) continue;
      const pref = rows.indexOf(anchor.r);
      let score = (pref < 0 ? 10 + Math.abs(anchor.r - rows[0]) : pref) + Math.abs(anchor.c - 3.5) * 0.2;
      if (near) {
        const adj = res.cells.some((c) => near.cells.some((n) => MAP.cellDist(c, n) === 1));
        score += adj ? -6 : 6;
      }
      if (score < bestScore) { bestScore = score; best = res; }
    }
    if (!best) throw new Error('排不下：' + p.k);
    p.cells = best.cells;
    placed[p.k] = p;
    for (const cell of best.cells) occ[MAP.key(cell.c, cell.r)] = true;
  }
}

function makeSide(spec, day) {
  const run = G.Run.newRun(spec.seed || 1, spec.faction || 'dongwu');
  run.day = day;
  run.cellsOwned = MAP.ownedOrder().slice(0, spec.cells || 12).map((c) => MAP.key(c.c, c.r));
  run._ownLen = -1;
  run._ownSet = null;
  const pieces = spec.pieces.map((p) => {
    const pc = G.Run.newPiece(p.k, { level: p.lv || 1 });
    if (p.evos) pc.evos = p.evos.slice();
    if (p.ench) pc.ench = p.ench;
    return pc;
  });
  placeAll(run, pieces);
  return { run, pieces, mods: G.Run.mods(run) };
}

function battles(specA, specB, day, seed, swap) {
  const A = makeSide(specA, day);
  const B = makeSide(specB, day);
  // swap = A 站敌方半场：用来抵消「谁站下半场」的位置/先手偏差
  const pSide = swap ? B : A, oSide = swap ? A : B;
  const piecesP = swap ? pSide.pieces : A.pieces;
  const piecesO = G.AI.mirror(oSide.pieces);
  const b = G.Battle.create({
    day,
    piecesP,
    piecesO,
    gridP: pSide.run.board,
    gridO: G.AI.gridFrom(piecesO),
    modsP: pSide.mods,
    modsO: oSide.mods,
    factionP: (swap ? specB : specA).faction || 'dongwu',
    factionO: (swap ? specA : specB).faction || 'dongwu',
    booksP: ((swap ? specB : specA).books || []).map((x) => ({ id: x.id, tier: x.tier || 1 })),
    booksO: ((swap ? specA : specB).books || []).map((x) => ({ id: x.id, tier: x.tier || 1 })),
    ownedCells: (swap ? specB : specA).cells || 12,
    ownedCellsO: (swap ? specA : specB).cells || 12,
    frontRowP: MAP.frontRow('p'),
    autoUlt: true,
    seed: (seed * 977 + day * 31) | 0
  });
  let steps = 0;
  while (b.status === 'run' && steps++ < 20000) G.Battle.step(b, 1 / 60);
  const aWon = swap ? b.status === 'lose' : b.status === 'win';
  return {
    win: aWon,
    t: b.t,
    dmgP: swap ? b.stats.dmgO : b.stats.dmgP,
    dmgO: swap ? b.stats.dmgP : b.stats.dmgO,
    ev: b.stats.ev || {},
    overflow: b.overflow
  };
}

const cost = (spec) => spec.pieces.reduce((s, p) => {
  const d = D.pieceById(p.k);
  return s + (d.price || 0);
}, 0);

function runMatch(a, b, n, day) {
  let wins = 0, t = 0, overflow = 0, ev = {};
  for (let i = 0; i < n; i++) {
    // 两个方向各打一局：A 在下半场 / A 在上半场，抵消站位偏差
    for (const swap of [false, true]) {
      const r = battles(a, b, day, i + 1, swap);
      if (r.win) wins++;
      t += r.t;
      overflow += r.overflow;
      for (const k in r.ev) ev[k] = (ev[k] || 0) + r.ev[k];
    }
  }
  n *= 2;
  const evTop = Object.entries(ev).sort((x, y) => y[1] - x[1]).slice(0, 4)
    .map(([k, v]) => k + ':' + (v / n).toFixed(1)).join(' ');
  return { win: +(wins / n).toFixed(3), t: +(t / n).toFixed(1), overflow: +(overflow / n).toFixed(1), ev: evTop };
}

/* ---------------- 构筑（数值待调，先验证链条方向） ---------------- */
const BUILDS = {
  stats: {
    name: '纯数值：刀客/弓手/骑将',
    pieces: [
      { k: 'dao', lv: 2, evos: ['fast'] },
      { k: 'gong', lv: 2, evos: ['rapid'] },
      { k: 'qi', lv: 2 },
      { k: 'dun', lv: 2 }
    ],
    books: [{ id: 'changqu', tier: 1 }],
    cells: 18
  },
  combo: {
    name: '高频攻击：连弩+战鼓+风助',
    pieces: [
      { k: 'dao', lv: 3, evos: ['fast'] },
      { k: 'nu', lv: 3, evos: ['rapid'] },
      { k: 'flag_dmg', lv: 1 },
      { k: 'feng', lv: 1 },
      { k: 'yi', lv: 2 }
    ],
    books: [{ id: 'lianu', tier: 2 }],
    cells: 18
  },
  burn: {
    name: '燃烧连锁：火术+机关+火盆',
    pieces: [
      { k: 'dao', lv: 2, near: 'huo' },
      { k: 'huo', lv: 3, evos: ['blaze'] },
      { k: 'ji', lv: 2 },
      { k: 'flag_burn', lv: 1 },
      { k: 'yi', lv: 2 }
    ],
    books: [{ id: 'liaoyuan', tier: 2 }],
    cells: 18
  },
  counter: {
    name: '承伤反击：骑将+盾卫+医者',
    pieces: [
      { k: 'qi', lv: 2, evos: ['ironhoof'] },
      { k: 'dun', lv: 2, near: 'qi' },
      { k: 'yi', lv: 2 },
      { k: 'dao', lv: 2 }
    ],
    books: [{ id: 'xuezhai', tier: 2 }],
    cells: 18
  }
};

const MATCHUPS = [
  ['stats', 'stats'],
  ['combo', 'combo'],
  ['combo', 'stats'],
  ['burn', 'stats'],
  ['counter', 'stats']
];

const args = process.argv.slice(2);
const nIdx = args.indexOf('--n');
const N = nIdx >= 0 ? parseInt(args[nIdx + 1], 10) : 40;
const dayIdx = args.indexOf('--day');
const DAYS = dayIdx >= 0 ? [parseInt(args[dayIdx + 1], 10)] : [3, 6, 9];
const json = args.includes('--json');

const out = [];
for (const day of DAYS) {
  for (const [ai, bi] of MATCHUPS) {
    const r = runMatch(BUILDS[ai], BUILDS[bi], N, day);
    out.push(Object.assign({ day, a: BUILDS[ai].name, b: BUILDS[bi].name }, r));
    if (!json) {
      console.log(
        `D${day}  ${BUILDS[ai].name.padEnd(26)} vs ${BUILDS[bi].name.padEnd(22)}` +
        `  ${(r.win * 100).toFixed(0)}%  ${r.t.toFixed(1)}s  ovf ${r.overflow}  ${r.ev}`
      );
    }
  }
}
if (json) console.log(JSON.stringify(out, null, 2));

// 造价对照（牌面价，不含升级成本）
for (const k in BUILDS) {
  const b = BUILDS[k];
  const lv = b.pieces.reduce((s, p) => s + (p.lv || 1), 0);
  console.log(`  ${k.padEnd(6)} 棋子 ${b.pieces.length} 枚 / ${lv} 级 / 牌面价 ${cost(b)} 金 / ${b.cells} 格`);
}
