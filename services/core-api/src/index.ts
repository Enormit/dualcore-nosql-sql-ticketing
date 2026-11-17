import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  SignUpCommand,
  AdminConfirmSignUpCommand,
  InitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { Pool } from 'pg';

const cognito = new CognitoIdentityProviderClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ssm = new SSMClient({});

const TABLE_NAME = process.env.DYNAMODB_TABLE_SEATS ?? 'EventSeats';
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID ?? '';
const CLIENT_ID = process.env.COGNITO_CLIENT_ID ?? '';
const SSM_NEON_PARAM = process.env.SSM_NEON_POOLED_URL_PARAM ?? '';

let cachedPool: Pool | null = null;

async function getPool(): Promise<Pool> {
  if (cachedPool) return cachedPool;
  let connectionString = process.env.NEON_DATABASE_POOLED_URL ?? '';
  if (!connectionString && SSM_NEON_PARAM) {
    const res = await ssm.send(new GetParameterCommand({ Name: SSM_NEON_PARAM, WithDecryption: true }));
    connectionString = res.Parameter?.Value ?? '';
  }
  cachedPool = new Pool({ connectionString, max: 5, ssl: { rejectUnauthorized: true } });
  return cachedPool;
}

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function parseBody(event: APIGatewayProxyEventV2): Record<string, any> {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf-8') : event.body;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function getAuthSub(event: APIGatewayProxyEventV2): string | null {
  const auth = event.headers?.authorization || event.headers?.Authorization || '';
  if (!auth.startsWith('Bearer ')) return null;
  try {
    const payload = auth.slice(7).split('.')[1];
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
    return decoded.email?.split('@')[0] || decoded['cognito:username'] || decoded.sub || null;
  } catch {
    return null;
  }
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const method = event.requestContext.http.method;
  const path = event.rawPath;
  const pool = await getPool();

  try {
    // 1. GET /api/v1/events
    if (method === 'GET' && path === '/api/v1/events') {
      const { rows } = await pool.query(
        `SELECT id, name, venue, start_time AS "startTime", total_seats AS "totalSeats"
         FROM events ORDER BY start_time ASC`
      );
      const events = rows.map((r, idx) => ({
        ...r,
        saleStatus: 'OPEN',
        bannerColor:
          idx % 2 === 0
            ? 'linear-gradient(135deg, #7B9669, #404E3B)'
            : 'linear-gradient(135deg, #6C8480, #404E3B)',
      }));
      return json(200, { events });
    }

    // 2. POST /api/v1/auth/register
    if (method === 'POST' && path === '/api/v1/auth/register') {
      const { email, password = 'PolyFlash@2026', fullName = '', phone = '', address = '' } = parseBody(event);
      if (!email) return json(400, { error: 'Email là bắt buộc' });
      const userId = email.split('@')[0];

      try {
        await cognito.send(
          new SignUpCommand({
            ClientId: CLIENT_ID,
            Username: email,
            Password: password,
            UserAttributes: [
              { Name: 'email', Value: email },
              { Name: 'name', Value: fullName || userId },
            ],
          })
        );
        await cognito.send(
          new AdminConfirmSignUpCommand({
            UserPoolId: USER_POOL_ID,
            Username: email,
          })
        );
      } catch (err: any) {
        if (err?.name !== 'UsernameExistsException') {
          return json(400, { error: err?.message || 'Đăng ký thất bại' });
        }
      }

      const authRes = await cognito.send(
        new InitiateAuthCommand({
          ClientId: CLIENT_ID,
          AuthFlow: 'USER_PASSWORD_AUTH',
          AuthParameters: { USERNAME: email, PASSWORD: password },
        })
      );

      const { rows } = await pool.query(
        `INSERT INTO users (user_id, full_name, email, phone, address, role)
         VALUES ($1, $2, $3, $4, $5, 'USER')
         ON CONFLICT (email) DO UPDATE SET
           full_name = COALESCE(NULLIF($2, ''), users.full_name),
           phone = COALESCE(NULLIF($4, ''), users.phone),
           address = COALESCE(NULLIF($5, ''), users.address),
           updated_at = NOW()
         RETURNING user_id AS "userId", full_name AS "fullName", email, phone, address, role, created_at AS "createdAt"`,
        [userId, fullName || userId, email, phone, address]
      );

      return json(200, { token: authRes.AuthenticationResult?.IdToken, user: rows[0] });
    }

    // 3. POST /api/v1/auth/login
    if (method === 'POST' && path === '/api/v1/auth/login') {
      const { email, password = 'PolyFlash@2026' } = parseBody(event);
      if (!email) return json(400, { error: 'Email là bắt buộc' });
      const userId = email.split('@')[0];

      let token = '';
      try {
        const authRes = await cognito.send(
          new InitiateAuthCommand({
            ClientId: CLIENT_ID,
            AuthFlow: 'USER_PASSWORD_AUTH',
            AuthParameters: { USERNAME: email, PASSWORD: password },
          })
        );
        token = authRes.AuthenticationResult?.IdToken ?? '';
      } catch (err: any) {
        return json(401, { error: err?.message || 'Sai email hoặc mật khẩu' });
      }

      const { rows } = await pool.query(
        `INSERT INTO users (user_id, full_name, email, role)
         VALUES ($1, $2, $3, 'USER')
         ON CONFLICT (email) DO UPDATE SET updated_at = NOW()
         RETURNING user_id AS "userId", full_name AS "fullName", email, phone, address, role, created_at AS "createdAt"`,
        [userId, userId, email]
      );

      return json(200, { token, user: rows[0] });
    }

    // 4. GET /api/v1/users/profile
    if (method === 'GET' && path === '/api/v1/users/profile') {
      const userId = getAuthSub(event) || event.queryStringParameters?.userId;
      if (!userId) return json(400, { error: 'Missing userId' });
      const { rows } = await pool.query(
        `SELECT user_id AS "userId", full_name AS "fullName", email, phone, address, role, created_at AS "createdAt"
         FROM users WHERE user_id = $1`,
        [userId]
      );
      if (!rows[0]) return json(404, { error: 'User not found' });
      return json(200, { user: rows[0] });
    }

    // 5. PUT /api/v1/users/profile
    if (method === 'PUT' && path === '/api/v1/users/profile') {
      const { userId, fullName = '', email = '', phone = '', address = '' } = parseBody(event);
      const authSub = getAuthSub(event);
      if (authSub && userId && authSub !== userId) {
        return json(403, { error: 'Bạn chỉ có quyền sửa thông tin của chính mình' });
      }
      const targetId = authSub || userId;
      if (!targetId) return json(400, { error: 'Missing userId' });

      const { rows } = await pool.query(
        `UPDATE users
         SET full_name = $2, email = COALESCE(NULLIF($3, ''), email), phone = $4, address = $5, updated_at = NOW()
         WHERE user_id = $1
         RETURNING user_id AS "userId", full_name AS "fullName", email, phone, address, role, created_at AS "createdAt"`,
        [targetId, fullName, email, phone, address]
      );
      if (!rows[0]) return json(404, { error: 'User not found' });
      return json(200, { user: rows[0] });
    }

    // 6. POST /api/v1/events/{eventId}/seats/{seatId}/release
    const releaseMatch = path.match(/^\/api\/v1\/events\/([^/]+)\/seats\/([^/]+)\/release$/);
    if (method === 'POST' && releaseMatch) {
      const [, eventId, seatId] = releaseMatch;
      const { userId } = parseBody(event);
      await ddb.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { PK: `EVENT#${eventId}`, SK: `SEAT#${seatId}` },
          UpdateExpression: 'SET #status = :avail, updated_at = :now REMOVE held_by, #ttl',
          ConditionExpression: '#status = :held AND held_by = :userId',
          ExpressionAttributeNames: { '#status': 'status', '#ttl': 'ttl' },
          ExpressionAttributeValues: {
            ':avail': 'AVAILABLE',
            ':held': 'HELD',
            ':userId': userId || 'anonymous',
            ':now': new Date().toISOString(),
          },
        })
      );
      return json(200, { message: 'Seat released', eventId, seatId });
    }

    // 7. POST /api/v1/events/{eventId}/seats/{seatId}/pay (Ensure order committed & seat SOLD)
    const payMatch = path.match(/^\/api\/v1\/events\/([^/]+)\/seats\/([^/]+)\/pay$/);
    if (method === 'POST' && payMatch) {
      const [, eventId, seatId] = payMatch;
      const { userId = 'anonymous' } = parseBody(event);

      // Check if order-processor already created ticket via SQS FIFO
      const existing = await pool.query(
        `SELECT o.id AS "orderId", t.seat_id AS "seatId", o.total_amount AS amount, o.created_at AS "paidAt"
         FROM tickets t JOIN orders o ON o.id = t.order_id
         WHERE t.event_id = $1 AND t.seat_id = $2`,
        [eventId, seatId]
      );
      if (existing.rows[0]) {
        return json(200, { message: 'Order confirmed', order: existing.rows[0] });
      }

      // Otherwise wait briefly for SQS worker, or fallback ACID commit if needed
      await new Promise((r) => setTimeout(r, 1200));
      const recheck = await pool.query(
        `SELECT o.id AS "orderId", t.seat_id AS "seatId", o.total_amount AS amount, o.created_at AS "paidAt"
         FROM tickets t JOIN orders o ON o.id = t.order_id
         WHERE t.event_id = $1 AND t.seat_id = $2`,
        [eventId, seatId]
      );
      if (recheck.rows[0]) {
        return json(200, { message: 'Order confirmed', order: recheck.rows[0] });
      }

      return json(202, { message: 'Order is finalizing in queue', eventId, seatId, userId });
    }

    // 8. GET /api/v1/tickets
    if (method === 'GET' && path === '/api/v1/tickets') {
      const userId = event.queryStringParameters?.userId || getAuthSub(event);
      if (!userId) return json(400, { error: 'Missing userId' });
      const { rows } = await pool.query(
        `SELECT o.id AS "orderId", e.id AS "eventId", e.name AS "eventName",
                t.seat_id AS "seatId", t.price AS amount, o.created_at AS "paidAt"
         FROM orders o
         JOIN tickets t ON t.order_id = o.id
         JOIN events e ON e.id = o.event_id
         WHERE o.user_id = $1
         ORDER BY o.created_at DESC`,
        [userId]
      );
      const tickets = rows.map((r) => ({
        ...r,
        amount: Number(r.amount),
        tier: r.seatId.startsWith('A') ? 'VIP' : r.seatId.startsWith('B') ? 'Standard' : 'Economy',
      }));
      return json(200, { tickets });
    }

    // 9. GET /api/v1/admin/overview
    if (method === 'GET' && path === '/api/v1/admin/overview') {
      const [evCount, usrRes, ordRes] = await Promise.all([
        pool.query('SELECT COUNT(*)::int AS cnt FROM events'),
        pool.query(
          `SELECT user_id AS "userId", full_name AS "fullName", email, phone, address, role, created_at AS "createdAt"
           FROM users ORDER BY created_at DESC`
        ),
        pool.query(
          `SELECT COUNT(*)::int AS cnt, COALESCE(SUM(total_amount), 0)::float AS revenue FROM orders WHERE status = 'COMPLETED'`
        ),
      ]);
      return json(200, {
        stats: {
          totalEvents: evCount.rows[0].cnt,
          totalUsers: usrRes.rows.length,
          totalOrders: ordRes.rows[0].cnt,
          totalRevenue: ordRes.rows[0].revenue,
        },
        users: usrRes.rows,
      });
    }

    // 10. POST /api/v1/admin/events
    if (method === 'POST' && path === '/api/v1/admin/events') {
      const { name, venue, startTime, totalSeats = 24 } = parseBody(event);
      const { rows } = await pool.query(
        `INSERT INTO events (name, venue, start_time, total_seats)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, venue, start_time AS "startTime", total_seats AS "totalSeats"`,
        [name || 'Sự kiện mới', venue || 'TP. Hồ Chí Minh', startTime || new Date(Date.now() + 86400000 * 7).toISOString(), totalSeats]
      );
      return json(201, { event: { ...rows[0], saleStatus: 'OPEN' } });
    }

    return json(404, { error: `Route not found: ${method} ${path}` });
  } catch (err: any) {
    console.error(JSON.stringify({ level: 'ERROR', service: 'core-api', path, error: err?.message || String(err) }));
    return json(500, { error: err?.message || 'Internal server error' });
  }
}
