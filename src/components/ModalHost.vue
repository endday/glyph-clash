<template>
  <div v-if="ui.books.offer.length" class="ov evo-ov">
    <div class="card">
      <header class="outcome">
        <span class="bigseal win">书</span>
        <span class="ot">
          <b>兵书 · 三选一</b>
          <em>构筑位 {{ ui.books.list.length }}/{{ ui.books.slots }} · 一本改一条规则，选完不换</em>
        </span>
      </header>
      <div class="evos books3">
        <button v-for="o in ui.books.offer" :key="o.id" class="evo-opt" @click="pickBook(o.id)">
          <b>{{ o.ch }} {{ o.name }}<i class="tier">{{ ['铜','银','金'][o.tier - 1] }}</i></b>
          <em>{{ o.desc }}</em>
        </button>
      </div>
    </div>
  </div>

  <div v-if="ui.evo" class="ov evo-ov">
    <div class="card">
      <header class="outcome">
        <span class="bigseal win">{{ ui.evo.ch }}</span>
        <span class="ot">
          <b>{{ ui.evo.name }} · 规则进化</b>
          <em>升到 2 级，二选一。选完就定，不能反悔。</em>
        </span>
      </header>
      <div class="evos">
        <button v-for="o in ui.evo.options" :key="o.id" class="evo-opt" @click="pickEvo(o.id)">
          <b>{{ o.name }}</b>
          <em>{{ o.desc }}</em>
        </button>
      </div>
    </div>
  </div>

  <div v-if="m" class="ov" @click.self="onBack">
    <div class="card">
      <!-- 门派选择 -->
      <template v-if="m.kind === 'title'">
        <header class="head">
          <span class="seal">字</span>
          <h1>符阵</h1>
          <span class="en">GLYPH CLASH</span>
          <p class="sub">在六边形的背包里摆汉字人物，<br>让它们自己打完这一仗。</p>
        </header>

        <div class="factions">
          <button
            v-for="f in m.factions"
            :key="f.id"
            class="faction"
            :style="{ borderColor: f.color }"
            @click="pick(f.id)"
          >
            <span class="fname" :style="{ color: f.color }">{{ f.name }}</span>
            <span class="fhero">{{ f.hero }}</span>
            <span class="fpromise">{{ f.promise }}</span>
            <span class="fpcs"><i v-for="(ch, i) in f.pieces" :key="i" class="fp">{{ ch }}</i></span>
          </button>
        </div>

        <button v-if="m.hasSave" class="save" @click="cont">继续经营</button>
        <p class="foot">选一个门派 · 10 天内赢下 6 场对局</p>
      </template>

      <!-- 结算 / 终局 -->
      <template v-else-if="m.kind === 'outcome'">
        <header class="outcome">
          <span class="bigseal" :class="m.win ? 'win' : 'lose'">{{ m.seal }}</span>
          <span class="ot">
            <b>{{ m.title }}</b>
            <em>{{ m.sub }}</em>
          </span>
        </header>

        <dl v-if="m.rows && m.rows.length" class="rows">
          <div v-for="(r, i) in m.rows" :key="i" class="row">
            <dt>{{ r.k }}</dt><dd>{{ r.v }}</dd>
          </div>
        </dl>

        <footer class="acts">
          <button class="sbtn red" @click="next">{{ m.next || '继续' }}</button>
        </footer>
      </template>

      <!-- 菜单 -->
      <template v-else-if="m.kind === 'menu'">
        <h2 class="mh">玩法</h2>
        <p class="p">点备战席里的棋子选中，再点棋盘格落子；点棋盘上的棋子可以挪位置。</p>
        <p class="p">选中一颗，再点同字同级的一颗即可合成升级；棋子占 1～3 格，放不下会有提示。</p>
        <p class="p">每枚棋子都有一个小技能，会自动释放；3 级起解锁大招，可在对局面板的大招条里手动放。</p>
        <p class="p muted">对局最长 55 秒，超时比双方剩余总血量。</p>
        <p class="p muted">输一场按当天进度扣声望，声望归零即出局；10 天内赢 6 场登顶。</p>

        <footer class="acts">
          <button class="sbtn gold" @click="toggleUlt">大招：{{ m.autoUlt ? '自动释放' : '手动释放' }}</button>
          <button class="sbtn" @click="restart">重新开始</button>
          <button class="sbtn" @click="repo">项目仓库</button>
          <button class="sbtn red" @click="dismiss">返回</button>
        </footer>
      </template>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { ui } from '../store.js'

const m = computed(() => ui.modal)
const GB = () => window.GB

function pickBook(id) {
  const g = GB()
  if (g && g.UI && g.UI.chooseBook) g.UI.chooseBook(id)
}

function pickEvo(id) {
  const g = GB()
  if (g && g.UI && g.UI.chooseEvo) g.UI.chooseEvo(id)
}

function close() {
  const g = GB()
  if (g && g.UI && g.UI.closeModal) g.UI.closeModal()
  ui.modal = null
}
function pick(id) {
  const g = GB()
  ui.modal = null
  if (g) { g.audio.unlock(); g.audio.gong(); g.Game.newRun(id) }
}
function cont() {
  const g = GB()
  ui.modal = null
  if (g) g.Game.continueRun()
}
function next() {
  const g = GB()
  ui.modal = null
  if (!g) return
  if (m.value && m.value.end) { restart(); return }
  g.UI.closeModal()
  g.Game.next()
}
function restart() {
  const g = GB()
  ui.modal = null
  if (g && g.U && g.U.clearSave) g.U.clearSave()
  location.reload()
}
function toggleUlt() {
  const g = GB()
  if (!g) return
  g.Game.toggleAutoUlt()
  g.UI.closeModal()
  if (g.Game.openMenu) g.Game.openMenu()
}
function dismiss() { close() }
function repo() { window.open('https://github.com/endday/glyph-clash', '_blank', 'noopener') }
function onBack() {
  if (m.value && m.value.kind === 'menu') close()
}
</script>

<style scoped>
.ov {
  position: fixed; inset: 0; z-index: 70; padding: 12px 10px;
  display: flex; align-items: center; justify-content: center;
  background: radial-gradient(circle at 50% 40%, rgba(30, 24, 16, .42), rgba(20, 16, 10, .72));
  backdrop-filter: blur(3px);
  overflow-y: auto;
}
.card {
  width: min(520px, 100%); max-height: 92dvh; overflow-y: auto;
  border-radius: 14px; padding: 14px 13px 12px;
  background: linear-gradient(180deg, #fbf5e6, #f0e5cd);
  border: 1px solid rgba(60, 45, 25, .3);
  box-shadow: 0 18px 46px rgba(20, 14, 6, .4);
  display: flex; flex-direction: column; gap: 9px;
  font-family: var(--serif, "Songti SC", serif); color: #1b1815;
  animation: pop .24s cubic-bezier(.2, 1.2, .3, 1);
}
@keyframes pop { from { transform: translateY(10px) scale(.98); opacity: 0 } }

/* 门派 */
.head { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.seal { width: 34px; height: 34px; border-radius: 7px; display: grid; place-items: center;
  background: linear-gradient(160deg, #c0442f, #8e291e); color: #f8ecd2;
  font-family: var(--kai, "KaiTi", serif); font-size: 21px;
  box-shadow: 0 4px 12px rgba(140, 40, 25, .3); }
.head h1 { margin: 3px 0 0; font-family: var(--kai, "KaiTi", serif);
  font-size: clamp(26px, 8.4vw, 36px); letter-spacing: 4px; }
.head .en { font-size: 8.5px; letter-spacing: 4px; color: #9b8f7d; }
.head .sub { margin: 6px 0 0; text-align: center; font-size: 11.5px; line-height: 1.6; color: #6d6255; }

.factions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; }
.faction { display: flex; flex-direction: column; gap: 1px; text-align: left; cursor: pointer;
  padding: 8px 9px; border-radius: 9px; min-width: 0;
  border: 1.5px solid rgba(60, 45, 25, .3); background: rgba(255, 252, 244, .78); }
.faction:active { transform: translateY(1px); }
.fname { font-family: var(--kai, "KaiTi", serif); font-size: 15px; letter-spacing: 1.5px; }
.fhero { font-size: 9.5px; color: #9b8f7d; }
.fpromise { font-size: 10px; line-height: 1.45; color: #5d5347; min-height: 29px; }
.fpcs { display: flex; gap: 3px; margin-top: 2px; }
.fp { width: 17px; height: 17px; border-radius: 4px; display: grid; place-items: center;
  font-style: normal; font-size: 11px; color: #f4ecda;
  background: linear-gradient(160deg, #3b342b, #1c1814); }

.save { min-height: 32px; border-radius: 8px; cursor: pointer; font-size: 12px;
  border: 1px solid rgba(40, 33, 26, .18); background: rgba(255, 252, 244, .85); color: #38312a; }
.foot { margin: 0; text-align: center; font-size: 10px; color: #9b8f7d; }

/* 结算 */
.outcome { display: flex; gap: 11px; align-items: center; }
.bigseal { width: 54px; height: 54px; flex: 0 0 54px; border-radius: 8px; display: grid; place-items: center;
  font-family: var(--kai, "KaiTi", serif); font-size: 30px; color: #f8ecd2; }
.bigseal.win { background: linear-gradient(160deg, #4d7d63, #2f5343); box-shadow: 0 6px 16px rgba(47, 83, 67, .34); }
.bigseal.lose { background: linear-gradient(160deg, #b0473a, #7d2a1e); box-shadow: 0 6px 16px rgba(120, 40, 25, .32); }
.ot b { display: block; font-family: var(--kai, "KaiTi", serif); font-size: 19px; letter-spacing: 2px; }
.ot em { display: block; margin-top: 3px; font-style: normal; font-size: 11px; color: #6d6255; }

.rows { margin: 0; display: flex; flex-wrap: wrap; gap: 6px; }
.row { display: flex; align-items: baseline; gap: 5px; padding: 4px 9px; border-radius: 999px;
  background: rgba(255, 252, 244, .8); border: 1px solid rgba(40, 33, 26, .14); }
.row dt { font-size: 10.5px; color: #6d6255; }
.row dd { font-size: 12.5px; font-weight: 700; color: #8a6a1f; font-variant-numeric: tabular-nums; }

/* 菜单 */
.mh { margin: 0; font-family: var(--kai, "KaiTi", serif); font-size: 18px; letter-spacing: 2px; }
.p { margin: 0; font-size: 11.5px; line-height: 1.6; color: #4a4238; }
.p.muted { color: #8a7d6b; font-size: 10.5px; }

.evos { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.books3 { grid-template-columns: 1fr; }
.evo-opt .tier { font-style: normal; font-size: 9px; margin-left: 5px; padding: 1px 5px;
  border-radius: 999px; background: rgba(160, 122, 45, .18); color: #7a5c14; vertical-align: 2px; }
.evo-opt { display: flex; flex-direction: column; gap: 3px; text-align: left; cursor: pointer;
  padding: 10px 11px; border-radius: 10px; min-width: 0;
  border: 1.5px solid rgba(160, 122, 45, .55);
  background: linear-gradient(180deg, #fdf7e8, #f2e6cc); color: #1b1815; }
.evo-opt:active { transform: translateY(1px); }
.evo-opt b { font-family: var(--kai, "KaiTi", serif); font-size: 15px; letter-spacing: 1px; color: #7a5c14; }
.evo-opt em { font-style: normal; font-size: 10.5px; line-height: 1.45; color: #5d5347; }

.acts { display: flex; gap: 7px; justify-content: flex-end; flex-wrap: wrap; margin-top: 2px; }
.sbtn { min-height: 34px; padding: 6px 13px; border-radius: 8px; cursor: pointer;
  font-family: var(--serif, "Songti SC", serif); font-size: 12.5px; letter-spacing: .5px;
  border: 1px solid rgba(40, 33, 26, .16); background: rgba(255, 252, 244, .85); color: #38312a; }
.sbtn.gold { color: #241a06; border-color: rgba(160, 122, 45, .5);
  background: linear-gradient(180deg, #c79a3f, #8f6a1f); }
.sbtn.red { color: #f7f0dd; border-color: rgba(120, 35, 22, .55);
  background: linear-gradient(180deg, #c14a38, #8e291e); }
</style>
