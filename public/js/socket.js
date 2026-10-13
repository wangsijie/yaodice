// ============ WebSocket ============
let reconnectToastEl = null;
let reconnectBannerEl = null;

const HEARTBEAT_INTERVAL = 20000;
const HEARTBEAT_TIMEOUT = 8000;
let heartbeatTimer = null;
let heartbeatTimeoutTimer = null;

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

function showReconnectBanner() {
  if (!reconnectBannerEl) {
    reconnectBannerEl = document.createElement('div');
    reconnectBannerEl.className = 'reconnect-banner';
    reconnectBannerEl.onclick = () => {
      retryConnection();
    };
    document.body.prepend(reconnectBannerEl);
  }
  reconnectBannerEl.textContent = '连接已断开，点击重新连接';
}

function hideReconnectBanner() {
  if (reconnectBannerEl) {
    reconnectBannerEl.remove();
    reconnectBannerEl = null;
  }
}

function retryConnection() {
  hideReconnectBanner();
  reconnectAttempt = 0;
  showReconnectToast(1);
  connectWebSocket();
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: 'ping' }));
        if (heartbeatTimeoutTimer) clearTimeout(heartbeatTimeoutTimer);
        heartbeatTimeoutTimer = setTimeout(() => {
          console.warn('Heartbeat pong timed out, resetting connection...');
          handleSocketDied();
        }, HEARTBEAT_TIMEOUT);
      } catch {
        handleSocketDied();
      }
    }
  }, HEARTBEAT_INTERVAL);
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (heartbeatTimeoutTimer) {
    clearTimeout(heartbeatTimeoutTimer);
    heartbeatTimeoutTimer = null;
  }
}

function onHeartbeatActivity() {
  if (heartbeatTimeoutTimer) {
    clearTimeout(heartbeatTimeoutTimer);
    heartbeatTimeoutTimer = null;
  }
}

function handleSocketDied() {
  stopHeartbeat();
  if (ws) {
    try {
      ws.onclose = null;
      ws.onerror = null;
      ws.close();
    } catch {}
    ws = null;
  }
  attemptReconnect();
}

function handleAppWakeup() {
  if (document.visibilityState === 'hidden') return;
  if (!state.roomCode) return;

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    if (!reconnectTimer) {
      showReconnectToast(reconnectAttempt + 1);
      connectWebSocket();
    }
  } else {
    try {
      ws.send(JSON.stringify({ type: 'ping' }));
      if (heartbeatTimeoutTimer) clearTimeout(heartbeatTimeoutTimer);
      heartbeatTimeoutTimer = setTimeout(() => {
        console.warn('Wakeup ping timed out, forcing reconnect...');
        handleSocketDied();
      }, 3000);
    } catch {
      handleSocketDied();
    }
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    handleAppWakeup();
  }
});
window.addEventListener('pageshow', handleAppWakeup);
window.addEventListener('focus', handleAppWakeup);

function attemptReconnect(immediate = false) {
  if (reconnectAttempt >= RECONNECT_MAX_ATTEMPTS) {
    hideReconnectToast();
    showReconnectBanner();
    return;
  }

  reconnectAttempt++;
  const delay = immediate ? 0 : Math.min(
    RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempt - 1),
    RECONNECT_MAX_DELAY
  );

  showReconnectToast(reconnectAttempt);

  if (delay === 0) {
    connectWebSocket();
    return;
  }

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

  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${proto}//${location.host}/ws/${state.roomCode}`);
  ws = socket;

  socket.onopen = () => {
    if (ws !== socket) return;
    startHeartbeat();
    hideReconnectBanner();
    if (reconnectToken) {
      socket.send(JSON.stringify({ type: 'reconnect', reconnectToken, nickname: state.nickname }));
    } else {
      socket.send(JSON.stringify({ type: 'join', nickname: state.nickname }));
    }
  };

  socket.onmessage = (e) => {
    if (ws !== socket) return;
    onHeartbeatActivity();
    let msg;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }
    if (msg.type === 'pong') return;
    handleMessage(msg);
  };

  socket.onerror = () => {
    // onclose will fire after this, reconnection handled there
  };

  socket.onclose = (event) => {
    if (ws !== socket) return;
    stopHeartbeat();
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
    try {
      ws.send(JSON.stringify(msg));
      return true;
    } catch {
      handleSocketDied();
      return false;
    }
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
      hideReconnectBanner();

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
      } else if (msg.phase === 'results' && msg.lastResults) {
        showPage('game');
        renderGame();
        showResults(msg.lastResults);
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
      if (state.round) {
        renderGame();
      }
      break;

    case 'player_reconnected':
      const rcPlayer = state.players.find(p => p.id === msg.id);
      if (rcPlayer) {
        rcPlayer.connected = true;
        if (msg.nickname) rcPlayer.nickname = msg.nickname;
      }
      state.hostId = msg.hostId;
      renderLobby();
      if (state.round) {
        renderGame();
      }
      showToast(msg.nickname + ' 重新连接了');
      break;

    case 'mode_changed':
      state.gameMode = msg.mode;
      state.selectedPlayers = msg.selectedPlayers || [];
      renderLobby();
      break;

    case 'round_started':
      if (typeof resetDiceRollAnimation === 'function') resetDiceRollAnimation();
      const keepShowingResults = typeof isViewingResults === 'function'
        && isViewingResults()
        && !autoRollAfterRoundStart;
      state.round = msg;
      state.myDice = null;
      state.pendingDice = null;
      state.isRollingDice = false;
      state.hasRolled = false;
      state.hasRevealed = false;
      state.isParticipant = msg.participants.some(p => p.id === state.myId);
      state.rolledPlayers = new Set();
      state.revealedPlayers = new Set();

      if (keepShowingResults) {
        showPage('game');
      } else if (typeof maybeAutoRollAfterRoundStart === 'function' && maybeAutoRollAfterRoundStart()) {
        // The local player clicked "play again", so entering the new round handled rendering and rolling.
      } else {
        document.getElementById('results-area').style.display = 'none';
        showPage('game');
        renderGame();
      }
      break;

    case 'round_aborted':
      showToast(msg.reason || '当前回合已取消');
      if (typeof clearCurrentRound === 'function') {
        clearCurrentRound();
      } else {
        state.round = null;
      }
      document.getElementById('results-area').style.display = 'none';
      showPage('lobby');
      renderLobby();
      break;

    case 'player_skipped':
      if (state.round && msg.participants) {
        state.round.participants = msg.participants;
      }
      showToast('已跳过掉线玩家');
      renderGame();
      break;

    case 'your_dice':
      receiveMyDice(msg.dice);
      break;

    case 'player_rolled':
      state.rolledPlayers.add(msg.id);
      if (typeof isViewingResults !== 'function' || !isViewingResults()) {
        renderGame();
      }
      break;

    case 'player_revealed':
      state.revealedPlayers.add(msg.id);
      if (typeof isViewingResults !== 'function' || !isViewingResults()) {
        renderGame();
      }
      break;

    case 'all_revealed':
      const wasViewingResults = typeof isViewingResults === 'function' && isViewingResults();
      if (typeof clearCurrentRound === 'function') {
        clearCurrentRound();
      } else {
        state.round = null;
      }
      if (!wasViewingResults) {
        showResults(msg.results);
      }
      break;
  }
}
