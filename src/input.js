// ฉีดเมาส์/คีย์บอร์ดลงเครื่องนี้ (ฝั่งที่ถูกควบคุม) ด้วย nut-js
const keymap = require('./keymap');

let nut = null;
let loadError = null;
try {
  nut = require('@nut-tree-fork/nut-js');
  nut.mouse.config.autoDelayMs = 0;
  nut.mouse.config.mouseSpeed = 100000;
  nut.keyboard.config.autoDelayMs = 0;
} catch (e) {
  loadError = e;
}

let enabled = false;
let size = { w: 0, h: 0, at: 0 };
const pressedKeys = new Set();
const pressedBtns = new Set();
const queue = [];
let pendingMove = null;
let pumping = false;

async function screenSize() {
  if (Date.now() - size.at > 3000) {
    size = { w: await nut.screen.width(), h: await nut.screen.height(), at: Date.now() };
  }
  return size;
}

async function moveTo(x, y) {
  if (typeof x !== 'number' || typeof y !== 'number') return;
  const { w, h } = await screenSize();
  const px = Math.min(w - 1, Math.max(0, Math.round(x * w)));
  const py = Math.min(h - 1, Math.max(0, Math.round(y * h)));
  await nut.mouse.setPosition(new nut.Point(px, py));
}

// แปลงปุ่มข้ามแพลตฟอร์ม: Windows<->Mac ใช้ Ctrl กับ Command คนละปุ่มกัน
//  - ผู้ดู Windows -> เครื่อง Mac : Ctrl กลายเป็น Command (Ctrl+C = Cmd+C)
//  - ผู้ดู Mac -> เครื่อง Windows : Command กลายเป็น Ctrl (Cmd+C = Ctrl+C)
let viewerPlatform = process.platform;
function setViewerPlatform(p) { viewerPlatform = p || process.platform; }
function mapCode(code) {
  const host = process.platform;
  if (host === 'darwin' && viewerPlatform !== 'darwin' && (code === 'ControlLeft' || code === 'ControlRight')) return 'MetaLeft';
  if (host !== 'darwin' && viewerPlatform === 'darwin' && (code === 'MetaLeft' || code === 'MetaRight')) return 'ControlLeft';
  return code;
}

const BTN = () => [nut.Button.LEFT, nut.Button.MIDDLE, nut.Button.RIGHT];

async function process(e) {
  switch (e.t) {
    case 'mm':
      return moveTo(e.x, e.y);
    case 'md': {
      const b = BTN()[e.b];
      if (b === undefined) return;
      await moveTo(e.x, e.y);
      pressedBtns.add(e.b);
      return nut.mouse.pressButton(b);
    }
    case 'mu': {
      const b = BTN()[e.b];
      if (b === undefined) return;
      await moveTo(e.x, e.y);
      pressedBtns.delete(e.b);
      return nut.mouse.releaseButton(b);
    }
    case 'wh': {
      await moveTo(e.x, e.y);
      const dy = Number(e.dy) || 0;
      const dx = Number(e.dx) || 0;
      if (dy) {
        const n = Math.min(20, Math.max(1, Math.round(Math.abs(dy) / 40)));
        await (dy > 0 ? nut.mouse.scrollDown(n) : nut.mouse.scrollUp(n));
      }
      if (dx) {
        const n = Math.min(20, Math.max(1, Math.round(Math.abs(dx) / 40)));
        await (dx > 0 ? nut.mouse.scrollRight(n) : nut.mouse.scrollLeft(n));
      }
      return;
    }
    case 'kd':
    case 'ku': {
      const name = keymap[mapCode(e.c)];
      const k = name && nut.Key[name];
      if (k === undefined) return;
      if (e.t === 'kd') { pressedKeys.add(k); return nut.keyboard.pressKey(k); }
      pressedKeys.delete(k);
      return nut.keyboard.releaseKey(k);
    }
    case 'ra':
      return releaseAll();
  }
}

async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    while (queue.length || pendingMove) {
      const e = queue.length ? queue.shift() : pendingMove;
      if (e === pendingMove) pendingMove = null;
      try { await process(e); } catch (err) { /* ข้ามเหตุการณ์ที่ผิดพลาด */ }
    }
  } finally {
    pumping = false;
  }
}

function handle(e) {
  if (!nut || !enabled || !e || typeof e !== 'object') return;
  if (e.t === 'mm') pendingMove = e; // รวมการขยับเมาส์ ใช้ตำแหน่งล่าสุดเท่านั้น
  else queue.push(e);
  pump();
}

async function releaseAll() {
  if (!nut) return;
  for (const k of [...pressedKeys]) { try { await nut.keyboard.releaseKey(k); } catch {} }
  for (const b of [...pressedBtns]) { try { await nut.mouse.releaseButton(BTN()[b]); } catch {} }
  pressedKeys.clear();
  pressedBtns.clear();
}

function setEnabled(v) {
  enabled = !!v;
  if (!enabled) releaseAll();
}

module.exports = { handle, setEnabled, releaseAll, setViewerPlatform, get error() { return loadError; } };
