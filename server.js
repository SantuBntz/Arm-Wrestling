// Servidor de la pulseada: sirve /public y maneja las salas por WebSocket.
// El servidor es la autoridad: decide aciertos, puntajes y velocidades.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');

// Todo lo que afina la jugabilidad está acá.
const CONFIG = {
  duration: Number(process.env.DURATION) || 20000,  // ms que dura la partida (se puede pisar con DURATION=60000)
  countdown: 3000,      // ms de cuenta regresiva antes de empezar
  baseSpeed: 1.6,       // rad/s al empezar (lento)
  speedUp: 1.12,        // multiplicador por cada acierto
  maxSpeed: 9,          // tope de velocidad (rad/s)
  missSlow: 0.85,       // multiplicador al fallar (frena un poco)
  lockout: 450,         // ms sin poder clickear después de un fallo
  zoneHalfWidth: 0.32,  // mitad del ancho de la zona de acierto (rad)
  maxClockSkew: 400     // ms hacia atrás que se le acepta al timestamp del cliente (cubre la latencia de internet)
};

const TAU = Math.PI * 2;

// ---------- Archivos estáticos ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json'
};

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(req.url.split('?')[0]);
  } catch {
    res.writeHead(400);
    return res.end();
  }
  if (urlPath === '/config.json') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ publicUrl: global.PUBLIC_URL || null }));
  }
  const rel = urlPath === '/' ? 'index.html' : urlPath;
  const file = path.normalize(path.join(PUBLIC, rel));
  if (file !== PUBLIC && !file.startsWith(PUBLIC + path.sep)) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('No encontrado');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

// ---------- Utilidades de juego ----------
const rooms = new Map();

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function send(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function broadcast(room, msg) {
  room.players.forEach(p => send(p.ws, msg));
}

// Ángulo de la flecha en el instante t (radianes, 0 = arriba, sentido horario).
function arrowAngle(a, t) {
  const tt = Math.max(t, a.t0);
  return (((a.angle0 + (a.speed * (tt - a.t0)) / 1000) % TAU) + TAU) % TAU;
}

// Distancia angular absoluta entre dos ángulos, en [0, PI].
function angDist(a, b) {
  const d = (((a - b) % TAU) + TAU) % TAU;
  return d > Math.PI ? TAU - d : d;
}

// Zona nueva, lejos de donde está la flecha para que no sea regalada.
function randomZone(fromAngle) {
  return (fromAngle + 1.2 + Math.random() * (TAU - 2.4)) % TAU;
}

function newPlayer(ws) {
  return { ws, name: '', ready: false, score: 0, arrow: { angle0: 0, speed: CONFIG.baseSpeed, t0: 0 }, zone: 0, lockedUntil: 0, wantsRematch: false };
}

function publicState(room) {
  return {
    scores: room.players.map(p => p.score),
    arrows: room.players.map(p => p.arrow),
    zones: room.players.map(p => p.zone)
  };
}

function startMatch(room) {
  const now = Date.now();
  room.status = 'playing';
  room.startAt = now + CONFIG.countdown;
  room.endAt = room.startAt + CONFIG.duration;
  room.players.forEach(p => {
    p.score = 0;
    p.lockedUntil = 0;
    p.wantsRematch = false;
    p.arrow = { angle0: 0, speed: CONFIG.baseSpeed, t0: room.startAt };
    p.zone = randomZone(0);
  });
  room.players.forEach((p, i) => {
    send(p.ws, {
      type: 'start',
      you: i,
      names: room.players.map((q, j) => q.name || `Jugador ${j + 1}`),
      startAt: room.startAt,
      endAt: room.endAt,
      halfWidth: CONFIG.zoneHalfWidth,
      lockout: CONFIG.lockout,
      baseSpeed: CONFIG.baseSpeed,
      maxSpeed: CONFIG.maxSpeed,
      state: publicState(room)
    });
  });
  clearTimeout(room.timer);
  room.timer = setTimeout(() => endMatch(room), CONFIG.countdown + CONFIG.duration);
}

function endMatch(room) {
  room.status = 'finished';
  const [a, b] = room.players.map(p => p.score);
  const winner = a === b ? -1 : a > b ? 0 : 1;
  broadcast(room, { type: 'end', scores: [a, b], winner });
}

function handleClick(room, idx, msg) {
  if (room.status !== 'playing') return;
  const player = room.players[idx];
  const now = Date.now();
  if (now < room.startAt || now > room.endAt) return;
  if (now < player.lockedUntil) return;

  // El cliente manda su hora estimada del servidor; se acepta solo dentro de un margen.
  let t = Number.isFinite(msg.t) ? msg.t : now;
  t = Math.min(now, Math.max(now - CONFIG.maxClockSkew, t));
  t = Math.max(t, room.startAt);

  const ang = arrowAngle(player.arrow, t);
  const hit = angDist(ang, player.zone) <= CONFIG.zoneHalfWidth;

  if (hit) {
    player.score++;
    player.arrow = { angle0: ang, speed: Math.min(CONFIG.maxSpeed, player.arrow.speed * CONFIG.speedUp), t0: t };
    player.zone = randomZone(ang);
  } else {
    player.arrow = { angle0: ang, speed: Math.max(CONFIG.baseSpeed, player.arrow.speed * CONFIG.missSlow), t0: t };
    player.lockedUntil = now + CONFIG.lockout;
  }

  broadcast(room, { type: 'state', state: publicState(room), last: { player: idx, hit } });
}

function cleanName(s) {
  return String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 14);
}

function sendNames(room) {
  broadcast(room, { type: 'names', names: room.players.map(p => p.name), ready: room.players.map(p => p.ready) });
}

function leave(ws) {
  const room = ws.room;
  if (!room) return;
  clearTimeout(room.timer);
  rooms.delete(room.code);
  room.players.forEach(p => {
    p.ws.room = null;
    if (p.ws !== ws) send(p.ws, { type: 'opponent_left' });
  });
}

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server });

// Cloudflare cierra los websockets que pasan un rato sin tráfico: un ping periódico los mantiene vivos
// y de paso detecta jugadores que se desconectaron sin avisar.
const HEARTBEAT = Number(process.env.HEARTBEAT) || 25000;
const heartbeat = setInterval(() => {
  wss.clients.forEach(ws => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, HEARTBEAT);
wss.on('close', () => clearInterval(heartbeat));

wss.on('connection', ws => {
  ws.room = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', raw => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg.type !== 'string') return;

    switch (msg.type) {
      case 'ping':
        send(ws, { type: 'pong', c: msg.c, s: Date.now() });
        break;

      case 'create': {
        if (ws.room) return;
        const code = makeCode();
        const room = { code, players: [newPlayer(ws)], status: 'waiting', timer: null };
        rooms.set(code, room);
        ws.room = room;
        send(ws, { type: 'created', code });
        break;
      }

      case 'join': {
        if (ws.room) return;
        const code = String(msg.code || '').trim().toUpperCase();
        const room = rooms.get(code);
        if (!room) return send(ws, { type: 'error', message: 'No existe una sala con ese código.' });
        if (room.players.length >= 2 || room.status !== 'waiting') {
          return send(ws, { type: 'error', message: 'La sala ya está llena.' });
        }
        room.players.push(newPlayer(ws));
        ws.room = room;
        room.status = 'setup';   // cinemática + nombres; la partida arranca cuando los dos están listos
        room.players.forEach((p, i) => send(p.ws, { type: 'matched', you: i }));
        sendNames(room);
        break;
      }

      case 'name': {
        const room = ws.room;
        if (!room || room.status !== 'setup') return;
        const p = room.players.find(q => q.ws === ws);
        if (p.ready) return;
        p.name = cleanName(msg.name);
        if (msg.ready) p.ready = true;
        sendNames(room);
        if (room.players.length === 2 && room.players.every(q => q.ready)) startMatch(room);
        break;
      }

      case 'click': {
        const room = ws.room;
        if (!room) return;
        handleClick(room, room.players.findIndex(p => p.ws === ws), msg);
        break;
      }

      case 'leave':   // volver al menú: sale de la sala sin cortar la conexión
        leave(ws);
        break;

      case 'rematch': {
        const room = ws.room;
        if (!room || room.status !== 'finished') return;
        room.players.find(p => p.ws === ws).wantsRematch = true;
        if (room.players.length === 2 && room.players.every(p => p.wantsRematch)) startMatch(room);
        break;
      }
    }
  });

  ws.on('close', () => leave(ws));
});

server.listen(PORT, () => {
  console.log(`Arm Wrestling listo en http://localhost:${PORT}`);
  console.log(`Para compartirla:  cloudflared tunnel --url http://localhost:${PORT}`);
});
