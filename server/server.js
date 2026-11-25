// signaling server แบบ Node สำหรับทดสอบในเครื่อง/ใช้ใน LAN โรงเรียน
// โปรโตคอลเดียวกับ worker/src/index.js  —  รัน: node server/server.js  (พอร์ต 8787)
const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 8787;
const ROOM_RE = /^\d{9}$/;
const rooms = new Map(); // room -> { host, viewer, viewerToken }

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/ice')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ iceServers: [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }] }));
    return;
  }
  res.end('ClassRemote signaling (node) OK');
});
const wss = new WebSocketServer({ noServer: true });

const send = (ws, obj) => { try { ws && ws.readyState === 1 && ws.send(JSON.stringify(obj)); } catch {} };

server.on('upgrade', (req, socket, head) => {
  const u = new URL(req.url, 'http://x');
  const room = u.searchParams.get('room') || '';
  const role = u.searchParams.get('role');
  const token = (u.searchParams.get('token') || '').slice(0, 64);
  if (u.pathname !== '/ws' || !ROOM_RE.test(room) || (role !== 'host' && role !== 'viewer')) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => onConnect(ws, room, role, token));
});

function onConnect(ws, roomId, role, token) {
  let r = rooms.get(roomId);
  if (!r) rooms.set(roomId, (r = { host: null, viewer: null, viewerToken: null }));

  if (role === 'host') {
    if (r.host) try { r.host.close(1000, 'replaced'); } catch {}
    r.host = ws;
    send(r.viewer, { type: 'host-online' });
  } else {
    if (r.viewer && r.viewerToken !== token) {
      send(ws, { type: 'busy' });
      ws.close(1000, 'busy');
      return;
    }
    if (r.viewer) try { r.viewer.close(1000, 'replaced'); } catch {}
    r.viewer = ws;
    r.viewerToken = token;
    send(ws, { type: r.host ? 'host-online' : 'host-offline' });
  }

  ws.on('message', (data) => {
    const s = data.toString();
    if (s.length > 65536) return;
    const peer = role === 'host' ? r.viewer : r.host;
    try { peer && peer.readyState === 1 && peer.send(s); } catch {}
  });

  ws.on('close', () => {
    if (role === 'host' && r.host === ws) {
      r.host = null;
      send(r.viewer, { type: 'host-left' });
    } else if (role === 'viewer' && r.viewer === ws) {
      r.viewer = null;
      r.viewerToken = null;
      send(r.host, { type: 'viewer-left' });
    }
    if (!r.host && !r.viewer) rooms.delete(roomId);
  });
  ws.on('error', () => {});
}

server.listen(PORT, () => console.log(`ClassRemote signaling listening on :${PORT}`));
