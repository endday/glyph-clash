<template>
  <section class="market">
    <header class="mt-head">
      <i class="tick"></i>
      <span class="ttl">晨市</span>
      <span class="sub">第 {{ ui.day }} 天 · 刷新 2 金</span>
    </header>

    <p v-if="ui.enchId" class="note">选一颗棋子附魔</p>

    <div class="grid">
      <button
        v-for="o in ui.offers"
        :key="o.id"
        class="card"
        :class="[o.tone, { sold: o.sold, cant: o.cant, pick: ui.enchId === o.id }]"
        :disabled="o.sold"
        @click="buy(o.id)"
      >
        <span v-if="o.badge" class="badge">{{ o.badge }}</span>
        <span class="glyph" :class="o.tone">{{ o.glyph }}</span>
        <span class="info">
          <b>{{ o.name }}</b>
          <em>{{ o.kind }}</em>
        </span>
        <span class="desc">{{ o.desc }}</span>
        <span class="price"><i class="coin"></i>{{ o.price }}</span>
      </button>
    </div>
  </section>
</template>

<script setup>
import { ui } from '../store.js'

function buy(id) {
  const g = window.GB
  if (g && g.UI && g.UI.buyOfferById) g.UI.buyOfferById(id)
}
</script>

<style scoped>
.market { display: flex; flex-direction: column; gap: 7px; min-width: 0; }

.mt-head { display: flex; align-items: baseline; gap: 7px; min-width: 0; }
.tick { width: 3px; height: 12px; background: #a5342a; border-radius: 1px; flex: 0 0 3px; }
.ttl { font-family: var(--kai, "KaiTi", serif); font-size: 13px; letter-spacing: 1px; color: #38312a; }
.sub { margin-left: auto; font-size: 10px; color: #9b8f7d; white-space: nowrap; }

.note { margin: 0; font-size: 10.5px; color: #8a6a1f; background: rgba(196, 158, 74, .16);
  border: 1px dashed rgba(160, 122, 45, .45); border-radius: 6px; padding: 5px 7px; }

.grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; }

.card {
  position: relative; display: grid; grid-template-columns: auto minmax(0, 1fr);
  grid-template-rows: auto 1fr auto; gap: 2px 6px;
  padding: 7px 8px; border-radius: 8px; text-align: left;
  border: 1px solid rgba(40, 33, 26, .16);
  background: linear-gradient(180deg, rgba(255, 252, 244, .92), rgba(247, 238, 220, .78));
  color: #1b1815; font-family: inherit; cursor: pointer; min-width: 0;
  transition: transform .1s, box-shadow .12s;
}
.card:active { transform: translateY(1px); }
.card.sold { opacity: .34; filter: grayscale(.8); pointer-events: none; }
.card.cant { opacity: .55; }
.card.pick { box-shadow: 0 0 0 2px rgba(169, 129, 47, .55); }

.badge { position: absolute; top: 5px; right: 6px; font-size: 8.5px; letter-spacing: .5px;
  padding: 1px 5px; border-radius: 999px; background: #a5342a; color: #fff; }
.card.gold .badge { background: linear-gradient(90deg, #b7822f, #d8ac57); }
.card.jade .badge { background: #3f6b57; }

.glyph { width: 28px; height: 28px; border-radius: 6px; display: grid; place-items: center;
  font-family: var(--kai, "KaiTi", serif); font-size: 16px; line-height: 1;
  background: linear-gradient(160deg, #3b342b, #1c1814); color: #f4ecda;
  box-shadow: inset 0 0 0 1px rgba(255, 250, 236, .12); }
.glyph.gold { background: linear-gradient(160deg, #d9b45e, #9a7222); color: #2a2008; }
.glyph.jade { background: linear-gradient(160deg, #5d8f77, #2f5343); }

.info { min-width: 0; align-self: center; }
.info b { display: block; font-size: 11.5px; line-height: 1.2; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; }
.info em { display: block; font-style: normal; font-size: 9.5px; color: #8a7d6b; }

.desc { grid-column: 1 / -1; font-size: 9.5px; line-height: 1.35; color: #5d5347;
  min-height: 26px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden; }

.price { grid-column: 1 / -1; display: flex; align-items: center; justify-content: flex-end;
  gap: 3px; font-size: 11px; font-weight: 700; color: #8a6a1f;
  font-variant-numeric: tabular-nums; }
.coin { width: 10px; height: 10px; border-radius: 50%;
  background: radial-gradient(circle at 34% 30%, #f6d98b, #c99a37 62%, #8d681f); }
</style>
