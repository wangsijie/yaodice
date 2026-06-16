// ============ Room Session ============
function loadRoomSession() {
  try {
    const raw = localStorage.getItem(ROOM_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data.roomCode !== 'string' || !/^\d{4}$/.test(data.roomCode)) {
      localStorage.removeItem(ROOM_SESSION_STORAGE_KEY);
      return null;
    }
    return {
      roomCode: data.roomCode,
      nickname: typeof data.nickname === 'string' ? data.nickname : '',
      reconnectToken: typeof data.reconnectToken === 'string' ? data.reconnectToken : null,
    };
  } catch {
    localStorage.removeItem(ROOM_SESSION_STORAGE_KEY);
    return null;
  }
}

function saveRoomSession() {
  if (!state.roomCode) return;
  localStorage.setItem(ROOM_SESSION_STORAGE_KEY, JSON.stringify({
    roomCode: state.roomCode,
    nickname: state.nickname,
    reconnectToken,
  }));
}

function saveReconnectToken(token) {
  reconnectToken = token;
  if (token) {
    sessionStorage.setItem('yaodice_reconnect_token', token);
  } else {
    sessionStorage.removeItem('yaodice_reconnect_token');
  }
  saveRoomSession();
}

function clearRoomSession() {
  reconnectToken = null;
  sessionStorage.removeItem('yaodice_reconnect_token');
  localStorage.removeItem(ROOM_SESSION_STORAGE_KEY);
}
