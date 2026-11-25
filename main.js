const { app, BrowserWindow, ipcMain, desktopCapturer, session, screen, Menu, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const input = require('./src/input');

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;

const FALLBACK_ICE = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function loadConfig() {
  const def = readJson(path.join(__dirname, 'config.default.json')) || {};
  const user = readJson(path.join(app.getPath('userData'), 'config.json')) || {};
  const signalUrl = process.env.CLASSREMOTE_SIGNAL || user.signalUrl || def.signalUrl || 'ws://localhost:8787';
  return { signalUrl: signalUrl.replace(/\/+$/, '') };
}

// รหัสเครื่อง 9 หลัก สร้างครั้งแรกแล้วจำไว้
function loadDeviceId() {
  const file = path.join(app.getPath('userData'), 'device.json');
  const saved = readJson(file);
  if (saved && /^\d{9}$/.test(saved.id)) return saved.id;
  const id = String(crypto.randomInt(100000000, 1000000000));
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ id }));
  } catch {}
  return id;
}

function createWindow() {
  win = new BrowserWindow({
    width: 560,
    height: 720,
    minWidth: 460,
    minHeight: 560,
    backgroundColor: '#0f172a',
    title: 'ZenityX Remote',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

// macOS: ต้องมีเมนู Edit ให้ Cmd+C/V ในช่องรหัสใช้ได้ แต่ตอนกำลังดูเครื่องอื่น (stage) ต้องตัดเมนูออก
// ไม่งั้น Cmd+C/V/Q จะถูกเมนูดักไว้ ไม่ถูกส่งไปเครื่องปลายทาง
function setMenu(stage) {
  if (process.platform !== 'darwin') { Menu.setApplicationMenu(null); return; }
  const tpl = stage
    ? [{ label: app.name, submenu: [{ role: 'about' }] }]
    : [{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

app.whenReady().then(() => {
  setMenu(false);

  // เลือกจอหลักให้อัตโนมัติเวลา renderer ขอแชร์จอ (ไม่ต้องให้นักเรียนเลือกเอง)
  session.defaultSession.setDisplayMediaRequestHandler(async (_req, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
      const primaryId = String(screen.getPrimaryDisplay().id);
      const src = sources.find((s) => s.display_id === primaryId) || sources[0];
      callback(src ? { video: src } : {});
    } catch {
      callback({});
    }
  });

  ipcMain.handle('app:info', () => ({
    id: loadDeviceId(),
    hostname: os.hostname(),
    version: app.getVersion(),
    platform: process.platform,
    inputError: input.error ? String(input.error.message || input.error) : null,
    ...loadConfig(),
  }));

  ipcMain.handle('app:ice', async () => {
    const http = loadConfig().signalUrl.replace(/^ws/, 'http');
    try {
      const r = await fetch(`${http}/ice`, { signal: AbortSignal.timeout(4000) });
      if (r.ok) {
        const j = await r.json();
        if (Array.isArray(j.iceServers) && j.iceServers.length) return j.iceServers;
      }
    } catch {}
    return FALLBACK_ICE;
  });

  ipcMain.on('app:attention', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    win.flashFrame(true);
  });

  ipcMain.on('input:event', (_e, evt) => input.handle(evt));
  ipcMain.on('input:enable', (_e, on) => {
    input.setEnabled(on);
    // macOS: ขอสิทธิ์ Accessibility (ต้องมีถึงจะขยับเมาส์/พิมพ์แทนได้) จะมีหน้าต่างระบบเด้งถาม
    if (on && process.platform === 'darwin') systemPreferences.isTrustedAccessibilityClient(true);
  });
  ipcMain.on('input:viewer-platform', (_e, p) => input.setViewerPlatform(String(p || '')));
  ipcMain.on('ui:stage', (_e, on) => setMenu(!!on));

  // macOS: เช็กสิทธิ์ Screen Recording / Accessibility (Windows ไม่ต้องใช้ ถือว่าผ่าน)
  ipcMain.handle('app:perms', async () => {
    if (process.platform !== 'darwin') return { screen: 'granted', accessibility: true };
    // เรียก getSources ครั้งหนึ่งเพื่อให้ macOS เด้งหน้าต่างขอสิทธิ์ Screen Recording
    try { await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } }); } catch {}
    return {
      screen: systemPreferences.getMediaAccessStatus('screen'),
      accessibility: systemPreferences.isTrustedAccessibilityClient(false),
    };
  });
  ipcMain.on('input:release', () => input.releaseAll());

  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});

app.on('window-all-closed', () => {
  input.releaseAll();
  app.quit();
});
