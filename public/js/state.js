// ============ State ============
const RECONNECT_BASE_DELAY = 1000;
const RECONNECT_MAX_DELAY = 30000;
const RECONNECT_MAX_ATTEMPTS = 10;
const NICKNAME_STORAGE_KEY = 'yaodice_custom_nickname';
const ROOM_SESSION_STORAGE_KEY = 'yaodice_room_session';
const savedRoomSession = loadRoomSession();

let ws = null;
let reconnectTimer = null;
let reconnectAttempt = 0;
let intentionalClose = false;
let reconnectToken = savedRoomSession?.reconnectToken || sessionStorage.getItem('yaodice_reconnect_token');
let lastGeneratedNickname = '';
let audioContext = null;
let audioUnlocked = false;
let rollAudioElement = null;
let roomActionPending = false;
let joinPending = false;

let state = {
  roomCode: savedRoomSession?.roomCode || '',
  myId: '',
  hostId: '',
  nickname: savedRoomSession?.nickname || '',
  players: [],
  round: null,
  gameMode: 'all',
  selectedPlayers: [],
  myDice: null,
  pendingDice: null,
  isRollingDice: false,
  hasRolled: false,
  hasRevealed: false,
  isParticipant: false,
  rolledPlayers: new Set(),
  revealedPlayers: new Set(),
};

function resetState() {
  state = {
    roomCode: '',
    myId: '',
    hostId: '',
    nickname: '',
    players: [],
    round: null,
    gameMode: 'all',
    selectedPlayers: [],
    myDice: null,
    pendingDice: null,
    isRollingDice: false,
    hasRolled: false,
    hasRevealed: false,
    isParticipant: false,
    rolledPlayers: new Set(),
    revealedPlayers: new Set(),
  };
  document.getElementById('input-code').value = '';
  document.getElementById('results-area').style.display = 'none';
  resetJoinPending();
}
