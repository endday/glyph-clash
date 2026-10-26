import { reactive } from 'vue'

// Vue 侧界面状态：由 game 层通过 storeBridge 单向推入，组件只读 + 调 GB.* 方法
export const ui = reactive({
  day: 1,
  slotCount: 4,
  cellsN: 6,
  cellsMax: 22,
  cellsUsed: 0,
  bench: [],           // [{id, ch, lv, sz, hero, shard, ench}]
  benchView: [],       // 备战席网格：{id, ch, lv, sz, w, h, idx}（按真实大小占格）
  benchRows: 3,        // 网格 4 列 × 3 行
  benchCap: 6,         // 可用的格数（藏兵 +2/+4）
  gold: 0,
  phase: 'shop',       // shop | battle
  opp: '',
  speed: 1,
  sel: null,           // 选中棋子 id
  wins: 0,
  prestige: 3,
  inited: false,

  offers: [],          // 晨市商品
  shopOpen: false,
  enchId: null,        // 待附魔的 offer id
  detail: null,        // 棋子详情卡
  log: [],             // 战报（最近 5 条）
  modal: null,         // 弹窗：title / outcome / menu
  evo: null,           // 待选规则进化 {id, ch, name, options}
  books: { slots: 0, list: [], offer: [] },   // 兵书＝遗物：槽位 / 已拥有 / 三选一
  toasts: [],          // 浮动提示
  drag: null,          // 拖动中的棋子 {id, ch, hero, x, y, active, from}
  b: null,             // 战斗快照
  rev: 0               // 每次 sync 递增，供 computed 依赖
})

const GB = () => window.GB
let toastSeq = 0

/* ---------------- 小工具 ---------------- */
// 攻击距离的说法（和 battle.js 的规则一一对应）
function rangeLabel(def) {
  var kind = def.splash ? '溅射' : def.pierce ? '穿透' : '单体'
  if (def.arc) return '抛射·' + kind
  if ((def.range || 1) <= 1) return '近战·' + (def.splash ? '横扫' : '单体')
  return '长兵·' + kind + '（可及 ' + def.range + ' 排）'
}

// 光环文案：用战斗里同一套公式算，所以升级后数字会跟着变
function auraText(def, lv) {
  const g = GB()
  const v = g && g.Battle && g.Battle.auraValue ? g.Battle.auraValue(def, lv) : def.value
  const pct = Math.round(v * 100)
  if (def.aura === 'dmg') return '相邻棋子攻击 +' + pct + '%'
  if (def.aura === 'spd') return '相邻棋子攻速 +' + pct + '%'
  if (def.aura === 'hp') return '相邻棋子血量 +' + pct + '%'
  if (def.aura === 'range') return '相邻棋子射程 +' + v
  if (def.aura === 'burn') return '相邻棋子攻击附带灼烧（每秒 ' + pct + '% 攻击）'
  if (def.aura === 'slow') return '相邻棋子攻击附带减速 ' + pct + '%'
  if (def.aura === 'poison') return '相邻棋子攻击附带中毒（每秒 ' + pct + '% 攻击）'
  if (def.aura === 'gold') return '相邻棋子击杀 +' + v + ' 金'
  return ''
}

function skDesc(u) {
  if (!u) return ''
  if (u.kind === 'nuke') return `打最多 ${u.n} 人，各 ${Math.round(u.v * 100)}% 攻击${u.stun ? `，眩晕 ${u.stun} 秒` : ''}`
  if (u.kind === 'rear') return `切后排 ${Math.round(u.v * 100)}% 攻击${u.burn ? '，附带灼烧' : ''}`
  if (u.kind === 'heal') return `全队回复 ${Math.round(u.v * 100)}% 最大生命`
  if (u.kind === 'shield') return `全队获得 ${Math.round(u.v * 100)}% 最大生命护盾`
  if (u.kind === 'haste') return `全队攻速 +${Math.round(u.v * 100)}%，${u.dur} 秒`
  if (u.kind === 'slow') return `全体敌人减速 ${Math.round(u.v * 100)}%，${u.dur} 秒`
  if (u.kind === 'gold') return `立刻 +${u.v} 金`
  return ''
}

function snapPiece(p) {
  if (!p) return null
  const D = GB().D
  const def = p.def || D.pieceById(p.k)
  if (!def) return null
  return {
    id: p.id,
    ch: p.k === 'jiang' ? '将' : def.ch,
    lv: p.level || 1,
    sz: def.size,
    hero: p.k === 'jiang',
    shard: def.role === 'shard',
    ench: p.ench || null
  }
}

function snapOffer(o, run) {
  const D = GB().D
  const out = {
    id: o.id,
    price: o.price,
    sold: !!o.sold,
    glyph: '?',
    name: '',
    kind: '',
    desc: '',
    badge: '',
    tone: '',
    cant: !o.sold && run.gold < o.price
  }
  if (o.type === 'piece') {
    const d = D.pieceById(o.k)
    if (!d) return { ...out, sold: true, name: '已售' }
    out.glyph = d.ch
    out.name = d.name
    out.kind = `${d.size} 格${d.role === 'flag' ? ' · 光环' : ''}`
    out.desc = d.desc || ''
    if (d.role === 'shard') { out.badge = '名将'; out.tone = 'gold' }
  } else if (o.type === 'skill') {
    const s = D.SKILLS[o.skillId]
    if (!s) return { ...out, sold: true, name: '已售' }
    out.glyph = s.ch
    out.name = '兵书·' + s.name
    out.kind = '全局被动'
    out.desc = s.desc
    out.badge = s.tier === 3 ? '上品' : s.tier === 2 ? '中品' : ''
    out.tone = 'gold'
  } else if (o.type === 'ench') {
    const e = D.ENCHANTS[o.enchId]
    if (!e) return { ...out, sold: true, name: '已售' }
    out.glyph = e.ch
    out.name = e.name
    out.kind = '附魔'
    out.desc = e.desc
    out.badge = '附魔'
    out.tone = 'jade'
  }
  return out
}

function snapDetail(p) {
  const D = GB().D
  const def = p.def || D.pieceById(p.k)
  if (!def) return null
  const lv = p.level || 1
  const lm = (D.LVL && D.LVL[lv]) || 1
  const hs = (D.CFG && D.CFG.hpScale) || 1
  const isFlag = def.role === 'flag'
  const stats = []
  if (!isFlag) {
    stats.push('血 ' + Math.round((def.hp || 0) * lm * hs))
    if (def.dmg) stats.push('攻 ' + Math.round(def.dmg * lm))
    if (def.heal) stats.push('疗 ' + Math.round(def.heal * lm))
    if (def.shield) stats.push('盾 ' + Math.round(def.shield * lm))
    if (def.atk) stats.push(def.atk.toFixed(1) + 's')
    stats.push(rangeLabel(def))
  }
  const aura = def.aura ? auraText(def, lv) : ''
  const small = D.ULTS[def.id]
  const ult = lv >= 3 ? D.ROLE_ULT[def.role] : null
  return {
    id: p.id,
    name: def.name,
    lv,
    ch: p.k === 'jiang' ? '将' : def.ch,
    sizeLabel: def.size + ' 格' + (isFlag ? ' · 无血挂件' : ''),
    structure: isFlag,
    stats,
    aura: aura,
    auraLv: def.aura ? lv : 0,
    skill: small ? { name: small.name, desc: skDesc(small) } : null,
    ult: ult ? { name: ult.name, desc: skDesc(ult) } : null,
    hint: !isFlag && lv < 3 ? '升到 3 级解锁大招' : '',
    ench: p.ench || null
  }
}

const CHAIN_LABEL = {
  hit: '命中',
  burn_tick: '燃烧',
  trigger: '触发',
  hurt: '受击'
}

function snapBattle(b) {
  const B = GB().Battle
  const sum = (list) => list.reduce((a, p) => a + (p.alive ? p.hp : 0), 0)
  const max = (list) => list.reduce((a, p) => a + (p.maxHp || 0), 0) || 1
  const pv = B.aliveCount(b.p)
  const ov = B.aliveCount(b.e)
  const ults = b.p
    .filter((p) => p.canUlt && p.alive)
    .map((p) => ({ id: p.id, ch: p.def ? p.def.ch : '?', ready: !!p.ultReady, pct: Math.round((p.ultT || 0) * 100) }))
  return {
    t: b.t,
    pv,
    ov,
    php: Math.round((sum(b.p) / max(b.p)) * 100),
    ohp: Math.round((sum(b.e) / max(b.e)) * 100),
    pMax: b.p.filter((x) => !x.structure).length,
    eMax: b.e.filter((x) => !x.structure).length,
    autoUlt: b.autoUlt !== false,
    ults,
    ready: ults.filter((u) => u.ready).length,
    chain: (B.trace ? B.trace(b) : []).map((e) => ({
      t: e.t,
      label: CHAIN_LABEL[e.type] || e.type,
      src: e.src,
      tgt: e.tgt
    }))
  }
}

/* ---------------- 桥 ---------------- */
export function installBridge() {
  const g = GB()
  if (typeof window !== 'undefined') window.__ui = ui
  if (!g) return
  let lastTick = 0

  g.storeBridge = {
    sync(run, battle, selected) {
      if (!run) return
      g.Run.syncBench(run)
      ui.slotCount = g.Run.benchSlots(run)
      ui.bench = run.bench.map(snapPiece)
      // 备战席按「真实大小」排布：1 格 1×1、2 格 2×1、4 格 2×2、6 格 2×3、9 格 3×3
      ;(function layoutBench() {
        var COLS = 4, ROWS = 24, grid = [], view = []
        for (var gi = 0; gi < COLS * ROWS; gi++) grid.push(0)
        function shape(sz) {
          if (sz >= 9) return { w: 3, h: 3 }
          if (sz >= 6) return { w: 2, h: 3 }
          if (sz >= 4) return { w: 2, h: 2 }
          if (sz >= 2) return { w: 2, h: 1 }
          return { w: 1, h: 1 }
        }
        for (var bi = 0; bi < run.bench.length; bi++) {
          var bp = run.bench[bi]
          if (!bp) continue
          var d = g.D.pieceById(bp.k) || {}
          var sh = shape(d.size || 1)
          var spot = null
          for (var r0 = 0; r0 + sh.h <= ROWS && !spot; r0++) {
            for (var c0 = 0; c0 + sh.w <= COLS; c0++) {
              var free = true
              for (var rr = 0; rr < sh.h && free; rr++)
                for (var cc = 0; cc < sh.w; cc++) if (grid[(r0 + rr) * COLS + c0 + cc]) { free = false; break }
              if (free) { spot = { c0: c0, r0: r0 }; break }
            }
          }
          if (!spot) continue
          for (var fr = 0; fr < sh.h; fr++)
            for (var fc = 0; fc < sh.w; fc++) grid[(spot.r0 + fr) * COLS + spot.c0 + fc] = 1
          view.push({
            id: bp.id, ch: (d.ch || '?'), lv: bp.level || 1, sz: d.size || 1,
            hero: bp.k === 'jiang', shard: false,
            w: sh.w, h: sh.h, c0: spot.c0, r0: spot.r0, idx: bi
          })
        }
        ui.benchView = view
        ui.benchRows = Math.max(1, Math.ceil((view.reduce(function (a, b) { return a + b.w * b.h; }, 0) || 1) / COLS))
        ui.benchCap = g.Run.benchSlots(run) || 6
      })()
      ui.gold = run.gold
      ui.phase = run.phase
      ui.opp = run.opp ? run.opp.name : ''
      ui.day = run.day
      ui.cellsN = g.Run.cellsN(run)
      ui.cellsMax = g.Run.cellsMax()
      ui.cellsUsed = g.Run.cellsUsed(run)
      ui.wins = run.wins
      ui.prestige = run.prestige
      ui.speed = g.Game ? g.Game.speed() : 1
      ui.sel = selected ? selected.id : null
      ui.offers = (run.offers || []).map((o) => snapOffer(o, run))
      ui.enchId = this._enchId || null
      ui.detail = run.phase === 'battle' ? null : selected ? snapDetail(selected) : null
      ui.log = (run.log || []).slice(-5).reverse().map((e) => ({ d: e.d, t: e.t }))
      ui.b = battle && run.phase === 'battle' ? snapBattle(battle) : null
      ui.inited = true
      var bkList = (run.skills || []).map(function (own) {
        var d = g.D.skillById(own.id)
        return d ? { id: own.id, ch: d.ch, name: d.name, tier: own.tier || 1, desc: d.desc } : null
      }).filter(Boolean)
      var bkOffer = (run.bookOffer || []).map(function (id) {
        var d = g.D.skillById(id)
        return d ? { id: id, ch: d.ch, name: d.name, tier: d.tier || 1, desc: d.desc } : null
      }).filter(Boolean)
      ui.books = { slots: g.Run.skillSlots(run), list: bkList, offer: bkOffer }
      var pend = g.Run.pendingEvo ? g.Run.pendingEvo(run) : null
      if (pend) {
        var pd = pend.def || g.D.pieceById(pend.k)
        ui.evo = {
          id: pend.id,
          ch: pd ? pd.ch : '?',
          name: pd ? pd.name : pend.k,
          options: (g.Run.evoChoices ? g.Run.evoChoices(pend) : (g.D.evoOptions(pend.k) || []))
            .map((o) => ({ id: o.id, name: o.name, desc: o.desc }))
        }
      } else ui.evo = null
      ui.rev++
    },

    // 战斗每帧回调，节流到 ~8Hz
    tick(battle) {
      if (!battle) return
      const now = performance.now()
      if (now - lastTick < 120) return
      lastTick = now
      ui.b = snapBattle(battle)
    },

    setShop(open) { ui.shopOpen = !!open },
    toast(msg, kind) {
      const id = ++toastSeq
      ui.toasts.push({ id, msg, kind: kind || '' })
      setTimeout(() => {
        const i = ui.toasts.findIndex((t) => t.id === id)
        if (i >= 0) ui.toasts.splice(i, 1)
      }, 1900)
    },
    setModal(m) { ui.modal = m || null },
    beginDrag(piece, x, y, from) {
      const s = snapPiece(piece)
      if (!s) return
      ui.drag = { id: s.id, ch: s.ch, hero: s.hero, x: x, y: y, active: from === 'bench', from: from || 'bench' }
    },
    endDrag() { ui.drag = null },
    setEnch(id) { this._enchId = id },
    refresh() { if (g.UI && g.UI.refresh) g.UI.refresh() }
  }
}
