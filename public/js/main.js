// Auto-focus code input
document.getElementById('input-code').addEventListener('input', function() {
  this.value = this.value.replace(/\D/g, '').slice(0, 6);
});

function restoreRoomSession() {
  if (!state.roomCode) return;

  if (reconnectToken) {
    showReconnectToast(1);
    connectWebSocket();
    return;
  }

  showPage('nickname');
  prepareNicknameInput();
}

restoreRoomSession();

// Preserve saved room session so refresh can reconnect.
window.addEventListener('beforeunload', () => {
  intentionalClose = true;
  if (ws) ws.close(1000, 'Page unload');
});
