<template>
  <header id="topbar" class="topbar">
    <div class="brand">
      <span class="brand-zh">活字阵</span>
      <span class="brand-en">MOVABLE TYPE</span>
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
      <button class="icon-btn" id="btn-speed">1×</button>
      <button class="icon-btn" id="btn-sound">♪</button>
      <button class="icon-btn" id="btn-menu">☰</button>
    </div>
  </header>
</template>

<script setup>
// 数据写入仍由 GB.UI.renderTop 完成（它按 id 找节点）
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

.topactions { display: flex; gap: 4px; margin-left: 4px; flex: 0 0 auto; }
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

@media (max-width: 901px) {
  .brand { display: none; }
  .brand-zh { font-size: 15px; }
  .topbar { padding: 3px 8px !important; gap: 4px !important; }
}
</style>
