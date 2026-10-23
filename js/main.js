/* main.js — 状态机、主循环、战斗结算 */
(function (root) {
  'use strict';
  var GB = root.GB = root.GB || {};
  var D = GB.D, U = GB.U, MAP = GB.MAP;
  var $ = U.$;

  var run = null, battle = null;
  var speed = 1, acc = 0, lastT = 0;
  var endTimer = 0, finishing = false;
  var sfxGate = 0, uiTick = 0;
  var autoUlt = true;

  /* ---------------- 流程 ---------------- */
  function newRun(faction) {
    run = GB.Run.newRun(Math.floor(Math.random() * 1e9), faction);
    battle = null;
    GB.UI.setRun(run);
    GB.UI.setBattle(null);
    GB.UI.render();
    GB.Run.save(run);
    GB.audio.click();
  }

  function continueRun() {
    var r = GB.Run.load();
    if (!r) { GB.UI.toast('没有存档', 'bad'); return; }
    run = r; battle = null;
    GB.UI.setRun(run);
    GB.UI.setBattle(null);
    GB.UI.render();
  }

  function startBattle() {
    if (!run || run.phase !== 'shop' || !run.opp) return;
    var fighters = GB.Run.boardPieces(run).filter(function (p) {
      var d = p.def || GB.D.pieceById(p.k);
      return d && d.role !== 'flag';
    });
    if (!GB.Run.boardPieces(run).length) {
      GB.UI.toast('先把棋子拖到棋盘上', 'bad');
      GB.audio.deny();
      return;
    }
    if (!fighters.length) {
      GB.UI.toast('光有挂件打不了，至少放一个能打的', 'bad');
      GB.audio.deny();
      return;
    }
    var opp = run.opp;
    battle = GB.Battle.create({
      day: run.day,
      piecesP: GB.Run.boardPieces(run),
      piecesO: opp.pieces,
      gridP: run.board,
      gridO: GB.AI.gridFrom(opp.pieces),
      modsP: GB.Run.mods(run),
      modsO: opp.mods,
      factionP: run.faction,
      factionO: opp.faction,
      booksP: run.skills,
      ownedCells: GB.Run.cellsN(run),
      frontRowP: GB.MAP.frontRow('p'),
      autoUlt: autoUlt,
      seed: (run.seed + run.day * 977) | 0
    });
    run.phase = 'battle';
    acc = 0; endTimer = 0; finishing = false;
    GB.Render.setMode(true);
    GB.UI.setBattle(battle);
    GB.UI.render();
    GB.audio.gong();
  }

  function finishBattle() {
    if (finishing) return;
    finishing = true;
    var win = battle.status === 'win';
    var t = battle.t;
    var aliveP = GB.Battle.aliveCount(battle.p), aliveO = GB.Battle.aliveCount(battle.e);
    var hpP = Math.round(GB.Battle.sumHp(battle.p)), hpO = Math.round(GB.Battle.sumHp(battle.e));

    var w0 = run.wins, p0 = run.prestige, day = run.day;
    GB.Run.endBattle(run, win, battle);

    var rows = [
      { k: '用时', v: t.toFixed(0) + ' 秒' },
      { k: '我方存活', v: aliveP + ' 子' },
      { k: '敌方存活', v: aliveO + ' 子' },
      { k: '残余血量', v: hpP + ' / ' + hpO }
    ];
    rows.unshift({ k: '声望', v: p0 + ' → ' + (win ? p0 : run.prestige) });

    GB.UI.showResult(win, {
      sub: win
        ? '第 ' + day + ' 天 · 第 ' + run.wins + ' 胜'
        : '第 ' + day + ' 天 · 声望 −' + day,
      rows: rows,
      next: '继续'
    });
    GB.Run.save(run);
  }

  function next() {
    battle = null;
    GB.Render.setMode(false);
    GB.UI.setBattle(null);
    if (run.phase === 'win') { showEnd(true); return; }
    if (run.phase === 'over') { showEnd(false); return; }
    GB.UI.render();
  }

  function showEnd(won) {
    if (GB.storeBridge) {
      GB.storeBridge.setModal({
        kind: 'outcome',
        win: !!won,
        end: true,
        seal: won ? '霸' : '败',
        title: won ? '字阵登顶' : '声望耗尽',
        sub: '第 ' + run.day + ' 天 · ' + run.wins + ' 胜 ' + run.losses + ' 负',
        next: '再开一局'
      });
      return;
    }
    var body = U.el('div', {},
      U.el('div', { class: 'outcome' },
        U.el('div', { class: 'seal ' + (won ? 'win' : 'lose'), text: won ? '霸' : '败' }),
        U.el('div', {},
          U.el('h3', { text: won ? '字阵登顶' : '声望耗尽' }),
          U.el('div', { class: 'muted', style: { marginTop: '6px' }, text: '第 ' + run.day + ' 天 · ' + run.wins + ' 胜 ' + run.losses + ' 负' })
        )
      )
    );
    GB.UI.modal({
      body: body,
      actions: [
        { label: '再开一局', cls: 'red', onClick: function () { GB.UI.closeModal(); U.clearSave(); location.reload(); } }
      ]
    });
  }

  function useUlt(p) {
    if (!battle || battle.status !== 'run') return false;
    return GB.Battle.useUlt(battle, p);
  }

  function toggleAutoUlt() {
    autoUlt = !autoUlt;
    if (battle) battle.autoUlt = autoUlt;
    GB.UI.toast('大招：' + (autoUlt ? '自动释放' : '手动释放'), 'gold');
    GB.UI.render();
    return autoUlt;
  }

  function isAutoUlt() { return autoUlt; }

  function cycleSpeed() {
    speed = speed === 1 ? 2 : speed === 2 ? 3 : 1;
    GB.UI.renderAction();
    GB.UI.toast('速度 ×' + speed);
  }

  function openMenu() {
    if (GB.storeBridge) {
      GB.storeBridge.setModal({ kind: 'menu', autoUlt: autoUlt });
      return;
    }
    var body = U.el('div', {},
      U.el('p', { text: '按住棋子拖到棋盘上摆阵；棋子在棋盘上互相拖拽可以换位。' }),
      U.el('p', { text: '把一颗拖到同字同级的另一颗上即可合成升级；棋子占 1～3 格，放不下会有提示。' }),
      U.el('p', { text: '点棋子可以看详情；点空白处收起。每枚棋子都有小技能（自动），3 级起解锁大招，可在对局面板的大招条里手动放。' }),
      U.el('p', { class: 'muted', text: '对局最长 55 秒，超时比双方剩余总血量。' }),
      U.el('p', { class: 'muted', text: '输一场按当天进度扣声望，声望归零即出局；10 天内赢 6 场登顶。' })
    );
    GB.UI.modal({
      title: '玩法',
      body: body,
      actions: [
        {
          label: autoUlt ? '大招：自动释放' : '大招：手动释放', cls: 'gold',
          onClick: function () { toggleAutoUlt(); GB.UI.closeModal(); openMenu(); }
        },
        { label: '重新开始', cls: 'ghost', onClick: function () { U.clearSave(); location.reload(); } },
        { label: '返回', cls: 'red', onClick: function () { GB.UI.closeModal(); } }
      ]
    });
  }

  /* ---------------- 循环 ---------------- */
  function drainEvents() {
    if (!battle) return;
    var evs = battle.events;
    for (var i = 0; i < evs.length; i++) {
      var ev = evs[i];
      GB.Render.onEvent(ev);
      if (ev.type === 'kill') {
        if (sfxGate <= 0) { GB.audio.kill(); sfxGate = 0.06; }
      } else if (ev.type === 'hitbase') GB.audio.leak();
      else if (ev.type === 'spawn') { if (sfxGate <= 0) { GB.audio.place(); sfxGate = 0.08; } }
      else if (ev.type === 'burst') GB.audio.kill();
      else if (ev.type === 'laststand') { GB.audio.gong(); GB.UI.toast(ev.side === 'p' ? '背水一战！' : '敌方背水一战', ev.side === 'p' ? 'gold' : 'bad'); }
      else if (ev.type === 'sandstorm') GB.UI.toast('沙暴来袭', 'bad');
      else if (ev.type === 'order') GB.audio.hero();
      else if (ev.type === 'heal' || ev.type === 'shield' || ev.type === 'charge') { if (sfxGate <= 0) { GB.audio.buy(); sfxGate = 0.1; } }
    }
    evs.length = 0;
  }

  function loop(ts) {
    var dt = (ts - lastT) / 1000;
    if (!isFinite(dt) || dt <= 0) dt = 0.016;
    dt = Math.min(dt, 0.05);
    lastT = ts;
    sfxGate -= dt;

    if (battle && battle.status === 'run') {
      acc += dt * speed;
      var guard = 0;
      while (acc >= 1 / 60 && guard++ < 10) {
        GB.Battle.step(battle, 1 / 60);
        acc -= 1 / 60;
      }
      if (battle.status !== 'run') endTimer = 1.1;
    } else if (battle && battle.status !== 'run' && !finishing) {
      endTimer -= dt;
      if (endTimer <= 0) finishBattle();
    }

    drainEvents();
    uiTick -= dt;
    if (uiTick <= 0) { uiTick = 0.4; if (battle) GB.UI.tickBattle(); }
    GB.Render.update(dt, run, battle, GB.UI.getView());
    GB.Render.draw();
    requestAnimationFrame(loop);
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    GB.Render.init($('#board'));
    GB.UI.init();
    var qs = {};
    try {
      var raw = location.search.replace(/^\?/, '') + '&' + location.hash.replace(/^#/, '');
      raw.split('&').forEach(function (kv) {
        var a = kv.split('='); if (a[0]) qs[a[0]] = decodeURIComponent(a[1] || '');
      });
    } catch (e) { }

    if (qs.faction) {
      newRun(qs.faction);
      var d = parseInt(qs.day || '1', 10);
      if (d > 1) {
        for (var i = 1; i < d && run.phase === 'shop'; i++) {
          autoPlayOneDay();
        }
        GB.UI.render();
      }
      if (qs.sel !== undefined && qs.sel !== '') {
        if (!Object.keys(run.board).length) autoPlace();
        var fk = Object.keys(run.board)[0];
        if (fk) {
          var pp = run.board[fk];
          if (qs.lv) pp.level = parseInt(qs.lv, 10) || 1;
          GB.UI.select(pp);
        }
      }
      if (qs.auto === 'battle') {
        autoPlace();
        GB.UI.render();
        startBattle();
        var ff = parseFloat(qs.ff || '0');
        if (ff > 0) {
          var steps = Math.min(20000, Math.floor(ff * 60));
          for (var s = 0; s < steps && battle.status === 'run'; s++) GB.Battle.step(battle, 1 / 60);
          drainEvents();
          GB.UI.render();
        }
      }
    } else {
      GB.UI.showTitle(U.hasSave());
    }

    window.addEventListener('resize', function () { GB.Render.layout(); });
    requestAnimationFrame(function (t) { lastT = t; requestAnimationFrame(loop); });
  }

  // 调试用：自动买、自动摆、打一场、进下一天
  function autoPlace() {
    var merged = true, guard = 0;
    while (merged && guard++ < 40) {
      merged = false;
      var all = GB.Run.allPieces(run);
      outer: for (var i = 0; i < all.length; i++) for (var j = i + 1; j < all.length; j++) {
        if (GB.Run.canMerge(all[i], all[j])) { GB.Run.mergeInto(run, all[i], all[j]); merged = true; break outer; }
      }
    }
    var cells = MAP.playerCells();
    for (var k = 0; k < run.bench.length; k++) {
      var p = run.bench[k];
      if (!p) continue;
      var def = p.def || D.pieceById(p.k);
      var rows = MAP.rowsFor('p', def.role);
      var done = false;
      for (var q = 0; q < rows.length && !done; q++) {
        for (var m = 0; m < cells.length; m++) {
          if (cells[m].r !== rows[q]) continue;
          if (GB.Run.placeAt(run, p, cells[m].q, cells[m].r)) { done = true; break; }
        }
      }
    }
  }

  function autoPlayOneDay() {
    var guard = 0;
    while (guard++ < 8) {
      var o = null;
      for (var i = 0; i < run.offers.length; i++) {
        var of = run.offers[i];
        if (!of.sold && of.type !== 'ench' && run.gold >= of.price) { o = of; break; }
      }
      if (!o) break;
      GB.Shop.buy(run, o);
    }
    autoPlace();
    var opp = run.opp;
    battle = GB.Battle.create({
      day: run.day, piecesP: GB.Run.boardPieces(run), piecesO: opp.pieces,
      gridP: run.board, gridO: GB.AI.gridFrom(opp.pieces),
      modsP: GB.Run.mods(run), modsO: opp.mods,
      factionP: run.faction, factionO: opp.faction, seed: (run.seed + run.day * 977) | 0
    });
    var g = 0;
    while (battle.status === 'run' && g++ < 15000) GB.Battle.step(battle, 1 / 60);
    GB.Run.endBattle(run, battle.status === 'win', battle);
    battle = null;
    GB.UI.setBattle(null);
  }

  GB.Game = {
    newRun: newRun,
    continueRun: continueRun,
    startBattle: startBattle,
    next: next,
    useUlt: useUlt,
    toggleAutoUlt: toggleAutoUlt,
    isAutoUlt: isAutoUlt,
    cycleSpeed: cycleSpeed,
    speed: function () { return speed; },
    openMenu: openMenu,
    afterChange: function () { GB.UI.render(); }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}(typeof window !== 'undefined' ? window : globalThis));
