import { DurableObject } from 'cloudflare:workers';

interface Player {
  id: string;
  nickname: string;
  connected: boolean;
}

interface Round {
  mode: 'all' | '1v1';
  participants: string[];
  dice: Map<string, number[]>;
  rolled: Set<string>;
  revealed: Set<string>;
}

type ClientMessage =
  | { type: 'join'; nickname: string }
  | { type: 'set_mode'; mode: 'all' | '1v1'; players?: string[] }
  | { type: 'start_round' }
  | { type: 'roll' }
  | { type: 'reveal' };

export class GameRoom extends DurableObject {
  private players: Map<string, Player> = new Map();
  private wsToPlayer: Map<WebSocket, string> = new Map();
  private playerToWs: Map<string, WebSocket> = new Map();
  private hostId: string | null = null;
  private roomCode: string = '';
  private round: Round | null = null;
  private initialized = false;
  private gameMode: 'all' | '1v1' = 'all';
  private selectedPlayers: string[] = [];

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/init' && request.method === 'POST') {
      const body = await request.json() as { code: string };
      if (!this.initialized) {
        this.roomCode = body.code;
        this.initialized = true;
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
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    if (typeof message !== 'string') return;

    let msg: ClientMessage;
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }

    switch (msg.type) {
      case 'join':
        this.handleJoin(ws, msg.nickname);
        break;
      case 'set_mode':
        this.handleSetMode(ws, msg.mode, msg.players);
        break;
      case 'start_round':
        this.handleStartRound(ws);
        break;
      case 'roll':
        this.handleRoll(ws);
        break;
      case 'reveal':
        this.handleReveal(ws);
        break;
    }
  }

  webSocketClose(ws: WebSocket): void {
    const playerId = this.wsToPlayer.get(ws);
    if (playerId) {
      const player = this.players.get(playerId);
      if (player) {
        player.connected = false;
      }
      this.wsToPlayer.delete(ws);
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

      // Clean up empty rooms
      const anyConnected = [...this.players.values()].some(p => p.connected);
      if (!anyConnected) {
        this.players.clear();
        this.round = null;
        this.hostId = null;
        this.initialized = false;
      }
    }
  }

  webSocketError(ws: WebSocket): void {
    this.webSocketClose(ws);
  }

  private handleJoin(ws: WebSocket, nickname: string): void {
    const playerId = crypto.randomUUID().slice(0, 8);

    const player: Player = {
      id: playerId,
      nickname: nickname || generateNickname(),
      connected: true,
    };

    this.players.set(playerId, player);
    this.wsToPlayer.set(ws, playerId);
    this.playerToWs.set(playerId, ws);

    if (!this.hostId) {
      this.hostId = playerId;
    }

    // Send full state to the new player
    this.send(ws, {
      type: 'room_state',
      you: playerId,
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
  }

  private handleSetMode(ws: WebSocket, mode: 'all' | '1v1', players?: string[]): void {
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
  }

  private handleStartRound(ws: WebSocket): void {
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
  }

  private handleRoll(ws: WebSocket): void {
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
  }

  private handleReveal(ws: WebSocket): void {
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
      participants: this.round.participants,
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
