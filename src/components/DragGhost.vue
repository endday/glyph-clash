<script setup>
import { computed, onBeforeUnmount, watch } from 'vue'
import { ui } from '../store.js'

const GB = () => window.GB
const d = computed(() => ui.drag)
const show = computed(() => !!(ui.drag && ui.drag.active))

function hitCell(x, y) {
  const g = GB()
  const cv = document.getElementById('board')
  if (!g || !cv || !g.Render) return null
  const r = cv.getBoundingClientRect()
  if (x < r.left || x > r.right || y < r.top || y > r.bottom) return null
  return g.Render.cellAtPx(x - r.left, y - r.top)
}

function hitSlot(x, y) {
  const el = document.elementFromPoint(x, y)
  if (!el || !el.closest) return -1
  const slot = el.closest('.slot')
  if (!slot || !slot.parentNode) return -1
  return Array.prototype.indexOf.call(slot.parentNode.children, slot)
}

// 落点是不是一颗「同字同级」的棋子（决定 ghost 要不要亮金）
function canDropMerge(x, y, cell) {
  const g = GB()
  if (!g || !ui.drag) return false
  const run = g.UI.getRun()
  if (!run) return false
  const piece = (g.Run.allPieces(run) || []).filter((p) => p && p.id === ui.drag.id)[0]
  if (!piece) return false
  let other = null
  if (cell) other = g.Run.pieceAt(run, cell.q, cell.r)
  else {
    const idx = hitSlot(x, y)
    if (idx >= 0) other = run.bench[idx]
  }
  return !!(other && other !== piece && g.Run.canMerge(piece, other))
}

function hover(cell) {
  const g = GB()
  if (g && g.Render && g.Render.setHover) g.Render.setHover(cell)
}

function onMove(e) {
  if (!ui.drag) return
  if (!ui.drag.active) ui.drag.active = true
  ui.drag.x = e.clientX
  ui.drag.y = e.clientY
  const cell = hitCell(e.clientX, e.clientY)
  hover(cell)
  ui.drag.merge = canDropMerge(e.clientX, e.clientY, cell)
  if (e.cancelable) e.preventDefault()
}

function onUp(e) {
  const g = GB()
  const drag = ui.drag
  detach()
  hover(null)
  ui.drag = null
  if (!g || !drag || !drag.active) return

  const run = g.UI.getRun()
  if (!run) return
  const all = g.Run.allPieces(run) || []
  const piece = all.filter((p) => p && p.id === drag.id)[0]
  if (!piece) return

  const cell = hitCell(e.clientX, e.clientY)

  // 1) 落到棋盘：合成 > 落子
  if (cell) {
    const target = g.Run.pieceAt(run, cell.q, cell.r)
    if (target && target !== piece && g.Run.canMerge(piece, target)) {
      if (g.Run.mergeInto(run, target, piece)) {
        g.audio.merge()
        g.UI.toast('合成 · Lv.' + target.level, 'gold')
        g.UI.select(null)
        g.UI.refresh()
      }
      return
    }
    if (g.Run.placeAt(run, piece, cell.q, cell.r)) {
      g.audio.place()
      g.UI.refresh()
    } else {
      g.audio.deny()
      const def = piece.def || g.D.pieceById(piece.k) || {}
      g.UI.toast('放不下（' + (def.size || 1) + ' 格）', 'bad')
    }
    return
  }

  // 2) 落到备战席某一格：先看能不能合成，否则换位
  const idx = hitSlot(e.clientX, e.clientY)
  if (idx >= 0) {
    const other = run.bench[idx]
    if (other && other !== piece && g.Run.canMerge(piece, other)) {
      if (g.Run.mergeInto(run, other, piece)) {
        g.audio.merge()
        g.UI.toast('合成 · Lv.' + other.level, 'gold')
        g.UI.select(null)
        g.UI.refresh()
      }
      return
    }
    if (g.UI.moveToBenchAt) g.UI.moveToBenchAt(piece, idx)
    return
  }

  // 3) 拖到别处：棋盘上的棋子回到备战席
  if (run.bench.indexOf(piece) < 0) {
    if (g.Run.addToBench(run, piece)) {
      g.audio.place()
      g.UI.refresh()
    }
  }
}

function onCancel() {
  detach()
  hover(null)
  ui.drag = null
}

function attach() {
  window.addEventListener('pointermove', onMove, { passive: false })
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onCancel)
}
function detach() {
  window.removeEventListener('pointermove', onMove)
  window.removeEventListener('pointerup', onUp)
  window.removeEventListener('pointercancel', onCancel)
}

// 只要进入拖动状态就接管指针（棋盘起手时 active 为 false，第一次移动才显现 ghost）
// flush:'sync' —— 手指极快时 pointerdown/up 可能在同一帧内，监听必须立刻挂上
watch(() => !!ui.drag, (v) => (v ? attach() : detach()), { flush: 'sync' })
onBeforeUnmount(detach)
</script>

<template>
  <div v-if="show" class="ghost" :class="{ merge: d.merge }" :style="{ left: d.x + 'px', top: d.y + 'px' }" aria-hidden="true">
    <span class="ch" :class="{ hero: d.hero }">{{ d.ch }}</span>
    <i v-if="d.merge" class="badge">合</i>
  </div>
</template>

<style scoped>
.ghost {
  position: fixed; z-index: 90; width: 46px; height: 46px;
  margin: -23px 0 0 -23px; border-radius: 9px;
  display: grid; place-items: center;
  background: linear-gradient(160deg, #3b342b, #1c1814); color: #f4ecda;
  box-shadow: 0 10px 22px rgba(20, 14, 6, .42), inset 0 0 0 1px rgba(255, 250, 236, .16);
  pointer-events: none; opacity: .95;
  transform: scale(1.06);
  font-family: var(--kai, "KaiTi", serif); font-size: 20px; line-height: 1;
}
.ghost .ch.hero { color: #f0d79a; }
.ghost.merge {
  box-shadow: 0 0 0 2px #e0be6a, 0 10px 24px rgba(20, 14, 6, .45), inset 0 0 0 1px rgba(255, 240, 200, .4);
}
.ghost .badge {
  position: absolute; top: -7px; right: -7px; width: 17px; height: 17px; border-radius: 50%;
  display: grid; place-items: center; font-style: normal; font-size: 10px; font-weight: 700;
  color: #2a2008; background: linear-gradient(180deg, #f0d79a, #c79a3f);
}
@media (max-width: 900px) {
  .ghost { width: 40px; height: 40px; margin: -20px 0 0 -20px; font-size: 18px; }
}
</style>
