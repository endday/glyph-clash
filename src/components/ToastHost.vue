<template>
  <div class="toasts" aria-live="polite">
    <transition-group name="t">
      <div v-for="t in ui.toasts" :key="t.id" class="toast" :class="t.kind">{{ t.msg }}</div>
    </transition-group>
  </div>
</template>

<script setup>
import { ui } from '../store.js'
</script>

<style scoped>
.toasts {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 55;
  display: flex; flex-direction: column; align-items: center; gap: 5px;
  padding: 0 12px calc(env(safe-area-inset-bottom, 0px) + 10px);
  pointer-events: none;
}
.toast {
  max-width: 88vw; padding: 6px 12px; border-radius: 999px;
  font-family: var(--serif, "Songti SC", serif); font-size: 12px; letter-spacing: .5px;
  color: #f6efdd; background: rgba(32, 26, 19, .9);
  border: 1px solid rgba(215, 175, 90, .28);
  box-shadow: 0 6px 18px rgba(10, 6, 2, .34);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.toast.good { background: rgba(47, 83, 67, .94); border-color: rgba(120, 170, 140, .34); }
.toast.bad { background: rgba(125, 42, 30, .94); border-color: rgba(200, 110, 90, .34); }
.toast.gold { background: linear-gradient(180deg, #c79a3f, #8f6a1f); color: #241a06; border-color: rgba(255, 240, 200, .4); }

.t-enter-active, .t-leave-active { transition: opacity .18s, transform .18s; }
.t-enter-from { opacity: 0; transform: translateY(6px); }
.t-leave-to { opacity: 0; transform: translateY(-4px); }

@media (min-width: 901px) {
  .toasts { bottom: 18px; align-items: flex-end; padding-right: 22px; }
}
</style>
