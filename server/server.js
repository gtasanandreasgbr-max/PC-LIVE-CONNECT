require('dotenv').config();
const fs = require('fs');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const WebSocket = require('ws');

const PORT = parseInt(process.env.PORT || '8443', 10);
const USE_SSL = process.env.USE_SSL === 'true';
const TURN_SECRET = process.env.TURN_SECRET || 'SubstituaPorUmaChaveSecretaSuperForte2026!';
const TURN_HOST = process.env.TURN_HOST || '127.0.0.1';
const TURN_PORT = process.env.TURN_PORT || '3478';
const SESSION_TTL_MS = parseInt(process.env.SESSION_TTL_MS || '14400000', 10);
const MAX_ATTEMPTS_PER_MIN = parseInt(process.env.MAX_ATTEMPTS_PER_MIN || '15', 10);

const rooms = new Map();
const rateLimiter = new Map();

const server = USE_SSL
  ? https.createServer({
      cert: fs.readFileSync(process.env.SSL_CERT_PATH),
      key: fs.readFileSync(process.env.SSL_KEY_PATH),
    })
  : http.createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: 'online', activeRooms: rooms.size, uptime: process.uptime() }));
      }
      res.writeHead(404);
      res.end();
    });

const wss = new WebSocket.Server({ server, maxPayload: 64 * 1024 });

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) {
    if (i === 4) code += '-';
    code += chars[bytes[i] % chars.length];
  }
  return rooms.has(code) ? generateRoomCode() : code;
}

function generateTurnCredentials(clientId) {
  const unixTimeStamp = Math.floor(Date.now() / 1000) + 12 * 3600;
  const username = `${unixTimeStamp}:${clientId}`;
  const hmac = crypto.createHmac('sha1', TURN_SECRET);
  hmac.update(username);
  const credential = hmac.digest('base64');

  return [
    { urls: `stun:${TURN_HOST}:${TURN_PORT}` },
    { urls: 'stun:stun.l.google.com:19302' },
    {
      urls: [
        `turn:${TURN_HOST}:${TURN_PORT}?transport=udp`,
        `turn:${TURN_HOST}:${TURN_PORT}?transport=tcp`,
      ],
      username,
      credential,
    },
  ];
}

function checkRateLimit(ip) {
  const now = Date.now();
  const record = rateLimiter.get(ip) || { count: 0, resetAt: now + 60000 };
  if (now > record.resetAt) {
    record.count = 0;
    record.resetAt = now + 60000;
  }
  record.count += 1;
  rateLimiter.set(ip, record);
  return record.count <= MAX_ATTEMPTS_PER_MIN;
}

function sendJson(ws, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

wss.on('connection', (ws, req) => {
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  ws.clientId = crypto.randomUUID();
  ws.isAlive = true;

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (rawData) => {
    let msg;
    try {
      msg = JSON.parse(rawData.toString());
    } catch {
      return sendJson(ws, { type: 'error', message: 'Formato JSON inválido.' });
    }

    if (!msg || typeof msg.type !== 'string') return;

    switch (msg.type) {
      case 'create-room': {
        const code = generateRoomCode();
        const sessionToken = crypto.randomBytes(24).toString('hex');
        rooms.set(code, {
          code,
          sessionToken,
          host: ws,
          receiver: null,
          createdAt: Date.now(),
          expiresAt: Date.now() + SESSION_TTL_MS,
        });
        ws.roomCode = code;
        ws.role = 'host';

        sendJson(ws, {
          type: 'room-created',
          code,
          sessionToken,
          iceServers: generateTurnCredentials(ws.clientId),
        });
        break;
      }

      case 'reclaim-room': {
        const { code, sessionToken } = msg;
        const room = rooms.get(code);
        if (room && room.sessionToken === sessionToken) {
          room.host = ws;
          ws.roomCode = code;
          ws.role = 'host';
          sendJson(ws, {
            type: 'room-reclaimed',
            code,
            hasReceiver: Boolean(room.receiver && room.receiver.readyState === WebSocket.OPEN),
            iceServers: generateTurnCredentials(ws.clientId),
          });
          if (room.receiver) {
            sendJson(room.receiver, { type: 'host-reconnected' });
          }
        } else {
          sendJson(ws, { type: 'error', message: 'Sessão expirada ou inválida para reconexão.' });
        }
        break;
      }

      case 'join-room': {
        if (!checkRateLimit(clientIp)) {
          return sendJson(ws, {
            type: 'error',
            message: 'Muitas tentativas de conexão. Aguarde 1 minuto.',
          });
        }

        const code = String(msg.code || '').trim().toUpperCase();
        const room = rooms.get(code);

        if (!room) {
          return sendJson(ws, { type: 'error', message: 'Código de transmissão não encontrado.' });
        }
        if (Date.now() > room.expiresAt) {
          rooms.delete(code);
          return sendJson(ws, { type: 'error', message: 'Este código de transmissão expirou.' });
        }
        if (room.receiver && room.receiver.readyState === WebSocket.OPEN && room.receiver !== ws) {
          return sendJson(ws, { type: 'error', message: 'Esta sala já possui um PC receptor conectado.' });
        }

        room.receiver = ws;
        ws.roomCode = code;
        ws.role = 'receiver';

        sendJson(ws, {
          type: 'room-joined',
          code,
          iceServers: generateTurnCredentials(ws.clientId),
        });

        if (room.host && room.host.readyState === WebSocket.OPEN) {
          sendJson(room.host, { type: 'receiver-joined', receiverId: ws.clientId });
        }
        break;
      }

      case 'signal': {
        const room = rooms.get(ws.roomCode);
        if (!room) return;

        const target = ws.role === 'host' ? room.receiver : room.host;
        if (target && target.readyState === WebSocket.OPEN) {
          sendJson(target, {
            type: 'signal',
            from: ws.role,
            data: msg.data,
          });
        }
        break;
      }

      case 'leave-room': {
        handleDisconnect(ws);
        break;
      }

      default:
        break;
    }
  });

  ws.on('close', () => handleDisconnect(ws));
});

function handleDisconnect(ws) {
  if (!ws.roomCode) return;
  const room = rooms.get(ws.roomCode);
  if (!room) return;

  if (ws.role === 'host' && room.host === ws) {
    if (room.receiver && room.receiver.readyState === WebSocket.OPEN) {
      sendJson(room.receiver, { type: 'peer-disconnected', role: 'host' });
    }
    setTimeout(() => {
      const currentRoom = rooms.get(ws.roomCode);
      if (currentRoom && (!currentRoom.host || currentRoom.host.readyState !== WebSocket.OPEN)) {
        rooms.delete(ws.roomCode);
      }
    }, 60000);
  } else if (ws.role === 'receiver' && room.receiver === ws) {
    room.receiver = null;
    if (room.host && room.host.readyState === WebSocket.OPEN) {
      sendJson(room.host, { type: 'peer-disconnected', role: 'receiver' });
    }
  }
}

setInterval(() => {
  const now = Date.now();
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });

  for (const [code, room] of rooms.entries()) {
    if (now > room.expiresAt) {
      sendJson(room.host, { type: 'error', message: 'Sessão encerrada por tempo limite.' });
      sendJson(room.receiver, { type: 'error', message: 'Sessão encerrada por tempo limite.' });
      rooms.delete(code);
    }
  }
}, 30000);

server.listen(PORT, () => {
  console.log(`[PC LIVE CONNECT SERVER] Rodando na porta ${PORT} (SSL: ${USE_SSL})`);
});
