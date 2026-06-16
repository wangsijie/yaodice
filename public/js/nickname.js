// ============ Nickname ============
const ADJS = ['快乐','神秘','飞翔','淡定','暴躁','优雅','沉默','勇敢','聪明','迷糊','傲娇','佛系','硬核','摸鱼','咸鱼','划水'];
const NOUNS = ['熊猫','青蛙','企鹅','老虎','兔子','猴子','柴犬','猫咪','鹦鹉','海豚','考拉','狐狸','龙虾','河豚','仓鼠','水獭'];

function prepareNicknameInput() {
  const savedNick = state.nickname || localStorage.getItem(NICKNAME_STORAGE_KEY);
  if (savedNick) {
    lastGeneratedNickname = '';
    document.getElementById('input-nickname').value = savedNick;
  } else {
    randomNickname();
  }
}

function randomNickname() {
  const a = ADJS[Math.floor(Math.random() * ADJS.length)];
  const n = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  lastGeneratedNickname = a + n;
  document.getElementById('input-nickname').value = lastGeneratedNickname;
}

function confirmNickname() {
  if (joinPending) return;
  const nick = document.getElementById('input-nickname').value.trim();
  if (!nick) {
    randomNickname();
    return;
  }
  hideError('nickname-error');
  joinPending = true;
  document.getElementById('btn-confirm-nickname').disabled = true;
  document.getElementById('btn-random-nick').disabled = true;
  state.nickname = nick;
  if (nick !== lastGeneratedNickname) {
    localStorage.setItem(NICKNAME_STORAGE_KEY, nick);
  }
  saveRoomSession();
  connectWebSocket();
}
