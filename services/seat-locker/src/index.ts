import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient, ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);
const sqsClient = new SQSClient({});

const TABLE_NAME = process.env.DYNAMODB_TABLE_SEATS ?? 'EventSeats';
const QUEUE_URL = process.env.SQS_ORDER_QUEUE_URL ?? '';
const HOLD_TTL_SECONDS = Number(process.env.SEAT_HOLD_TTL_SECONDS ?? '300');

function log(level: 'INFO' | 'WARN' | 'ERROR', message: string, meta: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ level, service: 'seat-locker', message, ...meta }));
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const start = Date.now();
  const requestId = event.requestContext.requestId;
  const eventId = event.pathParameters?.eventId;
  const seatId = event.pathParameters?.seatId;

  let userId = 'anonymous';
  let price = 0;
  try {
    if (event.body) {
      const parsed = JSON.parse(event.body);
      userId = parsed.userId ?? userId;
      price = Number(parsed.price ?? 0);
    }
  } catch {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid JSON body' }),
    };
  }

  if (!eventId || !seatId) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Missing eventId or seatId path parameter' }),
    };
  }

  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + HOLD_TTL_SECONDS;

  try {
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `EVENT#${eventId}`,
          SK: `SEAT#${seatId}`,
        },
        UpdateExpression: 'SET #status = :held, held_by = :userId, #ttl = :ttl, updated_at = :nowIso',
        ConditionExpression:
          'attribute_not_exists(PK) OR #status = :available OR (#status = :held AND #ttl < :now)',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#ttl': 'ttl',
        },
        ExpressionAttributeValues: {
          ':held': 'HELD',
          ':available': 'AVAILABLE',
          ':userId': userId,
          ':ttl': expiresAt,
          ':now': now,
          ':nowIso': new Date().toISOString(),
        },
      })
    );

    if (QUEUE_URL) {
      await sqsClient.send(
        new SendMessageCommand({
          QueueUrl: QUEUE_URL,
          MessageGroupId: seatId,
          MessageDeduplicationId: `${eventId}_${seatId}_${userId}_${now}`,
          MessageBody: JSON.stringify({
            eventId,
            seatId,
            userId,
            price,
            heldAt: now,
            expiresAt,
            requestId,
          }),
        })
      );
    }

    log('INFO', 'Seat held and queued for order processing', {
      requestId,
      eventId,
      seatId,
      userId,
      durationMs: Date.now() - start,
    });

    return {
      statusCode: 202,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Seat held, order is processing',
        eventId,
        seatId,
        holdExpiresAt: expiresAt,
      }),
    };
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      log('WARN', 'Seat lock conflict', {
        requestId,
        eventId,
        seatId,
        userId,
        durationMs: Date.now() - start,
      });

      return {
        statusCode: 409,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Seat is already held or sold' }),
      };
    }

    log('ERROR', 'Failed to lock seat', {
      requestId,
      eventId,
      seatId,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    });

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
}
