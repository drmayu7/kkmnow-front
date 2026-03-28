import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";
import encoding from "k6/encoding";

// ─── Config ─────────────────────────────────────────────────────────────────
const BASE_URL = __ENV.BASE_URL || "https://d1zofdcmpfqbdi.cloudfront.net";
const AUTH_USER = __ENV.AUTH_USER || "admin";
const AUTH_PASS = __ENV.AUTH_PASS || "dev_token_12345";

const authHeader = `Basic ${encoding.b64encode(`${AUTH_USER}:${AUTH_PASS}`)}`;
const defaultParams = {
  headers: { Authorization: authHeader },
};

// ─── Custom Metrics ─────────────────────────────────────────────────────────
const errorRate = new Rate("errors");
const healthDuration = new Trend("health_duration", true);
const isrDuration = new Trend("isr_page_duration", true);
const ssrDuration = new Trend("ssr_page_duration", true);

// ─── Test Scenarios ─────────────────────────────────────────────────────────
//
// Stage 1: Ramp up to 50 VUs over 30s (warm-up)
// Stage 2: Hold at 50 VUs for 1 min (baseline)
// Stage 3: Ramp to 100 VUs over 30s (moderate load)
// Stage 4: Hold at 100 VUs for 1 min (sustained moderate)
// Stage 5: Ramp to 200 VUs over 30s (high load)
// Stage 6: Hold at 200 VUs for 1 min (sustained high)
// Stage 7: Ramp down to 0 over 30s
//
export const options = {
  stages: [
    { duration: "30s", target: 50 },
    { duration: "1m", target: 50 },
    { duration: "30s", target: 100 },
    { duration: "1m", target: 100 },
    { duration: "30s", target: 200 },
    { duration: "1m", target: 200 },
    { duration: "30s", target: 0 },
  ],
  thresholds: {
    http_req_duration: ["p(95)<3000"], // 95th percentile < 3s
    errors: ["rate<0.05"],             // Error rate < 5%
  },
};

// ─── Page Weights (simulate real traffic distribution) ──────────────────────
const pages = [
  // ISR pages (~85% of traffic)
  { url: "/", weight: 30, type: "isr" },
  { url: "/dashboard/blood-donation", weight: 15, type: "isr" },
  { url: "/dashboard/organ-donation", weight: 10, type: "isr" },
  { url: "/dashboard/peka-b40", weight: 10, type: "isr" },
  { url: "/dashboard/healthcare-facilities", weight: 10, type: "isr" },
  { url: "/dashboard", weight: 10, type: "isr" },

  // SSR pages (~15% of traffic)
  { url: "/data-catalogue", weight: 15, type: "ssr" },

  // Health check (lightweight baseline)
  { url: "/api/health", weight: 0, type: "health" },
];

// Weighted random selection
function pickPage() {
  const totalWeight = pages.reduce((sum, p) => sum + p.weight, 0);
  let rand = Math.random() * totalWeight;
  for (const page of pages) {
    rand -= page.weight;
    if (rand <= 0) return page;
  }
  return pages[0];
}

// ─── Main Test Function ────────────────────────────────────────────────────
export default function () {
  const page = pickPage();
  const res = http.get(`${BASE_URL}${page.url}`, defaultParams);

  const success = check(res, {
    "status is 200": (r) => r.status === 200,
    "response time < 5s": (r) => r.timings.duration < 5000,
  });

  errorRate.add(!success);

  // Track by page type
  if (page.type === "health") healthDuration.add(res.timings.duration);
  else if (page.type === "isr") isrDuration.add(res.timings.duration);
  else if (page.type === "ssr") ssrDuration.add(res.timings.duration);

  // Simulate real user think time (1-3 seconds between pages)
  sleep(Math.random() * 2 + 1);
}

// ─── Summary ────────────────────────────────────────────────────────────────
export function handleSummary(data) {
  const summary = {
    total_requests: data.metrics.http_reqs?.values?.count || 0,
    avg_duration_ms: Math.round(data.metrics.http_req_duration?.values?.avg || 0),
    p95_duration_ms: Math.round(data.metrics.http_req_duration?.values?.["p(95)"] || 0),
    p99_duration_ms: Math.round(data.metrics.http_req_duration?.values?.["p(99)"] || 0),
    error_rate: ((data.metrics.errors?.values?.rate || 0) * 100).toFixed(2) + "%",
    isr_avg_ms: Math.round(data.metrics.isr_page_duration?.values?.avg || 0),
    ssr_avg_ms: Math.round(data.metrics.ssr_page_duration?.values?.avg || 0),
    rps: Math.round((data.metrics.http_reqs?.values?.count || 0) / ((data.state?.testRunDurationMs || 1) / 1000)),
  };

  console.log("\n═══════════════════════════════════════════════");
  console.log("  KKMNow Frontend Load Test Summary");
  console.log("═══════════════════════════════════════════════");
  console.log(`  Total Requests:    ${summary.total_requests}`);
  console.log(`  Avg RPS:           ${summary.rps}`);
  console.log(`  Avg Duration:      ${summary.avg_duration_ms}ms`);
  console.log(`  P95 Duration:      ${summary.p95_duration_ms}ms`);
  console.log(`  P99 Duration:      ${summary.p99_duration_ms}ms`);
  console.log(`  Error Rate:        ${summary.error_rate}`);
  console.log(`  ISR Pages Avg:     ${summary.isr_avg_ms}ms`);
  console.log(`  SSR Pages Avg:     ${summary.ssr_avg_ms}ms`);
  console.log("═══════════════════════════════════════════════\n");

  // Write JSON report (for CI artifact)
  const result = {
    stdout: JSON.stringify(summary, null, 2),
  };

  const reportPath = __ENV.K6_REPORT_PATH;
  if (reportPath) {
    result[reportPath] = JSON.stringify(
      {
        summary,
        thresholds: {
          p95_under_3s: (summary.p95_duration_ms < 3000),
          error_rate_under_5pct: (parseFloat(summary.error_rate) < 5),
        },
        timestamp: new Date().toISOString(),
        base_url: __ENV.BASE_URL || "https://d1zofdcmpfqbdi.cloudfront.net",
      },
      null,
      2
    );
  }

  return result;
}
