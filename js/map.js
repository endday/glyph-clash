/* map.js — 六边形阵型盘：6 列 × 8 行，上下各 4 行，前线紧贴 */
(function (root) {
  'use strict';
  var GB = root.GB = root.GB || {};

  var COLS = 6, ROWS = 8;
  var YS = 0.8660254;
  var CX = 2.75, CY = 3.0311;

  function key(c, r) { return c + ',' + r; }
  function axialOf(c, r) { return { q: c - Math.floor(r / 2), r: r }; }
  function colOf(q, r) { return q + Math.floor(r / 2); }

  var CELLS = [], BY_KEY = {}, ROWS_MAP = {}, OWNED_ORDER = null;
  (function () {
    for (var r = 0; r < ROWS; r++) {
      var w = (r % 2 === 0) ? COLS : COLS - 1;
      ROWS_MAP[r] = [];
      for (var c = 0; c < w; c++) {
        var a = axialOf(c, r);
        var cell = {
          c: c, r: r, q: a.q,
          x: c + 0.5 * (r & 1) - CX,
          y: r * YS - CY,
          zone: r < 4 ? 'e' : 'p'
        };
        CELLS.push(cell);
        BY_KEY[key(c, r)] = cell;
        ROWS_MAP[r].push(cell);
      }
    }
  }());

  /* 邻居（odd-r offset） */
  var NB_EVEN = [[1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]];
  var NB_ODD = [[1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1]];

  function cell(c, r) { return BY_KEY[key(c, r)] || null; }

  function neighbors(c, r) {
    var dirs = (r & 1) ? NB_ODD : NB_EVEN;
    var out = [];
    for (var i = 0; i < dirs.length; i++) {
      var cc = cell(c + dirs[i][0], r + dirs[i][1]);
      if (cc) out.push(cc);
    }
    return out;
  }

  function hexDist(a, b) {
    var q1 = a.q, r1 = a.r, q2 = b.q, r2 = b.r;
    var dq = q1 - q2, dr = r1 - r2;
    return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
  }

  function distXY(x1, y1, x2, y2) {
    var dx = x1 - x2, dy = y1 - y2;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /* 形状：以轴向定义，再转回 offset */
  function rotate(q, r, n) {
    for (var i = 0; i < n; i++) { var nq = -r, nr = q + r; q = nq; r = nr; }
    return [q, r];
  }
  function canon(list) {
    return list.map(function (p) { return p[0] + ':' + p[1]; }).sort().join('|');
  }
  function orientations(base) {
    var out = [], seen = {};
    for (var n = 0; n < 6; n++) {
      var rot = base.map(function (p) { var v = rotate(p[0], p[1], n); return [v[0], v[1]]; });
      var k = canon(rot);
      if (seen[k]) continue;
      seen[k] = 1;
      out.push(rot);
    }
    return out;
  }

  var SHAPES = {
    1: orientations([[0, 0]]),
    2: orientations([[0, 0], [1, 0]]),
    3: orientations([[0, 0], [1, 0], [0, 1]])
  };

  function cellsFor(c, r, size, rotIdx) {
    var list = SHAPES[size][rotIdx % SHAPES[size].length];
    var a = axialOf(c, r);
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var rr = a.r + list[i][1];
      var cc = colOf(a.q + list[i][0], rr);
      var t = cell(cc, rr);
      if (!t) return null;
      out.push(t);
    }
    return out;
  }

  function findPlacement(occ, c, r, size, zone, allowed) {
    for (var i = 0; i < SHAPES[size].length; i++) {
      var cs = cellsFor(c, r, size, i);
      if (!cs) continue;
      var ok = true;
      for (var j = 0; j < cs.length; j++) {
        if (cs[j].zone !== zone) { ok = false; break; }
        if (allowed && !allowed[key(cs[j].q, cs[j].r)]) { ok = false; break; }
        if (occ[key(cs[j].q, cs[j].r)]) { ok = false; break; }
      }
      if (ok) return { cells: cs, rot: i };
    }
    return null;
  }

  function cellAt(x, y) {
    var best = null, bd = 1e9;
    for (var i = 0; i < CELLS.length; i++) {
      var d = distXY(x, y, CELLS[i].x, CELLS[i].y);
      if (d < bd) { bd = d; best = CELLS[i]; }
    }
    return bd <= 0.9 ? best : null;
  }

  GB.MAP = {
    COLS: COLS, ROWS: ROWS, YS: YS,
    CELLS: CELLS, ROWS_MAP: ROWS_MAP, SHAPES: SHAPES,
    key: key, cell: cell, neighbors: neighbors, hexDist: hexDist, distXY: distXY,
    cellsFor: cellsFor, findPlacement: findPlacement, cellAt: cellAt,
    axialOf: axialOf, colOf: colOf,
    playerCells: function () { return CELLS.filter(function (c) { return c.zone === 'p'; }); },
    // 背包格的解锁顺序：从前排中间向外长，小背包也能摆出阵型
    ownedOrder: function () {
      if (!OWNED_ORDER) {
        OWNED_ORDER = CELLS.filter(function (c) { return c.zone === 'p'; });
        OWNED_ORDER.sort(function (a, b) {
          var ka = Math.abs(a.c - 2.5) * 2 + (a.r - 4) * 0.9;
          var kb = Math.abs(b.c - 2.5) * 2 + (b.r - 4) * 0.9;
          return ka - kb;
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
