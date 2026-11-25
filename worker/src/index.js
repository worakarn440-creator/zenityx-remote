// Signaling server บน Cloudflare Workers (ฟรี) — ใช้ Durable Object 1 ตัวต่อ 1 รหัสเครื่อง
// หน้าที่: จับคู่ host/viewer แล้วส่งต่อข้อความ signaling เท่านั้น (ไม่ได้ส่งภาพผ่านที่นี่)

const ROOM_RE = /^\d{9}$/;

export class Room {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }
    const url = new URL(request.url);
    const role = url.searchParams.get('role');
    const token = (url.searchParams.get('token') || '').slice(0, 64);
    if (role !== 'host' && role !== 'viewer') return new Response('bad role', { status: 400 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    if (role === 'host') {
      // host ใหม่แทนที่ host เดิม (เช่น เปิดแอปใหม่)
      for (const old of this.state.getWebSockets('host')) {
        try { old.close(1000, 'replaced'); } catch {}
      }
      this.state.acceptWebSocket(server, ['host']);
      this.send(this.state.getWebSockets('viewer'), { type: 'host-online' });
    } else {
      const olds = this.state.getWebSockets('viewer');
      const mine = olds.filter((w) => this.state.getTags(w).includes('t:' + token));
      if (olds.length && mine.length !== olds.length) {
        // มี viewer คนอื่นต่ออยู่แล้ว
        this.state.acceptWebSocket(server, ['rejected']);
        server.send(JSON.stringify({ type: 'busy' }));
        server.close(1000, 'busy');
        return new Response(null, { status: 101, webSocket: client });
      }
      for (const old of mine) {
        try { old.close(1000, 'replaced'); } catch {}
      }
      this.state.acceptWebSocket(server, ['viewer', 't:' + token]);
      const hasHost = this.state.getWebSockets('host').length > 0;
      server.send(JSON.stringify({ type: hasHost ? 'host-online' : 'host-offline' }));
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  send(sockets, obj) {
    const s = JSON.stringify(obj);
    for (const w of sockets) {
      try { w.send(s); } catch {}
    }
  }

  webSocketMessage(ws, message) {
    if (typeof message !== 'string' || message.length > 65536) return;
    const tags = this.state.getTags(ws);
    if (tags.includes('host')) {
      for (const w of this.state.getWebSockets('viewer')) { try { w.send(message); } catch {} }
    } else if (tags.includes('viewer')) {
      for (const w of this.state.getWebSockets('host')) { try { w.send(message); } catch {} }
    }
  }

  webSocketClose(ws) {
    const tags = this.state.getTags(ws);
    if (tags.includes('host')) {
      this.send(this.state.getWebSockets('viewer'), { type: 'host-left' });
    } else if (tags.includes('viewer')) {
      this.send(this.state.getWebSockets('host'), { type: 'viewer-left' });
    }
    try { ws.close(); } catch {}
  }

  webSocketError(ws) {
    this.webSocketClose(ws);
  }
}

const STUN = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];

async function iceServers(env) {
  // ถ้าตั้ง secret TURN_KEY_ID / TURN_API_TOKEN ไว้ จะแจก TURN relay (Cloudflare Realtime) เพิ่ม
  if (env.TURN_KEY_ID && env.TURN_API_TOKEN) {
    try {
      const r = await fetch(
        `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${env.TURN_API_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ttl: 86400 }),
        }
      );
      if (r.ok) {
        const j = await r.json();
        if (Array.isArray(j.iceServers)) return j.iceServers;
      }
    } catch {}
  }
  return STUN;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/ws') {
      const room = url.searchParams.get('room') || '';
      if (!ROOM_RE.test(room)) return new Response('bad room', { status: 400 });
      return env.ROOM.get(env.ROOM.idFromName(room)).fetch(request);
    }
    if (url.pathname === '/ice') {
      return new Response(JSON.stringify({ iceServers: await iceServers(env) }), {
        headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
      });
    }
    return new Response('ClassRemote signaling OK');
  },
};
