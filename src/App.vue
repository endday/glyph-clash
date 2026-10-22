<template>
  <div class="app" @contextmenu.prevent>
    <TopBar />

    <main id="stage" class="stage">
      <BoardCanvas />

      <aside id="panel" class="panel" :class="{ 'is-battle': ui.phase === 'battle' }">
        <div v-if="ui.phase !== 'battle'" class="market-slot">
          <Market />
        </div>
        <BattlePanel v-if="ui.phase === 'battle'" />
        <ShopSheet v-else />
      </aside>
    </main>

    <PeekTip />
    <ModalHost />
    <ToastHost />
    <DragGhost />

    <!-- 旧版弹窗 / 提示 / 拖拽层挂载点 -->
    <div id="overlay" class="overlay hidden"></div>
    <div id="toasts" class="toasts"></div>
    <div id="draglayer" class="draglayer"></div>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted } from 'vue'
import { ui } from './store.js'
import TopBar from './components/TopBar.vue'
import BoardCanvas from './components/BoardCanvas.vue'
import ShopSheet from './components/ShopSheet.vue'
import Market from './components/Market.vue'
import BattlePanel from './components/BattlePanel.vue'
import PeekTip from './components/PeekTip.vue'
import ModalHost from './components/ModalHost.vue'
import ToastHost from './components/ToastHost.vue'
import DragGhost from './components/DragGhost.vue'

// 点空白处 = 取消选中（棋子详情浮层随之收起），类似失焦
// 保留选中的区域：有棋子的备战席格（拖动起点）、底部操作栏（卖出需要）、浮层本身
const KEEP_SEL = '.slot.filled, .bar, .tip'
function onAwayTap(e) {
  const t = e.target
  if (!t || !t.closest) return
  if (t.closest(KEEP_SEL)) return
  if (ui.drag) return
  const g = window.GB
  if (g && g.UI && g.UI.select) g.UI.select(null)
}

onMounted(async () => {
  document.addEventListener('pointerdown', onAwayTap, true)
  // 旧版启动器：初始化渲染器、绑定交互、显示门派选择
  await import('../js/main.js')
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onAwayTap, true)
})
</script>

<style scoped>
.app {
  position: relative;
  z-index: 1;
  height: 100%;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-width: 0;
  overflow: hidden;
}

.stage {
  display: flex;
  min-height: 0;
  min-width: 0;
  gap: 14px;
  padding: 12px 16px 14px;
  align-items: stretch;
  overflow: hidden;
}

.panel {
  width: 372px;
  flex: 0 0 372px;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-radius: 10px;
  background: linear-gradient(180deg, rgba(255, 252, 244, .72), rgba(248, 240, 224, .5));
  border: 1px solid rgba(40, 33, 26, .16);
  overflow: hidden;
}

.market-slot {
  flex: 0 0 auto;
  max-height: 52%;
  min-height: 0;
  overflow-y: auto;
  padding: 10px 11px 8px;
  border-bottom: 1px solid rgba(40, 33, 26, .1);
}

@media (min-width: 901px) {
  .panel.is-battle {
    align-self: flex-start;
    height: auto;
    flex: 0 0 372px;
  }
}

@media (max-width: 900px) {
  .app { height: 100dvh; }
  .stage {
    flex-direction: column;
    gap: 2px;
    padding: 2px 6px 0;
  }
  .panel {
    width: 100%;
    flex: 0 0 70dvh;
    height: 70dvh;
    max-height: 70dvh;
    border-radius: 14px 14px 0 0;
    border-bottom: none;
  }
  .market-slot { padding: 7px 8px 5px; max-height: 46%; }
  .panel.is-battle {
    flex: 0 0 auto;
    height: auto;
    max-height: none;
  }
}
</style>
