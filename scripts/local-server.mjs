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

// Mock Neon DB Orders & Users
const orders = [];
const users = [
  {
    userId: 'user-demo-01',
    fullName: 'Nguyễn Văn An',
    email: 'user-demo-01@polyflash.vn',
    phone: '0901234567',
    address: 'Quận 1, TP. Hồ Chí Minh',
    role: 'USER',
    createdAt: '2026-11-10T08:00:00Z',
  },
  {
    userId: 'admin',
    fullName: 'Quản Trị Viên',
    email: 'admin@polyflash.vn',
    phone: '0909999999',
    address: 'Quận 3, TP. Hồ Chí Minh',
    role: 'ADMIN',
    createdAt: '2026-11-01T08:00:00Z',
  },
];

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

  // Serve static files from frontend/
  if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
    const reqFile = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
    const frontendDir = path.resolve(__dirname, '../frontend');
    const filePath = path.resolve(frontendDir, reqFile);
    if (filePath.startsWith(frontendDir) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath);
      const mimeTypes = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
      };
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      res.end(fs.readFileSync(filePath));
      return;
    }
  }

  // Normalize /api/v1 prefix so both /api/v1/* and legacy paths work
  const apiPath = url.pathname.replace(/^\/api\/v1/, '');

  // Auth: Mock Cognito Login / Register
  if (req.method === 'POST' && (apiPath === '/auth/login' || apiPath === '/auth/register')) {
    const { email, fullName = '', phone = '', address = '' } = await readBody(req);
    const cleanEmail = email || 'user-demo-01@polyflash.vn';
    const userId = cleanEmail.split('@')[0];
    let user = users.find((u) => u.userId === userId || u.email === cleanEmail);

    if (!user) {
      user = {
        userId,
        fullName: fullName || userId,
        email: cleanEmail,
        phone,
        address,
        role: 'USER',
        createdAt: new Date().toISOString(),
      };
      users.push(user);
    } else if (url.pathname === '/auth/register') {
      if (fullName) user.fullName = fullName;
      if (phone) user.phone = phone;
      if (address) user.address = address;
    }

    const fakeJwt = Buffer.from(JSON.stringify({ sub: user.userId, email: user.email, iat: Date.now() })).toString('base64url');
    return sendJson(res, 200, {
      token: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${fakeJwt}.mock-cognito-sig`,
      user,
    });
  }

  // User Profile: Update personal info
  if (req.method === 'PUT' && apiPath === '/users/profile') {
    const { userId, fullName, email, phone, address } = await readBody(req);
    let user = users.find((u) => u.userId === userId);
    if (!user) {
      user = {
        userId: userId || (email ? email.split('@')[0] : 'user-demo-01'),
        fullName: fullName || '',
        email: email || '',
        phone: phone || '',
        address: address || '',
        role: 'USER',
        createdAt: new Date().toISOString(),
      };
      users.push(user);
    } else {
      if (fullName !== undefined) user.fullName = fullName;
      if (email !== undefined) user.email = email;
      if (phone !== undefined) user.phone = phone;
      if (address !== undefined) user.address = address;
    }
    return sendJson(res, 200, { user });
  }

  // Admin: Create event
  if (req.method === 'POST' && apiPath === '/admin/events') {
    const { name, venue, startTime, saleStatus = 'OPEN' } = await readBody(req);
    const newEvent = {
      id: crypto.randomUUID(),
      name: name || 'Sự kiện mới',
      venue: venue || 'TP. Hồ Chí Minh',
      startTime: startTime || new Date(Date.now() + 86400000 * 7).toISOString(),
      saleStatus,
      bannerColor: 'linear-gradient(135deg, #7B9669, #404E3B)',
    };
    events.unshift(newEvent);
    return sendJson(res, 201, { event: newEvent });
  }

  // Admin: Update event status
  const adminEventMatch = apiPath.match(/^\/admin\/events\/([^/]+)$/);
  if (req.method === 'PATCH' && adminEventMatch) {
    const ev = events.find((e) => e.id === adminEventMatch[1]);
    if (!ev) return sendJson(res, 404, { error: 'Event not found' });
    const { saleStatus } = await readBody(req);
    if (saleStatus) ev.saleStatus = saleStatus;
    return sendJson(res, 200, { event: ev });
  }

  // Admin: List users & orders
  if (req.method === 'GET' && apiPath === '/admin/overview') {
    const totalRevenue = orders.reduce((sum, o) => sum + o.amount, 0);
    return sendJson(res, 200, {
      stats: { totalEvents: events.length, totalUsers: users.length, totalOrders: orders.length, totalRevenue },
      users,
      orders,
    });
  }

  // GET /api/v1/events
  if (req.method === 'GET' && apiPath === '/events') {
    return sendJson(res, 200, { events });
  }

  // GET /api/v1/events/:eventId/seats
  if (req.method === 'GET' && /^\/events\/[^/]+\/seats$/.test(apiPath)) {
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

  // POST /api/v1/events/:eventId/seats/:seatId/hold
  const holdMatch = apiPath.match(/^\/events\/([^/]+)\/seats\/([^/]+)\/hold$/);
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

  // POST /api/v1/events/:eventId/seats/:seatId/release
  const releaseMatch = apiPath.match(/^\/events\/([^/]+)\/seats\/([^/]+)\/release$/);
  if (req.method === 'POST' && releaseMatch) {
    const [, eventId, seatId] = releaseMatch;
    const seat = seats.get(seatId);
    const { userId = 'anonymous' } = await readBody(req);

    if (!seat) return sendJson(res, 404, { error: 'Seat not found' });
    if (seat.status === 'HELD' && seat.heldBy === userId) {
      seat.status = 'AVAILABLE';
      seat.heldBy = null;
      seat.ttl = null;
    }

    return sendJson(res, 200, { message: 'Seat released', eventId, seatId });
  }

  // POST /api/v1/events/:eventId/seats/:seatId/pay
  const payMatch = apiPath.match(/^\/events\/([^/]+)\/seats\/([^/]+)\/pay$/);
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

  // GET /api/v1/tickets
  if (req.method === 'GET' && apiPath === '/tickets') {
    const userId = url.searchParams.get('userId');
    const filtered = userId ? orders.filter((o) => o.userId === userId) : orders;
    return sendJson(res, 200, { tickets: filtered });
  }

  return sendJson(res, 404, { error: 'Not found' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 PolyFlash local web running at http://localhost:${PORT}`);
});
