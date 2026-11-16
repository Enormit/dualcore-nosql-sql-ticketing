import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT ?? 3000);

// Mock Events (Neon DB)
const events = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'PolyFlash Live Concert 2026',
    venue: 'Saigon Exhibition & Convention Center (SECC)',
    startTime: '2026-12-20T19:30:00+07:00',
    saleStatus: 'OPEN',
    bannerColor: 'linear-gradient(135deg, #4f46e5, #ec4899)',
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    name: 'Vietnam Cloud & DevSecOps Summit',
    venue: 'National Convention Center, Hà Nội',
    startTime: '2027-01-15T08:30:00+07:00',
    saleStatus: 'UPCOMING',
    countdownSeconds: 3600,
    bannerColor: 'linear-gradient(135deg, #0ea5e9, #10b981)',
  },
];

// Mock DynamoDB EventSeats
const seats = new Map();
const rows = ['A', 'B', 'C'];
for (const row of rows) {
  for (let i = 1; i <= 8; i++) {
    const seatId = `${row}-0${i}`;
    seats.set(seatId, {
      seatId,
      tier: row === 'A' ? 'VIP' : row === 'B' ? 'Standard' : 'Economy',
      status: 'AVAILABLE',
      price: row === 'A' ? 1200000 : row === 'B' ? 800000 : 500000,
      heldBy: null,
      ttl: null,
    });
  }
}

// Mock Neon DB Orders & Payments
const orders = [];

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  // Serve Frontend SPA
  if (req.method === 'GET' && url.pathname === '/') {
    const html = fs.readFileSync(path.resolve(__dirname, '../frontend/index.html'), 'utf-8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  // Auth: Mock Cognito Login / Register
  if (req.method === 'POST' && (url.pathname === '/auth/login' || url.pathname === '/auth/register')) {
    const { email } = await readBody(req);
    const userId = email ? email.split('@')[0] : 'user-demo-01';
    const fakeJwt = Buffer.from(JSON.stringify({ sub: userId, email: email || `${userId}@polyflash.vn`, iat: Date.now() })).toString('base64url');
    return sendJson(res, 200, {
      token: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${fakeJwt}.mock-cognito-sig`,
      user: { userId, email: email || `${userId}@polyflash.vn` },
    });
  }

  // GET /events
  if (req.method === 'GET' && url.pathname === '/events') {
    return sendJson(res, 200, { events });
  }

  // GET /events/:eventId/seats
  if (req.method === 'GET' && /^\/events\/[^/]+\/seats$/.test(url.pathname)) {
    const now = Math.floor(Date.now() / 1000);
    const list = Array.from(seats.values()).map((s) => {
      if (s.status === 'HELD' && s.ttl && s.ttl < now) {
        s.status = 'AVAILABLE';
        s.heldBy = null;
        s.ttl = null;
      }
      return { seatId: s.seatId, tier: s.tier, status: s.status, price: s.price, ttl: s.ttl };
    });
    return sendJson(res, 200, { seats: list });
  }

  // POST /events/:eventId/seats/:seatId/hold (Seat Locker -> DynamoDB Conditional Write)
  const holdMatch = url.pathname.match(/^\/events\/([^/]+)\/seats\/([^/]+)\/hold$/);
  if (req.method === 'POST' && holdMatch) {
    const [, eventId, seatId] = holdMatch;
    const seat = seats.get(seatId);
    const { userId = 'anonymous' } = await readBody(req);
    const now = Math.floor(Date.now() / 1000);

    if (!seat) return sendJson(res, 404, { error: 'Seat not found' });
    if (seat.status === 'SOLD' || (seat.status === 'HELD' && seat.ttl && seat.ttl >= now)) {
      return sendJson(res, 409, { error: 'Seat is already held or sold' });
    }

    seat.status = 'HELD';
    seat.heldBy = userId;
    seat.ttl = now + 300; // 5 minutes TTL

    return sendJson(res, 202, {
      message: 'Seat held in DynamoDB',
      eventId,
      seatId,
      price: seat.price,
      holdExpiresAt: seat.ttl,
    });
  }

  // POST /events/:eventId/seats/:seatId/pay (SQS FIFO -> Order Processor -> Neon DB ACID)
  const payMatch = url.pathname.match(/^\/events\/([^/]+)\/seats\/([^/]+)\/pay$/);
  if (req.method === 'POST' && payMatch) {
    const [, eventId, seatId] = payMatch;
    const seat = seats.get(seatId);
    const { userId = 'anonymous' } = await readBody(req);
    const now = Math.floor(Date.now() / 1000);

    if (!seat) return sendJson(res, 404, { error: 'Seat not found' });
    if (seat.status !== 'HELD' || seat.heldBy !== userId || (seat.ttl && seat.ttl < now)) {
      return sendJson(res, 409, { error: 'Hold expired or seat not held by you' });
    }

    // Simulate SQS FIFO -> Order Processor Worker latency (1.2s)
    await new Promise((r) => setTimeout(r, 1200));

    seat.status = 'SOLD';
    seat.ttl = null;

    const order = {
      orderId: `ORD-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
      eventId,
      eventName: events.find((e) => e.id === eventId)?.name ?? 'PolyFlash Event',
      seatId,
      tier: seat.tier,
      userId,
      amount: seat.price,
      transactionRef: `TXN-${Date.now()}`,
      paidAt: new Date().toISOString(),
    };
    orders.unshift(order);

    return sendJson(res, 200, { message: 'Order committed to Neon PostgreSQL', order });
  }

  // GET /tickets (My Tickets from Neon DB)
  if (req.method === 'GET' && url.pathname === '/tickets') {
    const userId = url.searchParams.get('userId');
    const filtered = userId ? orders.filter((o) => o.userId === userId) : orders;
    return sendJson(res, 200, { tickets: filtered });
  }

  return sendJson(res, 404, { error: 'Not found' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 PolyFlash local web running at http://localhost:${PORT}`);
});
