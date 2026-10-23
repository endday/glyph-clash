/* ui.js — DOM 面板、拖拽、弹窗、门派选择 */
(function (root) {
  'use strict';
  var GB = root.GB = root.GB || {};
  var U = GB.U, D = GB.D, MAP = GB.MAP;
  var el = U.el, $ = U.$, clear = U.clear;

  var run = null, battle = null;
  var drag = null, hoverSlot = -1, pendingEnch = null, selected = null;
  var view = { drag: null, hover: null };

  /* ---------------- 提示 ---------------- */
  function toast(msg, kind) {
    if (root.GB && root.GB.storeBridge && root.GB.storeBridge.toast) {
      root.GB.storeBridge.toast(msg, kind);
      return;
    }
    var box = $('#toasts');
    if (!box) return;
    var t = el('div', { class: 'toast ' + (kind || ''), text: msg });
    box.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 2000);
  }

  /* ---------------- 顶栏 ---------------- */
  function renderTop() {
    if (!run) return;
    $('#day-num').textContent = run.day;
    var tag = $('#phase-tag');
    tag.textContent = run.phase === 'battle' ? '对局' : '晨市';
    tag.className = 'phase-tag ' + (run.phase === 'battle' ? 'pvp' : 'shop');
    var h = $('#prestige-hearts'); clear(h);
    for (var i = 0; i < 5; i++) h.appendChild(el('i', { class: run.prestige > i * 4 ? '' : 'off' }));
    $('#prestige-num').textContent = run.prestige;
    $('#gold-num').textContent = run.gold;
    $('#wins-num').textContent = run.wins;
  }

  /* ---------------- 棋子小牌 ---------------- */
  function tile(p, small) {
    var def = p.def || D.pieceById(p.k);
    if (!def) return el('div', { class: 'utile' });
    var isHero = p.k === 'jiang';
    var cls = 'utile' + (isHero ? ' hero' : '') + (def.role === 'shard' ? ' shard' : '') + (small ? ' sm' : '');
    var txt = isHero ? (D.HEROES[p.heroId] ? D.HEROES[p.heroId].name : '将') : def.ch;
    return el('div', { class: cls, dataset: { id: p.id } },
      el('span', { class: 'ch', text: txt }),
      p.level > 1 ? el('span', { class: 'lv', text: p.level }) : null,
      def.size > 1 ? el('i', { class: 'sz', text: def.size }) : null,
      p.ench ? el('span', { class: 'ench e-' + p.ench }) : null
    );
  }

  /* ---------------- 集市 ---------------- */
  function offerCard(o) {
    var glyph = '?', name = '', kind = '', desc = '', badge = '', gcls = '';
    if (o.type === 'piece') {
      var d = D.pieceById(o.k);
      if (!d) return el('div', { class: 'offer sold' });
      glyph = d.ch; name = d.name; kind = d.size + ' 格';
      desc = d.desc || '';
      if (d.role === 'shard') { badge = '名将'; gcls = 'gold'; }
      else if (d.role === 'flag') kind = d.size + ' 格 · 光环';
    } else if (o.type === 'skill') {
      var s = D.SKILLS[o.skillId];
      if (!s) return el('div', { class: 'offer sold' });
      glyph = s.ch; name = '兵书·' + s.name; kind = '全局被动'; desc = s.desc;
      badge = s.tier === 3 ? '上品' : s.tier === 2 ? '中品' : '';
      gcls = 'gold';
    } else if (o.type === 'ench') {
      var e = D.ENCHANTS[o.enchId];
      if (!e) return el('div', { class: 'offer sold' });
      glyph = e.ch; name = e.name; kind = '附魔'; desc = e.desc;
      badge = '附魔'; gcls = 'jade';
    }
    var cant = !o.sold && run.gold < o.price;
    return el('div', {
      class: 'offer' + (o.sold ? ' sold' : '') + (cant ? ' cant' : ''),
      dataset: { id: o.id },
      onclick: function () { onBuy(o); }
    },
      badge ? el('span', { class: 'badge ' + (badge === '名将' || badge === '附魔' ? 'r2' : ''), text: badge }) : null,
      el('div', { class: 'og' },
        el('div', { class: 'glyph ' + gcls, text: glyph }),
        el('div', {},
          el('div', { class: 'name', text: name }),
          el('div', { class: 'kind', text: kind })
        )
      ),
      el('div', { class: 'desc', text: desc }),
      el('div', { class: 'price' }, el('span', { class: 'coin' }), String(o.price))
    );
  }

  function onBuy(o) {
    if (!run || o.sold) return;
    if (o.type === 'ench') {
      pendingEnch = (pendingEnch && pendingEnch.id === o.id) ? null : o;
      render();
      return;
    }
    var r = GB.Shop.buy(run, o);
    if (!r.ok) {
      GB.audio.deny();
      toast(r.why === 'gold' ? '金币不足' : r.why === 'bench' ? '备战席已满'
        : r.why === 'max' ? '已经铺满整块棋盘' : '买不了', 'bad');
      return;
    }
    GB.audio.buy();
    if (r.piece) toast('购入 ' + (D.pieceById(r.piece.k) || {}).name, 'good');
    if (r.skill) toast('习得兵书', 'good');
    if (r.expand) toast('扩建 · 布阵 +' + r.expand + ' 格', 'gold');
    after();
  }

  /* ---------------- 战斗面板 ---------------- */
  function renderBattlePanel(sec) {
    sec.style.display = '';
    sec.appendChild(el('div', { class: 'sec-head' }, '论战',
      el('span', { class: 'sub', text: (run.opp ? run.opp.name : '') + ' · ' + ((D.FACTIONS[run.opp.faction] || {}).name || '') })));
    var wrap = el('div', { class: 'traits' });
    var ready = 0, total = 0;
    if (battle) {
      for (var i = 0; i < battle.p.length; i++) {
        if (!battle.p[i].alive) continue;
        if (battle.p[i].canUlt) total++;
        if (battle.p[i].ultReady) ready++;
      }
    }
    wrap.appendChild(el('div', { class: 'trait' },
      el('div', { class: 'tg gold', text: '招' }),
      el('div', {},
        el('div', { class: 'tn', id: 'bi-ults', text: '大招 ' + ready + ' / ' + (battle && battle.autoUlt === false ? '手动' : '自动') }),
        el('div', { class: 'td', text: '3 级以上才有；亮了金环可点它释放' })
      )));
    wrap.appendChild(el('div', { class: 'trait' },
      el('div', { class: 'tg', text: '兵' }),
      el('div', {},
        el('div', { class: 'tn', id: 'bi-units', text: '存活 0 / 0' }),
        el('div', { class: 'td', text: '我方 / 敌方还站着的棋子' })
      )));
    sec.appendChild(wrap);
  }

  function isMobile() { return root.innerWidth <= 900; }

  function renderShop() {
    if (root.GB && root.GB.storeBridge) return;
    var sec = $('#sec-shop'); if (!sec) return; clear(sec);
    if (!run) return;
    if (isMobile() && run.phase !== 'battle') { sec.style.display = 'none'; return; }
    if (run.phase === 'battle') { renderBattlePanel(sec); return; }
    sec.style.display = '';
    sec.appendChild(el('div', { class: 'sec-head' },
      '晨市',
      el('span', { class: 'sub', text: '第 ' + run.day + ' 天 · 刷新 2 金' })
    ));
    if (pendingEnch) {
      sec.appendChild(el('div', { class: 'empty-note', text: '选择要附魔的棋子（点备战席或棋盘上的棋子）' }));
    }
    var grid = el('div', { class: 'offers' });
    (run.offers || []).forEach(function (o) { grid.appendChild(offerCard(o)); });
    sec.appendChild(grid);
  }

  var shopOpen = false;
  function openShop() {
    if (!run || run.phase === 'battle') return;
    shopOpen = true;
    if (root.GB && root.GB.storeBridge) { root.GB.storeBridge.setShop(true); return; }
    var grid = el('div', { class: 'offers' });
    (run.offers || []).forEach(function (o) { grid.appendChild(offerCard(o)); });
    var body = el('div', {},
      el('div', { class: 'muted', style: { marginBottom: '8px' }, text: '第 ' + run.day + ' 天 · 金币 ' + run.gold }),
      grid,
      el('div', { class: 'muted', style: { marginTop: '10px' }, text: '买完的会变灰。刷新 2 金。' })
    );
    modal({
      title: '商店',
      body: body,
      actions: [
        {
          label: '刷新 · 2', cls: 'gold',
          onClick: function () {
            if (!GB.Shop.reroll(run)) { GB.audio.deny(); toast('金币不足', 'bad'); return; }
            GB.audio.click(); pendingEnch = null;
            closeModal(); openShop(); render();
          }
        },
        { label: '关闭', cls: 'red', onClick: function () { shopOpen = false; closeModal(); } }
      ]
    });
  }

  /* ---------------- 备战席 ---------------- */
  function renderBench() {
    if (root.GB && root.GB.storeBridge) return;
    var sec = $('#sec-bench'); clear(sec);
    if (!run) return;
    if (run.phase === 'battle') { sec.style.display = 'none'; return; }
    sec.style.display = '';
    GB.Run.syncBench(run);
    var n = Math.max(8, GB.Run.benchSlots(run));
    sec.appendChild(el('div', { class: 'sec-head' },
      '备战席',
      el('span', { class: 'sub', text: run.bench.filter(Boolean).length + '/' + n })
    ));
    var grid = el('div', { class: 'bench' });
    for (var i = 0; i < n; i++) {
      (function (idx) {
        var p = run.bench[idx];
        var slot = el('div', {
          class: 'slot' + (p ? ' filled' : '') + (hoverSlot === idx ? ' dragover' : ''),
          dataset: { i: idx }
        }, p ? tile(p, true) : el('span', { class: 'empty', text: '+' }));
        grid.appendChild(slot);
      }(i));
    }
    sec.appendChild(grid);
  }

  /* ---------------- 兵书 / 名将 ---------------- */
  function renderBuild() {
    if (root.GB && root.GB.storeBridge) return;
    var sec = $('#sec-build'); if (!sec) return; clear(sec);
    if (!run) return;
    if (run.phase === 'battle') { sec.style.display = 'none'; return; }
    sec.style.display = '';
    sec.appendChild(el('div', { class: 'sec-head' }, '兵书', el('span', { class: 'sub', text: run.skills.length + ' 卷' })));
    var wrap = el('div', { class: 'traits' });
    if (!run.skills.length) wrap.appendChild(el('div', { class: 'empty-note', text: '还没有兵书' }));
    run.skills.forEach(function (s) {
      var sk = D.SKILLS[s.id]; if (!sk) return;
      wrap.appendChild(el('div', { class: 'trait' },
        el('div', { class: 'tg ' + (sk.tier === 3 ? 'gold' : ''), text: sk.ch }),
        el('div', {}, el('div', { class: 'tn', text: sk.name }), el('div', { class: 'td', text: sk.desc }))
      ));
    });
    var prog = GB.Run.shardProgress(run);
    var keys = Object.keys(prog);
    if (keys.length) {
      wrap.appendChild(el('div', { class: 'sec-head', style: { marginTop: '6px' } }, '名将'));
      keys.forEach(function (hid) {
        var h = D.HEROES[hid];
        wrap.appendChild(el('div', { class: 'trait' },
          el('div', { class: 'tg gold', text: h.chars[0] }),
          el('div', {}, el('div', { class: 'tn', text: h.name + '　' + prog[hid] + '/2' }), el('div', { class: 'td', text: h.desc }))
        ));
      });
    }
    sec.appendChild(wrap);
  }

  /* ---------------- 棋子详情 ---------------- */
  function stillExists(p) {
    if (!run || !p) return false;
    if (run.bench.indexOf(p) >= 0) return true;
    if (p.cells && p.cells.length) return run.board[MAP.key(p.cells[0].q, p.cells[0].r)] === p;
    return false;
  }

  function row(k, v) {
    return el('div', { class: 'dt-row' },
      el('span', { class: 'dt-k', text: k }),
      el('span', { class: 'dt-v', text: v }));
  }

  function tipHost() {
    var t = document.getElementById('piece-tip');
    if (!t) {
      t = el('div', { id: 'piece-tip' });
      document.body.appendChild(t);
    }
    return t;
  }

  function renderDetail() {
    if (root.GB && root.GB.storeBridge) return;   // 详情卡由 Vue <PeekTip> 渲染
    var tip = tipHost();
    clear(tip);
    if (!run || run.phase === 'battle' || !selected) { tip.className = ''; return; }
    var p = selected;
    var def = p.def || D.pieceById(p.k);
    if (!def) { tip.className = ''; return; }
    if (!stillExists(p)) { selected = null; tip.className = ''; return; }

    var lv = p.level || 1;
    var lm = (D.LVL && D.LVL[lv]) || 1;
    var hs = (D.CFG && D.CFG.hpScale) || 1;
    var isFlag = def.role === 'flag';

    tip.appendChild(el('div', { class: 'pt-h' },
      el('span', { class: 'pt-n', text: def.name }),
      el('span', { class: 'pt-lv', text: lv > 1 ? 'Lv.' + lv : 'Lv.1' }),
      el('span', { class: 'pt-s', text: def.size + ' 格' + (isFlag ? ' · 光环' : '') })
    ));

    if (!isFlag) {
      var parts = ['血 ' + Math.round((def.hp || 0) * lm * hs)];
      if (def.dmg) parts.push('攻 ' + Math.round(def.dmg * lm));
      if (def.heal) parts.push('疗 ' + Math.round(def.heal * lm));
      if (def.shield) parts.push('盾 ' + Math.round(def.shield * lm));
      if (def.atk) parts.push(def.atk.toFixed(1) + 's');
      if (def.range) parts.push('射程 ' + def.range + (def.arc ? '·抛' : ''));
      tip.appendChild(el('div', { class: 'pt-row', text: parts.join('  ·  ') }));
    }

    var sk = D.ULTS[def.id];
    if (sk) {
      tip.appendChild(el('div', { class: 'pt-sk', text: '『' + sk.name + '』' + skDesc(sk) }));
    }
    if (lv >= 3) {
      var ult = D.ROLE_ULT[def.role];
      if (ult) tip.appendChild(el('div', { class: 'pt-ult', text: '大招『' + ult.name + '』' + skDesc(ult) }));
    } else if (!isFlag) {
      tip.appendChild(el('div', { class: 'pt-row', text: '升到 3 级解锁大招' }));
    }
    if (p.ench) {
      var ec = D.ENCHANTS[p.ench];
      tip.appendChild(el('div', { class: 'pt-row', text: '附魔·' + (ec ? ec.name.replace('附魔·', '') : p.ench) }));
    }
    tip.className = 'on';
  }

  function skDesc(u) {
    if (u.kind === 'nuke') return '打最多 ' + u.n + ' 人，各 ' + Math.round(u.v * 100) + '% 攻击' + (u.stun ? '，眩晕 ' + u.stun + ' 秒' : '');
    if (u.kind === 'rear') return '切后排 ' + Math.round(u.v * 100) + '% 攻击' + (u.burn ? '，附带灼烧' : '');
    if (u.kind === 'heal') return '全队回复 ' + Math.round(u.v * 100) + '% 最大生命';
    if (u.kind === 'shield') return '全队获得 ' + Math.round(u.v * 100) + '% 最大生命护盾';
    if (u.kind === 'haste') return '全队攻速 +' + Math.round(u.v * 100) + '%，' + u.dur + ' 秒';
    if (u.kind === 'slow') return '全体敌人减速 ' + Math.round(u.v * 100) + '%，' + u.dur + ' 秒';
    if (u.kind === 'gold') return '立刻 +' + u.v + ' 金';
    return '';
  }

  function select(p) {
    if (selected === p) return;
    selected = p;
    renderDetail();
    if (root.GB && root.GB.storeBridge) {
      root.GB.storeBridge.setEnch(pendingEnch ? pendingEnch.id : null);
      root.GB.storeBridge.sync(run, battle, selected);
    }
  }

  /* ---------------- 底栏 ---------------- */
  function renderAction() {
    if (root.GB && root.GB.storeBridge) return;
    if (!document.getElementById('actionbar')) return;
    // 按钮放进右侧面板（底部固定栏在某些窗口下布局异常）
    var bar = $('#actionbar');
    if (bar) bar.style.display = 'none';
    var host = $('#sec-action');
    if (!host) {
      host = el('div', { class: 'sec', id: 'sec-action' });
      var pn = $('#panel');
      if (pn) pn.appendChild(host);
      else return;
    }
    clear(host);
    if (!run) return;

    var row = el('div', { style: { display: 'block', width: '100%' } });
    host.appendChild(row);

    if (run.phase === 'battle') {
      row.appendChild(el('div', {
        class: 'btn ghost sm pill', style: { display: 'block', width: '100%', marginBottom: '8px' }, text: '速度 ×' + GB.Game.speed(),
        onclick: function () { GB.Game.cycleSpeed(); }
      }));
      var hint = el('div', { class: 'hintbar', text: '战斗中阵型锁定，只能看' });
      row.appendChild(hint);
      return;
    }

    row.appendChild(el('div', {
      class: 'btn ghost sm pill', id: 'sell-zone', text: '卖出',
      style: { opacity: drag ? 1 : 0.45, display: 'block', width: '100%', marginBottom: '8px', textAlign: 'center' }
    }));
    row.appendChild(el('button', {
      class: 'btn ghost pill', style: { display: 'block', width: '100%', marginBottom: '8px' }, disabled: run.gold < 2,
      onclick: function () {
        if (!GB.Shop.reroll(run)) { GB.audio.deny(); toast('金币不足', 'bad'); return; }
        GB.audio.click(); pendingEnch = null; after();
      }
    }, '刷新 · 2'));
    if (isMobile()) {
      row.appendChild(el('button', {
        class: 'btn gold', style: { display: 'block', width: '100%' },
        onclick: function () { openShop(); }
      }, '商店'));
    }
    row.appendChild(el('button', {
      class: 'btn red', style: { display: 'block', width: '100%' },
      onclick: function () { GB.Game.startBattle(); }
    }, '出战 · ' + (run.opp ? run.opp.name : '')));
    host.appendChild(el('div', { class: 'hintbar', style: { marginTop: '6px' }, text: '拖棋子布阵 · 同字同级相叠合成' }));
  }

  /* ---------------- 总渲染 ---------------- */
  function render() {
    if (!run) return;
    renderTop();
    renderShop();
    renderBench();
    renderBuild();
    renderDetail();
    renderAction();
    if (root.GB && root.GB.storeBridge) {
      root.GB.storeBridge.setEnch(pendingEnch ? pendingEnch.id : null);
      root.GB.storeBridge.sync(run, battle, selected);
    }
  }

  function after() {
    GB.Run.checkHeroes(run);
    GB.Run.save(run);
    render();
    if (shopOpen) { closeModal(); openShop(); }
  }

  function tickBattle() {
    if (!battle) return;
    if (root.GB && root.GB.storeBridge && root.GB.storeBridge.tick) root.GB.storeBridge.tick(battle);
    var a = $('#bi-ults');
    if (a) {
      var r = 0;
      for (var i = 0; i < battle.p.length; i++) if (battle.p[i].alive && battle.p[i].ultReady) r++;
      a.textContent = '大招 ' + r + ' / ' + (battle.autoUlt === false ? '手动' : '自动');
    }
    var b = $('#bi-units');
    if (b) b.textContent = '存活 ' + GB.Battle.aliveCount(battle.p) + ' / ' + GB.Battle.aliveCount(battle.e);
  }

  /* ---------------- 拖拽 ---------------- */
  function startDrag(p, ev) {
    if (root.GB && root.GB.storeBridge && root.GB.storeBridge.beginDrag) {
      root.GB.storeBridge.beginDrag(p, ev.clientX, ev.clientY, 'board');
      return;
    }
    var def = p.def || D.pieceById(p.k);
    drag = { piece: p, x: ev.clientX, y: ev.clientY, cell: null, cells: null, valid: false };
    var g = el('div', { class: 'ghost' }, el('span', { text: p.k === 'jiang' ? '将' : (def ? def.ch : '?') }));
    drag.ghost = g;
    var layer = $('#draglayer');
    if (layer) layer.appendChild(g);
    moveGhost(ev.clientX, ev.clientY);
    document.body.style.cursor = 'grabbing';
  }

  function moveGhost(x, y) {
    if (!drag || !drag.ghost) return;
    drag.ghost.style.left = x + 'px';
    drag.ghost.style.top = y + 'px';
  }

  function endDrag() {
    if (drag && drag.ghost && drag.ghost.parentNode) drag.ghost.parentNode.removeChild(drag.ghost);
    drag = null; hoverSlot = -1;
    view.drag = null; view.hover = null;
    document.body.style.cursor = '';
  }

  function updateDragPreview(ev) {
    var cv = $('#board');
    if (!cv) return;
    var r = cv.getBoundingClientRect();
    var inside = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
    if (!inside) { drag.cell = null; drag.cells = null; drag.valid = false; view.drag = null; return; }
    var c = GB.Render.cellAtPx(ev.clientX - r.left, ev.clientY - r.top);
    drag.cell = c;
    if (!c) { drag.cells = null; drag.valid = false; view.drag = null; return; }
    var def = drag.piece.def || D.pieceById(drag.piece.k);
    var res = MAP.findPlacement(run.board, c.c, c.r, def.size, 'p');
    drag.cells = res ? res.cells : null;
    drag.valid = !!res;
    view.drag = { cell: c, cells: res ? res.cells : null, valid: !!res };
  }

  function drop(ev) {
    if (!drag) return;
    var p = drag.piece;
    var sz = $('#sell-zone');
    if (sz) {
      var sr = sz.getBoundingClientRect();
      if (ev.clientX >= sr.left && ev.clientX <= sr.right && ev.clientY >= sr.top && ev.clientY <= sr.bottom) {
        sell(p); endDrag(); return;
      }
    }
    var slots = U.$$('.slot');
    for (var i = 0; i < slots.length; i++) {
      var r2 = slots[i].getBoundingClientRect();
      if (ev.clientX >= r2.left && ev.clientX <= r2.right && ev.clientY >= r2.top && ev.clientY <= r2.bottom) {
        moveToBench(p, parseInt(slots[i].dataset.i, 10));
        endDrag();
        return;
      }
    }
    var cv = $('#board');
    if (!cv) { endDrag(); return; }
    var cr = cv.getBoundingClientRect();
    if (ev.clientX >= cr.left && ev.clientX <= cr.right && ev.clientY >= cr.top && ev.clientY <= cr.bottom) {
      var c = GB.Render.cellAtPx(ev.clientX - cr.left, ev.clientY - cr.top);
      if (c) placeOn(p, c);
    }
    endDrag();
  }

  function placeOn(p, c) {
    var target = GB.Run.pieceAt(run, c.q, c.r);
    if (target && target !== p) {
      if (GB.Run.canMerge(target, p)) {
        GB.Run.mergeInto(run, target, p);
        if (selected === p) selected = target;
        GB.audio.merge();
        toast('合成 → ' + (D.pieceById(target.k) || {}).name + ' ' + target.level + ' 级', 'good');
        after();
        return;
      }
      toast('只能与同字同级的棋子合成', 'bad');
      GB.audio.deny();
      return;
    }
    if (target === p) return;
    if (GB.Run.placeAt(run, p, c.q, c.r)) {
      GB.audio.place();
      after();
    } else {
      GB.audio.deny();
      toast('放不下（' + ((p.def || D.pieceById(p.k)) || {}).size + ' 格）');
    }
  }

  function moveToBench(p, idx) {
    var cur = run.bench[idx];
    if (cur === p) return;
    GB.Run.removePiece(run, p);
    if (cur && !GB.Run.addToBench(run, cur)) {
      GB.Run.addToBench(run, cur);
    }
    run.bench[idx] = p;
    p.cells = null;
    GB.Run.syncBench(run);
    GB.audio.place();
    after();
  }

  function sell(p) {
    if (selected === p) selected = null;
    var v = GB.Shop.sellValue(run, p);
    GB.Run.removePiece(run, p);
    run.gold += v;
    GB.audio.coin();
    toast('卖出 +' + v + ' 金', 'gold');
    after();
  }

  /* ---------------- 事件绑定 ---------------- */
  var boundCanvas = null, windowBound = false;

  function bind() {
    var cv = $('#board');
    if (!cv) return;
    if (boundCanvas === cv) return;   // 同一块画布已经绑过
    boundCanvas = cv;

    cv.addEventListener('pointerdown', function (ev) {
      GB.audio.unlock();
      if (!run) return;
      var r = cv.getBoundingClientRect();
      var c = GB.Render.cellAtPx(ev.clientX - r.left, ev.clientY - r.top);
      if (!c) return;
      var p = GB.Run.pieceAt(run, c.q, c.r);

      if (run.phase === 'battle') {
        if (p && GB.Game.useUlt(p)) {
          GB.audio.hero();
          toast('大招 · ' + (p.ultDef ? p.ultDef.name : ''), 'gold');
          tickBattle();
        } else if (p && p.canUlt && !p.ultReady) {
          toast('大招蓄力中 ' + Math.round((p.ultT || 0) * 100) + '%');
        }
        return;
      }

      if (pendingEnch) {
        if (p && GB.Shop.buyEnchant(run, pendingEnch, p)) {
          GB.audio.hero(); pendingEnch = null; toast('附魔成功', 'good'); after();
        } else if (p && p.ench) toast('该棋子已有附魔', 'bad');
        return;
      }

      // 晨市：点没解锁的格子 → 先显示价格，再点一次买下
      if (run.phase === 'shop' && GB.Run.canUnlock && !GB.Run.isOwned(run, c.c, c.r)) {
        var pend = GB.Render.getPending ? GB.Render.getPending() : null;
        if (pend && pend.c === c.c && pend.r === c.r) {
          var res = GB.Run.unlockCell(run, c.c, c.r);
          if (res && res.ok) {
            GB.audio.coin(); GB.Render.setPending(null);
            toast('解锁一格 · ' + res.price + ' 金（' + res.cells + '）', 'gold');
            after();
          } else if (res && res.why === 'gold') {
            GB.audio.deny(); toast('金币不足（' + res.price + ' 金）', 'bad');
          } else {
            GB.audio.deny(); toast('要挨着已有的格子扩', 'bad');
          }
        } else if (GB.Run.canUnlock(run, c.c, c.r)) {
          GB.Render.setPending(c);
          toast('解锁这格 · ' + GB.Run.nextCellPrice(run) + ' 金');
        } else {
          GB.audio.deny(); toast('要挨着已有的格子扩', 'bad');
        }
        ev.preventDefault();
        return;
      }
      if (GB.Render.setPending) GB.Render.setPending(null);

      // 棋子只靠拖动移动：点空格只是取消选中（点棋子＝选中看详情）
      if (!p) { select(null); return; }
      select(p);
      ev.preventDefault();
      startDrag(p, ev);
    });

    var bench = $('#sec-bench');
    if (bench) bench.addEventListener('pointerdown', function (ev) {
      if (!run || run.phase === 'battle') return;
      var slot = ev.target.closest ? ev.target.closest('.slot') : null;
      if (!slot) return;
      var p = run.bench[parseInt(slot.dataset.i, 10)];
      if (!p) return;
      if (pendingEnch) {
        if (GB.Shop.buyEnchant(run, pendingEnch, p)) { GB.audio.hero(); pendingEnch = null; toast('附魔成功', 'good'); after(); }
        return;
      }
      select(p);
      ev.preventDefault();
      startDrag(p, ev);
    });

    if (windowBound) return;
    windowBound = true;

    window.addEventListener('pointermove', function (ev) {
      if (!drag) return;
      drag.x = ev.clientX; drag.y = ev.clientY;
      moveGhost(ev.clientX, ev.clientY);
      updateDragPreview(ev);
      var slot = -1, slots = U.$$('.slot');
      for (var i = 0; i < slots.length; i++) {
        var r = slots[i].getBoundingClientRect();
        if (ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom) { slot = i; break; }
      }
      if (slot !== hoverSlot) { hoverSlot = slot; renderBench(); }
    }, { passive: true });

    window.addEventListener('pointerup', function (ev) { if (drag) drop(ev); });
    window.addEventListener('pointercancel', function () { endDrag(); });

    $('#btn-menu').addEventListener('click', function () { GB.Game.openMenu(); });
    $('#btn-sound').addEventListener('click', function () {
      var on = !GB.audio.isOn();
      GB.audio.enable(on);
      this.className = 'icon-btn' + (on ? '' : ' off');
      if (on) GB.audio.click();
    });
    $('#btn-speed').addEventListener('click', function () { GB.Game.cycleSpeed(); });
  }

  /* ---------------- 弹窗 ---------------- */
  function modal(opts) {
    var ov = $('#overlay');
    if (!ov) return null;
    ov.className = 'overlay';
    clear(ov);
    var box = el('div', { class: 'modal' + (opts.wide ? ' wide' : '') });
    if (opts.title) box.appendChild(el('h2', { text: opts.title }));
    if (opts.sub) box.appendChild(el('div', { class: 'muted', style: { marginTop: '4px' }, text: opts.sub }));
    if (opts.body) box.appendChild(opts.body);
    if (opts.actions && opts.actions.length) {
      var acts = el('div', { class: 'modal-actions' });
      opts.actions.forEach(function (a) {
        acts.appendChild(el('button', {
          class: 'btn ' + (a.cls || 'ghost'), disabled: !!a.disabled,
          onclick: function () { GB.audio.click(); if (a.onClick) a.onClick(); }
        }, a.label));
      });
      box.appendChild(acts);
    }
    ov.appendChild(box);
    return box;
  }

  function closeModal() {
    if (root.GB && root.GB.storeBridge) root.GB.storeBridge.setModal(null);
    var ov = $('#overlay');
    if (!ov) return;
    ov.className = 'overlay hidden';
    clear(ov);
  }

  /* ---------------- 门派选择 ---------------- */
  function showTitle(hasSave) {
    if (root.GB && root.GB.storeBridge) {
      root.GB.storeBridge.setModal({
        kind: 'title',
        hasSave: !!hasSave,
        factions: Object.keys(D.FACTIONS).map(function (k) {
          var f = D.FACTIONS[k];
          return {
            id: k, name: f.name, hero: f.hero, promise: f.promise, color: f.color,
            pieces: f.pieces.map(function (id) { var p = D.pieceById(id); return p ? p.ch : ''; })
          };
        })
      });
      return;
    }
    var wrap = el('div', { class: 'title-screen' });
    var inner = el('div', { class: 'title-inner' },
      el('div', { class: 'title-seal', text: '字' }),
      el('h1', { class: 'title-zh', text: '符阵' }),
      el('div', { class: 'title-en', text: 'GLYPH CLASH' }),
      el('div', { class: 'title-sub', html: '在六边形的背包里摆汉字人物，<br>让它们自己打完这一仗。' })
    );
    var grid = el('div', { class: 'factions' });
    Object.keys(D.FACTIONS).forEach(function (k) {
      var f = D.FACTIONS[k];
      grid.appendChild(el('div', {
        class: 'faction', style: { borderColor: f.color },
        onclick: function () {
          GB.audio.unlock(); GB.audio.gong();
          if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
          GB.Game.newRun(k);
        }
      },
        el('div', { class: 'fname', text: f.name, style: { color: f.color } }),
        el('div', { class: 'fhero', text: f.hero }),
        el('div', { class: 'fpromise', text: f.promise }),
        el('div', { class: 'fpcs' }, f.pieces.map(function (id) {
          var p = D.pieceById(id);
          return el('span', { class: 'fp', text: p ? p.ch : '' });
        }))
      ));
    });
    inner.appendChild(grid);
    if (hasSave) {
      inner.appendChild(el('div', { class: 'title-actions' },
        el('button', {
          class: 'btn ghost',
          onclick: function () { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); GB.Game.continueRun(); }
        }, '继续经营')
      ));
    }
    inner.appendChild(el('div', { class: 'title-foot', text: '选一个门派 · 10 天内赢下 6 场对局' }));
    wrap.appendChild(inner);
    document.body.appendChild(wrap);
  }

  /* ---------------- 结算 ---------------- */
  function showResult(win, info) {
    if (root.GB && root.GB.storeBridge) {
      root.GB.storeBridge.setModal({
        kind: 'outcome',
        win: !!win,
        seal: win ? '胜' : '败',
        title: win ? '论战得胜' : '阵线失守',
        sub: info.sub,
        rows: info.rows,
        next: info.next || '继续'
      });
      return;
    }
    var body = el('div', {},
      el('div', { class: 'outcome' },
        el('div', { class: 'seal ' + (win ? 'win' : 'lose'), text: win ? '胜' : '败' }),
        el('div', {},
          el('h3', { text: win ? '论战得胜' : '阵线失守' }),
          el('div', { class: 'muted', style: { marginTop: '6px' }, text: info.sub })
        )
      )
    );
    if (info.rows && info.rows.length) {
      var list = el('div', { class: 'rewardlist' });
      info.rows.forEach(function (r) { list.appendChild(el('div', { class: 'reward', html: r })); });
      body.appendChild(list);
    }
    modal({
      body: body,
      actions: [{ label: info.next || '继续', cls: 'red', onClick: function () { closeModal(); GB.Game.next(); } }]
    });
  }

  function getRun() { return run; }
  // 从备战席发起拖动（Vue 侧指针事件调用）
  function beginDragFromBench(i, x, y) {
    var p = run && run.bench[i];
    if (!p) return false;
    if (root.GB && root.GB.storeBridge && root.GB.storeBridge.beginDrag) {
      root.GB.storeBridge.beginDrag(p, x, y, 'bench');
      return true;
    }
    return false;
  }

  function moveToBenchAt(p, idx) {
    if (!run || !p) return false;
    GB.Run.syncBench(run);
    if (idx < 0) idx = 0;
    if (idx >= run.bench.length) idx = run.bench.length - 1;
    moveToBench(p, idx);
    return true;
  }

  function selectSlot(i) {
    // 只负责选中/取消选中；移动与合成都走拖动
    var p = run && run.bench[i];
    if (!p) { select(null); return; }
    select(selected === p ? null : p);
  }
  function sellPiece(p) { sell(p); }
  function refresh() { after(); }

  function chooseEvo(id) {
    var p = GB.Run.pendingEvo(run);
    if (!p) return false;
    if (!GB.Run.chooseEvo(run, p, id)) return false;
    GB.audio.hero();
    toast('进化完成', 'gold');
    after();
    return true;
  }

  function chooseBook(id) {
    if (!run || !id) return false;
    var sk = D.skillById(id);
    if (!sk) return false;
    if (!GB.Run.chooseBook(run, id, Math.min(GB.Run.skillTierMax(run), sk.tier || 1))) return false;
    GB.audio.hero();
    toast('得兵书 · ' + sk.name, 'gold');
    after();
    return true;
  }

  function closeShop() {
    shopOpen = false;
    if (root.GB && root.GB.storeBridge) { root.GB.storeBridge.setShop(false); return; }
    closeModal();
  }

  function buyOfferById(id) {
    if (!run) return;
    var list = run.offers || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) { onBuy(list[i]); return; }
  }

  function useUltById(id) {
    if (!battle) return;
    for (var i = 0; i < battle.p.length; i++) {
      var p = battle.p[i];
      if (p.id !== id) continue;
      if (GB.Game.useUlt(p)) { GB.audio.hero(); tickBattle(); }
      return;
    }
  }

  function init() { bind(); }

  GB.UI = {
    init: init,
    render: render,
    tickBattle: tickBattle,
    renderAction: renderAction,
    setRun: function (r) { run = r; },
    setBattle: function (b) { battle = b; },
    getView: function () { return view; },
    toast: toast,
    modal: modal,
    closeModal: closeModal,
    showTitle: showTitle,
    showResult: showResult,
    tile: tile,
    select: select,
    getRun: getRun,
    selectSlot: selectSlot,
    beginDragFromBench: beginDragFromBench,
    moveToBenchAt: moveToBenchAt,
    sellPiece: sellPiece,
    refresh: refresh,
    openShop: openShop,
    closeShop: closeShop,
    chooseEvo: chooseEvo,
    chooseBook: chooseBook,
    buyOfferById: buyOfferById,
    useUltById: useUltById,
    renderDetail: renderDetail
  };
}(typeof window !== 'undefined' ? window : globalThis));
