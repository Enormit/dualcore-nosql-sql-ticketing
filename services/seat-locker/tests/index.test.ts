import test from 'node:test';
import assert from 'node:assert/strict';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { SQSClient } from '@aws-sdk/client-sqs';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { handler } from '../src/index.js';

function makeEvent(eventId?: string, seatId?: string, body?: object): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: 'POST /events/{eventId}/seats/{seatId}/hold',
    rawPath: `/events/${eventId ?? ''}/seats/${seatId ?? ''}/hold`,
    rawQueryString: '',
    headers: {},
    requestContext: {
      accountId: '123456789012',
      apiId: 'api-id',
      domainName: 'example.com',
      domainPrefix: 'api',
      http: {
        method: 'POST',
        path: `/events/${eventId ?? ''}/seats/${seatId ?? ''}/hold`,
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'node-test',
      },
      requestId: 'req-456',
      routeKey: 'POST /events/{eventId}/seats/{seatId}/hold',
      stage: '$default',
      time: '16/Nov/2026:15:00:00 +0000',
      timeEpoch: 1794841200000,
    },
    pathParameters: eventId && seatId ? { eventId, seatId } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    isBase64Encoded: false,
  };
}

test('seat-locker returns 202 when seat lock succeeds', async () => {
  const originalDdbSend = DynamoDBDocumentClient.prototype.send;
  const originalSqsSend = SQSClient.prototype.send;

  DynamoDBDocumentClient.prototype.send = (async () => ({})) as typeof originalDdbSend;
  SQSClient.prototype.send = (async () => ({ MessageId: 'msg-1' })) as typeof originalSqsSend;

  try {
    const res = await handler(makeEvent('evt-1', 'A-01', { userId: 'user-1', price: 500000 }));
    assert.equal(typeof res, 'object');
    if (typeof res === 'object') {
      assert.equal(res.statusCode, 202);
      const body = JSON.parse(res.body ?? '{}');
      assert.equal(body.eventId, 'evt-1');
      assert.equal(body.seatId, 'A-01');
      assert.ok(body.holdExpiresAt > 0);
    }
  } finally {
    DynamoDBDocumentClient.prototype.send = originalDdbSend;
    SQSClient.prototype.send = originalSqsSend;
  }
});

test('seat-locker returns 409 on ConditionalCheckFailedException', async () => {
  const originalDdbSend = DynamoDBDocumentClient.prototype.send;

  DynamoDBDocumentClient.prototype.send = (async () => {
    throw new ConditionalCheckFailedException({
      message: 'The conditional request failed',
      $metadata: {},
    });
  }) as typeof originalDdbSend;

  try {
    const res = await handler(makeEvent('evt-1', 'A-01', { userId: 'user-2', price: 500000 }));
    assert.equal(typeof res, 'object');
    if (typeof res === 'object') {
      assert.equal(res.statusCode, 409);
    }
  } finally {
    DynamoDBDocumentClient.prototype.send = originalDdbSend;
  }
});
