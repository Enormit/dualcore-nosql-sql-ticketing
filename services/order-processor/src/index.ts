import type { SQSBatchResponse, SQSEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { Pool } from 'pg';

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

const TABLE_NAME = process.env.DYNAMODB_TABLE_SEATS ?? 'EventSeats';
const POOLED_URL = process.env.NEON_DATABASE_POOLED_URL ?? '';

const pool = new Pool({
  connectionString: POOLED_URL,
  max: 5,
  ssl: { rejectUnauthorized: true },
});

interface OrderPayload {
  eventId: string;
  seatId: string;
  userId: string;
  price: number;
  requestId?: string;
}

function log(level: 'INFO' | 'ERROR', message: string, meta: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ level, service: 'order-processor', message, ...meta }));
}

async function processSingleOrder(payload: OrderPayload): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const orderRes = await client.query<{ id: string }>(
      `INSERT INTO orders (user_id, event_id, status, total_amount)
       VALUES ($1, $2, 'COMPLETED', $3)
       RETURNING id`,
      [payload.userId, payload.eventId, payload.price]
    );
    const orderId = orderRes.rows[0].id;

    await client.query(
      `INSERT INTO tickets (order_id, event_id, seat_id, price)
       VALUES ($1, $2, $3, $4)`,
      [orderId, payload.eventId, payload.seatId, payload.price]
    );

    const txRef = `tx_${payload.eventId}_${payload.seatId}_${Date.now()}`;
    await client.query(
      `INSERT INTO payments (order_id, amount, status, transaction_ref)
       VALUES ($1, $2, 'SUCCESS', $3)`,
      [orderId, payload.price, txRef]
    );

    await client.query('COMMIT');

    // Sync seat status to SOLD and remove TTL in DynamoDB
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `EVENT#${payload.eventId}`,
          SK: `SEAT#${payload.seatId}`,
        },
        UpdateExpression: 'SET #status = :sold, updated_at = :nowIso REMOVE #ttl',
        ConditionExpression: '#status = :held AND held_by = :userId',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#ttl': 'ttl',
        },
        ExpressionAttributeValues: {
          ':sold': 'SOLD',
          ':held': 'HELD',
          ':userId': payload.userId,
          ':nowIso': new Date().toISOString(),
        },
      })
    );
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const batchItemFailures: SQSBatchResponse['batchItemFailures'] = [];

  for (const record of event.Records) {
    const start = Date.now();
    try {
      const payload = JSON.parse(record.body) as OrderPayload;
      await processSingleOrder(payload);

      log('INFO', 'Order processed successfully', {
        messageId: record.messageId,
        requestId: payload.requestId,
        eventId: payload.eventId,
        seatId: payload.seatId,
        userId: payload.userId,
        durationMs: Date.now() - start,
      });
    } catch (err) {
      log('ERROR', 'Failed to process order record', {
        messageId: record.messageId,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      });

      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
}
