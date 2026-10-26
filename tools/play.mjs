// tools/play.mjs — 让 AI 实际玩一局：每一步「截图 → 读状态 → 执行动作」
//
// 用法：
//   node tools/play.mjs --url http://127.0.0.1:5173/ --out shots/play --steps steps.json
//   node tools/play.mjs --url ... --out ... --auto 40        （用内置策略自动跑 40 步）
//
// steps.json 格式（数组，按顺序执行）：
//   [{"name":"buy","args":{"offerId":"o1"}}, {"name":"battle"}]
//   action 可以是 {"name","args"}，也可以是 {"eval":"任意 JS 表达式"} 用于临时探针
//
// 产物：
//   <out>/step-000.png …   每一步一张截图（动作执行后）
//   <out>/transcript.json  每一步的 {step, action, result, state}（state 是 DRIVER.state()）
//   <out>/actions.json     最后一步的 DRIVER.actions()（可行动作列表，便于 AI 决策）
import fs from 'node:fs';
import path from 'node:path';

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

const URL_ = arg('url', 'http://127.0.0.1:5173/');
const OUT = arg('out', 'shots/play');
const STEPS_FILE = arg('steps', '');
const AUTO = +(arg('auto', '0') || 0);
const W = +(arg('w', '360'));
const H = +(arg('h', '800'));
const PORT = process.env.CDP_PORT || 9333;

fs.mkdirSync(OUT, { recursive: true });

/* ---------------- CDP ---------------- */
const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const events = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
  } else if (m.method) {
    (events.get(m.method) || []).forEach((f) => f(m.params));
  }
});
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const mid = ++id;
    pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
    setTimeout(() => {
      if (pending.has(mid)) { pending.delete(mid); rej(new Error('timeout ' + method)); }
    }, 120000);
  });
const once = (method) =>
  new Promise((res) => {
    const fns = events.get(method) || [];
    const f = (p) => { events.set(method, fns.filter((x) => x !== f)); res(p); };
    events.set(method, [...fns, f]);
  });

await new Promise((res) => ws.addEventListener('open', res));
await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: W < 600 });
await send('Emulation.setTouchEmulationEnabled', { enabled: W < 600 });

const loaded = once('Page.loadEventFired');
await send('Page.navigate', { url: URL_ });
await loaded.catch(() => {});
await sleep(1200);

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r.result?.value ?? null;
}

async function shot(file) {
  const s = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(file, Buffer.from(s.data, 'base64'));
}

async function getState() {
  return evaluate('DRIVER && DRIVER.state ? JSON.stringify(DRIVER.state()) : null').then((v) =>
    v ? JSON.parse(v) : null
  );
}

/* ---------------- 进入游戏（选门派） ---------------- */
async function enterGame() {
  const ok = await evaluate(`(() => {
    const b = document.querySelectorAll('.faction');
    if (!b.length) return false;
    b[0].click();
    return true;
  })()`);
  if (ok) await sleep(1200);
  return ok;
}

/* ---------------- 内置策略（--auto 用） ---------------- */
function pickAuto(st) {
  if (!st) return null;
  if (st.modal && st.modal.kind === 'outcome') return { name: 'closeModal', args: {} };
  if (st.evoOffer && st.evoOffer.options.length) return { name: 'chooseEvo', args: { id: st.evoOffer.options[0].id } };
  if (st.bookOffer && st.bookOffer.length && st.books.length < (st.books.length + 3)) {
    return { name: 'chooseBook', args: { id: st.bookOffer[0].id } };
  }
  if (st.phase === 'battle') return { name: 'waitBattle', args: {} };
  if (st.phase !== 'shop') return null;
  // 1) 能合成先合成
  const byKey = {};
  for (const p of [...st.bench, ...st.board]) {
    const k = p.k + '#' + p.level;
    if (byKey[k]) return { name: 'merge', args: { a: byKey[k].id, b: p.id } };
    byKey[k] = p;
  }
  // 2) 有钱先买（优先买得起的、贵的）
  const buyable = st.offers.filter((o) => !o.sold && o.price <= st.gold).sort((a, b) => b.price - a.price);
  if (buyable.length && st.bench.length < 6) return { name: 'buy', args: { offerId: buyable[0].id } };
  // 3) 备战席里的棋子尽量上阵
  if (st.bench.length) {
    const size = st.bench[0].size || 1;
    return { name: 'testPlace', args: { pieceId: st.bench[0].id, size } };
  }
  // 4) 开战
  if (st.board.length) return { name: 'battle', args: {} };
  return { name: 'reroll', args: {} };
}

/* 落子要试多个格子：放进页面里暴力找第一个能放的位置 */
async function doPlace(pieceId) {
  return evaluate(`(() => {
    const g = window.GB, r = g.UI.getRun();
    const p = g.Run.allPieces(r).find(x => x.id === ${JSON.stringify(pieceId)});
    if (!p) return { ok: false, msg: 'no piece' };
    for (const c of g.MAP.playerCells()) {
      if (!g.Run.isOwned(r, c.c, c.r)) continue;
      if (g.Run.placeAt(r, p, c.c, c.r)) { g.UI.refresh(); return { ok: true, msg: 'placed' }; }
    }
    return { ok: false, msg: 'no room' };
  })()`);
}

/* ---------------- 主循环 ---------------- */
let steps = [];
if (STEPS_FILE) steps = JSON.parse(fs.readFileSync(STEPS_FILE, 'utf8'));

await enterGame();
const transcript = [];
const total = STEPS_FILE ? steps.length : AUTO;
let lastActions = [];

for (let i = 0; i < total; i++) {
  const st = await getState();
  await shot(path.join(OUT, `step-${String(i).padStart(3, '0')}-a.png`));

  let action = STEPS_FILE ? steps[i] : pickAuto(st);
  if (!action) break;

  let result;
  if (action.eval) {
    result = { ok: true, msg: 'eval', value: await evaluate(action.eval) };
  } else if (action.name === 'testPlace') {
    result = await doPlace(action.args.pieceId);
  } else if (action.name === 'waitBattle') {
    await evaluate(`(() => { if (GB.Game.cycleSpeed) { GB.Game.cycleSpeed(); GB.Game.cycleSpeed(); } })()`);
    result = await evaluate(`DRIVER.waitBattle(80000)`);
    await sleep(400);
  } else {
    result = await evaluate(`DRIVER.do(${JSON.stringify(action.name)}, ${JSON.stringify(action.args || {})})`);
  }
  await sleep(action.name === 'battle' ? 1200 : 350);

  const after = await getState();
  await shot(path.join(OUT, `step-${String(i).padStart(3, '0')}-b.png`));
  transcript.push({ step: i, action, result, state: after });
  lastActions = await evaluate('JSON.stringify(DRIVER.actions().map(a => a.label))').then((v) => (v ? JSON.parse(v) : []));
  console.log(`#${i} ${action.name} → ${result && result.ok ? 'ok' : 'FAIL ' + (result && result.msg)} | day ${after?.day} ${after?.phase} 金${after?.gold} 格${after?.cells?.used}/${after?.cells?.n}`);
}

fs.writeFileSync(path.join(OUT, 'transcript.json'), JSON.stringify(transcript, null, 2));
fs.writeFileSync(path.join(OUT, 'actions.json'), JSON.stringify(lastActions, null, 2));
console.log('写完 ' + OUT + '/transcript.json （' + transcript.length + ' 步）');
await send('Page.close').catch(() => {});
ws.close();
process.exit(0);
