import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT ?? 3000);

// In-memory mock DynamoDB for local development
const seats = new Map();
const rows = ['A', 'B', 'C'];
for (const row of rows) {
  for (let i = 1; i <= 8; i++) {
    const seatId = `${row}-0${i}`;
    seats.set(seatId, {
      seatId,
      status: 'AVAILABLE',
      price: row === 'A' ? 1200000 : row === 'B' ? 800000 : 500000,
      heldBy: null,
      ttl: null,
    });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  // Serve frontend
  if (req.method === 'GET' && url.pathname === '/') {
    const html = fs.readFileSync(path.resolve(__dirname, '../frontend/index.html'), 'utf-8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
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
      return { seatId: s.seatId, status: s.status, price: s.price };
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ seats: list }));
    return;
  }

  // POST /events/:eventId/seats/:seatId/hold
  const holdMatch = url.pathname.match(/^\/events\/[^/]+\/seats\/([^/]+)\/hold$/);
  if (req.method === 'POST' && holdMatch) {
    const seatId = holdMatch[1];
    const seat = seats.get(seatId);

    let body = '';
    for await (const chunk of req) body += chunk;
    const parsed = body ? JSON.parse(body) : {};
    const userId = parsed.userId ?? 'anonymous';

    const now = Math.floor(Date.now() / 1000);
    if (!seat) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Seat not found' }));
      return;
    }

    if (seat.status === 'SOLD' || (seat.status === 'HELD' && seat.ttl && seat.ttl >= now)) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Seat is already held or sold' }));
      return;
    }

    seat.status = 'HELD';
    seat.heldBy = userId;
    seat.ttl = now + 300;

    // Simulate async Order Processor Worker finishing after 2s
    setTimeout(() => {
      if (seat.status === 'HELD' && seat.heldBy === userId) {
        seat.status = 'SOLD';
        seat.ttl = null;
      }
    }, 2000);

    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Seat held, order is processing', seatId, holdExpiresAt: seat.ttl }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`🚀 PolyFlash local web running at http://localhost:${PORT}`);
});
