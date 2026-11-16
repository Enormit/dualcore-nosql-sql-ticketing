import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import crypto from 'node:crypto';

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

const TABLE_NAME = process.env.DYNAMODB_TABLE_SEATS ?? 'EventSeats';

function log(level: 'INFO' | 'ERROR', message: string, meta: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ level, service: 'seat-reader', message, ...meta }));
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const start = Date.now();
  const requestId = event.requestContext.requestId;
  const eventId = event.pathParameters?.eventId;

  if (!eventId) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Missing eventId path parameter' }),
    };
  }

  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: {
          ':pk': `EVENT#${eventId}`,
        },
      })
    );

    const now = Math.floor(Date.now() / 1000);
    const seats = (result.Items ?? []).map((item) => {
      const isExpiredHold = item.status === 'HELD' && typeof item.ttl === 'number' && item.ttl < now;
      return {
        seatId: String(item.SK).replace(/^SEAT#/, ''),
        status: isExpiredHold ? 'AVAILABLE' : item.status,
        price: item.price,
      };
    });

    const payload = JSON.stringify({ eventId, seats });
    const etag = `"${crypto.createHash('md5').update(payload).digest('hex')}"`;

    log('INFO', 'Fetched event seats', {
      requestId,
      eventId,
      seatCount: seats.length,
      durationMs: Date.now() - start,
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'max-age=1, stale-while-revalidate=2',
        ETag: etag,
      },
      body: payload,
    };
  } catch (err) {
    log('ERROR', 'Failed to query seats', {
      requestId,
      eventId,
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
