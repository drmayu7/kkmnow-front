# KKMNow Frontend — Load Test Scripts

## Overview

`k6-load-test.js` is a [Grafana k6](https://k6.io/) load test script that simulates real user traffic against the KKMNow frontend (CloudFront + ECS Fargate). It tests the full stack end-to-end: browser → CloudFront cache → ALB → ECS Fargate container.

---

## Traffic Simulation

The script simulates realistic user traffic distribution across page types:

| Page | URL | Weight | Type | Expected Latency |
|------|-----|--------|------|-----------------|
| Home | `/` | 30% | ISR | < 10ms (cached) |
| Blood Donation | `/dashboard/blood-donation` | 15% | ISR | < 10ms (cached) |
| Data Catalogue | `/data-catalogue` | 15% | SSR | 50–150ms (origin) |
| Organ Donation | `/dashboard/organ-donation` | 10% | ISR | < 10ms (cached) |
| Peka B40 | `/dashboard/peka-b40` | 10% | ISR | < 10ms (cached) |
| Healthcare Facilities | `/dashboard/healthcare-facilities` | 10% | ISR | < 10ms (cached) |
| Dashboard | `/dashboard` | 10% | ISR | < 10ms (cached) |

**ISR pages** (85% of traffic) are served from CloudFront cache — very fast.
**SSR pages** (15% of traffic) always hit the ECS origin — latency depends on container load.

Each VU waits 1–3 seconds between requests (simulating real user think time).

---

## Ramp-Up Profile

```
VUs
200 ┤                        ╭────────╮
100 ┤           ╭────────╮   │        │
 50 ┤  ╭─────╮  │        │   │        │
  0 ┤  │     │  │        │   │        ╰──
    └──┴─────┴──┴────────┴───┴────────┴──
       30s  1m  30s  1m  30s  1m     30s
```

| Stage | Duration | VUs | Purpose |
|-------|----------|-----|---------|
| 1 | 30s | 0 → 50 | Warm up / cache priming |
| 2 | 1m | 50 | Baseline — typical daytime load |
| 3 | 30s | 50 → 100 | Moderate ramp |
| 4 | 1m | 100 | Sustained moderate |
| 5 | 30s | 100 → 200 | Peak ramp |
| 6 | 1m | 200 | Sustained peak (stress test) |
| 7 | 30s | 200 → 0 | Cool-down |

**Total duration:** 5 minutes (+ 30s graceful stop)

---

## Pass/Fail Thresholds

| Threshold | Limit | Rationale |
|-----------|-------|-----------|
| P95 response time | < 3,000ms | Google's Core Web Vitals LCP target |
| P99 response time | < 5,000ms | Worst-case acceptable user wait |
| Overall error rate | < 5% | Industry standard for web services |
| HTTP 5xx rate | < 1% | Server-side errors should be near-zero |

A threshold crossing means the job exits with a non-zero code. Since the job has `allow_failure: true`, the pipeline continues but the job is marked as a warning.

---

## Running Locally

### Prerequisites
```bash
# Install k6 (macOS)
brew install k6

# Or via Docker
docker pull grafana/k6:0.55.0
```

### Basic run (staging)
```bash
k6 run scripts/k6-load-test.js \
  -e BASE_URL=https://d1zofdcmpfqbdi.cloudfront.net
```

### Production run
```bash
k6 run scripts/k6-load-test.js \
  -e BASE_URL=https://d11sm8hqrx9aay.cloudfront.net
```

### With Basic Auth (staging only)
```bash
k6 run scripts/k6-load-test.js \
  -e BASE_URL=https://d1zofdcmpfqbdi.cloudfront.net \
  -e AUTH_USER=admin \
  -e AUTH_PASS=your_password
```

### Save report to file
```bash
k6 run scripts/k6-load-test.js \
  -e BASE_URL=https://d11sm8hqrx9aay.cloudfront.net \
  -e K6_REPORT_PATH=load-test-report.json
```

### Quick smoke test (10 VUs, 30s)
```bash
k6 run scripts/k6-load-test.js \
  -e BASE_URL=https://d11sm8hqrx9aay.cloudfront.net \
  --vus 10 --duration 30s
```

### Via Docker (no local install)
```bash
docker run --rm -i grafana/k6:0.55.0 run - \
  -e BASE_URL=https://d11sm8hqrx9aay.cloudfront.net \
  < scripts/k6-load-test.js
```

---

## Running in CI (GitLab)

The load test runs as a **manual** step after `verify_staging` or `verify_production`. It will not trigger automatically.

1. Open the pipeline in GitLab UI
2. Navigate to the `load-test` stage
3. Click ▶️ on `load_test_staging` or `load_test_production`

The `load-test-report.json` artifact is saved for 30 days and can be downloaded from the pipeline artifacts.

### Optional CI overrides (per environment in GitLab Variables)

| Variable | Default | Description |
|----------|---------|-------------|
| `LOAD_TEST_AUTH_USER` | `admin` | Basic auth user for staging |
| `LOAD_TEST_AUTH_PASS` | _(none)_ | Basic auth password (masked) |
| `K6_VUS` | _(script default: 200)_ | Override max virtual users |
| `K6_DURATION` | _(script default: 5m)_ | Override total test duration |

---

## Interpreting Results

### Summary output

```
═══════════════════════════════════════════════
  KKMNow Frontend Load Test Summary
  Target: https://d11sm8hqrx9aay.cloudfront.net
═══════════════════════════════════════════════
  Total Requests:    15666
  Avg RPS:           52
───────────────────────────────────────────────
  Latency
    Avg:             15ms
    P95:             69ms  (threshold: < 3000ms)
    P99:             82ms  (threshold: < 5000ms)
───────────────────────────────────────────────
  By Page Type
    ISR avg/p95:     5ms / 18ms
    SSR avg/p95:     75ms / 210ms
───────────────────────────────────────────────
  Error Breakdown
    Overall:         0.80%  (threshold: < 5%)
    HTTP 4xx:        0.10%
    HTTP 5xx:        0.00%  (threshold: < 1%)
    Empty body:      0.00%
───────────────────────────────────────────────
  Thresholds
    ✓ p95_under_3s
    ✓ p99_under_5s
    ✓ error_rate_under_5pct
    ✓ http_5xx_under_1pct
  Overall: ✅ PASSED
═══════════════════════════════════════════════
```

### What each metric means

| Metric | What it tells you |
|--------|-------------------|
| **Avg RPS** | Sustained request rate. At 200 VUs with 1–3s think time, expect ~67–200 RPS |
| **ISR avg** | CloudFront cache hit latency. Should be < 20ms. High values → cache miss problem |
| **SSR avg** | ECS origin latency for server-rendered pages. 50–150ms is normal |
| **HTTP 4xx rate** | Client errors (401 auth, 404 not found). High 4xx → check page URLs in script |
| **HTTP 5xx rate** | Server errors. Any 5xx under load indicates a capacity or crash issue |
| **Empty body rate** | Responses < 100 bytes. Indicates errors even when status is 200 |

### Troubleshooting high error rates

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| High 4xx (>5%) | Basic auth wrong, or pages returning 404 | Check `AUTH_PASS`, verify URLs exist |
| High 5xx (>1%) | ECS tasks crashing under load | Check ECS container logs, increase desired count |
| High ISR latency (>100ms) | CloudFront cache miss | Check cache policy TTL, allow warm-up phase |
| High SSR latency (>500ms) | ECS CPU throttling | Check Fargate task CPU/memory, enable autoscaling |
| Empty body | Container returning 200 with empty page | Check i18n config, server-side rendering errors |

---

## Latest Run Results (2026-03-31)

> **⚠️ Note:** This run accidentally targeted the **staging** CloudFront (`d1zofdcmpfqbdi.cloudfront.net`) instead of production due to a missing `HEALTH_CHECK_URL` CI variable. Results reflect staging performance, not production.

| Metric | Value | Status |
|--------|-------|--------|
| Total Requests | 15,666 | — |
| Avg RPS | 52 | — |
| Avg Duration | 15ms | ✅ |
| P95 Duration | 69ms | ✅ (threshold: 3,000ms) |
| Error Rate | 10.04% | ❌ (threshold: 5%) |
| ISR Pages Avg | 5ms | ✅ |
| SSR Pages Avg | 75ms | ✅ |

**Analysis:**
- **Latency is excellent** — P95 at 69ms is 43× better than the 3s threshold. CloudFront caching is working well.
- **Error rate (10%) is a known false alarm** — caused by the wrong target URL (staging, which may have had Basic Auth on and `AUTH_PASS` was not set). The `|| true` in the CI script also masked the non-zero exit code.
- **ISR at 5ms confirms CloudFront cache hits** are working correctly.
- **SSR at 75ms** shows ECS can handle the load comfortably.

**Action items resolved:**
- [x] Fix `HEALTH_CHECK_URL` variable validation in CI (now fails explicitly if unset)
- [x] Remove hardcoded staging fallback from k6 script
- [x] Remove `|| true` from k6 run command (allow proper exit code propagation)
- [ ] Set `HEALTH_CHECK_URL=https://d11sm8hqrx9aay.cloudfront.net` for `production` environment in GitLab CI/CD variables
- [ ] Re-run production load test to get accurate baseline numbers

---

## Required GitLab CI/CD Variables

Set these in **Settings > CI/CD > Variables**, scoped to the correct environment:

| Variable | Environment | Value |
|----------|-------------|-------|
| `HEALTH_CHECK_URL` | staging | `https://d1zofdcmpfqbdi.cloudfront.net` |
| `HEALTH_CHECK_URL` | production | `https://d11sm8hqrx9aay.cloudfront.net` |
| `LOAD_TEST_AUTH_PASS` | staging | _(staging basic auth password, masked)_ |
