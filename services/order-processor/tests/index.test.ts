import test from 'node:test';
import assert from 'node:assert/strict';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { Pool } from 'pg';
import type { SQSEvent } from 'aws-lambda';
import { handler } from '../src/index.js';

function makeSqsEvent(payload: object): SQSEvent {
  return {
    Records: [
      {
        messageId: 'msg-001',
        receiptHandle: 'handle-001',
        body: JSON.stringify(payload),
        attributes: {
          ApproximateReceiveCount: '1',
          SentTimestamp: '1794841200000',
          SenderId: '123456789012',
          ApproximateFirstReceiveTimestamp: '1794841200001',
        },
        messageAttributes: {},
        md5OfBody: 'md5',
        eventSource: 'aws:sqs',
        eventSourceARN: 'arn:aws:sqs:ap-southeast-1:123456789012:ticketing-order-queue.fifo',
        awsRegion: 'ap-southeast-1',
      },
    ],
  };
}

test('order-processor commits SQL transaction and updates DynamoDB to SOLD', async () => {
  const queries: string[] = [];
  let ddbCalled = false;

  const originalConnect = Pool.prototype.connect;
  const originalDdbSend = DynamoDBDocumentClient.prototype.send;

  Pool.prototype.connect = (async () => ({
    query: async (sql: string) => {
      queries.push(sql.trim().split(/\s+/)[0]);
      if (sql.includes('RETURNING id')) {
        return { rows: [{ id: 'order-uuid-1' }] };
      }
      return { rows: [] };
    },
    release: () => {},
  })) as unknown as typeof originalConnect;

  DynamoDBDocumentClient.prototype.send = (async () => {
    ddbCalled = true;
    return {};
  }) as typeof originalDdbSend;

  try {
    const res = await handler(
      makeSqsEvent({
        eventId: 'evt-1',
        seatId: 'A-01',
        userId: 'user-1',
        price: 500000,
      })
    );
    assert.equal(res.batchItemFailures.length, 0);
    assert.deepEqual(queries, ['BEGIN', 'INSERT', 'INSERT', 'INSERT', 'COMMIT']);
    assert.equal(ddbCalled, true);
  } finally {
    Pool.prototype.connect = originalConnect;
    DynamoDBDocumentClient.prototype.send = originalDdbSend;
  }
});

test('order-processor rolls back SQL and returns batchItemFailures on error', async () => {
  const queries: string[] = [];
  const originalConnect = Pool.prototype.connect;

  Pool.prototype.connect = (async () => ({
    query: async (sql: string) => {
      const cmd = sql.trim().split(/\s+/)[0];
      queries.push(cmd);
      if (sql.includes('INSERT INTO tickets')) {
        throw new Error('duplicate key value violates unique constraint');
      }
      if (sql.includes('RETURNING id')) {
        return { rows: [{ id: 'order-uuid-2' }] };
      }
      return { rows: [] };
    },
    release: () => {},
  })) as unknown as typeof originalConnect;

  try {
    const res = await handler(
      makeSqsEvent({
        eventId: 'evt-1',
        seatId: 'A-01',
        userId: 'user-1',
        price: 500000,
      })
    );
    assert.equal(res.batchItemFailures.length, 1);
    assert.equal(res.batchItemFailures[0].itemIdentifier, 'msg-001');
    assert.ok(queries.includes('ROLLBACK'));
  } finally {
    Pool.prototype.connect = originalConnect;
  }
});
