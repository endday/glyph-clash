<template>
  <div v-if="d && !ui.drag" class="tip" :style="pos">
    <header class="th">
      <span class="ch">{{ d.ch }}</span>
      <b>{{ d.name }}</b>
      <span class="lv">Lv.{{ d.lv }}</span>
      <span class="sz">{{ d.sizeLabel }}</span>
    </header>

    <p v-if="d.structure" class="stats nohp">无血量 · 不会被打掉 · 只占格子</p>
    <p v-else-if="d.stats.length" class="stats">{{ d.stats.join('  ·  ') }}</p>

    <p v-if="d.aura" class="line aura"><i>环</i>{{ d.aura }}<b v-if="d.auraLv > 1" class="up">Lv.{{ d.auraLv }}</b></p>
    <p v-if="d.skill" class="line"><i>技</i>{{ d.skill.name }} · {{ d.skill.desc }}</p>
    <p v-if="d.ult" class="line ult"><i>绝</i>{{ d.ult.name }} · {{ d.ult.desc }}</p>
    <p v-else-if="d.hint" class="hint">{{ d.hint }}</p>
    <p v-if="d.ench" class="hint">附魔 · {{ d.ench }}</p>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ui } from '../store.js'

const d = computed(() => ui.detail)
const pos = ref({ left: '8px', right: '8px', bottom: '70dvh' })

function measure() {
  const el = document.getElementById('panel')
  const vh = window.innerHeight
  if (!el) {
    pos.value = { left: '8px', right: '8px', bottom: '70dvh' }
    return
  }
  const r = el.getBoundingClientRect()
  if (window.innerWidth <= 900) {
    pos.value = { left: '8px', right: '8px', bottom: Math.round(vh - r.top + 6) + 'px' }
  } else {
    pos.value = {
      left: Math.max(10, Math.round(r.left - 272)) + 'px',
      right: 'auto',
      width: '260px',
      bottom: Math.round(vh - r.bottom) + 'px'
    }
  }
}

let ro = null
onMounted(() => {
  measure()
  window.addEventListener('resize', measure)
  const el = document.getElementById('panel')
  if (el && window.ResizeObserver) {
    ro = new ResizeObserver(measure)
    ro.observe(el)
  }
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', measure)
  if (ro) ro.disconnect()
})
watch(d, () => requestAnimationFrame(measure))
</script>

<style scoped>
.tip {
  position: fixed; z-index: 40; pointer-events: none;
  padding: 7px 9px 8px; border-radius: 9px;
  background: rgba(30, 25, 19, .93); color: #f4ecda;
  border: 1px solid rgba(215, 175, 90, .38);
  box-shadow: 0 8px 22px rgba(10, 6, 2, .45);
  font-family: var(--serif, "Songti SC", serif);
  display: flex; flex-direction: column; gap: 3px;
  animation: tin .16s ease-out;
}
@keyframes tin { from { opacity: 0; transform: translateY(4px) } }

.th { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
.th .ch { width: 19px; height: 19px; flex: 0 0 19px; border-radius: 4px; display: grid; place-items: center;
  background: linear-gradient(160deg, #3b342b, #100d0a); color: #f6dfae;
  font-family: var(--kai, "KaiTi", serif); font-size: 12px; }
.th b { font-size: 13px; letter-spacing: 1px; }
.th .lv { font-size: 9.5px; color: #d8b96e; }
.th .sz { margin-left: auto; font-size: 9.5px; color: rgba(244, 236, 218, .6); white-space: nowrap; }

.stats.nohp { color: #9fc7ad; }
.stats { margin: 0; font-size: 10.5px; color: #e6d7b6; font-variant-numeric: tabular-nums; }
.line { margin: 0; font-size: 10px; line-height: 1.4; color: rgba(244, 236, 218, .82); display: flex; gap: 4px; }
.line i { font-style: normal; flex: 0 0 auto; width: 14px; height: 14px; border-radius: 3px;
  display: grid; place-items: center; font-size: 9px; background: rgba(255, 250, 236, .14); }
.line.aura { color: #a9d3b4; }
.line.aura i { background: rgba(93, 143, 119, .35); color: #d7f0dd; }
.line.aura .up { margin-left: auto; font-size: 9px; color: #f0d79a; font-weight: 700; }
.line.ult { color: #f0d79a; }
.line.ult i { background: linear-gradient(160deg, #d9b45e, #9a7222); color: #2a2008; }
.hint { margin: 0; font-size: 9.5px; color: rgba(244, 236, 218, .52); }
</style>
