// tools/battle-smoke.mjs — 开一局 → 上阵 → 打一场 → 截图，并收集控制台异常
// usage: node tools/battle-smoke.mjs <url> <out.png> [w] [h]
import fs from 'node:fs';
import WS from 'ws';

const [url = 'http://127.0.0.1:5173/', out = 'shots/battle.png', w = '390', h = '844'] = process.argv.slice(2);
const PORT = process.env.CDP_PORT || 9333;

const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WS(t.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
let id = 0;
const pending = new Map();
const logs = [];
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
  } else if (m.method === 'Runtime.consoleAPICalled') {
    const txt = m.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
    if (m.params.type === 'error' || m.params.type === 'warning') logs.push(m.params.type + ': ' + txt);
  } else if (m.method === 'Runtime.exceptionThrown') {
    logs.push('EXCEPTION: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  }
});
const send = (method, params = {}) => new Promise((res, rej) => {
  const mid = ++id;
  pending.set(mid, { res, rej });
  ws.send(JSON.stringify({ id: mid, method, params }));
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evalJS = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  return r.result?.value;
};

await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: +w, height: +h, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url });
await sleep(2200);

// 1. 选门派 2. 上阵 3. 出战
const info = await evalJS(`(function(){
  document.querySelector('.faction').click();
  var d = window.DRIVER;
  var acts = d.actions();
  var place = acts.filter(function(a){ return a.name === 'place'; })[0];
  if (place) d.do('place', place.args);
  var st = d.state();
  d.do('battle');
  return JSON.stringify({ day: st.day, gold: st.gold, units: st.units && st.units.length, placed: !!place });
})()`);
await sleep(1400);
const mid = await evalJS(`(function(){ var s = window.DRIVER.state(); return JSON.stringify({phase:s.phase, battle: s.battle && {t: s.battle.t, status: s.battle.status, p: s.battle.hpP, e: s.battle.hpO}});})()`);

const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));

await sleep(6000);
const after = await evalJS(`(function(){ var s = window.DRIVER.state(); return JSON.stringify({phase:s.phase, result: s.lastResult, hpP: s.hpP, hpO: s.hpO});})()`);

console.log('start', info);
console.log('mid', mid);
console.log('after', after);
console.log('errors', logs.length ? logs.slice(-6).join('\n') : '(none)');
console.log('saved', out);
ws.close();
