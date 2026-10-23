/* map.js — 正方形阵型盘：8 列 × 8 行，上下各 4 行，前线紧贴
   尺寸：1×1 / 1×2 / 2×2 / 2×3 / 3×3（旋转 = 宽高互换）
   坐标：只用 c,r（旧字段 q 保留为 c 的别名，避免一次性改爆调用点） */
(function (root) {
  'use strict';
  var GB = root.GB = root.GB || {};

  var COLS = 8, ROWS = 8;
  var CX = COLS / 2, CY = ROWS / 2;   // 单位坐标以盘心为原点

  function key(c, r) { return c + ',' + r; }

  var CELLS = [], BY_KEY = {}, ROWS_MAP = {}, OWNED_ORDER = null;
  (function () {
    for (var r = 0; r < ROWS; r++) {
      ROWS_MAP[r] = [];
      for (var c = 0; c < COLS; c++) {
        var cell = {
          c: c, r: r, q: c,                  // q 是旧字段，等价于 c
          x: c + 0.5 - CX,                   // 单位坐标（格心）
          y: r + 0.5 - CY,
          zone: r < 4 ? 'e' : 'p'
        };
        CELLS.push(cell);
        BY_KEY[key(c, r)] = cell;
        ROWS_MAP[r].push(cell);
      }
    }
  }());

  /* 四邻（上下左右） */
  var NB = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  function cell(c, r) { return BY_KEY[key(c, r)] || null; }

  function neighbors(c, r) {
    var out = [];
    for (var i = 0; i < NB.length; i++) {
      var t = cell(c + NB[i][0], r + NB[i][1]);
      if (t) out.push(t);
    }
    return out;
  }

  /* 方格距离：Chebyshev（方形扩散圈） */
  function cellDist(a, b) {
    return Math.max(Math.abs(a.c - b.c), Math.abs(a.r - b.r));
  }

  function distXY(x1, y1, x2, y2) {
    var dx = x1 - x2, dy = y1 - y2;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /* 形状：以「左上角为锚点」的偏移表；旋转即宽高互换 */
  var SHAPES = {
    1: [[[0, 0]]],
    2: [
      [[0, 0], [1, 0]],                                    // 横
      [[0, 0], [0, 1]]                                     // 竖
    ],
    4: [
      [[0, 0], [1, 0], [0, 1], [1, 1]]                     // 2×2
    ],
    6: [
      [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]],    // 3 宽 × 2 高
      [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2]]     // 2 宽 × 3 高
    ],
    9: [
      [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [0, 2], [1, 2], [2, 2]]
    ]
  };

  function cellsFor(c, r, size, rotIdx) {
    var table = SHAPES[size];
    if (!table) return null;
    var list = table[rotIdx % table.length], out = [];
    for (var i = 0; i < list.length; i++) {
      var t = cell(c + list[i][0], r + list[i][1]);
      if (!t) return null;
      out.push(t);
    }
    return out;
  }

  function findPlacement(occ, c, r, size, zone, allowed) {
    var table = SHAPES[size];
    if (!table) return null;
    for (var i = 0; i < table.length; i++) {
      var cs = cellsFor(c, r, size, i);
      if (!cs) continue;
      var ok = true;
      for (var j = 0; j < cs.length; j++) {
        if (cs[j].zone !== zone) { ok = false; break; }
        if (allowed && !allowed[key(cs[j].c, cs[j].r)]) { ok = false; break; }
        if (occ[key(cs[j].c, cs[j].r)]) { ok = false; break; }
      }
      if (ok) return { cells: cs, rot: i };
    }
    return null;
  }

  /* 单位坐标 → 格子（整除，比六边形快也更准） */
  function cellAt(x, y) {
    var c = Math.floor(x + CX), r = Math.floor(y + CY);
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return null;
    return cell(c, r);
  }

  GB.MAP = {
    COLS: COLS, ROWS: ROWS, CX: CX, CY: CY,
    CELLS: CELLS, ROWS_MAP: ROWS_MAP, SHAPES: SHAPES,
    key: key, cell: cell, neighbors: neighbors, cellDist: cellDist, distXY: distXY,
    cellsFor: cellsFor, findPlacement: findPlacement, cellAt: cellAt,
    // 旧名保留（外部还有引用）
    hexDist: cellDist,
    axialOf: function (c, r) { return { q: c, r: r }; },
    colOf: function (q, r) { return q; },
    playerCells: function () { return CELLS.filter(function (c) { return c.zone === 'p'; }); },
    // 背包格的解锁顺序：先是前排中央的 4×3 方块，再向外长
    ownedOrder: function () {
      if (!OWNED_ORDER) {
        var C0 = 2, C1 = 5, R0 = 4, R1 = 6;   // 起始方块：列 2~5、行 4~6 = 12 格
        function inside(c) { return c.c >= C0 && c.c <= C1 && c.r >= R0 && c.r <= R1; }
        OWNED_ORDER = CELLS.filter(function (c) { return c.zone === 'p'; });
        OWNED_ORDER.sort(function (a, b) {
          var ia = inside(a) ? 0 : 1, ib = inside(b) ? 0 : 1;
          if (ia !== ib) return ia - ib;
          if (ia === 0) return (a.r - b.r) || (a.c - b.c);        // 方块内：行优先
          var da = Math.abs(a.c - (C0 + C1) / 2) + Math.max(0, a.r - R1) * 1.1 + Math.max(0, R0 - a.r) * 1.1;
          var db = Math.abs(b.c - (C0 + C1) / 2) + Math.max(0, b.r - R1) * 1.1 + Math.max(0, R0 - b.r) * 1.1;
          return da - db;                                          // 方块外：离方块越近越先解锁
        });
      }
      return OWNED_ORDER;
    },
    enemyCells: function () { return CELLS.filter(function (c) { return c.zone === 'e'; }); },
    frontRow: function (side) { return side === 'p' ? 4 : 3; },
    // 按角色给出该站的行（从前到后）
    rowsFor: function (side, role) {
      var back = side === 'p';
      var front = back ? [4, 5, 6, 7] : [3, 2, 1, 0];
      if (role === 'melee' || role === 'tank') return front;
      if (role === 'mid') return [front[0], front[1], front[2], front[3]];
      if (role === 'arc' || role === 'heal' || role === 'spell') return [front[2], front[1], front[3], front[0]];
      return [front[1], front[0], front[2], front[3]];
    }
  };
}(typeof window !== 'undefined' ? window : globalThis));
