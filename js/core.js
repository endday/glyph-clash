/* core.js — 基础工具：随机数、数学、DOM、存储、音效 */
(function (root) {
  'use strict';
  var GB = root.GB = root.GB || {};
  var U = GB.U = {};

  /* ---------------- 随机 ---------------- */
  U.mulberry32 = function (a) {
    var s = a | 0;
    return function () {
      s = (s + 0x6D2B79F5) | 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  U.hash = function (str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  };
  U.pick = function (arr, rnd) { return arr[Math.floor((rnd || Math.random)() * arr.length)]; };
  U.pickW = function (arr, rnd) {
    var total = 0, i;
    for (i = 0; i < arr.length; i++) total += arr[i].w || 1;
    var r = (rnd || Math.random)() * total;
    for (i = 0; i < arr.length; i++) { r -= (arr[i].w || 1); if (r <= 0) return arr[i]; }
    return arr[arr.length - 1];
  };
  U.shuffle = function (arr, rnd) {
    var a = arr.slice(), r = rnd || Math.random;
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(r() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  };
  U.int = function (a, b, rnd) { return a + Math.floor((rnd || Math.random)() * (b - a + 1)); };
  U.chance = function (p, rnd) { return (rnd || Math.random)() < p; };

  /* ---------------- 数学 ---------------- */
  U.clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
  U.lerp = function (a, b, t) { return a + (b - a) * t; };
  U.dist = function (x1, y1, x2, y2) { var dx = x1 - x2, dy = y1 - y2; return Math.sqrt(dx * dx + dy * dy); };
  U.easeOut = function (t) { return 1 - Math.pow(1 - t, 3); };
  U.easeInOut = function (t) { return t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; };
  U.easeBack = function (t) { var c = 1.70158 + 1; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };

  /* ---------------- DOM ---------------- */
  U.$ = function (s) { return document.querySelector(s); };
  U.$$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  U.el = function (tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        var v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class' || k === 'className') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'style') { for (var s in v) node.style[s] = v[s]; }
        else if (k === 'dataset') { for (var d in v) node.dataset[d] = v[d]; }
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
        else node.setAttribute(k, v === true ? '' : v);
      }
    }
    for (var i = 2; i < arguments.length; i++) U.append(node, arguments[i]);
    return node;
  };
  U.append = function (node, kid) {
    if (kid === null || kid === undefined || kid === false) return node;
    if (Array.isArray(kid)) { for (var i = 0; i < kid.length; i++) U.append(node, kid[i]); return node; }
    node.appendChild(typeof kid === 'object' && kid.nodeType ? kid : document.createTextNode(String(kid)));
    return node;
  };
  U.clear = function (node) { if (node) while (node.firstChild) node.removeChild(node.firstChild); return node; };

  /* ---------------- 存储 ---------------- */
  var KEY = 'glyph_clash_save_v1';
  U.save = function (obj) {
    try { root.localStorage.setItem(KEY, JSON.stringify(obj)); return true; }
    catch (e) { return false; }
  };
  U.load = function () {
    try {
      var s = root.localStorage.getItem(KEY);
      return s ? JSON.parse(s) : null;
    } catch (e) { return null; }
  };
  U.clearSave = function () { try { root.localStorage.removeItem(KEY); } catch (e) { } };
  U.hasSave = function () { try { return !!root.localStorage.getItem(KEY); } catch (e) { return false; } };

  /* ---------------- 音效（WebAudio 合成，无外部资源） ---------------- */
  var AC = null, master = null, sfxOn = true, lastHit = 0;

  function ensureAudio() {
    if (AC) return AC;
    try {
      var Ctx = root.AudioContext || root.webkitAudioContext;
      if (!Ctx) return null;
      AC = new Ctx();
      master = AC.createGain();
      master.gain.value = 0.32;
      master.connect(AC.destination);
    } catch (e) { AC = null; }
    return AC;
  }

  function tone(freq, dur, type, gain, slideTo, delay) {
    var ac = ensureAudio(); if (!ac || !sfxOn) return;
    var t0 = ac.currentTime + (delay || 0);
    var o = ac.createOscillator(), g = ac.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain || 0.2, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  function noise(dur, gain, filterFreq, delay) {
    var ac = ensureAudio(); if (!ac || !sfxOn) return;
    var t0 = ac.currentTime + (delay || 0);
    var len = Math.max(1, Math.floor(ac.sampleRate * dur));
    var buf = ac.createBuffer(1, len, ac.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = ac.createBufferSource(); src.buffer = buf;
    var f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filterFreq || 1600;
    var g = ac.createGain(); g.gain.value = gain || 0.2;
    var env = ac.createGain();
    env.gain.setValueAtTime(g.gain.value, t0);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(env); env.connect(master);
    src.start(t0);
  }

  GB.audio = {
    enable: function (v) {
      sfxOn = v;
      try { if (v) ensureAudio(); } catch (e) { }
    },
    isOn: function () { return sfxOn; },
    unlock: function () { ensureAudio(); if (AC && AC.state === 'suspended') AC.resume(); },
    click: function () { tone(520, 0.05, 'triangle', 0.12, 380); },
    place: function () { tone(190, 0.12, 'sine', 0.28, 110); noise(0.06, 0.12, 900); },
    merge: function () { tone(440, 0.1, 'triangle', 0.16, 880); tone(660, 0.16, 'sine', 0.1, 1320, 0.05); },
    hero: function () { tone(392, 0.16, 'sine', 0.2, 784); tone(587, 0.24, 'triangle', 0.14, 1174, 0.09); tone(784, 0.3, 'sine', 0.1, 1568, 0.18); },
    hit: function () {
      var now = Date.now(); if (now - lastHit < 55) return; lastHit = now;
      noise(0.045, 0.07, 2600);
    },
    kill: function () { tone(150, 0.1, 'sawtooth', 0.09, 60); },
    leak: function () { tone(220, 0.22, 'square', 0.14, 90); noise(0.16, 0.12, 500); },
    coin: function () { tone(1180, 0.06, 'triangle', 0.1); tone(1580, 0.1, 'triangle', 0.08, 1580, 0.05); },
    buy: function () { tone(700, 0.07, 'triangle', 0.12, 900); },
    deny: function () { tone(160, 0.1, 'square', 0.08, 120); },
    wave: function () { tone(160, 0.5, 'sine', 0.18, 320); noise(0.28, 0.08, 700); },
    win: function () { [523, 659, 784, 1047].forEach(function (f, i) { tone(f, 0.34, 'sine', 0.14, f, i * 0.1); }); },
    lose: function () { [392, 330, 262, 196].forEach(function (f, i) { tone(f, 0.4, 'triangle', 0.13, f * .98, i * 0.13); }); },
    gong: function () { tone(98, 1.1, 'sine', 0.22, 62); tone(196, 0.9, 'sine', 0.08, 140, 0.02); }
  };

  /* ---------------- 事件总线 ---------------- */
  var handlers = {};
  GB.bus = {
    on: function (k, fn) { (handlers[k] = handlers[k] || []).push(fn); },
    emit: function (k, data) {
      var hs = handlers[k]; if (!hs) return;
      for (var i = 0; i < hs.length; i++) hs[i](data);
    }
  };
}(typeof window !== 'undefined' ? window : globalThis));
