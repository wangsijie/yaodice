// ============ Home ============
async function createRoom() {
  if (roomActionPending) return;
  setRoomActionPending(true);
  try {
    const res = await fetch('/api/room/create', { method: 'POST' });
    const data = await res.json();
    state.roomCode = data.code;
    saveRoomSession();
    showPage('nickname');
    prepareNicknameInput();
  } catch (e) {
    showError('home-error', '创建失败，请重试');
  } finally {
    setRoomActionPending(false);
  }
}

async function joinRoom() {
  if (roomActionPending) return;
  const code = document.getElementById('input-code').value.trim();
  if (!/^\d{4}$/.test(code)) {
    showError('home-error', '请输入4位数字房间号');
    return;
  }
  setRoomActionPending(true);
  try {
    const res = await fetch('/api/room/' + code);
    const data = await res.json();
    if (!data.exists) {
      showError('home-error', '房间不存在');
      return;
    }
    state.roomCode = code;
    saveRoomSession();
    showPage('nickname');
    prepareNicknameInput();
  } catch (e) {
    showError('home-error', '加入失败，请重试');
  } finally {
    setRoomActionPending(false);
  }
}

function setRoomActionPending(pending) {
  roomActionPending = pending;
  document.getElementById('btn-create').disabled = pending;
  document.getElementById('btn-join').disabled = pending;
}

function showError(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.style.display = 'block';
  setTimeout(() => el.style.display = 'none', 3000);
}
