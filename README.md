# KKMNow Frontend

KKMNow (Kementerian Kesihatan Malaysia Now) is the official health data portal by the Ministry of Health Malaysia. It provides near real-time dashboards on blood donation, organ donation, COVID-19, healthcare facilities, and more.

**Live site:** [data.moh.gov.my](https://data.moh.gov.my)

## Architecture

```
                    ┌─────────────────┐
                    │    CloudFront    │
                    │   (CDN Cache)    │
                    └────────┬────────┘
                             │
                    ┌────────┴────────┐
                    │       ALB       │
                    │ (Load Balancer) │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │                             │
     ┌────────┴───────┐          ┌─────────┴────────┐
     │  ECS Fargate   │          │   ECS Fargate    │
     │  (Frontend)    │          │   (Backend API)  │
     │  Next.js :3000 │          │   Django :8000   │
     └────────────────┘          └──────────────────┘
                                          │
              ┌───────────────────────────┼──────────────┐
              │                           │              │
        ┌─────┴──────┐            ┌──────┴─────┐  ┌─────┴──────┐
        │  Aurora DB  │            │   Redis    │  │   S3 + CF  │
        │ PostgreSQL  │            │ (Cache)    │  │ (Datasets) │
        └────────────┘            └────────────┘  └────────────┘
```

### Rendering Strategy

The application uses a **hybrid rendering** approach:

| Mode | Pages | % Traffic | Description |
|---|---|---|---|
| **SSG + ISR** | Dashboards, Home, 404/500 | ~85% | Static generation with 24h Incremental Static Regeneration |
| **SSR** | Data Catalogue | ~15% | Server-side rendered per request |
| **API Routes** | `/api/revalidate`, `/api/embed`, `/api/health` | <1% | On-demand ISR trigger, metadata, health check |

This is **not** a static SPA — it requires a Node.js server for ISR, SSR, API routes, and middleware.

## Tech Stack

- **Framework:** Next.js 13 (Pages Router)
- **Language:** TypeScript
- **UI:** React 18, Tailwind CSS
- **Monorepo:** Turborepo, Yarn 1.22 workspaces
- **Runtime:** Node.js >= 22.0.0
- **Deployment:** AWS ECS Fargate + CloudFront
- **IaC:** AWS CDK (CloudFormation)
- **CI/CD:** GitLab CI

## Project Structure

```
kkmnow-front/
├── apps/
│   └── kkmnow/              # Next.js frontend application
│       ├── dashboards/       # Dashboard components (blood-donation, covid-19, etc.)
│       ├── pages/            # Next.js pages (SSG/SSR/API routes)
│       ├── middleware.ts     # Auth token middleware
│       ├── Dockerfile        # Multi-stage Docker build
│       └── next.config.js    # Next.js config (standalone output)
├── packages/
│   ├── datagovmy-ui/         # Shared UI components, API utilities, charts
│   ├── datagovmy-nextra/     # Nextra documentation theme
│   ├── tsconfig/             # Shared TypeScript + Tailwind configs
│   └── eslint-config-datagovmy/  # Shared ESLint config
├── lambda/
│   └── roll_auth_token/      # Auth token rotation Lambda
├── infra/
│   └── frontend/             # AWS CDK infrastructure
├── .gitlab-ci.yml            # CI/CD pipeline
├── turbo.json                # Turborepo pipeline config
└── package.json              # Workspace root
```

## Local Development

### Prerequisites

- Node.js >= 22.0.0
- Yarn 1.22.x
- Git

### Setup

```bash
git clone https://github.com/MoH-Malaysia/kkmnow-front.git
cd kkmnow-front
yarn install
yarn prepare

# Configure environment
cp apps/kkmnow/.env.example apps/kkmnow/.env
# Edit apps/kkmnow/.env with your values

# Start dev server
yarn dev --filter=kkmnow
# Open http://localhost:3000
```

### Commands

```bash
yarn dev --filter=kkmnow    # Start dev server
yarn build --filter=kkmnow  # Production build
yarn lint --filter=kkmnow   # Run ESLint
yarn build                  # Build all workspaces
```

## Environment Variables

### Build-time Variables (`NEXT_PUBLIC_*`)

Baked into the JavaScript bundle at build time. Must be set as Docker `--build-arg` in CI/CD.

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | Yes | Public application URL (e.g. `https://data.moh.gov.my`) |
| `NEXT_PUBLIC_API_URL` | Yes | Backend API endpoint |
| `NEXT_PUBLIC_S3_URL` | Yes | CloudFront URL for kkmnow-dataset S3 bucket |
| `NEXT_PUBLIC_APP_ENV` | Yes | `development`, `staging`, or `production` |
| `NEXT_PUBLIC_API_KEY` | Yes | API key for backend (API Gateway) |
| `NEXT_PUBLIC_AUTHORIZATION_TOKEN` | Yes | Auth token for API requests |
| `NEXT_PUBLIC_GA_TAG` | No | Google Analytics tag |
| `NEXT_PUBLIC_MIXPANEL_TOKEN` | No | Mixpanel analytics token |
| `NEXT_PUBLIC_TINYBIRD_TOKEN` | No | Tinybird analytics token |
| `NEXT_PUBLIC_TINYBIRD_URL` | No | Tinybird API URL |
| `NEXT_PUBLIC_TILESERVER_URL` | No | Map tile server URL |

### Runtime Variables (server-only)

Injected via ECS task definition at container start time.

| Variable | Required | Description |
|---|---|---|
| `REVALIDATE_TOKEN` | Yes | Bearer token for `/api/revalidate` ISR endpoint |
| `AUTH_TOKEN` | Staging | Basic auth password for staging environment |
| `ROLLING_TOKEN` | Yes | Rolling auth token (from SSM Parameter Store) |
| `NODE_ENV` | Yes | `production` (set in Dockerfile) |
| `PORT` | Yes | `3000` (set in Dockerfile) |

## AWS Deployment

### Infrastructure Overview

| Component | Details |
|---|---|
| **Region** | ap-southeast-5 (Jakarta) |
| **CloudFront** | CDN with 4 cache behaviors |
| **ALB** | Routes frontend (default) and backend (`/api/v1/*`) |
| **ECS Fargate** | 2 tasks (multi-AZ), 512 CPU / 1024 MB, auto-scales to 6 |
| **Docker Image** | Multi-stage build with `output: 'standalone'` (~200 MB) |
| **Auto-Scaling** | CPU target 60%, request count per target 500/min |
| **ECR** | `kkmnow-frontend` repository |

### CloudFront Cache Behaviors

| Path Pattern | Strategy | TTL |
|---|---|---|
| `/_next/static/*` | Immutable (content-hashed) | 365 days |
| `/static/*`, `/favicon.ico` | Public assets | 24 hours |
| `/data-catalogue*` | SSR, origin-controlled | `s-maxage=21600` (6h) |
| `/*` (default) | ISR, origin-controlled | `s-maxage=86400` (24h) |

`Accept-Language` is included in the cache key for non-static behaviors to serve EN and MS-MY content correctly.

### CDK Infrastructure

The frontend infrastructure is defined in `infra/frontend/` using AWS CDK (TypeScript).

```bash
cd infra/frontend
npm install
npx cdk synth    # Preview CloudFormation template
npx cdk deploy   # Deploy to AWS
npx cdk diff     # Show pending changes
```

**Stack:** `KkmnowStagingFrontend` — creates ECR repo, ECS task definition + service, ALB target group + listener rules, CloudFront distribution, and auto-scaling policies.

Shared resources (VPC, ECS cluster, ALB, secrets) are imported from existing backend stacks.

## First-Time Deployment Setup

This guide walks through deploying the frontend from scratch to a new AWS environment.

### Prerequisites

- AWS CLI v2 configured with appropriate profile
- AWS CDK CLI (`npm install -g aws-cdk`)
- Docker Desktop (or Docker Engine with BuildKit)
- Node.js >= 22.0.0

### Step 1: Bootstrap CDK (if not already done)

```bash
cd infra/frontend
npx cdk bootstrap aws://ACCOUNT_ID/ap-southeast-5 --profile YOUR_PROFILE
```

### Step 2: Prepare Secrets Manager

The ECS task definition expects these keys in your Secrets Manager secret. Create or update the secret before deploying:

```bash
aws secretsmanager create-secret \
  --name "kkmnow/staging/app-config" \
  --secret-string '{
    "REVALIDATE_TOKEN": "your-revalidate-token",
    "AUTH_TOKEN_SECRET": "your-basic-auth-password",
    "ROLLING_TOKEN": "your-rolling-token"
  }' \
  --profile YOUR_PROFILE --region ap-southeast-5
```

> **Important:** All three keys (`REVALIDATE_TOKEN`, `AUTH_TOKEN_SECRET`, `ROLLING_TOKEN`) **must exist** in the secret JSON. Missing keys will prevent ECS containers from launching entirely.

### Step 3: Deploy CDK Infrastructure (without ECS service)

On first deploy, the ECR repository has no images. The ECS service will fail if it tries to pull a non-existent image. To handle this:

1. **Deploy the stack** — with circuit breaker disabled temporarily in `frontend-stack.ts`:
   ```typescript
   circuitBreaker: { enable: false },
   ```

2. **Run CDK deploy:**
   ```bash
   cd infra/frontend
   npm install
   npx cdk deploy --profile YOUR_PROFILE --require-approval never
   ```

3. The stack will create all resources. The ECS service will cycle tasks (they'll crash since there's no valid image yet), but without circuit breaker, CloudFormation won't roll back.

### Step 4: Build and Push Docker Image

```bash
cd /path/to/kkmnow-front

# Source environment variables (resolves $VAR references in .env)
set -a && source apps/kkmnow/.env && set +a

# Build for AMD64 (ECS Fargate architecture — critical on Apple Silicon Macs)
docker build \
  --platform linux/amd64 \
  -f apps/kkmnow/Dockerfile \
  --build-arg NEXT_PUBLIC_APP_URL="$NEXT_PUBLIC_APP_URL" \
  --build-arg NEXT_PUBLIC_API_URL="$NEXT_PUBLIC_API_URL" \
  --build-arg NEXT_PUBLIC_S3_URL="$NEXT_PUBLIC_S3_URL" \
  --build-arg NEXT_PUBLIC_APP_ENV=staging \
  --build-arg NEXT_PUBLIC_API_KEY="$NEXT_PUBLIC_API_KEY" \
  --build-arg NEXT_PUBLIC_AUTHORIZATION_TOKEN="$NEXT_PUBLIC_AUTHORIZATION_TOKEN" \
  --build-arg NEXT_PUBLIC_GA_TAG="$NEXT_PUBLIC_GA_TAG" \
  --build-arg NEXT_PUBLIC_MIXPANEL_TOKEN="$NEXT_PUBLIC_MIXPANEL_TOKEN" \
  --build-arg NEXT_PUBLIC_TINYBIRD_TOKEN="$NEXT_PUBLIC_TINYBIRD_TOKEN" \
  --build-arg NEXT_PUBLIC_TINYBIRD_URL="$NEXT_PUBLIC_TINYBIRD_URL" \
  --build-arg NEXT_PUBLIC_TILESERVER_URL="$NEXT_PUBLIC_TILESERVER_URL" \
  --build-arg NEXT_PUBLIC_I18N_URL="$NEXT_PUBLIC_I18N_URL" \
  -t ACCOUNT_ID.dkr.ecr.ap-southeast-5.amazonaws.com/kkmnow-frontend:latest \
  .

# Authenticate and push to ECR
aws ecr get-login-password --profile YOUR_PROFILE --region ap-southeast-5 \
  | docker login --username AWS --password-stdin ACCOUNT_ID.dkr.ecr.ap-southeast-5.amazonaws.com

docker push ACCOUNT_ID.dkr.ecr.ap-southeast-5.amazonaws.com/kkmnow-frontend:latest
```

> **Warning:** Always use `--platform linux/amd64` when building on Apple Silicon (M1/M2/M3). Without it, Docker builds an ARM64 image that causes `exec format error` on ECS Fargate (x86_64).

> **Warning:** Use `set -a && source apps/kkmnow/.env && set +a` (not just `export $(grep NEXT_PUBLIC_ .env)`). The `.env` file uses variable references like `NEXT_PUBLIC_API_KEY=$API_KEY` that need the full file sourced to resolve.

### Step 5: Force ECS Deployment

```bash
aws ecs update-service \
  --cluster kkmnow-staging \
  --service kkmnow-frontend-staging \
  --force-new-deployment \
  --profile YOUR_PROFILE --region ap-southeast-5
```

Wait for tasks to become healthy:

```bash
aws ecs wait services-stable \
  --cluster kkmnow-staging \
  --services kkmnow-frontend-staging \
  --profile YOUR_PROFILE --region ap-southeast-5
```

### Step 6: Re-enable Circuit Breaker

Once tasks are running healthy, update `frontend-stack.ts` to re-enable the circuit breaker:

```typescript
circuitBreaker: { enable: true, rollback: true },
```

Then redeploy:

```bash
cd infra/frontend
npx cdk deploy --profile YOUR_PROFILE --require-approval never
```

### Step 7: Verify Deployment

```bash
# Health check (should return 200 with JSON)
curl -s https://YOUR_CLOUDFRONT_DOMAIN/api/health

# Homepage (staging returns 401 Basic Auth — expected)
curl -sI https://YOUR_CLOUDFRONT_DOMAIN/

# Static assets (should have long cache headers)
curl -sI https://YOUR_CLOUDFRONT_DOMAIN/_next/static/chunks/main-*.js | grep cache-control
```

### Step 8: Configure GitLab CI/CD

Add the following variables in GitLab project settings (Settings > CI/CD > Variables):

| Variable | Value | Protected | Masked |
|---|---|---|---|
| `NEXT_PUBLIC_APP_URL` | `https://your-domain.com` | No | No |
| `NEXT_PUBLIC_API_URL` | Backend API endpoint | No | No |
| `NEXT_PUBLIC_S3_URL` | CloudFront URL for datasets | No | No |
| `NEXT_PUBLIC_APP_ENV` | `staging` or `production` | No | No |
| `NEXT_PUBLIC_API_KEY` | API key | Yes | Yes |
| `NEXT_PUBLIC_AUTHORIZATION_TOKEN` | Auth token | Yes | Yes |
| `NEXT_PUBLIC_I18N_URL` | CloudFront URL for i18n | No | No |
| `NEXT_PUBLIC_GA_TAG` | Google Analytics tag | No | No |
| `NEXT_PUBLIC_MIXPANEL_TOKEN` | Mixpanel token | No | No |
| `CF_DISTRIBUTION_ID` | CloudFront distribution ID | No | No |
| `HEALTH_CHECK_URL` | `https://your-cloudfront-domain` | No | No |

> **AWS credentials are NOT needed** — the GitLab runner uses an EC2 instance profile with IAM role `gitlab-runner-autoscaled-RunnerWorkerRole-AYQcrmOCa7bc`.

### Step 9: Add CloudFront Invalidation Permission

Add an inline policy to the GitLab runner IAM role:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "FrontendCloudFrontInvalidation",
      "Effect": "Allow",
      "Action": "cloudfront:CreateInvalidation",
      "Resource": "arn:aws:cloudfront::ACCOUNT_ID:distribution/YOUR_DISTRIBUTION_ID"
    }
  ]
}
```

### Common Issues

| Issue | Cause | Fix |
|---|---|---|
| `exec format error` | ARM64 image on x86_64 Fargate | Add `--platform linux/amd64` to docker build |
| Container exit code 255, no logs | Missing Secrets Manager keys | Ensure all keys (`REVALIDATE_TOKEN`, `AUTH_TOKEN_SECRET`, `ROLLING_TOKEN`) exist |
| ECS circuit breaker rollback on first deploy | No image in ECR | Disable circuit breaker, deploy stack, push image, re-enable |
| 403 during Docker build (static generation) | Env vars not resolved | Source full `.env` with `set -a && source .env && set +a` |
| 401 Basic Auth on staging | Expected behavior | Middleware enforces Basic Auth when `NEXT_PUBLIC_APP_ENV=staging` |
| Health check works but pages don't | Health check bypasses middleware | `/api/*` routes aren't matched by middleware |

## CI/CD Pipeline

The GitLab CI pipeline (`.gitlab-ci.yml`) automates the full deployment lifecycle. The GitLab runner uses an EC2 instance profile with IAM role — **no AWS credentials are stored in CI/CD variables**.

```
lint → build → push → deploy → verify
```

| Stage | What it does | When |
|---|---|---|
| **lint** | `turbo run lint --filter=kkmnow` | Merge requests only |
| **build** | Docker multi-stage build with `NEXT_PUBLIC_*` args | `staging` or `main` branch |
| **push** | Push to ECR (`:$COMMIT_SHA` + `:latest`) | `staging` or `main` branch |
| **deploy** | ECS rolling update (`--force-new-deployment`) | `staging`: auto, `main`: manual approval |
| **verify** | CloudFront invalidation + health check | After deploy |

### GitLab CI/CD Variables

| Variable | Type | Purpose |
|---|---|---|
| `AWS_DEFAULT_REGION` | Variable | `ap-southeast-5` |
| `ECR_REGISTRY` | Variable | `624693141495.dkr.ecr.ap-southeast-5.amazonaws.com` |
| `NEXT_PUBLIC_*` | Variables | Build-time env vars (see table above) |
| `CF_DISTRIBUTION_ID` | Variable | Frontend CloudFront distribution ID |
| `HEALTH_CHECK_URL` | Variable | URL for post-deploy smoke test |

### Branch Strategy

- `staging` branch → auto-deploy to staging
- `main` branch → manual approval gate for production

### Rollback

ECS uses rolling deployments with circuit breaker. If new tasks fail health checks, the deployment rolls back automatically. Manual rollback:

```bash
aws ecs update-service --cluster kkmnow-staging \
  --service kkmnow-frontend-staging \
  --task-definition kkmnow-frontend:<previous-revision>
```

## ISR & Caching

### How ISR works on ECS

1. Pages are pre-rendered at build time or on first request (`fallback: 'blocking'`)
2. Next.js serves from filesystem cache (`.next/cache`) for the ISR TTL period (24h)
3. After TTL expires, the next request triggers background regeneration — stale content is served immediately while the page rebuilds
4. On-demand revalidation: backend POSTs to `/api/revalidate` with a bearer token to refresh specific pages

### Multi-task consistency

With 2+ Fargate tasks, each has its own ISR cache. On-demand revalidation hits one task via ALB round-robin. The other task self-heals within its own TTL (24h). CloudFront further masks this — once any task returns fresh content, CloudFront caches it for all users.

### IAM Permissions (GitLab Runner)

The runner role (`gitlab-runner-autoscaled-RunnerWorkerRole-AYQcrmOCa7bc`) already has:
- ECR full access (push/pull images)
- ECS service management (update, describe)
- CDK deployment (assume `cdk-*` roles)
- S3 full access

**One additional policy needed:** `cloudfront:CreateInvalidation` for the frontend CloudFront distribution. Add after `cdk deploy` creates the distribution.

## Contributing

1. Branch from `staging` with a descriptive name: `feat/xxx`, `fix/xxx`
2. Develop and test locally
3. `git fetch && git merge origin/staging` to sync changes
4. Push and create a merge request to `staging`
5. Assign a reviewer and wait for approval

## License

[MIT](./LICENSE.md) — Copyright 2023-2026 Ministry of Health Malaysia
