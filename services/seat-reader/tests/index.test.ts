import test from 'node:test';
import assert from 'node:assert/strict';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { handler } from '../src/index.js';

function makeEvent(eventId?: string): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: 'GET /events/{eventId}/seats',
    rawPath: `/events/${eventId ?? ''}/seats`,
    rawQueryString: '',
    headers: {},
    requestContext: {
      accountId: '123456789012',
      apiId: 'api-id',
      domainName: 'example.com',
      domainPrefix: 'api',
      http: {
        method: 'GET',
        path: `/events/${eventId ?? ''}/seats`,
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'node-test',
      },
      requestId: 'req-123',
      routeKey: 'GET /events/{eventId}/seats',
      stage: '$default',
      time: '16/Nov/2026:15:00:00 +0000',
      timeEpoch: 1794841200000,
    },
    pathParameters: eventId ? { eventId } : undefined,
    isBase64Encoded: false,
  };
}

test('seat-reader returns 400 when eventId is missing', async () => {
  const res = await handler(makeEvent());
  assert.equal(typeof res, 'object');
  if (typeof res === 'object') {
    assert.equal(res.statusCode, 400);
  }
});

test('seat-reader returns 200 with seats and treats expired HELD as AVAILABLE', async () => {
  const now = Math.floor(Date.now() / 1000);
  const originalSend = DynamoDBDocumentClient.prototype.send;

  DynamoDBDocumentClient.prototype.send = (async () => ({
    Items: [
      { PK: 'EVENT#evt-1', SK: 'SEAT#A-01', status: 'AVAILABLE', price: 500000 },
      { PK: 'EVENT#evt-1', SK: 'SEAT#A-02', status: 'HELD', ttl: now - 10, price: 500000 },
      { PK: 'EVENT#evt-1', SK: 'SEAT#A-03', status: 'SOLD', price: 750000 },
    ],
  })) as typeof originalSend;

  try {
    const res = await handler(makeEvent('evt-1'));
    assert.equal(typeof res, 'object');
    if (typeof res === 'object') {
      assert.equal(res.statusCode, 200);
      assert.ok(res.headers?.ETag);
      const body = JSON.parse(res.body ?? '{}');
      assert.equal(body.eventId, 'evt-1');
      assert.equal(body.seats.length, 3);
      assert.equal(body.seats[1].status, 'AVAILABLE');
      assert.equal(body.seats[2].status, 'SOLD');
    }
  } finally {
    DynamoDBDocumentClient.prototype.send = originalSend;
  }
});
