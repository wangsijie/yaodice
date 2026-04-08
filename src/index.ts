import { Hono } from 'hono';
import { GameRoom } from './game-room';

export { GameRoom };

type Bindings = {
  GAME_ROOM: DurableObjectNamespace;
  ASSETS: Fetcher;
};

const app = new Hono<{ Bindings: Bindings }>();

// Create a new room
app.post('/api/room/create', async (c) => {
  const code = generateRoomCode();
  const id = c.env.GAME_ROOM.idFromName(code);
  const stub = c.env.GAME_ROOM.get(id);
  // Initialize the room
  await stub.fetch(new Request('http://internal/init', {
    method: 'POST',
    body: JSON.stringify({ code }),
  }));
  return c.json({ code });
});

// Check if room exists
app.get('/api/room/:code', async (c) => {
  const code = c.req.param('code');
  if (!/^\d{6}$/.test(code)) {
    return c.json({ error: 'Invalid room code' }, 400);
  }
  const id = c.env.GAME_ROOM.idFromName(code);
  const stub = c.env.GAME_ROOM.get(id);
  const res = await stub.fetch(new Request('http://internal/info'));
  const data = await res.json() as { exists: boolean; playerCount: number };
  return c.json(data);
});

// WebSocket connection
app.get('/ws/:code', async (c) => {
  const code = c.req.param('code');
  if (!/^\d{6}$/.test(code)) {
    return c.text('Invalid room code', 400);
  }
  const upgradeHeader = c.req.header('Upgrade');
  if (upgradeHeader !== 'websocket') {
    return c.text('Expected WebSocket', 426);
  }
  const id = c.env.GAME_ROOM.idFromName(code);
  const stub = c.env.GAME_ROOM.get(id);
  return stub.fetch(c.req.raw);
});

// Fallback to static assets
app.get('*', async (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

function generateRoomCode(): string {
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  return code;
}

export default app;
