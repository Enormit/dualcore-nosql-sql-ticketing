import { performance } from 'node:perf_hooks';

const API_URL = process.env.API_URL ?? 'https://sdz6xbd6l6.execute-api.ap-southeast-1.amazonaws.com';
const CLOUDFRONT_URL = process.env.CLOUDFRONT_URL ?? 'https://d13el8mejyicnc.cloudfront.net';
const AUTH_TOKEN = process.env.AUTH_TOKEN ?? '';
const EVENT_ID = '11111111-1111-1111-1111-111111111111';

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

async function runGetLoad(label, url, concurrency, totalRequests) {
  const latencies = [];
  const statusCounts = {};
  let nextIdx = 0;

  const tStart = performance.now();

  async function worker() {
    while (true) {
      const idx = nextIdx++;
      if (idx >= totalRequests) break;
      const t0 = performance.now();
      try {
        const res = await fetch(url);
        await res.arrayBuffer();
        latencies.push(performance.now() - t0);
        statusCounts[res.status] = (statusCounts[res.status] || 0) + 1;
      } catch {
        statusCounts.network_error = (statusCounts.network_error || 0) + 1;
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const totalMs = performance.now() - tStart;
  latencies.sort((a, b) => a - b);

  return {
    label,
    concurrency,
    totalRequests,
    durationMs: Math.round(totalMs),
    rps: Math.round((totalRequests / totalMs) * 1000),
    statusCounts,
    p50: latencies.length ? latencies[Math.floor(latencies.length * 0.5)].toFixed(2) : '0',
    p95: percentile(latencies, 95).toFixed(2),
    p99: percentile(latencies, 99).toFixed(2),
  };
}

async function runCloudFlashSaleContention(seatId, concurrentUsers) {
  const latencies = [];
  const statusCounts = {};

  const headers = { 'Content-Type': 'application/json' };
  if (AUTH_TOKEN) headers['Authorization'] = `Bearer ${AUTH_TOKEN}`;

  const tStart = performance.now();
  await Promise.all(
    Array.from({ length: concurrentUsers }, async (_, i) => {
      const userId = `cloud-load-user-${i + 1}`;
      const t0 = performance.now();
      try {
        const res = await fetch(`${API_URL}/api/v1/events/${EVENT_ID}/seats/${seatId}/hold`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ userId, price: 1200000 }),
        });
        await res.arrayBuffer();
        latencies.push(performance.now() - t0);
        statusCounts[res.status] = (statusCounts[res.status] || 0) + 1;
      } catch {
        statusCounts.network_error = (statusCounts.network_error || 0) + 1;
      }
    })
  );
  const totalMs = performance.now() - tStart;
  latencies.sort((a, b) => a - b);

  return {
    seatId,
    concurrentUsers,
    durationMs: Math.round(totalMs),
    statusCounts,
    p50: latencies.length ? latencies[Math.floor(latencies.length * 0.5)].toFixed(2) : '0',
    p95: percentile(latencies, 95).toFixed(2),
    p99: percentile(latencies, 99).toFixed(2),
  };
}

async function main() {
  console.log(`🚀 Running PolyFlash Cloud Production Load Test`);
  console.log(`   CloudFront: ${CLOUDFRONT_URL}`);
  console.log(`   API Gateway: ${API_URL}\n`);

  // Warm-up 1 request to avoid skewing Cold Start
  await fetch(`${API_URL}/api/v1/events/${EVENT_ID}/seats`);

  const cfResults = [
    await runGetLoad('CloudFront CDN', `${CLOUDFRONT_URL}/index.html`, 50, 300),
    await runGetLoad('CloudFront CDN', `${CLOUDFRONT_URL}/index.html`, 150, 600),
  ];
  console.log('1) CloudFront Static Delivery:', JSON.stringify(cfResults, null, 2));

  const apiReadResults = [
    await runGetLoad('API GW -> seat-reader -> DynamoDB', `${API_URL}/api/v1/events/${EVENT_ID}/seats`, 10, 100),
    await runGetLoad('API GW -> seat-reader -> DynamoDB', `${API_URL}/api/v1/events/${EVENT_ID}/seats`, 30, 300),
    await runGetLoad('API GW -> seat-reader -> DynamoDB', `${API_URL}/api/v1/events/${EVENT_ID}/seats`, 60, 300),
  ];
  console.log('\n2) Seat Reader Cloud Benchmark:', JSON.stringify(apiReadResults, null, 2));

  if (AUTH_TOKEN) {
    const contention = await runCloudFlashSaleContention('A-01', 30);
    console.log('\n3) Cloud Flash Sale Contention (Cognito JWT -> seat-locker -> DynamoDB -> SQS FIFO):', JSON.stringify(contention, null, 2));
  } else {
    console.log('\n3) Skipping authenticated Flash Sale contention test (AUTH_TOKEN not provided).');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
