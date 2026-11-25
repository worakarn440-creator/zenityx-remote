'use strict';
const $ = (id) => document.getElementById(id);
const fmtId = (s) => s.replace(/(\d{3})(?=\d)/g, '$1 ');
const rand = () => Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
let info = null;

/* ---------- ตัวช่วย UI ---------- */
function setStatus(kind, text) {
  const el = $('status');
  el.className = 'chip chip-' + kind;
  el.textContent = text;
}
let toastTimer;
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 4500);
}
function setConnMsg(text, err) {
  const m = $('connMsg');
  m.textContent = text || '';
  m.className = 'msg' + (err ? ' err' : '');
}

/* ---------- WebSocket signaling พร้อมต่อใหม่อัตโนมัติ ---------- */
class Signal {
  constructor(url, onMsg, onState) {
    Object.assign(this, { url, onMsg, onState, stopped: false, retry: 0, ws: null, ping: null });
    this.connect();
  }
  connect() {
    if (this.stopped) return;
    const ws = (this.ws = new WebSocket(this.url));
    ws.onopen = () => {
      this.retry = 0;
      this.onState('open');
      clearInterval(this.ping);
      this.ping = setInterval(() => this.send({ type: 'ping' }), 20000);
    };
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.type !== 'ping') this.onMsg(m);
    };
    ws.onclose = (e) => {
      clearInterval(this.ping);
      if (this.ws !== ws) return;
      if (e.reason === 'replaced') { this.stopped = true; this.onState('replaced'); return; }
      this.onState('closed');
      if (!this.stopped) setTimeout(() => this.connect(), Math.min(1000 * 2 ** this.retry++, 8000));
    };
    ws.onerror = () => {};
  }
  send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
  close() {
    this.stopped = true;
    clearInterval(this.ping);
    try { this.ws.close(); } catch {}
  }
}

// ประมวลผลข้อความ signaling ทีละอัน ตามลำดับ (กันแข่งกันระหว่าง offer/answer/ice)
function serial(handler) {
  let q = Promise.resolve();
  return (m) => { q = q.then(() => handler(m)).catch((e) => console.error(e)); };
}

/* =====================================================================
 *  ฝั่ง HOST (เครื่องที่ถูกดู/ควบคุม)
 * ===================================================================== */
const H = { sig: null, pc: null, sid: null, stream: null, token: null, control: false, pending: null, failTimer: null, starting: false };

function hostStart() {
  H.sig = new Signal(
    `${info.signalUrl}/ws?room=${info.id}&role=host`,
    serial(hostOnMsg),
    (s) => {
      if (s === 'open') setStatus('ok', 'ออนไลน์ พร้อมให้ช่วย');
      else if (s === 'replaced') setStatus('bad', 'รหัสนี้ถูกใช้ที่อื่นอยู่');
      else setStatus('wait', 'กำลังเชื่อมต่อเซิร์ฟเวอร์…');
    }
  );
}

async function hostOnMsg(m) {
  switch (m.type) {
    case 'hello': return onHello(m);
    case 'answer':
      if (H.pc && m.sid === H.sid) await H.pc.setRemoteDescription(m.sdp);
      return;
    case 'ice':
      if (H.pc && m.sid === H.sid && m.candidate) { try { await H.pc.addIceCandidate(m.candidate); } catch {} }
      return;
    case 'bye':
      if (H.token) endHostSession('ผู้ดูตัดการเชื่อมต่อแล้ว', false);
      return;
  }
}

function onHello(m) {
  if (!m.token) return;
  if (H.token && m.token === H.token) { startSession(); return; } // ผู้ดูคนเดิมต่อใหม่ ไม่ต้องถามซ้ำ
  if (H.token || (H.pending && H.pending !== m.token)) { H.sig.send({ type: 'busy' }); return; }
  if (H.pending === m.token) return;
  H.pending = m.token;
  H.pendingPlatform = m.platform;
  window.api.attention();
  $('modalText').textContent = `เครื่อง “${m.name || 'ไม่ทราบชื่อ'}” ขอดูหน้าจอของคุณ ถ้าไม่รู้จัก ให้กด “ไม่อนุญาต”`;
  $('modal').hidden = false;
}

function answerModal(choice) {
  $('modal').hidden = true;
  const token = H.pending;
  H.pending = null;
  if (!token) return;
  if (choice === 'deny') { H.sig.send({ type: 'deny' }); return; }
  H.token = token;
  H.control = choice === 'control';
  window.api.setViewerPlatform(H.pendingPlatform);
  window.api.inputEnable(H.control);
  if (H.control) checkMacPerms();
  startSession();
}

function cleanupHostPc() {
  clearTimeout(H.failTimer);
  if (H.pc) {
    H.pc.onconnectionstatechange = H.pc.onicecandidate = null;
    try { H.pc.close(); } catch {}
  }
  H.pc = null;
}

async function startSession() {
  if (H.starting) return;
  H.starting = true;
  try {
    cleanupHostPc();
    const ice = await window.api.ice();
    if (!H.stream || !H.stream.getVideoTracks().some((t) => t.readyState === 'live')) {
      try {
        H.stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30, max: 30 } }, audio: false });
      } catch {
        H.sig.send({ type: 'deny', reason: 'capture' });
        endHostSession('แชร์หน้าจอไม่สำเร็จ', false);
        return;
      }
      H.stream.getVideoTracks()[0].onended = () => endHostSession('การแชร์หน้าจอหยุดลง', true);
    }
    const track = H.stream.getVideoTracks()[0];
    try { track.contentHint = 'detail'; } catch {}

    const pc = (H.pc = new RTCPeerConnection({ iceServers: ice, bundlePolicy: 'max-bundle' }));
    const sid = (H.sid = rand());
    const sender = pc.addTrack(track, H.stream);

    const onData = (e) => {
      if (!H.control) return;
      try { window.api.input(JSON.parse(e.data)); } catch {}
    };
    pc.createDataChannel('ctl').onmessage = onData;
    pc.createDataChannel('mv', { ordered: false, maxRetransmits: 0 }).onmessage = onData;

    pc.onicecandidate = (e) => { if (e.candidate) H.sig.send({ type: 'ice', sid, candidate: e.candidate }); };
    pc.onconnectionstatechange = () => {
      if (H.pc !== pc) return;
      const s = pc.connectionState;
      if (s === 'connected') {
        clearTimeout(H.failTimer);
        showHostBanner(true);
      } else if (s === 'disconnected' || s === 'failed') {
        window.api.inputRelease(); // กันปุ่มค้าง
        showHostBanner(false);
        clearTimeout(H.failTimer);
        H.failTimer = setTimeout(() => endHostSession('การเชื่อมต่อหลุดนานเกินไป', true), 25000);
      }
    };

    await pc.setLocalDescription(await pc.createOffer());
    H.sig.send({ type: 'offer', sid, sdp: pc.localDescription });

    try { // เพดานบิตเรตสูงเพื่อให้ตัวหนังสือคมชัด
      const p = sender.getParameters();
      if (!p.encodings || !p.encodings.length) p.encodings = [{}];
      p.encodings[0].maxBitrate = 6_000_000;
      await sender.setParameters(p);
    } catch {}
  } finally {
    H.starting = false;
  }
}

function showHostBanner(connected) {
  $('hostBanner').hidden = false;
  $('hostBannerText').textContent = connected
    ? (H.control ? 'กำลังแชร์หน้าจอ — ผู้ดูควบคุมเมาส์/คีย์บอร์ดได้' : 'กำลังแชร์หน้าจอ — ผู้ดูดูได้อย่างเดียว')
    : 'สัญญาณไม่เสถียร กำลังต่อใหม่…';
}

function endHostSession(reason, notifyPeer) {
  clearTimeout(H.failTimer);
  if (notifyPeer !== false && H.sig) H.sig.send({ type: 'bye' });
  cleanupHostPc();
  if (H.stream) { H.stream.getTracks().forEach((t) => t.stop()); H.stream = null; }
  H.token = null; H.pending = null; H.control = false;
  window.api.inputRelease();
  window.api.inputEnable(false);
  $('hostBanner').hidden = true;
  $('modal').hidden = true;
  if (reason) toast(reason);
}

/* =====================================================================
 *  ฝั่ง VIEWER (เครื่องที่ไปดู/ควบคุมเครื่องอื่น)
 * ===================================================================== */
const V = { sig: null, pc: null, sid: null, token: null, ctl: null, mv: null, active: false, failTimer: null };

function viewerConnect(rawId) {
  const id = rawId.replace(/\D/g, '');
  if (!/^\d{9}$/.test(id)) return setConnMsg('รหัสต้องเป็นตัวเลข 9 หลัก', true);
  if (id === info.id) return setConnMsg('นี่คือรหัสของเครื่องนี้ ให้ใส่รหัสของเครื่องอื่น', true);
  viewerDisconnect(null, false);
  V.token = rand();
  $('connectBtn').hidden = true;
  $('cancelBtn').hidden = false;
  setConnMsg('กำลังเชื่อมต่อ…');
  V.sig = new Signal(
    `${info.signalUrl}/ws?room=${id}&role=viewer&token=${V.token}`,
    serial(viewerOnMsg),
    (s) => {
      if (s === 'closed' && !V.active) setConnMsg('กำลังเชื่อมต่อเซิร์ฟเวอร์…');
      if (s === 'closed' && V.active) $('stageStatus').textContent = 'เซิร์ฟเวอร์หลุด กำลังต่อใหม่…';
    }
  );
}

function sendHello() {
  if (V.sig) V.sig.send({ type: 'hello', token: V.token, name: info.hostname, platform: info.platform });
}

async function viewerOnMsg(m) {
  switch (m.type) {
    case 'host-online':
      if (!(V.pc && V.pc.connectionState === 'connected')) {
        sendHello();
        if (!V.active) setConnMsg('รอปลายทางกด “อนุญาต”…');
      }
      return;
    case 'host-offline':
      if (!V.active) setConnMsg('ยังไม่พบเครื่องนี้ ตรวจรหัส หรือให้ปลายทางเปิดแอปไว้ (กำลังรอ…)', true);
      return;
    case 'host-left':
      if (V.active) $('stageStatus').textContent = 'ปลายทางออฟไลน์ กำลังรอ…';
      return;
    case 'busy': return viewerDisconnect('เครื่องนี้มีผู้ดูคนอื่นเชื่อมต่ออยู่', false, true);
    case 'deny': return viewerDisconnect('ปลายทางไม่อนุญาต หรือแชร์หน้าจอไม่สำเร็จ', false, true);
    case 'bye': return viewerDisconnect('ปลายทางหยุดแชร์แล้ว', false);
    case 'offer': return handleOffer(m);
    case 'ice':
      if (V.pc && m.sid === V.sid && m.candidate) { try { await V.pc.addIceCandidate(m.candidate); } catch {} }
      return;
  }
}

function closeViewerPc() {
  clearTimeout(V.failTimer);
  if (V.pc) {
    V.pc.onconnectionstatechange = V.pc.onicecandidate = V.pc.ontrack = V.pc.ondatachannel = null;
    try { V.pc.close(); } catch {}
  }
  V.pc = null; V.ctl = null; V.mv = null;
}

async function handleOffer(m) {
  closeViewerPc();
  V.sid = m.sid;
  const ice = await window.api.ice();
  const pc = (V.pc = new RTCPeerConnection({ iceServers: ice, bundlePolicy: 'max-bundle' }));
  pc.onicecandidate = (e) => { if (e.candidate && V.sig) V.sig.send({ type: 'ice', sid: m.sid, candidate: e.candidate }); };
  pc.ondatachannel = (e) => { if (e.channel.label === 'ctl') V.ctl = e.channel; else V.mv = e.channel; };
  pc.ontrack = (e) => {
    try { e.receiver.jitterBufferTarget = 0; } catch {}
    $('remote').srcObject = e.streams[0];
    $('remote').play().catch(() => {});
    showStage();
  };
  pc.onconnectionstatechange = () => {
    if (V.pc !== pc) return;
    const s = pc.connectionState;
    if (s === 'connected') {
      clearTimeout(V.failTimer);
      $('stageStatus').textContent = 'เชื่อมต่อแล้ว — คลิกในภาพเพื่อควบคุม';
    } else if (s === 'disconnected' || s === 'failed') {
      $('stageStatus').textContent = 'สัญญาณไม่เสถียร กำลังต่อใหม่…';
      clearTimeout(V.failTimer);
      V.failTimer = setTimeout(() => {
        if (V.pc !== pc || pc.connectionState === 'connected') return;
        closeViewerPc(); // สร้างการเชื่อมต่อใหม่ทั้งชุด (ปลายทางไม่ต้องกดอนุญาตซ้ำ)
        sendHello();
      }, s === 'failed' ? 500 : 5000);
    }
  };
  await pc.setRemoteDescription(m.sdp);
  await pc.setLocalDescription(await pc.createAnswer());
  V.sig.send({ type: 'answer', sid: m.sid, sdp: pc.localDescription });
}

function showStage() {
  if (V.active) return;
  V.active = true;
  window.api.stage(true);
  $('view-home').hidden = true;
  $('view-stage').hidden = false;
}

function viewerDisconnect(msg, notifyPeer, isError) {
  if (V.sig) {
    if (notifyPeer !== false) V.sig.send({ type: 'bye' });
    V.sig.close();
  }
  closeViewerPc();
  V.sig = null; V.active = false;
  window.api.stage(false);
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  $('remote').srcObject = null;
  $('view-stage').hidden = true;
  $('view-home').hidden = false;
  $('connectBtn').hidden = false;
  $('cancelBtn').hidden = true;
  setConnMsg(msg || '', isError);
}

/* ---------- จับเมาส์/คีย์บอร์ดฝั่ง viewer แล้วส่งไปปลายทาง ---------- */
const video = () => $('remote');

function contentPos(e) {
  const v = video();
  const vw = v.videoWidth, vh = v.videoHeight;
  if (!vw || !vh) return null;
  const r = v.getBoundingClientRect();
  const scale = Math.min(r.width / vw, r.height / vh);
  const cw = vw * scale, ch = vh * scale;
  const x = (e.clientX - (r.left + (r.width - cw) / 2)) / cw;
  const y = (e.clientY - (r.top + (r.height - ch) / 2)) / ch;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x, y };
}

const sendCtl = (o) => { if (V.ctl && V.ctl.readyState === 'open') V.ctl.send(JSON.stringify(o)); };
let pendingMove = null, moveRaf = 0;

function bindViewerInput() {
  const v = video();
  v.addEventListener('mousemove', (e) => {
    if (!V.active) return;
    const p = contentPos(e);
    if (!p) return;
    pendingMove = { t: 'mm', x: p.x, y: p.y };
    if (!moveRaf) moveRaf = requestAnimationFrame(() => {
      moveRaf = 0;
      if (pendingMove && V.mv && V.mv.readyState === 'open') V.mv.send(JSON.stringify(pendingMove));
      pendingMove = null;
    });
  });
  v.addEventListener('mousedown', (e) => {
    if (!V.active) return;
    e.preventDefault();
    const p = contentPos(e);
    if (p) sendCtl({ t: 'md', b: e.button, x: p.x, y: p.y });
  });
  window.addEventListener('mouseup', (e) => {
    if (!V.active) return;
    const p = contentPos(e);
    sendCtl({ t: 'mu', b: e.button, ...(p || {}) });
  });
  v.addEventListener('wheel', (e) => {
    if (!V.active) return;
    e.preventDefault();
    const p = contentPos(e);
    sendCtl({ t: 'wh', dx: e.deltaX, dy: e.deltaY, ...(p || {}) });
  }, { passive: false });
  v.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('keydown', (e) => {
    if (!V.active) return;
    e.preventDefault();
    sendCtl({ t: 'kd', c: e.code });
  }, true);
  window.addEventListener('keyup', (e) => {
    if (!V.active) return;
    e.preventDefault();
    sendCtl({ t: 'ku', c: e.code });
  }, true);
  window.addEventListener('blur', () => { if (V.active) sendCtl({ t: 'ra' }); });
}

/* ---------- macOS: เช็กสิทธิ์ที่ต้องเปิดเอง ---------- */
async function checkMacPerms() {
  if (info.platform !== 'darwin') return;
  const p = await window.api.perms();
  const missing = [];
  if (p.screen !== 'granted') missing.push('Screen Recording (การบันทึกหน้าจอ)');
  if (!p.accessibility) missing.push('Accessibility (การช่วยการเข้าถึง)');
  const el = $('permHint');
  if (!missing.length) { el.hidden = true; return; }
  el.hidden = false;
  el.textContent = 'Mac ต้องเปิดสิทธิ์: ' + missing.join(' และ ') +
    ' ที่ การตั้งค่าระบบ → ความเป็นส่วนตัวและความปลอดภัย แล้วเลือก ZenityX Remote จากนั้นปิดแอปแล้วเปิดใหม่';
}

/* ---------- เริ่มต้น ---------- */
async function init() {
  info = await window.api.info();
  $('myId').textContent = fmtId(info.id);
  if (info.inputError) toast('ระบบควบคุมเมาส์/คีย์บอร์ดโหลดไม่ได้ (ยังดูจอได้): ' + info.inputError);

  $('copyBtn').onclick = async () => {
    try { await navigator.clipboard.writeText(info.id); toast('คัดลอกรหัสแล้ว'); } catch { toast('คัดลอกไม่สำเร็จ'); }
  };
  $('peerId').addEventListener('input', (e) => {
    e.target.value = fmtId(e.target.value.replace(/\D/g, '').slice(0, 9));
  });
  $('peerId').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('connectBtn').click(); });
  $('connectBtn').onclick = () => viewerConnect($('peerId').value);
  $('cancelBtn').onclick = () => viewerDisconnect('', true);
  $('disconnectBtn').onclick = () => viewerDisconnect('ตัดการเชื่อมต่อแล้ว', true);
  $('fsBtn').onclick = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  };
  $('stopShareBtn').onclick = () => endHostSession('หยุดแชร์หน้าจอแล้ว', true);
  $('allowCtl').onclick = () => answerModal('control');
  $('allowView').onclick = () => answerModal('view');
  $('denyBtn').onclick = () => answerModal('deny');

  bindViewerInput();
  hostStart();
  checkMacPerms();
}
init();
