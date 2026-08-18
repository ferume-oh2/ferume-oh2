const app = document.querySelector('#app');
let token = localStorage.getItem('munchkin-token');
let playerId = localStorage.getItem('munchkin-player-id');
let state = null;
let error = '';
let socket = null;

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[c]));
const api = async (url, options = {}) => {
  const r = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Session': token } : {}), ...(options.headers || {}) }
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || 'Ошибка');
  return d;
};

function connectSocket() {
  if (!token) return;
  socket?.close();
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(`${protocol}//${location.host}/ws?token=${encodeURIComponent(token)}`);
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.type === 'state') { state = message.room; error = ''; render(); }
    if (message.type === 'error') { error = message.error; render(); }
  };
  socket.onclose = () => {
    setTimeout(() => { if (token && (!socket || socket.readyState === WebSocket.CLOSED)) connectSocket(); }, 1500);
  };
}

async function action(action, extra = {}) {
  try {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ action, ...extra }));
      return;
    }
    const d = await api('/api/action', { method: 'POST', body: JSON.stringify({ action, ...extra }) });
    state = d.room;
    error = '';
    render();
  } catch (e) { error = e.message; render(); }
}

async function create() {
  try {
    const name = document.querySelector('#name').value.trim();
    const d = await api('/api/create', { method: 'POST', body: JSON.stringify({ name }) });
    token = d.token; playerId = d.playerId;
    localStorage.setItem('munchkin-token', token);
    localStorage.setItem('munchkin-player-id', playerId);
    localStorage.setItem('munchkin-name', name);
    state = d.room; error = ''; render(); connectSocket();
  } catch (e) { error = e.message; render(); }
}

async function join() {
  try {
    const name = document.querySelector('#name').value.trim();
    const roomCode = document.querySelector('#code').value.trim().toUpperCase();
    const d = await api('/api/join', { method: 'POST', body: JSON.stringify({ name, roomCode }) });
    token = d.token; playerId = d.playerId;
    localStorage.setItem('munchkin-token', token);
    localStorage.setItem('munchkin-player-id', playerId);
    localStorage.setItem('munchkin-name', name);
    state = d.room; error = ''; render(); connectSocket();
  } catch (e) { error = e.message; render(); }
}

function leave() {
  socket?.close(); socket = null;
  token = null; playerId = null; state = null;
  localStorage.removeItem('munchkin-token');
  localStorage.removeItem('munchkin-player-id');
  render();
}

function sendChat() {
  const input = document.querySelector('#chat');
  const text = input?.value.trim();
  if (!text) return;
  input.value = '';
  action('chat', { text });
}

function render() {
  if (!state) {
    app.innerHTML = `<main class="landing"><div class="brand">MUNCHKIN <span>ONLINE</span></div><p class="subtitle">онлайн-стол для игры с друзьями</p><section class="join-card"><label>Твоё имя<input id="name" value="${esc(localStorage.getItem('munchkin-name') || '')}" placeholder="Артём" autocomplete="off"></label><div class="actions"><button onclick="create()">Создать комнату</button><div class="join-row"><input id="code" placeholder="КОД" maxlength="6"><button onclick="join()">Войти</button></div></div><div class="status"><i class="online"></i> сервер готов</div>${error ? `<div class="error">${esc(error)}</div>` : ''}</section></main>`;
    return;
  }
  const me = state.players.find(p => p.id === playerId);
  const current = state.players[state.currentPlayerIndex];
  const myTurn = !!me && current.id === me.id;
  const socketOnline = socket?.readyState === WebSocket.OPEN;

  app.innerHTML = `<main class="app-shell"><header class="topbar"><div class="brand small">MUNCHKIN <span>ONLINE</span></div><div class="room-pill">КОМНАТА <strong>${state.code}</strong><button onclick="navigator.clipboard?.writeText('${state.code}')">Копировать</button></div><div class="connection"><i class="${socketOnline ? 'online' : ''}"></i> ${socketOnline ? 'онлайн' : 'подключение…'}</div><button class="leave" onclick="leave()">Выйти</button></header><div class="game-layout"><aside class="players panel"><div class="panel-title">ИГРОКИ <span>${state.players.length}/6</span></div>${state.players.map((p, i) => `<div class="player ${current.id === p.id ? 'active' : ''}"><div class="avatar ${p.color}">${esc(p.name[0])}</div><div class="player-info"><strong>${esc(p.name)}${p.id === state.hostId ? ' 👑' : ''}</strong><span>Уровень ${p.level}</span></div><div class="online-dot ${p.connected ? '' : 'offline'}">●</div>${i === state.currentPlayerIndex ? '<div class="turn-badge">ХОД</div>' : ''}</div>`).join('')}${state.phase === 'waiting' && me?.id === state.hostId ? `<button class="start" onclick="action('start')" ${state.players.length < 2 ? 'disabled' : ''}>Начать игру</button>` : ''}${state.phase === 'waiting' && me?.id !== state.hostId ? '<div class="waiting">Ждём хоста…</div>' : ''}</aside><section class="table-area"><div class="turn-line">${state.phase === 'waiting' ? 'ОЖИДАНИЕ ИГРЫ' : `ХОД: <b>${esc(current.name)}</b>${myTurn ? '<em> — ТВОЙ ХОД</em>' : ''}`}</div><div class="table">${state.door ? `<div class="door-card ${state.door.type}"><small>ДВЕРЬ</small><h2>${esc(state.door.title)}</h2><div class="card-mark">${state.door.icon}</div>${state.door.level ? `<div class="door-level">Уровень ${state.door.level}</div>` : ''}</div>` : '<div class="empty-door"><div>🚪</div><span>Дверь пока закрыта</span></div>'}</div><div class="game-actions"><button class="primary" ${!myTurn || state.phase !== 'turn' ? 'disabled' : ''} onclick="action('openDoor')">Открыть дверь</button><button ${!myTurn || state.phase !== 'turn' ? 'disabled' : ''} onclick="action('endTurn')">Закончить ход</button></div>${error ? `<div class="error centered">${esc(error)}</div>` : ''}</section><aside class="right-column"><div class="chat panel"><div class="panel-title">ЧАТ</div><div class="messages">${state.chat.map(m => `<div class="message"><b>${esc(m.player)}:</b> ${esc(m.text)}</div>`).join('')}</div><form onsubmit="event.preventDefault();sendChat()"><input id="chat" placeholder="Сообщение…"><button>→</button></form></div><div class="log panel"><div class="panel-title">ИГРОВОЙ ЛОГ</div><div class="log-list">${state.log.slice().reverse().map(l => `<div>${esc(l.text)}</div>`).join('')}</div></div></aside></div></main>`;
}

if (token) {
  api('/api/state').then(d => { state = d.room; render(); connectSocket(); }).catch(() => leave());
} else render();
