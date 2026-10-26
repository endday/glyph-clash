<template>
  <header id="topbar" class="topbar">
    <div class="brand">
      <span class="brand-zh">符阵</span>
      <span class="brand-en">GLYPH CLASH</span>
    </div>

    <div class="topstats">
      <div class="stat" id="stat-day">
        <span class="stat-k">第</span><span class="stat-v" id="day-num">1</span><span class="stat-k">天</span>
        <span class="phase-tag" id="phase-tag">晨市</span>
      </div>
      <div class="stat" id="stat-prestige">
        <span class="stat-k">声望</span>
        <span class="hearts" id="prestige-hearts"></span>
        <span class="stat-v" id="prestige-num">20</span>
      </div>
      <div class="stat" id="stat-gold">
        <span class="coin"></span>
        <span class="stat-v" id="gold-num">10</span>
      </div>
      <div class="stat" id="stat-wins">
        <span class="stat-k">胜</span>
        <span class="stat-v" id="wins-num">0</span><span class="stat-k">/6</span>
      </div>
    </div>

    <div class="topactions">
      <button class="icon-btn" data-menu aria-label="菜单" @click.stop="toggleMenu">☰</button>
      <button class="icon-btn hidden" id="btn-menu">☰</button>
      <!-- 原来的速度/音乐按钮留着，只是藏起来：游戏里的点击逻辑完全不用改 -->
      <button class="icon-btn hidden" id="btn-speed">1×</button>
      <button class="icon-btn hidden" id="btn-sound">♪</button>

      <div v-if="open" class="menu" @click.stop>
        <div class="mrow">
          <span class="mk">速度</span>
          <button v-for="n in [1, 2, 3]" :key="n" class="seg" :class="{ on: speed === n }" @click="setSpeed(n)">
            {{ n }}×
          </button>
        </div>
        <button class="mitem" @click="toggleSound">音乐<em>{{ sound ? '开' : '关' }}</em></button>
        <button class="mitem" @click="help">玩法说明</button>
        <button class="mitem" @click="repo">项目仓库</button>
      </div>
    </div>
  </header>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'

const open = ref(false)
const speed = ref(1)
const sound = ref(true)
let menuEl = null

const G = () => (typeof window !== 'undefined' ? window.GB : null)

// 隐藏的原始按钮：游戏本体按 id 驱动它们，这里只负责「替玩家点一下」
function hidden(id) { return document.getElementById(id) }

function readState() {
  const sp = hidden('btn-speed')
  if (sp) {
    const t = (sp.textContent || '').trim()
    const n = parseInt(t, 10)
    if (n >= 1 && n <= 3) speed.value = n
  }
  const sd = hidden('btn-sound')
  if (sd) {
    const t = (sd.textContent || '').trim()
    sound.value = t !== '♪̸' && t !== '✕' && !sd.classList.contains('off')
  }
}

// 速度按钮的文本不会跟着刷新（游戏只在 renderTop 时写），所以自己记住当前档位
let curSpeed = 1

function setSpeed(n) {
  const g = G()
  if (g && g.Game && g.Game.setSpeed) { g.Game.setSpeed(n); curSpeed = n; speed.value = n; return }
  const el = hidden('btn-speed')
  if (!el) return
  const times = ((n - curSpeed) % 3 + 3) % 3   // 1→2→3→1 的循环
  for (let i = 0; i < times; i++) el.click()
  curSpeed = n
  speed.value = n
}

function toggleSound() {
  const el = hidden('btn-sound')
  if (el) el.click()
  setTimeout(readState, 60)
}

function help() {
  open.value = false
  const g = G()
  if (g && g.Game && g.Game.openMenu) g.Game.openMenu()
  else if (g && g.UI && g.UI.modal) g.UI.modal({ title: '玩法', body: '点备战席棋子选中，点棋盘落子。' })
}

function repo() {
  open.value = false
  window.open('https://github.com/endday/glyph-clash', '_blank', 'noopener')
}

function toggleMenu(e) {
  if (e) e.stopPropagation()
  open.value = !open.value
  if (open.value) readState()
}

function onDocTap(e) {
  if (!open.value) return
  if (menuEl && menuEl.contains(e.target)) return
  open.value = false
}

onMounted(() => {
  menuEl = document.querySelector('[data-menu]')
  document.addEventListener('pointerdown', onDocTap)
  readState()
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocTap)
})
</script>

<style scoped>
.topbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-bottom: 1px solid rgba(40, 33, 26, .16);
  background: linear-gradient(180deg, rgba(255, 252, 242, .72), rgba(255, 252, 242, .18));
  flex-wrap: nowrap;
  overflow: hidden;
  min-width: 0;
}
.brand { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.brand-zh {
  font-family: "KaiTi", "STKaiti", serif;
  font-size: 18px;
  letter-spacing: 1px;
  white-space: nowrap;
  color: #1b1815;
}
.brand-en {
  font-family: "Songti SC", "SimSun", serif;
  font-size: 9px;
  letter-spacing: 3px;
  color: #9b8f7d;
  white-space: nowrap;
}

.topstats {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  min-width: 0;
  overflow: hidden;
}
.stat {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(255, 252, 244, .55);
  border: 1px solid rgba(40, 33, 26, .16);
  font-size: 10.5px;
  color: #38312a;
  white-space: nowrap;
  flex: 0 0 auto;
}
.stat-k { font-size: 10px; color: #6d6255; }
.stat-v {
  font-family: "Songti SC", "SimSun", serif;
  font-weight: 700;
  font-size: 12.5px;
  color: #1b1815;
  font-variant-numeric: tabular-nums;
}
.phase-tag {
  font-size: 9.5px;
  padding: 1px 6px;
  border-radius: 999px;
  color: #fff;
  background: #a9812f;
  letter-spacing: .5px;
}
.hearts { display: flex; gap: 2px; }
.hearts :deep(i) {
  width: 7px;
  height: 7px;
  display: block;
  transform: rotate(45deg);
  background: #a5342a;
  border-radius: 1px;
}
.hearts :deep(i.off) { background: #9b8f7d; opacity: .4; }
.coin {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: radial-gradient(circle at 34% 30%, #f6d98b, #c99a37 62%, #8d681f);
}

.topactions { position: relative; display: flex; gap: 4px; margin-left: 4px; flex: 0 0 auto; }
.icon-btn {
  width: 27px;
  height: 27px;
  border-radius: 7px;
  border: 1px solid rgba(40, 33, 26, .16);
  background: rgba(255, 252, 244, .6);
  color: #38312a;
  font-family: "Songti SC", serif;
  font-size: 11px;
  display: grid;
  place-items: center;
  cursor: pointer;
  padding: 0;
}
.icon-btn:active { transform: scale(.95); }
.icon-btn.hidden { display: none; }

/* 下拉菜单 */
.menu {
  position: absolute;
  right: 0;
  top: calc(100% + 6px);
  z-index: 60;
  width: 168px;
  padding: 6px;
  border-radius: 10px;
  background: #fffcf4;
  border: 1px solid rgba(120, 95, 60, .28);
  box-shadow: 0 10px 26px rgba(40, 30, 18, .22);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.mrow { display: flex; align-items: center; gap: 4px; }
.mk { font-size: 10.5px; color: #6d6255; margin-right: auto; padding-left: 4px; }
.seg {
  width: 34px; height: 26px; border-radius: 7px; cursor: pointer;
  border: 1px solid rgba(120, 95, 60, .3); background: rgba(120, 95, 60, .06);
  font-family: "Songti SC", serif; font-size: 11px; color: #38312a;
}
.seg.on { background: #a9812f; border-color: #8a6a1f; color: #fff8e6; }
.mitem {
  display: flex; align-items: center; justify-content: space-between;
  height: 30px; padding: 0 8px; border-radius: 7px; cursor: pointer;
  border: 1px solid transparent; background: rgba(120, 95, 60, .05);
  font-size: 12px; color: #2f2822; text-align: left;
}
.mitem:active { background: rgba(120, 95, 60, .12); }
.mitem em { font-style: normal; font-size: 10.5px; color: #8a6a1f; }

@media (max-width: 901px) {
  .brand { display: none; }
  .brand-zh { font-size: 15px; }
  .topbar { padding: 3px 8px !important; gap: 4px !important; }
}
</style>
