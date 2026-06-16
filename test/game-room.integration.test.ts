import { exports } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';

type PlayerSummary = {
  id: string;
  nickname: string;
  connected: boolean;
};

type RoundParticipant = {
  id: string;
  nickname: string;
};

type RevealedResult = {
  id: string;
  nickname: string;
  dice: number[];
};

type ServerMessage =
  | {
      type: 'room_state';
      you: string;
      reconnectToken: string;
      roomCode: string;
      hostId: string;
      players: PlayerSummary[];
      round: null | {
        mode: 'all' | '1v1';
        participants: RoundParticipant[];
        rolled: string[];
        revealed: string[];
        yourDice: number[] | null;
        allRevealed: boolean;
        allResults: RevealedResult[] | null;
      };
      gameMode: 'all' | '1v1';
      selectedPlayers: string[];
    }
  | {
      type: 'player_joined';
      id: string;
      nickname: string;
      hostId: string;
    }
  | {
      type: 'player_left';
      id: string;
      hostId: string | null;
      left?: boolean;
    }
  | {
      type: 'player_reconnected';
      id: string;
      nickname: string;
      hostId: string;
    }
  | {
      type: 'mode_changed';
      mode: 'all' | '1v1';
      selectedPlayers: string[];
    }
  | {
      type: 'round_started';
      mode: 'all' | '1v1';
      participants: RoundParticipant[];
    }
  | {
      type: 'your_dice';
      dice: number[];
    }
  | {
      type: 'player_rolled';
      id: string;
      allRolled: boolean;
    }
  | {
      type: 'player_revealed';
      id: string;
    }
  | {
      type: 'all_revealed';
      results: RevealedResult[];
    }
  | {
      type: 'error';
      code: string;
      message: string;
    };

type ClientMessage =
  | { type: 'join'; nickname: string }
  | { type: 'reconnect'; reconnectToken: string; nickname: string }
  | { type: 'set_mode'; mode: 'all' | '1v1'; players?: string[] }
  | { type: 'start_round' }
  | { type: 'roll' }
  | { type: 'reveal' }
  | { type: 'leave' };

type DiceTotals = {
  wild: number;
  2: number;
  3: number;
  4: number;
  5: number;
  6: number;
};

const BASE_URL = 'http://yaodice.test';
const worker = (exports as unknown as { default: Fetcher }).default;
const openClients: RoomClient[] = [];

describe('GameRoom multiplayer integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    while (openClients.length) {
      openClients.pop()?.close();
    }
  });

  it('lets multiple players join, play, see private dice first, then all see numeric totals', async () => {
    const roomCode = await createRoom();
    const alice = await joinRoom(roomCode, 'Alice');
    const bob = await joinRoom(roomCode, 'Bob');
    const carol = await joinRoom(roomCode, 'Carol');

    await Promise.all([
      alice.waitFor('player_joined', (msg) => msg.nickname === 'Carol'),
      bob.waitFor('player_joined', (msg) => msg.nickname === 'Carol'),
    ]);

    expect(alice.hostId).toBe(alice.id);
    expect(alice.messagesOf('player_joined').map((msg) => msg.nickname)).toEqual([
      'Bob',
      'Carol',
    ]);
    expect(bob.messagesOf('player_joined').map((msg) => msg.nickname)).toEqual(['Carol']);
    expect(carol.players.map((player) => player.nickname)).toEqual(['Alice', 'Bob', 'Carol']);

    const infoResponse = await worker.fetch(`${BASE_URL}/api/room/${roomCode}`);
    expect(infoResponse.status).toBe(200);
    expect(await infoResponse.json()).toEqual({ exists: true, playerCount: 3 });

    alice.send({ type: 'start_round' });
    await Promise.all([
      alice.waitFor('round_started'),
      bob.waitFor('round_started'),
      carol.waitFor('round_started'),
    ]);

    mockDiceRolls([1, 1, 1, 1, 1], [2, 2, 2, 1, 1], [3, 4, 5, 6, 2]);

    await rollAndAssertPerspective(alice, [alice, bob, carol], [1, 1, 1, 1, 1], false);
    await rollAndAssertPerspective(bob, [alice, bob, carol], [2, 2, 2, 1, 1], false);
    await rollAndAssertPerspective(carol, [alice, bob, carol], [3, 4, 5, 6, 2], true);

    alice.send({ type: 'reveal' });
    bob.send({ type: 'reveal' });
    carol.send({ type: 'reveal' });

    const revealed = await Promise.all([
      alice.waitFor('all_revealed'),
      bob.waitFor('all_revealed'),
      carol.waitFor('all_revealed'),
    ]);

    const expectedResults = [
      { id: alice.id, nickname: 'Alice', dice: [1, 1, 1, 1, 1] },
      { id: bob.id, nickname: 'Bob', dice: [2, 2, 2, 1, 1] },
      { id: carol.id, nickname: 'Carol', dice: [3, 4, 5, 6, 2] },
    ];
    for (const msg of revealed) {
      expect(msg.results).toEqual(expectedResults);
      expect(calculateDiceTotals(msg.results)).toEqual({
        wild: 9,
        2: 14,
        3: 10,
        4: 10,
        5: 10,
        6: 10,
      });
    }
  });

  it('restores the same player view after disconnecting and reconnecting mid-round', async () => {
    const roomCode = '772201';
    const alice = await joinRoom(roomCode, 'Alice');
    const bob = await joinRoom(roomCode, 'Bob');

    alice.send({ type: 'start_round' });
    await Promise.all([alice.waitFor('round_started'), bob.waitFor('round_started')]);

    mockDiceRolls([4, 4, 4, 2, 1]);
    await rollAndAssertPerspective(alice, [alice, bob], [4, 4, 4, 2, 1], false);

    const reconnectToken = alice.reconnectToken;
    alice.close();

    const leftMessage = await bob.waitFor('player_left', (msg) => msg.id === alice.id);
    expect(leftMessage.hostId).toBe(bob.id);

    const reconnectedAlice = await reconnectToRoom(roomCode, reconnectToken, 'Alice');
    const reconnectedState = reconnectedAlice.lastRoomState;

    expect(reconnectedAlice.id).toBe(alice.id);
    expect(reconnectedAlice.reconnectToken).toBe(reconnectToken);
    expect(reconnectedState.hostId).toBe(bob.id);
    expect(reconnectedState.players).toEqual([
      { id: alice.id, nickname: 'Alice', connected: true },
      { id: bob.id, nickname: 'Bob', connected: true },
    ]);
    expect(reconnectedState.round).toMatchObject({
      mode: 'all',
      rolled: [alice.id],
      revealed: [],
      yourDice: [4, 4, 4, 2, 1],
    });
    expect(reconnectedState.round?.participants.map((participant) => participant.id)).toEqual([
      alice.id,
      bob.id,
    ]);

    const reconnectNotice = await bob.waitFor(
      'player_reconnected',
      (msg) => msg.id === alice.id,
    );
    expect(reconnectNotice.hostId).toBe(bob.id);

    mockDiceRolls([6, 6, 6, 6, 6]);
    await rollAndAssertPerspective(bob, [reconnectedAlice, bob], [6, 6, 6, 6, 6], true);

    reconnectedAlice.send({ type: 'reveal' });
    bob.send({ type: 'reveal' });

    const finalResults = await Promise.all([
      reconnectedAlice.waitFor('all_revealed'),
      bob.waitFor('all_revealed'),
    ]);

    for (const msg of finalResults) {
      expect(msg.results).toEqual([
        { id: alice.id, nickname: 'Alice', dice: [4, 4, 4, 2, 1] },
        { id: bob.id, nickname: 'Bob', dice: [6, 6, 6, 6, 6] },
      ]);
    }
  });

  it.each([
    {
      name: 'plain mixed dice without wilds or leopard bonus',
      dice: [
        [2, 3, 4, 5, 6],
        [2, 2, 3, 3, 4],
      ],
      expected: { wild: 0, 2: 3, 3: 3, 4: 2, 5: 1, 6: 1 },
    },
    {
      name: 'single wild one adds to every non-one number',
      dice: [[1, 2, 3, 4, 5]],
      expected: { wild: 1, 2: 2, 3: 2, 4: 2, 5: 2, 6: 1 },
    },
    {
      name: 'all ones count as wilds with extra wild bonus',
      dice: [[1, 1, 1, 1, 1]],
      expected: { wild: 7, 2: 7, 3: 7, 4: 7, 5: 7, 6: 7 },
    },
    {
      name: 'true leopard adds two to its number',
      dice: [[6, 6, 6, 6, 6]],
      expected: { wild: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 7 },
    },
    {
      name: 'leopard with wild dice adds one to its number',
      dice: [[1, 4, 4, 4, 4]],
      expected: { wild: 1, 2: 1, 3: 1, 4: 6, 5: 1, 6: 1 },
    },
    {
      name: 'multiple players combine wilds, all-ones bonus, leopard bonus, and plain dice',
      dice: [
        [1, 1, 1, 1, 1],
        [2, 2, 2, 1, 1],
        [3, 4, 5, 6, 2],
      ],
      expected: { wild: 9, 2: 14, 3: 10, 4: 10, 5: 10, 6: 10 },
    },
  ])('calculates dice totals for $name', ({ dice, expected }) => {
    expect(calculateDiceTotals(resultsFromDice(dice))).toEqual(expected);
  });
});

async function createRoom(): Promise<string> {
  const response = await worker.fetch(`${BASE_URL}/api/room/create`, {
    method: 'POST',
  });
  expect(response.status).toBe(200);

  const data = (await response.json()) as { code: string };
  expect(data.code).toMatch(/^\d{6}$/);
  return data.code;
}

async function joinRoom(roomCode: string, nickname: string): Promise<RoomClient> {
  const client = await connect(roomCode);
  client.send({ type: 'join', nickname });
  client.applyRoomState(await client.waitFor('room_state'));
  return client;
}

async function reconnectToRoom(
  roomCode: string,
  reconnectToken: string,
  nickname: string,
): Promise<RoomClient> {
  const client = await connect(roomCode);
  client.send({ type: 'reconnect', reconnectToken, nickname });
  client.applyRoomState(await client.waitFor('room_state'));
  return client;
}

async function connect(roomCode: string): Promise<RoomClient> {
  const response = await worker.fetch(`${BASE_URL}/ws/${roomCode}`, {
    headers: { Upgrade: 'websocket' },
  });
  expect(response.status).toBe(101);
  expect(response.webSocket).toBeDefined();

  const client = new RoomClient(response.webSocket!);
  openClients.push(client);
  return client;
}

async function rollAndAssertPerspective(
  roller: RoomClient,
  allPlayers: RoomClient[],
  dice: number[],
  allRolled: boolean,
): Promise<void> {
  const markers = new Map(allPlayers.map((client) => [client, client.mark()]));

  roller.send({ type: 'roll' });

  const [yourDice] = await Promise.all([
    roller.waitFor('your_dice', (msg) => sameDice(msg.dice, dice), markers.get(roller)),
    ...allPlayers.map((client) =>
      client.waitFor(
        'player_rolled',
        (msg) => msg.id === roller.id && msg.allRolled === allRolled,
        markers.get(client),
      ),
    ),
  ]);

  expect(yourDice.dice).toEqual(dice);

  for (const client of allPlayers) {
    const messages = client.messagesSince(markers.get(client)!);
    const diceMessages = messages.filter((msg) => msg.type === 'your_dice');
    expect(diceMessages).toHaveLength(client === roller ? 1 : 0);
  }
}

function mockDiceRolls(...rolls: number[][]): void {
  const randomValues = rolls.flat().map((die) => (die - 0.5) / 6);
  vi.spyOn(Math, 'random').mockImplementation(() => {
    const next = randomValues.shift();
    if (next === undefined) {
      throw new Error('No mocked dice values left for Math.random()');
    }
    return next;
  });
}

function calculateDiceTotals(results: RevealedResult[]): DiceTotals {
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  const leopardBonus = { 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  let wildBonus = 0;

  for (const result of results) {
    for (const die of result.dice) {
      counts[die as keyof typeof counts] += 1;
    }

    if (result.dice.length > 0 && result.dice.every((die) => die === 1)) {
      wildBonus += 2;
      continue;
    }

    const nonWildDice = result.dice.filter((die) => die !== 1);
    const leopardNumber = nonWildDice[0] as keyof typeof leopardBonus | undefined;
    const isLeopard = leopardNumber && nonWildDice.every((die) => die === leopardNumber);
    if (isLeopard) {
      const hasWildDice = result.dice.length !== nonWildDice.length;
      leopardBonus[leopardNumber] += hasWildDice ? 1 : 2;
    }
  }

  const wild = counts[1] + wildBonus;
  return {
    wild,
    2: counts[2] + wild + leopardBonus[2],
    3: counts[3] + wild + leopardBonus[3],
    4: counts[4] + wild + leopardBonus[4],
    5: counts[5] + wild + leopardBonus[5],
    6: counts[6] + wild + leopardBonus[6],
  };
}

function resultsFromDice(diceByPlayer: number[][]): RevealedResult[] {
  return diceByPlayer.map((dice, index) => ({
    id: `player-${index + 1}`,
    nickname: `Player ${index + 1}`,
    dice,
  }));
}

function sameDice(left: number[], right: number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

class RoomClient {
  readonly messages: ServerMessage[] = [];
  id = '';
  reconnectToken = '';
  hostId = '';
  players: PlayerSummary[] = [];
  lastRoomState!: Extract<ServerMessage, { type: 'room_state' }>;

  private readonly waiters: Array<{
    type: ServerMessage['type'];
    since: number;
    predicate: (message: ServerMessage) => boolean;
    resolve: (message: ServerMessage) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }> = [];

  constructor(private readonly socket: WebSocket) {
    socket.accept();
    socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return;
      const message = JSON.parse(event.data) as ServerMessage;
      this.messages.push(message);
      if (message.type === 'room_state') {
        this.applyRoomState(message);
      }
      this.resolveWaiters();
    });
  }

  send(message: ClientMessage): void {
    this.socket.send(JSON.stringify(message));
  }

  close(): void {
    if (
      this.socket.readyState === WebSocket.OPEN ||
      this.socket.readyState === WebSocket.CONNECTING
    ) {
      this.socket.close(1001, 'Test client closed');
    }
  }

  applyRoomState(message: Extract<ServerMessage, { type: 'room_state' }>): void {
    this.lastRoomState = message;
    this.id = message.you;
    this.reconnectToken = message.reconnectToken;
    this.hostId = message.hostId;
    this.players = message.players;
  }

  mark(): number {
    return this.messages.length;
  }

  messagesSince(mark: number): ServerMessage[] {
    return this.messages.slice(mark);
  }

  messagesOf<T extends ServerMessage['type']>(
    type: T,
  ): Array<Extract<ServerMessage, { type: T }>> {
    return this.messages.filter(
      (message): message is Extract<ServerMessage, { type: T }> => message.type === type,
    );
  }

  waitFor<T extends ServerMessage['type']>(
    type: T,
    predicate: (message: Extract<ServerMessage, { type: T }>) => boolean = () => true,
    since = 0,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    const existing = this.findMessage(type, predicate, since);
    if (existing) return Promise.resolve(existing);

    return new Promise((resolve, reject) => {
      const waiter = {
        type,
        since,
        predicate: predicate as (message: ServerMessage) => boolean,
        resolve: resolve as (message: ServerMessage) => void,
        reject,
        timeout: setTimeout(() => {
          this.removeWaiter(waiter);
          reject(new Error(`Timed out waiting for ${type}`));
        }, 2000),
      };
      this.waiters.push(waiter);
    });
  }

  private findMessage<T extends ServerMessage['type']>(
    type: T,
    predicate: (message: Extract<ServerMessage, { type: T }>) => boolean,
    since: number,
  ): Extract<ServerMessage, { type: T }> | undefined {
    return this.messages
      .slice(since)
      .find(
        (message): message is Extract<ServerMessage, { type: T }> =>
          message.type === type && predicate(message as Extract<ServerMessage, { type: T }>),
      );
  }

  private resolveWaiters(): void {
    for (const waiter of [...this.waiters]) {
      const message = this.messages
        .slice(waiter.since)
        .find((candidate) => candidate.type === waiter.type && waiter.predicate(candidate));
      if (!message) continue;

      clearTimeout(waiter.timeout);
      this.removeWaiter(waiter);
      waiter.resolve(message);
    }
  }

  private removeWaiter(waiter: (typeof this.waiters)[number]): void {
    const index = this.waiters.indexOf(waiter);
    if (index !== -1) this.waiters.splice(index, 1);
  }
}
