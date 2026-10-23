<template>
  <div class="sheet" @contextmenu.prevent>
    <div class="body">
      <!-- 备战席 -->
      <div class="block">
        <div class="head">
          <span>备战席</span>
          <span class="sub">{{ usedBenchCells }}/{{ ui.benchCap }} 格</span>
        </div>
        <div class="benchgrid">
          <button
            v-for="b in ui.benchView"
            :key="b.id"
            class="bslot"
            :class="{ sel: ui.sel === b.id, hero: b.hero }"
            :style="{ gridColumn: 'span ' + b.w, gridRow: 'span ' + b.h }"
            @click="pick(b.idx)"
            @pointerdown="onDown(b.idx, $event)"
            @dragstart.prevent
          >
            <span class="ch">{{ b.ch }}</span>
            <span v-if="b.lv > 1" class="lv">{{ b.lv }}</span>
            <i v-if="b.sz > 1" class="sz">{{ b.sz }}格</i>
          </button>
          <div
            v-for="n in Math.max(0, ui.benchCap - usedBenchCells)"
            :key="'e' + n"
            class="bslot empty"
          ><span>+</span></div>
        </div>
      </div>

      <!-- 战况 -->
      <div class="sum">
        <span class="f">{{ faction }}</span>
        <span class="k">格 <b>{{ ui.cellsUsed }}/{{ ui.cellsN }}</b></span>
        <span class="k">上阵 <b>{{ placed }}</b></span>
        <span class="k">前排 <b>{{ rows[0] }}</b></span>
        <span class="k">后排 <b>{{ rows[1] }}</b></span>
      </div>

      <!-- 兵书 -->
      <div class="block">
        <div class="head">
          <span>兵书</span>
          <span class="sub">{{ ui.books.list.length }}/{{ ui.books.slots }} 卷</span>
        </div>
        <p v-if="!ui.books.list.length" class="note">还没有兵书</p>
        <template v-else>
          <div class="books">
            <button
              v-for="(s, i) in ui.books.list"
              :key="s.id"
              class="book"
              :class="{ gold: s.tier === 3, sel: bookSel === i }"
              :title="s.name"
              @click="bookSel = bookSel === i ? -1 : i"
            >{{ s.ch }}</button>
          </div>
          <p v-if="book" class="book-detail"><b>{{ book.name }}</b>{{ book.desc }}</p>
        </template>
      </div>

      <!-- 名将 -->
      <div v-if="heroes.length" class="block">
        <div class="head"><span>名将</span><span class="sub">{{ heroes.length }}</span></div>
        <div v-for="h in heroes" :key="h.id" class="trait gold">
          <span class="tg gold">{{ h.ch }}</span>
          <span class="tx"><b>{{ h.name }}　{{ h.n }}/2</b><em>{{ h.desc }}</em></span>
        </div>
      </div>

      <!-- 战报 -->
      <div v-if="ui.log.length" class="block">
        <div class="head"><span>战报</span><span class="sub">近 5 条</span></div>
        <div class="log">
          <div v-for="(e, i) in ui.log" :key="i" class="li"><i>第{{ e.d }}天</i><span>{{ e.t }}</span></div>
        </div>
      </div>
    </div>

    <!-- 底部操作 -->
    <div class="bar">
      <button class="sbtn" @click="sellSel" :disabled="!ui.sel">卖出</button>
      <button class="sbtn" :disabled="ui.gold < 2" @click="reroll">刷新 · 2</button>
      <button class="sbtn red" @click="fight">出战 · {{ ui.opp || '对战' }}</button>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { ui } from '../store.js'

const GB = () => window.GB

const runNow = computed(() => {
  void ui.rev
  const g = GB()
  return g && g.UI && g.UI.getRun ? g.UI.getRun() : null
})

const bookSel = ref(-1)
const book = computed(() => (bookSel.value >= 0 ? ui.books.list[bookSel.value] : null))

const filled = computed(() => ui.bench.filter(Boolean).length)
const usedBenchCells = computed(() => {
  void ui.rev
  return (ui.benchView || []).reduce((a, b) => a + b.w * b.h, 0)
})

const skills = computed(() => {
  void ui.rev
  return ui.books.list
})

const faction = computed(() => {
  void ui.rev
  const run = runNow.value
  const g = GB()
  const f = run && g && g.D ? g.D.FACTIONS[run.faction] : null
  return f ? f.name : '未立门派'
})

const placed = computed(() => {
  void ui.rev
  const run = runNow.value
  if (!run) return 0
  const seen = new Set()
  Object.keys(run.board).forEach((k) => {
    const p = run.board[k]
    if (p) seen.add(p.id)
  })
  return seen.size
})

const rows = computed(() => {
  void ui.rev
  const run = runNow.value
  const out = [0, 0]
  if (!run) return out
  const seen = new Set()
  Object.keys(run.board).forEach((k) => {
    const p = run.board[k]
    if (!p || seen.has(p.id) || !p.cells || !p.cells.length) return
    seen.add(p.id)
    out[p.cells[0].r <= 5 ? 0 : 1] += 1
  })
  return out
})

watch(() => ui.books.list.length, (n) => {
  if (bookSel.value >= n) bookSel.value = -1
})

const heroes = computed(() => {
  void ui.rev
  const run = runNow.value
  const g = GB()
  if (!run || !g || !g.Run || !g.Run.shardProgress) return []
  const prog = g.Run.shardProgress(run)
  return Object.keys(prog).map((id) => {
    const h = g.D.HEROES[id] || { name: id, desc: '', chars: '?' }
    return { id, ch: h.chars[0], name: h.name, desc: h.desc, n: prog[id] }
  })
})

/* ---------------- 拖动 ---------------- */
let pd = null
let suppressClick = false

function listen(on) {
  const m = on ? 'addEventListener' : 'removeEventListener'
  window[m]('pointermove', onMove, { passive: false })
  window[m]('pointerup', onUp)
  window[m]('pointercancel', onUp)
}

function onDown(i, e) {
  const g = GB()
  const run = g && g.UI && g.UI.getRun ? g.UI.getRun() : null
  if (!run || !run.bench[i]) return
  if (e.pointerType === 'mouse' && e.button !== 0) return
  pd = { i, x: e.clientX, y: e.clientY, id: e.pointerId, moved: false }
  listen(true)
}

function onMove(e) {
  if (!pd || e.pointerId !== pd.id) return
  if (!pd.moved) {
    const dx = e.clientX - pd.x
    const dy = e.clientY - pd.y
    if (dx * dx + dy * dy < 64) return          // 8px 以内当点击
    pd.moved = true
    suppressClick = true
    const g = GB()
    if (g && g.UI && g.UI.beginDragFromBench) g.UI.beginDragFromBench(pd.i, e.clientX, e.clientY)
  }
  if (e.cancelable) e.preventDefault()
}

function onUp(e) {
  if (!pd || e.pointerId !== pd.id) return
  const moved = pd.moved
  pd = null
  listen(false)
  if (moved) setTimeout(() => { suppressClick = false }, 350)
}

function pick(i) {
  if (suppressClick) { suppressClick = false; return }
  const g = GB()
  if (g && g.UI && g.UI.selectSlot) g.UI.selectSlot(i)
}
function reroll() {
  const g = GB()
  if (!g) return
  if (!g.Shop.reroll(g.UI.getRun())) { g.audio.deny(); return }
  g.audio.click()
  g.UI.refresh()
}
function fight() {
  const g = GB()
  if (g && g.Game) g.Game.startBattle()
}
function sellSel() {
  const g = GB()
  if (!g || !ui.sel) return
  const run = g.UI.getRun()
  if (!run) return
  const p = run.bench.find((x) => x && x.id === ui.sel) ||
    Object.keys(run.board).map((k) => run.board[k]).find((x) => x && x.id === ui.sel)
  if (p && g.UI.sellPiece) g.UI.sellPiece(p)
}
</script>

<style scoped>
.sheet {
  flex: 1 1 auto; min-height: 0;
  display: flex; flex-direction: column; gap: 6px;
  padding: 6px 8px calc(6px + env(safe-area-inset-bottom));
  background: #f7f0e2; border-top: 1px solid rgba(40, 33, 26, .14);
  min-width: 0;
}
.body::-webkit-scrollbar { width: 3px; }
.body::-webkit-scrollbar-thumb { background: rgba(60, 45, 25, .22); border-radius: 2px; }
.body::-webkit-scrollbar-track { background: transparent; }
.body { flex: 1 1 auto; display: flex; flex-direction: column; gap: 7px; min-height: 0;
  overflow-y: auto; padding-bottom: 2px; }
.block { display: flex; flex-direction: column; gap: 4px; }

.head { display: flex; align-items: baseline; gap: 7px; }
.head > span:first-child { font-family: var(--kai, "KaiTi", serif); font-size: 12px;
  letter-spacing: 1px; color: #38312a; }
.head::before { content: ""; width: 3px; height: 11px; background: #a5342a; border-radius: 1px; }
.sub { margin-left: auto; font-size: 9.5px; color: #9b8f7d; font-variant-numeric: tabular-nums; }

.benchgrid { display: grid; grid-template-columns: repeat(4, 44px); grid-template-rows: repeat(3, 44px);
  gap: 5px; justify-content: start; }
.bslot { position: relative; display: flex; align-items: center; justify-content: center;
  border-radius: 9px; border: 1.5px solid rgba(160,122,45,.5); min-width: 0; min-height: 0; cursor: pointer;
  touch-action: none; -webkit-user-select: none; user-select: none;
  background: linear-gradient(180deg, #3b342b, #1c1814); color: #f4ecda; padding: 0; }
.bslot .ch { font-family: var(--kai, "KaiTi", serif); font-size: 17px; }
.bslot .lv { position: absolute; left: 4px; top: 3px; font-size: 9px; color: #f0d68a; }
.bslot .sz { position: absolute; right: 4px; bottom: 2px; font-style: normal; font-size: 8px; color: #b9a98a; }
.bslot.sel { outline: 2px solid #c9a24b; outline-offset: 1px; }
.bslot.hero { background: linear-gradient(180deg, #e0c076, #96701f); color: #2a2008; }
.bslot.empty { background: rgba(120,95,60,.06); border-style: dashed; cursor: default; }
.bslot.empty span { color: rgba(120,92,50,.5); font-size: 15px; }
.slot {
  position: relative; min-height: 46px;
  touch-action: none; -webkit-user-select: none; user-select: none;
  -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; border-radius: 7px; padding: 0;
  border: 1px dashed rgba(60, 45, 25, .26); background: rgba(120, 98, 66, .06);
  display: grid; place-items: center; cursor: pointer; min-width: 0; }
.slot.filled { border-style: solid; border-color: rgba(60, 45, 25, .2); background: transparent; }
.slot.sel { border-color: #a9812f; box-shadow: 0 0 0 2px rgba(169, 129, 47, .3); }
.slot .empty { color: rgba(60, 45, 25, .2); font-size: 14px; }

.utile {
  -webkit-user-select: none; user-select: none; -webkit-touch-callout: none;
  position: absolute; inset: 3px; border-radius: 5px; display: grid; place-items: center;
  background: linear-gradient(160deg, #3b342b, #1c1814); color: #f4ecda;
  font-family: var(--kai, "KaiTi", serif); font-size: 17px; line-height: 1;
  box-shadow: inset 0 0 0 1px rgba(255, 250, 236, .13); }
.utile.hero { background: linear-gradient(160deg, #e4c476, #8f6a1f); color: #2a2008; font-size: 12px; font-weight: 700; }
.utile.shard { box-shadow: inset 0 0 0 1.5px rgba(215, 175, 90, .7); color: #f0d79a; }
.utile .lv { position: absolute; top: -3px; right: -3px; width: 13px; height: 13px; border-radius: 50%;
  background: #e8c877; color: #241a06; font-size: 9px; display: grid; place-items: center; font-weight: 700; }
.utile .sz { position: absolute; bottom: 1px; right: 3px; font-size: 8.5px; font-style: normal;
  color: rgba(244, 236, 218, .55); }

.log { display: flex; flex-direction: column; gap: 2px; }
.li { display: flex; gap: 6px; font-size: 10px; line-height: 1.45; color: #6d6255; min-width: 0; }
.li i { flex: 0 0 auto; font-style: normal; color: #9b8f7d; font-size: 9.5px; }
.li span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.sum { display: flex; align-items: baseline; gap: 8px; padding: 5px 7px; border-radius: 6px;
  background: rgba(255, 252, 244, .55); border: 1px solid rgba(40, 33, 26, .1);
  font-size: 10px; color: #6d6255; min-width: 0; }
.sum .f { font-family: var(--kai, "KaiTi", serif); font-size: 11.5px; color: #38312a;
  letter-spacing: .5px; white-space: nowrap; }
.sum .k { white-space: nowrap; }
.sum .k b { color: #1b1815; font-variant-numeric: tabular-nums; }
.sum .k:nth-child(2) { margin-left: auto; }

.note { margin: 0; font-size: 10px; color: #9b8f7d; padding: 5px; text-align: center;
  border: 1px dashed rgba(40, 33, 26, .16); border-radius: 6px; }
.books { display: flex; gap: 6px; overflow-x: auto; padding: 3px 0 4px; scrollbar-width: none; }
.books::-webkit-scrollbar { display: none; }
.book {
  flex: 0 0 auto; width: 30px; height: 34px; padding: 0; border: none; cursor: pointer;
  clip-path: polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%);
  background: linear-gradient(160deg, #3b342b, #1c1814);
  color: #f4ecda; font-family: var(--kai, "KaiTi", serif); font-size: 14px; line-height: 1;
  filter: drop-shadow(0 1px 1px rgba(20, 14, 6, .3));
  transition: transform .1s, filter .12s;
}
.book:active { transform: translateY(1px); }
.book.gold { background: linear-gradient(160deg, #d9b45e, #9a7222); color: #2a2008; }
.book.sel { background: linear-gradient(160deg, #e8c877, #a5342a 140%); color: #2a2008;
  filter: drop-shadow(0 0 4px rgba(201, 154, 55, .9)); transform: translateY(-1px) scale(1.06); }

.book-detail { margin: 0; font-size: 10px; line-height: 1.45; color: #6d6255; }
.book-detail b { color: #1b1815; margin-right: 5px; }
.book-hint { margin: 0; font-size: 9.5px; color: #9b8f7d; }

.trait { display: flex; gap: 6px; align-items: flex-start; padding: 4px 6px; border-radius: 6px;
  background: rgba(255, 252, 244, .6); border: 1px solid rgba(40, 33, 26, .12); }
.tg { width: 18px; height: 18px; flex: 0 0 18px; border-radius: 4px; display: grid; place-items: center;
  font-family: var(--kai, "KaiTi", serif); font-size: 11px; color: #f4ecda;
  background: linear-gradient(160deg, #3b342b, #1c1814); }
.tg.gold { background: linear-gradient(160deg, #d9b45e, #9a7222); color: #2a2008; }
.tx b { display: block; font-size: 11px; color: #1b1815; }
.tx em { display: block; font-style: normal; font-size: 9.5px; line-height: 1.35; color: #6d6255; }

.bar { position: relative; box-shadow: 0 -7px 10px -8px rgba(60, 45, 25, .55);
  display: grid; gap: 5px;
  grid-template-columns: minmax(0, .72fr) minmax(0, 1fr) minmax(0, 1.6fr); }
.sbtn { min-height: 32px; border-radius: 7px; cursor: pointer; padding: 5px 6px;
  font-family: var(--serif, "Songti SC", serif); font-size: 11.5px; letter-spacing: .5px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0;
  color: #38312a; background: rgba(255, 252, 244, .85); border: 1px solid rgba(40, 33, 26, .16); }
.sbtn:disabled { opacity: .42; }
.sbtn.gold { color: #241a06; border-color: rgba(160, 122, 45, .5);
  background: linear-gradient(180deg, #c79a3f, #8f6a1f); }
.sbtn.red { min-height: 32px; font-size: 12.5px; color: #f7f0dd;
  border-color: rgba(120, 35, 22, .6);
  background: linear-gradient(180deg, #c14a38, #8e291e); }

@media (min-width: 901px) {
  .sheet { border-top: none; border-radius: 0 0 10px 10px; padding: 8px 10px 10px; }
  
  .slot { min-height: 54px; }
  .bar { grid-template-columns: minmax(0, .8fr) minmax(0, 1fr) minmax(0, 1.5fr); }
  .sbtn.red { min-height: 34px; }
  .sbtn { min-height: 34px; font-size: 12px; }
}
</style>
