import { DurableObject } from 'cloudflare:workers';

interface Player {
  id: string;
  nickname: string;
  connected: boolean;
  reconnectToken: string;
  disconnectedAt: number | null;
}

interface Round {
  mode: 'all' | '1v1';
  participants: string[];
  dice: Map<string, number[]>;
  rolled: Set<string>;
  revealed: Set<string>;
}

interface StoredRoom {
  initialized: boolean;
  roomCode: string;
  hostId: string | null;
  players: Player[];
  gameMode: 'all' | '1v1';
  selectedPlayers: string[];
  round: {
    mode: 'all' | '1v1';
    participants: string[];
    dice: [string, number[]][];
    rolled: string[];
    revealed: string[];
  } | null;
}

interface WebSocketAttachment {
  playerId?: string;
}

type ClientMessage =
  | { type: 'join'; nickname: string }
  | { type: 'reconnect'; reconnectToken: string; nickname: string }
  | { type: 'set_mode'; mode: 'all' | '1v1'; players?: string[] }
  | { type: 'start_round' }
  | { type: 'roll' }
  | { type: 'reveal' };

export class GameRoom extends DurableObject {
  private players: Map<string, Player> = new Map();
  private wsToPlayer: Map<WebSocket, string> = new Map();
  private playerToWs: Map<string, WebSocket> = new Map();
  private tokenToPlayerId: Map<string, string> = new Map();
  private hostId: string | null = null;
  private roomCode: string = '';
  private round: Round | null = null;
  private initialized = false;
  private gameMode: 'all' | '1v1' = 'all';
  private selectedPlayers: string[] = [];
  private loaded = false;

  async fetch(request: Request): Promise<Response> {
    await this.ensureLoaded();
    const url = new URL(request.url);

    if (url.pathname === '/init' && request.method === 'POST') {
      const body = await request.json() as { code: string };
      if (!this.initialized) {
        this.roomCode = body.code;
        this.initialized = true;
        await this.saveState();
      }
      return new Response(JSON.stringify({ ok: true }));
    }

    if (url.pathname === '/info') {
      return new Response(JSON.stringify({
        exists: this.initialized,
        playerCount: this.players.size,
      }));
    }

    // WebSocket upgrade
    if (!this.initialized && url.pathname.startsWith('/ws/')) {
      const code = url.pathname.split('/').pop();
      if (code && /^\d{6}$/.test(code)) {
        this.roomCode = code;
        this.initialized = true;
      }
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await this.ensureLoaded();
    if (typeof message !== 'string') return;

    let msg: ClientMessage;
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }

    switch (msg.type) {
      case 'join':
        await this.handleJoin(ws, msg.nickname);
        break;
      case 'reconnect':
        await this.handleReconnect(ws, msg.reconnectToken, msg.nickname);
        break;
      case 'set_mode':
        await this.handleSetMode(ws, msg.mode, msg.players);
        break;
      case 'start_round':
        await this.handleStartRound(ws);
        break;
      case 'roll':
        await this.handleRoll(ws);
        break;
      case 'reveal':
        await this.handleReveal(ws);
        break;
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.ensureLoaded();
    const attachment = ws.deserializeAttachment() as WebSocketAttachment | undefined;
    const playerId = this.wsToPlayer.get(ws) ?? attachment?.playerId;
    if (playerId) {
      const currentWs = this.playerToWs.get(playerId);
      const isCurrentSocket = !currentWs || currentWs === ws;
      this.wsToPlayer.delete(ws);
      ws.serializeAttachment({});

      if (!isCurrentSocket) return;

      const player = this.players.get(playerId);
      if (player) {
        player.connected = false;
        player.disconnectedAt = Date.now();
      }
      this.playerToWs.delete(playerId);

      // If host left, assign new host
      if (playerId === this.hostId) {
        const connected = [...this.players.entries()].find(([_, p]) => p.connected);
        this.hostId = connected ? connected[0] : null;
      }

      this.broadcast({
        type: 'player_left',
        id: playerId,
        hostId: this.hostId,
      });

      await this.saveState();
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  private async handleJoin(ws: WebSocket, nickname: string): Promise<void> {
    const playerId = crypto.randomUUID().slice(0, 8);
    const reconnectToken = crypto.randomUUID();

    const player: Player = {
      id: playerId,
      nickname: nickname || generateNickname(),
      connected: true,
      reconnectToken,
      disconnectedAt: null,
    };

    this.players.set(playerId, player);
    this.tokenToPlayerId.set(reconnectToken, playerId);
    this.wsToPlayer.set(ws, playerId);
    this.playerToWs.set(playerId, ws);
    ws.serializeAttachment({ playerId });

    if (!this.hostId) {
      this.hostId = playerId;
    }

    // Send full state to the new player
    this.send(ws, {
      type: 'room_state',
      you: playerId,
      reconnectToken,
      roomCode: this.roomCode,
      hostId: this.hostId,
      players: this.getPlayerList(),
      round: this.getRoundState(playerId),
      gameMode: this.gameMode,
      selectedPlayers: this.selectedPlayers,
    });

    // Notify others
    this.broadcastExcept(ws, {
      type: 'player_joined',
      id: playerId,
      nickname: player.nickname,
      hostId: this.hostId,
    });

    await this.saveState();
  }

  private async handleReconnect(ws: WebSocket, reconnectToken: string, nickname: string): Promise<void> {
    const playerId = this.tokenToPlayerId.get(reconnectToken);

    if (!playerId || !this.players.has(playerId)) {
      await this.handleJoin(ws, nickname);
      return;
    }

    const player = this.players.get(playerId)!;

    if (player.connected) {
      const oldWs = this.playerToWs.get(playerId);
      if (oldWs) {
        this.wsToPlayer.delete(oldWs);
        oldWs.serializeAttachment({});
        oldWs.close(4001, 'Replaced by reconnection');
      }
    }

    player.connected = true;
    player.disconnectedAt = null;
    if (nickname && nickname !== player.nickname) {
      player.nickname = nickname;
    }
    this.wsToPlayer.set(ws, playerId);
    this.playerToWs.set(playerId, ws);
    ws.serializeAttachment({ playerId });

    if (!this.hostId || ![...this.players.values()].some(p => p.connected && p.id === this.hostId)) {
      this.hostId = playerId;
    }

    this.send(ws, {
      type: 'room_state',
      you: playerId,
      reconnectToken,
      roomCode: this.roomCode,
      hostId: this.hostId,
      players: this.getPlayerList(),
      round: this.getRoundState(playerId),
      gameMode: this.gameMode,
      selectedPlayers: this.selectedPlayers,
    });

    this.broadcastExcept(ws, {
      type: 'player_reconnected',
      id: playerId,
      nickname: player.nickname,
      hostId: this.hostId,
    });

    await this.saveState();
  }

  private async handleSetMode(ws: WebSocket, mode: 'all' | '1v1', players?: string[]): Promise<void> {
    const playerId = this.wsToPlayer.get(ws);
    if (playerId !== this.hostId) return;

    this.gameMode = mode;
    if (mode === '1v1' && players) {
      this.selectedPlayers = players.filter(id => this.players.has(id));
    } else {
      this.selectedPlayers = [];
    }

    this.broadcast({
      type: 'mode_changed',
      mode: this.gameMode,
      selectedPlayers: this.selectedPlayers,
    });

    await this.saveState();
  }

  private async handleStartRound(ws: WebSocket): Promise<void> {
    const playerId = this.wsToPlayer.get(ws);
    if (playerId !== this.hostId) return;

    let participants: string[];
    if (this.gameMode === '1v1' && this.selectedPlayers.length === 2) {
      participants = this.selectedPlayers;
    } else {
      participants = [...this.players.entries()]
        .filter(([_, p]) => p.connected)
        .map(([id]) => id);
    }

    if (participants.length < 2) return;

    this.round = {
      mode: this.gameMode,
      participants,
      dice: new Map(),
      rolled: new Set(),
      revealed: new Set(),
    };

    this.broadcast({
      type: 'round_started',
      mode: this.round.mode,
      participants: participants.map(id => ({
        id,
        nickname: this.players.get(id)?.nickname || '',
      })),
    });

    await this.saveState();
  }

  private async handleRoll(ws: WebSocket): Promise<void> {
    const playerId = this.wsToPlayer.get(ws);
    if (!playerId || !this.round) return;
    if (!this.round.participants.includes(playerId)) return;
    if (this.round.rolled.has(playerId)) return;

    // Generate 5 random dice
    const dice = Array.from({ length: 5 }, () => Math.floor(Math.random() * 6) + 1);
    this.round.dice.set(playerId, dice);
    this.round.rolled.add(playerId);

    // Send dice only to this player
    this.send(ws, { type: 'your_dice', dice });

    // Tell everyone this player rolled
    this.broadcast({
      type: 'player_rolled',
      id: playerId,
      allRolled: this.round.rolled.size === this.round.participants.length,
    });

    await this.saveState();
  }

  private async handleReveal(ws: WebSocket): Promise<void> {
    const playerId = this.wsToPlayer.get(ws);
    if (!playerId || !this.round) return;
    if (!this.round.participants.includes(playerId)) return;
    if (!this.round.rolled.has(playerId)) return;
    if (this.round.revealed.has(playerId)) return;

    this.round.revealed.add(playerId);

    this.broadcast({
      type: 'player_revealed',
      id: playerId,
    });

    // Check if all revealed
    if (this.round.revealed.size === this.round.participants.length) {
      const results = this.round.participants.map(id => ({
        id,
        nickname: this.players.get(id)?.nickname || '',
        dice: this.round!.dice.get(id) || [],
      }));

      this.broadcast({
        type: 'all_revealed',
        results,
      });

      this.round = null;
    }

    await this.saveState();
  }

  private getPlayerList() {
    return [...this.players.entries()].map(([id, p]) => ({
      id,
      nickname: p.nickname,
      connected: p.connected,
    }));
  }

  private getRoundState(playerId: string) {
    if (!this.round) return null;
    return {
      mode: this.round.mode,
      participants: this.round.participants.map(id => ({
        id,
        nickname: this.players.get(id)?.nickname || '',
      })),
      rolled: [...this.round.rolled],
      revealed: [...this.round.revealed],
      yourDice: this.round.dice.get(playerId) || null,
      allRevealed: this.round.revealed.size === this.round.participants.length,
      allResults: this.round.revealed.size === this.round.participants.length
        ? this.round.participants.map(id => ({
            id,
            nickname: this.players.get(id)?.nickname || '',
            dice: this.round!.dice.get(id) || [],
          }))
        : null,
    };
  }

  private send(ws: WebSocket, data: unknown): void {
    try {
      ws.send(JSON.stringify(data));
    } catch {
      // WebSocket might be closed
    }
  }

  private broadcast(data: unknown): void {
    const msg = JSON.stringify(data);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(msg);
      } catch {
        // skip closed sockets
      }
    }
  }

  private broadcastExcept(excludeWs: WebSocket, data: unknown): void {
    const msg = JSON.stringify(data);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === excludeWs) continue;
      try {
        ws.send(msg);
      } catch {
        // skip
      }
    }
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;

    const stored = await this.ctx.storage.get<StoredRoom>('room');
    if (stored) {
      this.initialized = stored.initialized;
      this.roomCode = stored.roomCode;
      this.hostId = stored.hostId;
      this.players = new Map(stored.players.map(player => [player.id, player]));
      this.tokenToPlayerId = new Map(stored.players.map(player => [player.reconnectToken, player.id]));
      this.gameMode = stored.gameMode;
      this.selectedPlayers = stored.selectedPlayers;
      this.round = stored.round ? {
        mode: stored.round.mode,
        participants: stored.round.participants,
        dice: new Map(stored.round.dice),
        rolled: new Set(stored.round.rolled),
        revealed: new Set(stored.round.revealed),
      } : null;
    }

    this.wsToPlayer = new Map();
    this.playerToWs = new Map();
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as WebSocketAttachment | undefined;
      const playerId = attachment?.playerId;
      if (!playerId || !this.players.has(playerId)) continue;
      this.wsToPlayer.set(ws, playerId);
      this.playerToWs.set(playerId, ws);
      const player = this.players.get(playerId);
      if (player) {
        player.connected = true;
        player.disconnectedAt = null;
      }
    }

    this.loaded = true;
  }

  private async saveState(): Promise<void> {
    const stored: StoredRoom = {
      initialized: this.initialized,
      roomCode: this.roomCode,
      hostId: this.hostId,
      players: [...this.players.values()],
      gameMode: this.gameMode,
      selectedPlayers: this.selectedPlayers,
      round: this.round ? {
        mode: this.round.mode,
        participants: this.round.participants,
        dice: [...this.round.dice.entries()],
        rolled: [...this.round.rolled],
        revealed: [...this.round.revealed],
      } : null,
    };
    await this.ctx.storage.put('room', stored);
  }
}

const ADJECTIVES = [
  '快乐', '神秘', '飞翔', '淡定', '暴躁', '优雅', '沉默', '勇敢',
  '聪明', '迷糊', '傲娇', '佛系', '硬核', '摸鱼', '咸鱼', '划水',
];

const NOUNS = [
  '熊猫', '青蛙', '企鹅', '老虎', '兔子', '猴子', '柴犬', '猫咪',
  '鹦鹉', '海豚', '考拉', '狐狸', '龙虾', '河豚', '仓鼠', '水獭',
];

function generateNickname(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return adj + noun;
}
