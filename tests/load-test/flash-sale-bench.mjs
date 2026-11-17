import { performance } from 'node:perf_hooks';

const BASE_URL = process.env.TARGET_URL ?? 'http://localhost:3000';
const EVENT_ID = '11111111-1111-1111-1111-111111111111';

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

async function runConcurrentRead(concurrency, totalRequests) {
  const latencies = [];
  let ok = 0;
  let errors = 0;
  let nextIdx = 0;

  const tStart = performance.now();

  async function worker() {
    while (true) {
      const idx = nextIdx++;
      if (idx >= totalRequests) break;
      const t0 = performance.now();
      try {
        const res = await fetch(`${BASE_URL}/api/v1/events/${EVENT_ID}/seats`);
        await res.arrayBuffer();
        const dt = performance.now() - t0;
        latencies.push(dt);
        if (res.ok) ok++;
        else errors++;
      } catch {
        errors++;
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const totalMs = performance.now() - tStart;
  latencies.sort((a, b) => a - b);

  return {
    concurrency,
    totalRequests,
    durationMs: Math.round(totalMs),
    rps: Math.round((totalRequests / totalMs) * 1000),
    ok,
    errors,
    p50: latencies.length ? latencies[Math.floor(latencies.length * 0.5)].toFixed(2) : '0',
    p95: percentile(latencies, 95).toFixed(2),
    p99: percentile(latencies, 99).toFixed(2),
  };
}

async function runFlashSaleContention(seatId, concurrentUsers) {
  const latencies = [];
  let won = 0;
  let conflict = 0;
  let errors = 0;

  const tStart = performance.now();
  await Promise.all(
    Array.from({ length: concurrentUsers }, async (_, i) => {
      const userId = `load-user-${i + 1}`;
      const t0 = performance.now();
      try {
        const res = await fetch(`${BASE_URL}/api/v1/events/${EVENT_ID}/seats/${seatId}/hold`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, price: 1200000 }),
        });
        await res.arrayBuffer();
        latencies.push(performance.now() - t0);
        if (res.status === 202) {
          won++;
          // Release back so test is repeatable
          await fetch(`${BASE_URL}/api/v1/events/${EVENT_ID}/seats/${seatId}/release`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId }),
          });
        } else if (res.status === 409) {
          conflict++;
        } else {
          errors++;
        }
      } catch {
        errors++;
      }
    })
  );
  const totalMs = performance.now() - tStart;
  latencies.sort((a, b) => a - b);

  return {
    seatId,
    concurrentUsers,
    durationMs: Math.round(totalMs),
    won,
    conflict,
    errors,
    p95: percentile(latencies, 95).toFixed(2),
    p99: percentile(latencies, 99).toFixed(2),
  };
}

async function runMixedTraffic(concurrency, durationSec = 5) {
  const stopAt = performance.now() + durationSec * 1000;
  const latencies = [];
  let totalReq = 0;
  let errors = 0;

  async function worker(id) {
    let step = 0;
    while (performance.now() < stopAt) {
      step++;
      const t0 = performance.now();
      try {
        // 80% browse/read seats, 20% hold/release attempt
        if (step % 5 !== 0) {
          const url =
            step % 2 === 0
              ? `${BASE_URL}/api/v1/events`
              : `${BASE_URL}/api/v1/events/${EVENT_ID}/seats`;
          const res = await fetch(url);
          await res.arrayBuffer();
          if (!res.ok) errors++;
        } else {
          const seatId = `B-0${(id % 8) + 1}`;
          const res = await fetch(`${BASE_URL}/api/v1/events/${EVENT_ID}/seats/${seatId}/hold`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: `mix-${id}`, price: 800000 }),
          });
          await res.arrayBuffer();
          if (res.status === 202) {
            await fetch(`${BASE_URL}/api/v1/events/${EVENT_ID}/seats/${seatId}/release`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userId: `mix-${id}` }),
            });
          } else if (res.status !== 409) {
            errors++;
          }
        }
        latencies.push(performance.now() - t0);
        totalReq++;
      } catch {
        errors++;
      }
    }
  }

  const tStart = performance.now();
  await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i)));
  const elapsedMs = performance.now() - tStart;
  latencies.sort((a, b) => a - b);

  return {
    concurrency,
    durationSec,
    totalReq,
    rps: Math.round((totalReq / elapsedMs) * 1000),
    errors,
    p50: latencies.length ? latencies[Math.floor(latencies.length * 0.5)].toFixed(2) : '0',
    p95: percentile(latencies, 95).toFixed(2),
    p99: percentile(latencies, 99).toFixed(2),
  };
}

async function main() {
  console.log(`🚀 Running PolyFlash Load Test against ${BASE_URL}\n`);

  const read50 = await runConcurrentRead(50, 1000);
  const read200 = await runConcurrentRead(200, 2000);
  const read500 = await runConcurrentRead(500, 3000);
  console.log('1) Seat Reader Benchmark:', JSON.stringify([read50, read200, read500], null, 2));

  const contention200 = await runFlashSaleContention('A-02', 200);
  console.log('\n2) Flash Sale 200-User Contention:', JSON.stringify(contention200, null, 2));

  const mixed100 = await runMixedTraffic(100, 5);
  const mixed300 = await runMixedTraffic(300, 5);
  console.log('\n3) Mixed Realistic Traffic (5s):', JSON.stringify([mixed100, mixed300], null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
