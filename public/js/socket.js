// ============ WebSocket ============
let reconnectToastEl = null;

function showReconnectToast(attempt) {
  if (!reconnectToastEl) {
    reconnectToastEl = document.createElement('div');
    reconnectToastEl.className = 'toast';
    reconnectToastEl.id = 'reconnect-toast';
    document.body.appendChild(reconnectToastEl);
  }
  reconnectToastEl.textContent = '重新连接中... (' + attempt + '/' + RECONNECT_MAX_ATTEMPTS + ')';
}

function hideReconnectToast() {
  if (reconnectToastEl) {
    reconnectToastEl.remove();
    reconnectToastEl = null;
  }
}

function attemptReconnect() {
  if (reconnectAttempt >= RECONNECT_MAX_ATTEMPTS) {
    showToast('连接已断开，请刷新页面重试');
    clearRoomSession();
    resetState();
    showPage('home');
    return;
  }

  reconnectAttempt++;
  const delay = Math.min(
    RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempt - 1),
    RECONNECT_MAX_DELAY
  );

  showReconnectToast(reconnectAttempt);

  reconnectTimer = setTimeout(() => {
    connectWebSocket();
  }, delay);
}

function connectWebSocket() {
  intentionalClose = false;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${proto}//${location.host}/ws/${state.roomCode}`);
  ws = socket;

  socket.onopen = () => {
    if (ws !== socket) return;
    if (reconnectToken) {
      socket.send(JSON.stringify({ type: 'reconnect', reconnectToken, nickname: state.nickname }));
    } else {
      socket.send(JSON.stringify({ type: 'join', nickname: state.nickname }));
    }
  };

  socket.onmessage = (e) => {
    if (ws !== socket) return;
    const msg = JSON.parse(e.data);
    handleMessage(msg);
  };

  socket.onerror = () => {
    // onclose will fire after this, reconnection handled there
  };

  socket.onclose = (event) => {
    if (ws !== socket) return;
    ws = null;

    if (intentionalClose) return;
    if (event.code === 1000 || event.code === 4001 || event.code === 4002) {
      resetJoinPending();
      return;
    }

    attemptReconnect();
  };
}

function sendMsg(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
    return true;
  }
  if (state.roomCode && !reconnectTimer) {
    showReconnectToast(reconnectAttempt + 1);
    connectWebSocket();
  }
  showToast('连接中，请稍后再试');
  return false;
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'room_state':
      const wasReconnecting = reconnectAttempt > 0;
      state.myId = msg.you;
      state.hostId = msg.hostId;
      state.players = msg.players;
      state.roomCode = msg.roomCode || state.roomCode;
      state.gameMode = msg.gameMode || 'all';
      state.selectedPlayers = msg.selectedPlayers || [];
      saveRoomSession();

      if (msg.reconnectToken) {
        saveReconnectToken(msg.reconnectToken);
      }

      reconnectAttempt = 0;
      hideReconnectToast();

      if (wasReconnecting) {
        showToast('已重新连接');
      }
      resetJoinPending();
      if (msg.round) {
        // Rejoin mid-round
        state.round = msg.round;
        state.myDice = msg.round.yourDice;
        state.hasRolled = msg.round.rolled.includes(state.myId);
        state.hasRevealed = msg.round.revealed.includes(state.myId);
        state.isParticipant = msg.round.participants.some(p => p.id === state.myId);
        state.rolledPlayers = new Set(msg.round.rolled);
        state.revealedPlayers = new Set(msg.round.revealed);
        if (msg.round.allRevealed && msg.round.allResults) {
          showPage('game');
          renderGame();
          showResults(msg.round.allResults);
        } else {
          showPage('game');
          renderGame();
        }
      } else {
        showPage('lobby');
        renderLobby();
      }
      break;

    case 'error':
      resetJoinPending();
      if (msg.code === 'nickname_taken') {
        showPage('nickname');
        showError('nickname-error', msg.message || '这个昵称已经在房间里了，请换一个');
      } else {
        showToast(msg.message || '操作失败，请重试');
      }
      break;

    case 'player_joined':
      state.players.push({ id: msg.id, nickname: msg.nickname, connected: true });
      state.hostId = msg.hostId;
      renderLobby();
      showToast(msg.nickname + ' 加入了房间');
      break;

    case 'player_left':
      if (msg.left) {
        state.players = state.players.filter(p => p.id !== msg.id);
        state.selectedPlayers = state.selectedPlayers.filter(id => id !== msg.id);
      } else {
        const leftPlayer = state.players.find(p => p.id === msg.id);
        if (leftPlayer) leftPlayer.connected = false;
      }
      state.hostId = msg.hostId;
      renderLobby();
      break;

    case 'player_reconnected':
      const rcPlayer = state.players.find(p => p.id === msg.id);
      if (rcPlayer) {
        rcPlayer.connected = true;
        if (msg.nickname) rcPlayer.nickname = msg.nickname;
      }
      state.hostId = msg.hostId;
      renderLobby();
      showToast(msg.nickname + ' 重新连接了');
      break;

    case 'mode_changed':
      state.gameMode = msg.mode;
      state.selectedPlayers = msg.selectedPlayers || [];
      renderLobby();
      break;

    case 'round_started':
      if (typeof resetDiceRollAnimation === 'function') resetDiceRollAnimation();
      state.round = msg;
      state.myDice = null;
      state.pendingDice = null;
      state.isRollingDice = false;
      state.hasRolled = false;
      state.hasRevealed = false;
      state.isParticipant = msg.participants.some(p => p.id === state.myId);
      state.rolledPlayers = new Set();
      state.revealedPlayers = new Set();
      document.getElementById('results-area').style.display = 'none';
      showPage('game');
      renderGame();
      break;

    case 'your_dice':
      receiveMyDice(msg.dice);
      break;

    case 'player_rolled':
      state.rolledPlayers.add(msg.id);
      renderGame();
      break;

    case 'player_revealed':
      state.revealedPlayers.add(msg.id);
      renderGame();
      break;

    case 'all_revealed':
      showResults(msg.results);
      break;
  }
}
