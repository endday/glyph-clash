<template>
  <section class="boardwrap" id="boardwrap" @contextmenu.prevent>
    <canvas ref="cv" id="board"></canvas>
  </section>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'

// 只负责挂载 canvas；绘制与交互由 game 层（GB.Render / GB.UI）接管
const cv = ref(null)

// 热更新会重新挂载组件 → 画布是个新元素。
// 老渲染器还握着已经被移除的那块 canvas，必须重新 init，否则棋盘一片空白。
onMounted(() => {
  const g = window.GB
  if (!g || !cv.value) return
  if (g.Render && g.Render.init) g.Render.init(cv.value)
  if (g.UI && g.UI.init) g.UI.init()   // bind() 幂等，只会给新 canvas 挂一次
})

onBeforeUnmount(() => {
  const g = window.GB
  if (g && g.Render && g.Render.init) g.Render.init(null)
})
</script>

<style scoped>
.boardwrap {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  min-height: 0;
  width: 100%;
  overflow: hidden;
  -webkit-touch-callout: none;
  -webkit-user-select: none;
  user-select: none;
}
#board {
  display: block;
  max-width: 100%;
  height: auto;
  border-radius: 8px;
  touch-action: none;
  -webkit-touch-callout: none;
  -webkit-user-select: none;
  user-select: none;
}

@media (max-width: 900px) {
  .boardwrap {
    flex: 1 1 auto;
    width: 100%;
    max-width: 100%;
  }
  #board {
    max-width: 100%;
    height: auto;
  }
}
</style>
