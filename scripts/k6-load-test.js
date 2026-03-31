import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";
import encoding from "k6/encoding";

// ─── Config ─────────────────────────────────────────────────────────────────
const BASE_URL = __ENV.BASE_URL;
if (!BASE_URL) {
  throw new Error(
    "BASE_URL is required. Pass it via -e BASE_URL=https://your-cloudfront-domain.net"
  );
}

const AUTH_USER = __ENV.AUTH_USER || "admin";
const AUTH_PASS = __ENV.AUTH_PASS || "";

const defaultParams = {
  headers: AUTH_PASS
    ? { Authorization: `Basic ${encoding.b64encode(`${AUTH_USER}:${AUTH_PASS}`)}` }
    : {},
  timeout: "10s",
};

// ─── Custom Metrics ──────────────────────────────────────────────────────────
const errorRate  = new Rate("errors");
const http4xx    = new Rate("http_4xx");
const http5xx    = new Rate("http_5xx");
const emptyBody  = new Rate("empty_body");

const healthDuration = new Trend("health_duration",   true);
const isrDuration    = new Trend("isr_page_duration", true);
const ssrDuration    = new Trend("ssr_page_duration", true);

// ─── Test Scenarios ──────────────────────────────────────────────────────────
//
// Stage 1: Ramp up to  50 VUs over 30s  (warm-up)
// Stage 2: Hold at     50 VUs for 1 min (baseline)
// Stage 3: Ramp to    100 VUs over 30s  (moderate load)
// Stage 4: Hold at    100 VUs for 1 min (sustained moderate)
// Stage 5: Ramp to    200 VUs over 30s  (peak load)
// Stage 6: Hold at    200 VUs for 1 min (sustained peak)
// Stage 7: Ramp down to 0 over 30s      (cool-down)
//
export const options = {
  stages: [
    { duration: "30s", target: 50  },
    { duration: "1m",  target: 50  },
    { duration: "30s", target: 100 },
    { duration: "1m",  target: 100 },
    { duration: "30s", target: 200 },
    { duration: "1m",  target: 200 },
    { duration: "30s", target: 0   },
  ],
  thresholds: {
    http_req_duration: ["p(95)<3000", "p(99)<5000"], // p95 < 3s, p99 < 5s
    errors:   ["rate<0.05"],  // Overall error rate < 5%
    http_5xx: ["rate<0.01"],  // 5xx rate < 1%
  },
};

// ─── Page Weights (simulate real traffic distribution) ───────────────────────
//
// ISR pages  (~85%): served from CloudFront cache — fast (< 10ms on cache hit)
// SSR pages  (~15%): always hits origin ECS  — slower (50–150ms)
// Health     (  0%): baseline sanity only, excluded from weighted selection
//
const pages = [
  // ISR pages
  { url: "/",                                   weight: 30, type: "isr" },
  { url: "/dashboard/blood-donation",           weight: 15, type: "isr" },
  { url: "/dashboard/organ-donation",           weight: 10, type: "isr" },
  { url: "/dashboard/peka-b40",                 weight: 10, type: "isr" },
  { url: "/dashboard/healthcare-facilities",    weight: 10, type: "isr" },
  { url: "/dashboard",                          weight: 10, type: "isr" },
  // SSR pages
  { url: "/data-catalogue",                     weight: 15, type: "ssr" },
];

function pickPage() {
  const total = pages.reduce((s, p) => s + p.weight, 0);
  let rand = Math.random() * total;
  for (const page of pages) {
    rand -= page.weight;
    if (rand <= 0) return page;
  }
  return pages[0];
}

// ─── Main Test Function ───────────────────────────────────────────────────────
export default function () {
  const page = pickPage();
  const url  = `${BASE_URL}${page.url}`;

  const res = http.get(url, {
    ...defaultParams,
    tags: { page: page.url, type: page.type },
  });

  const is4xx = res.status >= 400 && res.status < 500;
  const is5xx = res.status >= 500;
  const isEmpty = !res.body || res.body.length < 100;

  const success = check(res, {
    "status is 200":      (r) => r.status === 200,
    "response time < 5s": (r) => r.timings.duration < 5000,
    "body is not empty":  (r) => r.body && r.body.length > 100,
  });

  // Custom metric tracking
  errorRate.add(!success);
  http4xx.add(is4xx);
  http5xx.add(is5xx);
  emptyBody.add(isEmpty);

  // Per-type latency tracking
  if (page.type === "isr") isrDuration.add(res.timings.duration);
  else if (page.type === "ssr") ssrDuration.add(res.timings.duration);

  // Think time: 1–3 seconds between pages (simulate real user)
  sleep(Math.random() * 2 + 1);
}

// ─── Health Check (separate, optional) ───────────────────────────────────────
export function healthCheck() {
  const res = http.get(`${BASE_URL}/api/health`, defaultParams);
  healthDuration.add(res.timings.duration);
  check(res, { "health 200": (r) => r.status === 200 });
}

// ─── Summary ─────────────────────────────────────────────────────────────────
export function handleSummary(data) {
  const m = data.metrics;

  const totalReqs  = m.http_reqs?.values?.count || 0;
  const durationMs = data.state?.testRunDurationMs || 1;

  const summary = {
    total_requests:  totalReqs,
    rps:             Math.round(totalReqs / (durationMs / 1000)),
    avg_duration_ms: Math.round(m.http_req_duration?.values?.avg    || 0),
    p95_duration_ms: Math.round(m.http_req_duration?.values?.["p(95)"] || 0),
    p99_duration_ms: Math.round(m.http_req_duration?.values?.["p(99)"] || 0),
    error_rate:      ((m.errors?.values?.rate    || 0) * 100).toFixed(2) + "%",
    http_4xx_rate:   ((m.http_4xx?.values?.rate  || 0) * 100).toFixed(2) + "%",
    http_5xx_rate:   ((m.http_5xx?.values?.rate  || 0) * 100).toFixed(2) + "%",
    empty_body_rate: ((m.empty_body?.values?.rate || 0) * 100).toFixed(2) + "%",
    isr_avg_ms:      Math.round(m.isr_page_duration?.values?.avg || 0),
    isr_p95_ms:      Math.round(m.isr_page_duration?.values?.["p(95)"] || 0),
    ssr_avg_ms:      Math.round(m.ssr_page_duration?.values?.avg || 0),
    ssr_p95_ms:      Math.round(m.ssr_page_duration?.values?.["p(95)"] || 0),
  };

  const thresholds = {
    p95_under_3s:        summary.p95_duration_ms < 3000,
    p99_under_5s:        summary.p99_duration_ms < 5000,
    error_rate_under_5pct: parseFloat(summary.error_rate) < 5,
    http_5xx_under_1pct:  parseFloat(summary.http_5xx_rate) < 1,
  };

  const allPassed = Object.values(thresholds).every(Boolean);

  console.log("\n═══════════════════════════════════════════════");
  console.log("  KKMNow Frontend Load Test Summary");
  console.log(`  Target: ${BASE_URL}`);
  console.log("═══════════════════════════════════════════════");
  console.log(`  Total Requests:    ${summary.total_requests}`);
  console.log(`  Avg RPS:           ${summary.rps}`);
  console.log("───────────────────────────────────────────────");
  console.log("  Latency");
  console.log(`    Avg:             ${summary.avg_duration_ms}ms`);
  console.log(`    P95:             ${summary.p95_duration_ms}ms  (threshold: < 3000ms)`);
  console.log(`    P99:             ${summary.p99_duration_ms}ms  (threshold: < 5000ms)`);
  console.log("───────────────────────────────────────────────");
  console.log("  By Page Type");
  console.log(`    ISR avg/p95:     ${summary.isr_avg_ms}ms / ${summary.isr_p95_ms}ms`);
  console.log(`    SSR avg/p95:     ${summary.ssr_avg_ms}ms / ${summary.ssr_p95_ms}ms`);
  console.log("───────────────────────────────────────────────");
  console.log("  Error Breakdown");
  console.log(`    Overall:         ${summary.error_rate}  (threshold: < 5%)`);
  console.log(`    HTTP 4xx:        ${summary.http_4xx_rate}`);
  console.log(`    HTTP 5xx:        ${summary.http_5xx_rate}  (threshold: < 1%)`);
  console.log(`    Empty body:      ${summary.empty_body_rate}`);
  console.log("───────────────────────────────────────────────");
  console.log("  Thresholds");
  for (const [key, passed] of Object.entries(thresholds)) {
    console.log(`    ${passed ? "✓" : "✗"} ${key}`);
  }
  console.log(`  Overall: ${allPassed ? "✅ PASSED" : "❌ FAILED"}`);
  console.log("═══════════════════════════════════════════════\n");

  const report = {
    summary,
    thresholds,
    passed: allPassed,
    timestamp: new Date().toISOString(),
    base_url: BASE_URL,
  };

  const result = {
    stdout: JSON.stringify(summary, null, 2),
  };

  const reportPath = __ENV.K6_REPORT_PATH;
  if (reportPath) {
    result[reportPath] = JSON.stringify(report, null, 2);
  }

  return result;
}
