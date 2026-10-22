<template>
  <section class="bp">
    <header class="top">
      <span class="side p">我方 <b>{{ b.pv }}</b>/{{ b.pMax }}</span>
      <span class="clock">{{ clock }}</span>
      <span class="side o">{{ b.ov }}/<b>{{ b.eMax }}</b> 敌方</span>
    </header>

    <div class="bars">
      <span class="bar p"><i :style="{ width: b.php + '%' }"></i></span>
      <span class="bar o"><i :style="{ width: b.ohp + '%' }"></i></span>
    </div>

    <div v-if="b.chain && b.chain.length" class="chain">
      <span v-for="(c, i) in b.chain.slice(-3)" :key="i" class="step">
        <b>{{ c.label }}</b>{{ c.src ? c.src : '' }}<i v-if="c.tgt">→{{ c.tgt }}</i>
      </span>
    </div>

    <div v-if="b.ults.length" class="ults">
      <button
        v-for="u in b.ults"
        :key="u.id"
        class="ult"
        :class="{ ready: u.ready }"
        @click="cast(u.id)"
      >
        <span class="ch">{{ u.ch }}</span>
        <span class="cd" v-if="!u.ready">{{ u.pct }}%</span>
        <span class="cd ok" v-else>可放</span>
      </button>
    </div>

    <div class="foot">
      <button class="sbtn" @click="speed">速度 ×{{ ui.speed }}</button>
      <button class="sbtn" :class="{ on: b.autoUlt }" @click="auto">
        自动大招 {{ b.autoUlt ? '开' : '关' }}
      </button>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue'
import { ui } from '../store.js'

const b = computed(() => ui.b || {
  pv: 0, ov: 0, pMax: 0, eMax: 0, php: 0, ohp: 0, t: 0, ults: [], autoUlt: true
})

const clock = computed(() => {
  const t = b.value.t || 0
  return Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0')
})

function cast(id) {
  const g = window.GB
  if (g && g.UI && g.UI.useUltById) g.UI.useUltById(id)
}
function speed() {
  const g = window.GB
  if (g && g.Game) g.Game.cycleSpeed()
}
function auto() {
  const g = window.GB
  if (g && g.Game && g.Game.toggleAutoUlt) g.Game.toggleAutoUlt()
}
</script>

<style scoped>
.bp { display: flex; flex-direction: column; gap: 6px; padding: 8px 10px 10px;
  border-top: 1px solid rgba(40, 33, 26, .14); background: #f7f0e2; }

.top { display: flex; align-items: baseline; gap: 8px; font-size: 11px; color: #38312a; }
.side { white-space: nowrap; }
.side b { font-size: 13px; font-variant-numeric: tabular-nums; }
.side.p b { color: #2f5343; }
.side.o b { color: #a5342a; }
.clock { margin: 0 auto; font-family: var(--serif, "Songti SC", serif); font-size: 12px;
  font-variant-numeric: tabular-nums; color: #6d6255; }

.bars { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.bar { display: block; height: 5px; border-radius: 3px; background: rgba(60, 45, 25, .14); overflow: hidden; }
.bar i { display: block; height: 100%; transition: width .18s linear; }
.bar.p i { background: linear-gradient(90deg, #4d7d63, #2f5343); }
.bar.o i { background: linear-gradient(90deg, #c8604c, #8e291e); }

.chain { display: flex; gap: 5px; overflow-x: auto; font-size: 10px; color: #6d6255; }
.chain .step { flex: 0 0 auto; padding: 2px 6px; border-radius: 999px;
  background: rgba(255, 252, 244, .8); border: 1px solid rgba(40, 33, 26, .12); white-space: nowrap; }
.chain .step b { color: #8a6a1f; margin-right: 3px; }
.chain .step i { font-style: normal; color: #9b8f7d; }

.ults { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 1px; }
.ult { position: relative; flex: 0 0 auto; width: 46px; height: 40px; border-radius: 8px;
  border: 1px solid rgba(40, 33, 26, .18); background: rgba(255, 252, 244, .8);
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px;
  cursor: pointer; padding: 0; }
.ult .ch { font-family: var(--kai, "KaiTi", serif); font-size: 15px; color: #38312a; }
.ult .cd { font-size: 8.5px; color: #9b8f7d; }
.ult .cd.ok { color: #8a6a1f; font-weight: 700; }
.ult.ready { border-color: rgba(201, 154, 55, .85);
  background: linear-gradient(180deg, #f7e6b8, #e2c078);
  box-shadow: 0 0 0 2px rgba(201, 154, 55, .28); }

.foot { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.sbtn { min-height: 32px; border-radius: 8px; cursor: pointer; padding: 5px 8px;
  font-family: var(--serif, "Songti SC", serif); font-size: 11.5px; letter-spacing: .5px; }
.sbtn { color: #38312a; background: rgba(255, 252, 244, .85); border: 1px solid rgba(40, 33, 26, .16); }
.sbtn.on { border-color: rgba(201, 154, 55, .8); color: #7a5c14; }
</style>
