# KKMNow Backend API Requirements Documentation

## Context

The KKMNow frontend (Next.js 13) is being migrated to a new Python FastAPI backend. This document serves as a comprehensive API contract specification derived from the frontend codebase, detailing every endpoint the backend must implement for the frontend to function correctly in both development and production.

**Current architecture:** The frontend consumes data from two sources:
1. **Dynamic API** (`NEXT_PUBLIC_API_URL`) - Real-time/computed endpoints (homepage, hospital bed utilisation, data catalogue)
2. **Static S3 JSON** (`NEXT_PUBLIC_S3_URL`) - Pre-computed dashboard JSON files (COVID-19, vaccination, blood/organ donation, PEKA B40)

**Decision:** Keep the current two-source architecture:
- FastAPI serves dynamic endpoints (homepage, hospital bed utilisation, data catalogue)
- FastAPI pipeline generates static JSON files and uploads to S3 for dashboard data (COVID-19, vaccination, blood/organ donation, PEKA B40)

---

## 1. Authentication & Authorization

### Current Token Strategy
- **Server-side (SSR/SSG):** Uses `AUTHORIZATION_TOKEN` env var as Bearer token
- **Client-side (browser):** Uses `rolling_token` from cookies, auto-refreshed via Vercel Edge Config on 401
- **S3 endpoints:** No authorization required

### Backend Requirements
- All API endpoints (except S3 static files) require `Authorization: Bearer <token>` header
- Return `{ "status": 401, "message": "Unauthorized" }` on invalid tokens
- The frontend retries once on 401 by fetching a new rolling token

### Revalidation Token
- Separate `REVALIDATE_TOKEN` for the ISR webhook endpoint (`POST /api/revalidate`)
- This is a Next.js internal API route, not a backend endpoint

---

## 2. API Endpoints Specification

### 2.1 Homepage Dashboard

```
GET /dashboard/
```

**Query Parameters:**
| Param | Type | Required | Value |
|-------|------|----------|-------|
| `dashboard` | string | Yes | `"kkmnow_homepage"` |

**Response Body:**
```json
{
  "data_last_updated": "2023-11-20 23:59",
  "keystats": {
    "covid": { "callout": {}, "data_as_of": "string" },
    "covid_vax": { "callout": {}, "data_as_of": "string" },
    "util_bed": { "callout": {}, "data_as_of": "string" },
    "util_icu": { "callout": {}, "data_as_of": "string" },
    "blood": { "callout": {}, "data_as_of": "string" },
    "organ": { "callout": {}, "data_as_of": "string" },
    "pekab40": { "callout": {}, "data_as_of": "string" }
  },
  "timeseries": {
    "x": ["date_string", "..."],
    "views": [0, "..."],
    "downloads": [0, "..."]
  },
  "timeseries_callout": {
    "downloads": { "daily": 0, "total": 0 },
    "views": { "daily": 0, "total": 0 }
  }
}
```

**Frontend file:** `apps/kkmnow/pages/index.tsx`

---

### 2.2 Hospital Bed Utilisation Dashboard

```
GET /dashboard
```

**Query Parameters:**
| Param | Type | Required | Default |
|-------|------|----------|---------|
| `dashboard` | string | Yes | `"bed_util"` |
| `hospital` | string | Yes | `"Hospital Sungai Buloh"` |

**Response Body:**
```json
{
  "data_last_updated": "string",
  "data_next_update": "string",
  "choropleth_malaysia": {
    "x": ["state_code", "..."],
    "y": {
      "beds_nonicu": [0, "..."],
      "util_nonicu": [0, "..."],
      "beds_icu": [0, "..."],
      "util_icu": [0, "..."],
      "vent": [0, "..."],
      "util_vent": [0, "..."]
    }
  },
  "timeseries_dropdown": {
    "data": {
      "data": ["Hospital Name 1", "Hospital Name 2", "..."]
    }
  },
  "table_facility": [
    {
      "index": 0,
      "state": "string",
      "data": {
        "hospital": "string",
        "beds_nonicu": 0,
        "util_nonicu": 0,
        "beds_icu": 0,
        "util_icu": 0,
        "vent": 0,
        "util_vent": 0
      }
    }
  ],
  "timeseries_facility": {
    "data": {
      "x": ["date_string", "..."],
      "beds_nonicu": [0, "..."],
      "util_nonicu": [0, "..."],
      "beds_icu": [0, "..."],
      "util_icu": [0, "..."],
      "vent": [0, "..."],
      "util_vent": [0, "..."]
    }
  }
}
```

**Frontend file:** `apps/kkmnow/pages/dashboard/hospital-bed-utilisation/[[...hospital]].tsx`

---

### 2.3 Data Catalogue - List

```
GET /data-catalogue
```

**Query Parameters:**
| Param | Type | Required | Example |
|-------|------|----------|---------|
| `language` | string | Yes | `"en"` or `"ms"` |
| `site` | string | Yes | `"kkmnow"` |
| *(other filters)* | string | No | Passed through from frontend query params |

**Response Body:**
```json
{
  "dataset": {
    "Category Name": {
      "Subcategory": [
        {
          "title": "string",
          "id": "string",
          "description": "string"
        }
      ]
    }
  },
  "source_filters": ["Agency 1", "Agency 2", "..."]
}
```

**Notes:**
- `dataset` is a nested object: categories -> subcategories -> array of catalogue items
- `source_filters` is a flat array of source agency strings
- Cache: Frontend caches for 10 minutes

**Frontend file:** `apps/kkmnow/pages/data-catalogue/index.tsx`

---

### 2.4 Data Catalogue - Detail

```
GET /data-catalogue/{id}
```

**Path Parameters:**
| Param | Type | Required |
|-------|------|----------|
| `id` | string | Yes |

**Query Parameters:**
| Param | Type | Required | Example |
|-------|------|----------|---------|
| `language` | string | Yes | `"en"` or `"ms"` |
| *(other filters)* | string | No | Dynamic filters from dropdowns |

**Response Body:** `DCVariable` type - a complex object containing:
```json
{
  "id": "string",
  "title": "string",
  "description": "string",
  "data_source": "string or array of strings",
  "data": [],
  "dataviz_set": [
    {
      "chart_type": "string",
      "config": {}
    }
  ],
  "dropdown": [
    {
      "name": "string",
      "options": ["string", "..."],
      "selected": "string"
    }
  ],
  "link_csv": "url_string",
  "link_parquet": "url_string",
  "link_geojson": "url_string or null",
  "link_editions": "url_template_string or null"
}
```

**Notes:**
- Cache: Frontend caches for 6 hours
- The `dropdown` filters are used for interactive data exploration
- Query params beyond `language` are typically filter selections from dropdowns

**Frontend file:** `apps/kkmnow/pages/data-catalogue/[id].tsx`

---

## 3. Static Dashboard JSON Files (S3)

These files are currently served from S3 (`NEXT_PUBLIC_S3_URL`). The backend needs to **generate and upload** these JSON files, OR serve them dynamically.

### 3.1 COVID-19 Epidemic Dashboard

```
GET /dashboards/covid-epid-{state_code}.json
```

**Path:** `state_code` = `mys` | `jhr` | `kdh` | `ktn` | `mlk` | `nsn` | `phg` | `prk` | `png` | `sbh` | `swk` | `slg` | `trg` | `kul` | `pjy` | `pls` | `lbn` | `wps`

**Response Body:**
```json
{
  "data_last_updated": "string",
  "data_next_update": "string",
  "snapshot_bar": {
    "data": [
      { "x": "string", "y": 0 }
    ]
  },
  "snapshot_graphic": {
    "cases": { "active": 0, "local": 0, "import": 0, "recovered": 0 },
    "admitted": {},
    "deaths": {},
    "icu": {},
    "vent": {}
  },
  "snapshot_table": {
    "data": [
      {
        "state": "state_code",
        "deaths": 0,
        "cases": 0,
        "admitted": 0
      }
    ]
  },
  "timeseries": {
    "daily_7d": {
      "x": [],
      "y": [],
      "admitted": [],
      "cases": [],
      "deaths_inpatient": [],
      "deaths_brought_in": [],
      "icu": [],
      "tests_pcr": [],
      "tests_rtk": [],
      "vent": []
    },
    "daily": {},
    "monthly": {},
    "yearly": {}
  },
  "statistics": {
    "cases": { "annot1": "string", "annot2": "string" },
    "deaths": { "annot1": "string", "annot2": "string" },
    "admitted": {},
    "icu": {},
    "tests": {},
    "vent": {}
  }
}
```

**Frontend file:** `apps/kkmnow/pages/dashboard/covid-19/[[...state]].tsx`

---

### 3.2 COVID-19 Vaccination Dashboard

```
GET /dashboards/covid-vax-{state_code}.json
```

**Response Body:**
```json
{
  "data_last_updated": "string",
  "data_next_update": "string",
  "waffle": {
    "total": { "dose1": {}, "dose2": {}, "booster1": {}, "booster2": {} },
    "adult": {},
    "adolescent": {},
    "child": {},
    "elderly": {}
  },
  "bar_chart": {
    "dose1": [{ "x": "string", "y": 0 }],
    "dose2": [],
    "booster1": [],
    "booster2": []
  },
  "timeseries": {
    "daily_7d": {
      "x": [],
      "y": [],
      "primary": [],
      "booster": [],
      "booster2": [],
      "adult": [],
      "adol": [],
      "child": []
    },
    "daily": {},
    "monthly": {},
    "yearly": {}
  },
  "statistics": {
    "daily": { "latest": 0, "total": 0 },
    "daily_adult": {},
    "daily_adol": {},
    "daily_booster": {},
    "daily_booster2": {},
    "daily_primary": {}
  },
  "snapshot": {
    "data_as_of": "string",
    "data": [
      {
        "state": "state_code",
        "total": {
          "perc_dose1": 0,
          "perc_dose2": 0,
          "perc_booster1": 0,
          "perc_booster2": 0
        },
        "adult": {},
        "adol": {},
        "child": {}
      }
    ]
  }
}
```

**Frontend file:** `apps/kkmnow/pages/dashboard/covid-vaccination/[[...state]].tsx`

---

### 3.3 Blood Donation Dashboard

```
GET /dashboards/blood-donation-{state_code}.json
```

**State codes:** Same as COVID-19, EXCEPT excludes `pjy`, `pls`, `lbn`

**Response Body:**
```json
{
  "data_last_updated": "string",
  "data_next_update": "string",
  "timeseries_all": {
    "daily_7d": { "x": [], "y": [] },
    "daily": { "x": [], "y": [] },
    "monthly": { "x": [], "y": [] },
    "yearly": { "x": [], "y": [] }
  },
  "bar_chart_age": {
    "past_year": { "x": ["age_group", "..."], "y": [0, "..."] },
    "past_month": { "x": [], "y": [] }
  },
  "bar_chart_time": {
    "data": {
      "annual": { "x": ["year", "..."], "y": [0, "..."] },
      "monthly": { "x": ["yyyy-MM-dd", "..."], "y": [0, "..."] }
    }
  },
  "barchart_key_variables": {
    "yesterday": {
      "blood_group": { "x": [], "y": [] },
      "donation_type": { "x": [], "y": [] },
      "location": { "x": [], "y": [] },
      "donation_regularity": { "x": [], "y": [] },
      "social_group": { "x": [], "y": [] }
    },
    "past_month": {},
    "past_year": {}
  },
  "choropleth_malaysia": {
    "x": ["state_code", "..."],
    "y": {
      "perc": [0, "..."]
    }
  }
}
```

**Frontend note:** The frontend transforms `bar_chart_time.data.monthly.x` dates to month abbreviations (e.g. "Jan", "Feb") with year shown for January.

**Frontend file:** `apps/kkmnow/pages/dashboard/blood-donation/index.tsx`

---

### 3.4 Organ Donation Dashboard

```
GET /dashboards/organ-donation-{state_code}.json
```

**Response Body:**
```json
{
  "data_last_updated": "string",
  "data_next_update": "string",
  "timeseries": {
    "daily_7d": { "x": [], "y": [] },
    "daily": { "x": [], "y": [] },
    "monthly": { "x": [], "y": [] },
    "yearly": { "x": [], "y": [] }
  },
  "choropleth_malaysia": {
    "x": ["state_code", "..."],
    "y": {
      "perc": [0, "..."]
    }
  },
  "barchart_age": {
    "past_year": { "x": [], "y": [] },
    "past_month": { "x": [], "y": [] }
  },
  "barchart_time": {
    "data": {
      "annual": { "x": [], "y": [] },
      "monthly": { "x": ["yyyy-MM-dd", "..."], "y": [] }
    }
  }
}
```

**Frontend note:** Same date transformation as blood donation for `barchart_time.data.monthly.x`.

**Frontend file:** `apps/kkmnow/pages/dashboard/organ-donation/index.tsx`

---

### 3.5 PEKA B40 Dashboard

```
GET /dashboards/peka-b40-{state_code}.json
```

**Response Body:**
```json
{
  "data_last_updated": "string",
  "data_next_update": "string",
  "timeseries": {
    "daily_7d": { "x": [], "y": [] },
    "daily": { "x": [], "y": [] },
    "monthly": { "x": [], "y": [] },
    "yearly": { "x": [], "y": [] }
  },
  "choropleth_malaysia": {
    "x": ["state_code", "..."],
    "y": {
      "perc": [0, "..."]
    }
  }
}
```

**Frontend file:** `apps/kkmnow/pages/dashboard/peka-b40/index.tsx`

---

## 4. State Codes Reference

| Code | State |
|------|-------|
| `mys` | Malaysia (national aggregate) |
| `jhr` | Johor |
| `kdh` | Kedah |
| `ktn` | Kelantan |
| `mlk` | Melaka |
| `nsn` | Negeri Sembilan |
| `phg` | Pahang |
| `prk` | Perak |
| `png` | Pulau Pinang |
| `sbh` | Sabah |
| `swk` | Sarawak |
| `slg` | Selangor |
| `trg` | Terengganu |
| `kul` | Kuala Lumpur |
| `pjy` | Putrajaya |
| `pls` | Perlis |
| `lbn` | Labuan |
| `wps` | W.P. (combined federal territories) |

---

## 5. Common Response Patterns

### Timeseries Structure
All timeseries data follows this period-based pattern:
```json
{
  "daily_7d": { "x": ["date", "..."], "y": ["value", "..."] },
  "daily":    { "x": ["date", "..."], "y": ["value", "..."] },
  "monthly":  { "x": ["date", "..."], "y": ["value", "..."] },
  "yearly":   { "x": ["date", "..."], "y": ["value", "..."] }
}
```

### Choropleth Structure
```json
{
  "x": ["state_code", "..."],
  "y": { "metric_name": [0, "..."] }
}
```

### Common Metadata Fields
Every dashboard response includes:
- `data_last_updated`: ISO date string of when data was last updated
- `data_next_update`: ISO date string of next expected update

---

## 6. Environment Variables Required

| Variable | Purpose | Used By |
|----------|---------|---------|
| `NEXT_PUBLIC_API_URL` | FastAPI backend base URL | All dynamic API calls |
| `NEXT_PUBLIC_S3_URL` | S3 bucket for static dashboard JSONs | Dashboard data fetching |
| `NEXT_PUBLIC_APP_URL` | Frontend app URL (self-reference) | Internal API routes |
| `NEXT_PUBLIC_AUTHORIZATION_TOKEN` | Server-side Bearer token | SSR/SSG API calls |
| `REVALIDATE_TOKEN` | ISR revalidation webhook auth | Backend -> Frontend cache invalidation |
| `NEXT_PUBLIC_AI_URL` | AI streaming service URL | AI features (if any) |
| `NEXT_PUBLIC_I18N_URL` | i18n translation CDN | Localization assets |
| `EDGE_CONFIG` | Vercel Edge Config URL | Rolling token management |

---

## 7. Backend-to-Frontend Webhook

The backend should call this endpoint to invalidate cached pages after data updates:

```
POST {FRONTEND_URL}/api/revalidate
```

**Headers:**
```
Authorization: Bearer {REVALIDATE_TOKEN}
Content-Type: application/json
```

**Body:**
```json
{
  "route": "/dashboard/covid-19,/dashboard/blood-donation"
}
```

**Supported routes:**
- `/` (homepage)
- `/dashboard/covid-19` (+ auto-revalidates all state variants)
- `/dashboard/covid-vaccination` (+ auto-revalidates all state variants)
- `/dashboard/blood-donation`
- `/dashboard/organ-donation`
- `/dashboard/peka-b40`
- `/dashboard/hospital-bed-utilisation`
- `/ms-MY/...` variants (auto-handled for covid/vaccination)

---

## 8. FastAPI Implementation Checklist

### Priority 1 - Core Dynamic Endpoints
- [ ] `GET /dashboard/` with `dashboard=kkmnow_homepage`
- [ ] `GET /dashboard` with `dashboard=bed_util&hospital={name}`
- [ ] `GET /data-catalogue` (list with filters)
- [ ] `GET /data-catalogue/{id}` (detail with filters)

### Priority 2 - Static Dashboard Data (S3 or API)
- [ ] COVID-19 epidemic data per state (18 variants)
- [ ] COVID-19 vaccination data per state (18 variants)
- [ ] Blood donation data per state (~15 variants)
- [ ] Organ donation data per state (~18 variants)
- [ ] PEKA B40 data per state (~18 variants)

### Priority 3 - Supporting Features
- [ ] Bearer token authentication middleware
- [ ] CORS configuration for frontend domains
- [ ] Response caching strategy
- [ ] Data pipeline to generate/update dashboard JSONs

---

## 9. Verification Plan

1. **Unit test each endpoint** against the response schemas above
2. **Integration test:** Run the Next.js frontend locally with `NEXT_PUBLIC_API_URL` pointing to local FastAPI
3. **Verify pages load:**
   - Homepage (`/`) - check keystats render
   - Each dashboard page with `mys` state code
   - Data catalogue index and a detail page
   - Hospital bed utilisation with default hospital
4. **Verify state variants:** Test at least one dashboard with a non-`mys` state
5. **Verify revalidation:** POST to `/api/revalidate` and confirm page cache updates

---

## 10. Key Files Reference

| Purpose | File Path |
|---------|-----------|
| API utility (get/post/put/stream) | `packages/datagovmy-ui/src/lib/api.ts` |
| Homepage page | `apps/kkmnow/pages/index.tsx` |
| COVID-19 page | `apps/kkmnow/pages/dashboard/covid-19/[[...state]].tsx` |
| COVID Vaccination page | `apps/kkmnow/pages/dashboard/covid-vaccination/[[...state]].tsx` |
| Blood Donation page | `apps/kkmnow/pages/dashboard/blood-donation/index.tsx` |
| Organ Donation page | `apps/kkmnow/pages/dashboard/organ-donation/index.tsx` |
| PEKA B40 page | `apps/kkmnow/pages/dashboard/peka-b40/index.tsx` |
| Hospital Bed Utilisation page | `apps/kkmnow/pages/dashboard/hospital-bed-utilisation/[[...hospital]].tsx` |
| Data Catalogue list page | `apps/kkmnow/pages/data-catalogue/index.tsx` |
| Data Catalogue detail page | `apps/kkmnow/pages/data-catalogue/[id].tsx` |
| Revalidation API route | `apps/kkmnow/pages/api/revalidate.ts` |
| Route definitions | `apps/kkmnow/lib/routes.ts` |
| Environment variables template | `apps/kkmnow/.env.example` |
