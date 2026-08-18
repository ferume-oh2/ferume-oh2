const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT || 3000);
const HOST = '0.0.0.0';
const rooms = new Map();
const sessions = new Map();
const sockets = new Map();
const colors = ['violet', 'blue', 'red', 'green', 'orange', 'pink'];
const doors = [
  { title: 'Гоблин-неудачник', type: 'monster', icon: '👹', level: 1 },
  { title: 'Проклятие: Потеряй шапку', type: 'curse', icon: '☠️' },
  { title: 'Комната с подозрительным сундуком', type: 'room', icon: '🚪' },
  { title: 'Слизень-странник', type: 'monster', icon: '🟢', level: 2 },
  { title: 'Проклятие: Потеряй 1 уровень', type: 'curse', icon: '💀' },
];

const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let value;
  do value = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  while (rooms.has(value));
  return value;
}

function addLog(room, text) {
  room.log.push({ id: id(), text, time: now() });
  room.log = room.log.slice(-60);
}

function publicRoom(room) {
  return {
    code: room.code,
    players: room.players,
    hostId: room.hostId,
    currentPlayerIndex: room.currentPlayerIndex,
    phase: room.phase,
    door: room.door,
    log: room.log,
    chat: room.chat,
  };
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); }
      catch { reject(new Error('Некорректный JSON')); }
    });
    req.on('error', reject);
  });
}

function roomForToken(token) {
  const session = sessions.get(token);
  if (!session) throw new Error('Сессия не найдена');
  const room = rooms.get(session.roomCode);
  if (!room) throw new Error('Комната не найдена');
  const player = room.players.find(p => p.id === session.playerId);
  if (!player) throw new Error('Игрок не найден');
  return { room, player, session };
}

function broadcast(room) {
  const message = JSON.stringify({ type: 'state', room: publicRoom(room) });
  for (const player of room.players) {
    const token = [...sessions.entries()].find(([, s]) => s.roomCode === room.code && s.playerId === player.id)?.[0];
    const ws = token ? sockets.get(token) : null;
    if (ws && ws.readyState === 1) ws.send(message);
  }
}

function mutate(room, player, action, body = {}) {
  if (action === 'start') {
    if (room.hostId !== player.id) throw new Error('Начать игру может только хост');
    if (room.players.length < 2) throw new Error('Нужно минимум 2 игрока');
    if (room.phase !== 'waiting') throw new Error('Игра уже началась');
    room.phase = 'turn';
    addLog(room, `Игра началась. Ход игрока ${room.players[0].name}`);
  } else if (action === 'openDoor') {
    if (room.phase !== 'turn') throw new Error('Сначала начните игру');
    if (room.players[room.currentPlayerIndex].id !== player.id) throw new Error('Сейчас ход другого игрока');
    room.door = doors[Math.floor(Math.random() * doors.length)];
    addLog(room, `${player.name} открыл дверь: ${room.door.title}`);
  } else if (action === 'endTurn') {
    if (room.phase !== 'turn') throw new Error('Игра ещё не началась');
    if (room.players[room.currentPlayerIndex].id !== player.id) throw new Error('Сейчас ход другого игрока');
    room.door = null;
    room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length;
    addLog(room, `Ход переходит к ${room.players[room.currentPlayerIndex].name}`);
  } else if (action === 'chat') {
    const text = String(body.text || '').trim().slice(0, 300);
    if (!text) return;
    room.chat.push({ id: id(), player: player.name, text, time: now() });
    room.chat = room.chat.slice(-50);
  } else {
    throw new Error('Неизвестное действие');
  }
}

function createRoom(name) {
  const roomCode = makeCode();
  const playerId = id();
  const room = {
    code: roomCode,
    players: [{ id: playerId, name, level: 1, color: colors[0], connected: true }],
    hostId: playerId,
    currentPlayerIndex: 0,
    phase: 'waiting',
    door: null,
    log: [],
    chat: [],
  };
  rooms.set(roomCode, room);
  addLog(room, `${name} создал комнату`);
  return { room, playerId };
}

function joinRoom(name, roomCode) {
  const room = rooms.get(roomCode);
  if (!room) throw new Error('Комната не найдена');
  if (room.players.length >= 6) throw new Error('В комнате уже 6 игроков');
  if (room.phase !== 'waiting') throw new Error('Нельзя присоединиться после начала игры');
  if (room.players.some(p => p.name.toLowerCase() === name.toLowerCase())) throw new Error('Это имя уже занято');
  const playerId = id();
  room.players.push({ id: playerId, name, level: 1, color: colors[room.players.length], connected: true });
  addLog(room, `${name} присоединился к игре`);
  return { room, playerId };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return sendJson(res, 200, { ok: true, rooms: rooms.size, websocket: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/create') {
      const body = await readBody(req);
      const name = String(body.name || '').trim().slice(0, 24);
      if (!name) throw new Error('Введите имя');
      const { room, playerId } = createRoom(name);
      const token = id();
      sessions.set(token, { roomCode: room.code, playerId });
      return sendJson(res, 200, { token, playerId, room: publicRoom(room) });
    }
    if (req.method === 'POST' && url.pathname === '/api/join') {
      const body = await readBody(req);
      const name = String(body.name || '').trim().slice(0, 24);
      const roomCode = String(body.roomCode || '').trim().toUpperCase();
      if (!name) throw new Error('Введите имя');
      const { room, playerId } = joinRoom(name, roomCode);
      const token = id();
      sessions.set(token, { roomCode: room.code, playerId });
      broadcast(room);
      return sendJson(res, 200, { token, playerId, room: publicRoom(room) });
    }
    if (req.method === 'GET' && url.pathname === '/api/state') {
      const { room } = roomForToken(req.headers['x-session']);
      return sendJson(res, 200, { room: publicRoom(room) });
    }
    if (req.method === 'POST' && url.pathname === '/api/action') {
      const { room, player } = roomForToken(req.headers['x-session']);
      const body = await readBody(req);
      mutate(room, player, body.action, body);
      broadcast(room);
      return sendJson(res, 200, { room: publicRoom(room) });
    }
    if (req.method === 'GET') {
      let file = url.pathname === '/' ? '/index.html' : url.pathname;
      const publicDir = path.resolve(__dirname, 'public');
      const filePath = path.resolve(publicDir, `.${file}`);
      if (!filePath.startsWith(publicDir + path.sep)) return sendJson(res, 404, { error: 'Not found' });
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return sendJson(res, 404, { error: 'Not found' });
      const ext = path.extname(filePath);
      const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
      res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
      return res.end(fs.readFileSync(filePath));
    }
    sendJson(res, 404, { error: 'Not found' });
  } catch (e) {
    sendJson(res, 400, { error: e.message || 'Ошибка' });
  }
});

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname !== '/ws') return socket.destroy();
  const token = url.searchParams.get('token');
  try { roomForToken(token); } catch { return socket.destroy(); }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, token));
});

wss.on('connection', (ws, token) => {
  sockets.set(token, ws);
  const { room, player } = roomForToken(token);
  player.connected = true;
  broadcast(room);

  ws.on('message', raw => {
    try {
      const message = JSON.parse(raw.toString());
      mutate(room, player, message.action, message);
      broadcast(room);
    } catch (e) {
      ws.send(JSON.stringify({ type: 'error', error: e.message || 'Ошибка' }));
    }
  });

  ws.on('close', () => {
    if (sockets.get(token) === ws) sockets.delete(token);
    const session = sessions.get(token);
    if (session) {
      const room = rooms.get(session.roomCode);
      const player = room?.players.find(p => p.id === session.playerId);
      if (player) {
        player.connected = false;
        broadcast(room);
      }
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Munchkin Online listening on ${HOST}:${PORT}`);
});
