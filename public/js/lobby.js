// ============ Lobby Rendering ============
function renderLobby() {
  document.getElementById('lobby-room-code').textContent = state.roomCode;
  
  const list = document.getElementById('lobby-players');
  list.innerHTML = state.players.map(p => `
    <li class="player-item">
      <span>${escHtml(p.nickname)}</span>
      ${p.id === state.hostId ? '<span class="host-badge">房主</span>' : ''}
      ${p.id === state.myId ? '<span class="you-badge">你</span>' : ''}
      <span class="status-dot ${p.connected ? '' : 'offline'}"></span>
    </li>
  `).join('');

  const isHost = state.myId === state.hostId;
  document.getElementById('host-controls').style.display = isHost ? 'block' : 'none';
  document.getElementById('guest-hint').style.display = isHost ? 'none' : 'block';

  if (isHost) {
    document.querySelectorAll('.mode-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === state.gameMode);
    });
    render1v1Select();

    const canStart = state.gameMode === 'all'
      ? state.players.filter(p => p.connected).length >= 2
      : state.selectedPlayers.length === 2;
    document.getElementById('btn-start').disabled = !canStart;
  }
}

function render1v1Select() {
  const container = document.getElementById('1v1-select');
  container.style.display = state.gameMode === '1v1' ? 'block' : 'none';
  if (state.gameMode !== '1v1') return;

  const list = document.getElementById('1v1-player-list');
  list.innerHTML = state.players.filter(p => p.connected).map(p => `
    <li class="player-item selectable ${state.selectedPlayers.includes(p.id) ? 'selected' : ''}"
        onclick="toggle1v1Player('${p.id}')">
      <span>${escHtml(p.nickname)}</span>
      ${p.id === state.myId ? '<span class="you-badge">你</span>' : ''}
    </li>
  `).join('');
}

function toggle1v1Player(id) {
  if (state.myId !== state.hostId) return;
  const idx = state.selectedPlayers.indexOf(id);
  if (idx >= 0) {
    state.selectedPlayers.splice(idx, 1);
  } else if (state.selectedPlayers.length < 2) {
    state.selectedPlayers.push(id);
  }
  sendMsg({ type: 'set_mode', mode: '1v1', players: state.selectedPlayers });
  renderLobby();
}

function setMode(mode) {
  if (state.myId !== state.hostId) return;
  state.gameMode = mode;
  state.selectedPlayers = [];
  sendMsg({ type: 'set_mode', mode, players: [] });
  renderLobby();
}

function startRound() {
  sendMsg({ type: 'start_round' });
}

function copyRoomCode() {
  navigator.clipboard?.writeText(state.roomCode).then(() => {
    showToast('已复制房间号 ' + state.roomCode);
  }).catch(() => {
    showToast('房间号: ' + state.roomCode);
  });
}

function leaveRoom() {
  intentionalClose = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  hideReconnectToast();

  if (ws) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'leave' }));
    }
    ws.close(1000, 'Left room');
    ws = null;
  }

  clearRoomSession();
  resetState();
  showPage('home');
  showToast('已离开房间');
}
