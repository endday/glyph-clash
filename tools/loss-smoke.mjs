// tools/loss-smoke.mjs — 打一场，等到结算弹窗，截图（用来检查连败补偿那一行）
// usage: node tools/loss-smoke.mjs <url> <out.png> [w] [h]
import fs from 'node:fs';
import WS from 'ws';

const [url = 'http://127.0.0.1:5173/', out = 'shots/loss.png', w = '390', h = '844'] = process.argv.slice(2);
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
  } else if (m.method === 'Runtime.exceptionThrown') {
    logs.push('EXCEPTION: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  }
});
const send = (method, params = {}) => new Promise((res, rej) => {
  const mid = ++id; pending.set(mid, { res, rej });
  ws.send(JSON.stringify({ id: mid, method, params }));
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evalJS = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.value;

await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: +w, height: +h, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url });
await sleep(2000);

await evalJS(`(function(){
  document.querySelector('.faction').click();
  var d = window.DRIVER, a = d.actions();
  var place = a.filter(function(x){return x.name==='place';})[0];
  if (place) d.do('place', place.args);
  d.do('battle');
  return 1;
})()`);

// 轮询到结算弹窗出现
let state = null;
for (let i = 0; i < 40; i++) {
  await sleep(700);
  state = await evalJS(`(function(){
    var m = document.querySelector('.modal, .sheet, [class*=modal]');
    var txt = (m && m.innerText) || '';
    return JSON.stringify({ txt: txt.slice(0, 220), phase: window.DRIVER.state().phase });
  })()`);
  if (state && state.includes('继续')) break;
}

const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
console.log('state', state);
console.log('errors', logs.length ? logs.join('\n') : '(none)');
console.log('saved', out);
ws.close();
