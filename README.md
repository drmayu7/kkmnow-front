# KKMNow Frontend

KKMNow (Kementerian Kesihatan Malaysia Now) is the official health data portal by the Ministry of Health Malaysia. It provides near real-time dashboards on blood donation, organ donation, COVID-19, healthcare facilities, and more.

**Live site:** [data.moh.gov.my](https://data.moh.gov.my)

## Architecture

```
                 ┌──────────────────────────────────────────────┐
                 │               CloudFront (CDN)                │
                 │   Staging: d1zofdcmpfqbdi.cloudfront.net      │
                 │   Production: <prod-cf-domain>.cloudfront.net │
                 └─────────────────┬────────────────────────────┘
                                   │
              ┌────────────────────┴─────────────────────┐
              │                                          │
   ┌──────────┴──────────┐                   ┌──────────┴──────────┐
   │   Staging ALB :3000  │                   │  Production ALB :3000│
   │  kkmnow-staging-alb  │                   │ kkmnow-production-alb│
   └──────────┬──────────┘                   └──────────┬──────────┘
              │                                          │
   ┌──────────┴──────────┐                   ┌──────────┴──────────┐
   │  ECS Fargate (2-6)  │                   │  ECS Fargate (2-10) │
   │  kkmnow-staging      │                   │  kkmnow-production  │
   │  Next.js :3000       │                   │  Next.js :3000      │
   └─────────────────────┘                   └─────────────────────┘
                              │
              ┌───────────────┼──────────────┐
              │               │              │
        ┌─────┴──────┐  ┌────┴──────┐  ┌───┴───────┐
        │  Aurora DB  │  │   Redis   │  │  S3 + CF  │
        │ PostgreSQL  │  │  (Cache)  │  │ (Datasets)│
        └────────────┘  └───────────┘  └───────────┘
```

Both environments share the same **VPC**, **ECR repository**, and **backend infrastructure** (Aurora, Redis, S3). Each environment has its own CloudFront distribution, ALB listener, ECS cluster/service, and Secrets Manager secret.

### Rendering Strategy

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
│   └── frontend/             # AWS CDK infrastructure (staging + production)
├── scripts/
│   └── k6-load-test.js       # k6 load test script
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
| `NEXT_PUBLIC_I18N_URL` | Yes | CloudFront URL for i18n translations |
| `NEXT_PUBLIC_APP_ENV` | Yes | `development`, `staging`, or `production` |
| `NEXT_PUBLIC_API_KEY` | Yes | API key for backend (API Gateway) |
| `NEXT_PUBLIC_AUTHORIZATION_TOKEN` | Yes | Auth token for API requests |
| `NEXT_PUBLIC_GA_TAG` | No | Google Analytics tag |
| `NEXT_PUBLIC_MIXPANEL_TOKEN` | No | Mixpanel analytics token |
| `NEXT_PUBLIC_TINYBIRD_TOKEN` | No | Tinybird analytics token |
| `NEXT_PUBLIC_TINYBIRD_URL` | No | Tinybird API URL |
| `NEXT_PUBLIC_TILESERVER_URL` | No | Map tile server URL |

### Runtime Variables (server-only)

Injected via ECS task definition secrets at container start time. Stored in AWS Secrets Manager.

| Variable | Secret Key | Description |
|---|---|---|
| `REVALIDATE_TOKEN` | `REVALIDATE_TOKEN` | Bearer token for `/api/revalidate` ISR endpoint |
| `AUTH_TOKEN` | `AUTH_TOKEN_SECRET` | Basic auth password for staging environment |
| `ROLLING_TOKEN` | `ROLLING_TOKEN` | Rolling auth token for middleware |

Secrets Manager paths:
- Staging: `kkmnow/staging/app-config`
- Production: `kkmnow/production/app-config`

## AWS Deployment

### Infrastructure Overview

| Component | Staging | Production |
|---|---|---|
| **Region** | ap-southeast-5 (Jakarta) | ap-southeast-5 (Jakarta) |
| **ECS Cluster** | `kkmnow-staging` | `kkmnow-production` |
| **ECS Service** | `kkmnow-frontend-staging` | `kkmnow-frontend-production` |
| **Tasks** | 2 desired, auto-scales to 6 | 2 desired, auto-scales to 10 |
| **Task Size** | 1 vCPU / 2 GB | 1 vCPU / 2 GB |
| **ALB** | `kkmnow-staging-alb` (port 3000) | `kkmnow-production-alb` (port 3000) |
| **CloudFront** | `E2IEQUEBP9SU1W` | *(from CDK output after first deploy)* |
| **ECR Image Tag** | `:staging` | `:main` |
| **Secrets Manager** | `kkmnow/staging/app-config` | `kkmnow/production/app-config` |

### CloudFront Cache Behaviors

| Path Pattern | Strategy | TTL |
|---|---|---|
| `/_next/static/*` | Immutable (content-hashed) | 365 days |
| `/static/*` | Public assets | 24 hours |
| `/data-catalogue*` | SSR, short default TTL | 60s default, up to 6h |
| `/*` (default) | ISR, origin-controlled | 0s default, up to 24h |

`Accept-Language` is included in the cache key for non-static behaviors to serve EN and BM content correctly.

### CDK Infrastructure

The frontend infrastructure is defined in `infra/frontend/` using AWS CDK (TypeScript). The same `FrontendStack` class creates both staging and production with environment-specific configuration.

```bash
cd infra/frontend
npm install

# Preview changes (no deployment)
npx cdk diff KkmnowStagingFrontend --profile persis-pik
npx cdk diff KkmnowProductionFrontend --profile persis-pik

# Deploy individual environments
npx cdk deploy KkmnowStagingFrontend --profile persis-pik
npx cdk deploy KkmnowProductionFrontend --profile persis-pik

# Deploy both at once
npx cdk deploy --all --profile persis-pik
```

## First-Time Deployment Setup

### Prerequisites

- AWS CLI v2 configured with profile `persis-pik`
- AWS CDK CLI: `npm install -g aws-cdk`
- Docker Desktop (or Docker Engine with BuildKit)
- Node.js >= 22.0.0

### Staging (already deployed)

Staging infrastructure is live. To redeploy after CDK changes:

```bash
cd infra/frontend
npx cdk deploy KkmnowStagingFrontend --profile persis-pik
```

### Production (first-time bootstrap)

Follow these steps to bring up the production frontend for the first time.

#### Step 1: Verify Secrets Manager

Ensure all required keys exist in `kkmnow/production/app-config`:

```bash
aws secretsmanager get-secret-value \
  --secret-id kkmnow/production/app-config \
  --profile persis-pik --region ap-southeast-5 \
  --query 'SecretString' --output text | python3 -m json.tool
```

Required keys: `REVALIDATE_TOKEN`, `AUTH_TOKEN_SECRET`, `ROLLING_TOKEN`

To update missing keys:

```bash
aws secretsmanager update-secret \
  --secret-id kkmnow/production/app-config \
  --secret-string '{
    "REVALIDATE_TOKEN": "your-revalidate-token",
    "AUTH_TOKEN_SECRET": "your-basic-auth-password",
    "ROLLING_TOKEN": "your-rolling-token"
  }' \
  --profile persis-pik --region ap-southeast-5
```

#### Step 2: Deploy CDK (circuit breaker disabled first)

On first deploy, ECR has no `:main` tag yet. Temporarily disable the circuit breaker in `frontend-stack.ts` to prevent CloudFormation rollback when tasks fail to start:

```typescript
// In frontend-stack.ts, temporarily change:
circuitBreaker: { enable: false },
```

Then deploy:

```bash
cd infra/frontend
npx cdk deploy KkmnowProductionFrontend --profile persis-pik --require-approval never
```

Note the CloudFront distribution ID from the CDK output — you will need it for GitLab CI/CD variables.

#### Step 3: Build and push production Docker image

```bash
cd /path/to/kkmnow-front

# Source environment variables (resolves $VAR references in .env)
set -a && source apps/kkmnow/.env && set +a

# Build for AMD64 (ECS Fargate architecture — critical on Apple Silicon Macs)
docker build \
  --platform linux/amd64 \
  -f apps/kkmnow/Dockerfile \
  --build-arg NEXT_PUBLIC_APP_URL="https://data.moh.gov.my" \
  --build-arg NEXT_PUBLIC_API_URL="$NEXT_PUBLIC_API_URL" \
  --build-arg NEXT_PUBLIC_S3_URL="$NEXT_PUBLIC_S3_URL" \
  --build-arg NEXT_PUBLIC_APP_ENV=production \
  --build-arg NEXT_PUBLIC_API_KEY="$NEXT_PUBLIC_API_KEY" \
  --build-arg NEXT_PUBLIC_AUTHORIZATION_TOKEN="$NEXT_PUBLIC_AUTHORIZATION_TOKEN" \
  --build-arg NEXT_PUBLIC_GA_TAG="$NEXT_PUBLIC_GA_TAG" \
  --build-arg NEXT_PUBLIC_MIXPANEL_TOKEN="$NEXT_PUBLIC_MIXPANEL_TOKEN" \
  --build-arg NEXT_PUBLIC_TINYBIRD_TOKEN="$NEXT_PUBLIC_TINYBIRD_TOKEN" \
  --build-arg NEXT_PUBLIC_TINYBIRD_URL="$NEXT_PUBLIC_TINYBIRD_URL" \
  --build-arg NEXT_PUBLIC_TILESERVER_URL="$NEXT_PUBLIC_TILESERVER_URL" \
  --build-arg NEXT_PUBLIC_I18N_URL="$NEXT_PUBLIC_I18N_URL" \
  -t 624693141495.dkr.ecr.ap-southeast-5.amazonaws.com/kkmnow-frontend:main \
  .

# Authenticate and push to ECR
aws ecr get-login-password --profile persis-pik --region ap-southeast-5 \
  | docker login --username AWS --password-stdin \
    624693141495.dkr.ecr.ap-southeast-5.amazonaws.com

docker push 624693141495.dkr.ecr.ap-southeast-5.amazonaws.com/kkmnow-frontend:main
```

#### Step 4: Force ECS deployment

```bash
aws ecs update-service \
  --cluster kkmnow-production \
  --service kkmnow-frontend-production \
  --force-new-deployment \
  --profile persis-pik --region ap-southeast-5

aws ecs wait services-stable \
  --cluster kkmnow-production \
  --services kkmnow-frontend-production \
  --profile persis-pik --region ap-southeast-5
```

#### Step 5: Re-enable circuit breaker

Once tasks are healthy, restore the circuit breaker in `frontend-stack.ts`:

```typescript
circuitBreaker: { enable: true, rollback: true },
```

Then redeploy:

```bash
cd infra/frontend
npx cdk deploy KkmnowProductionFrontend --profile persis-pik --require-approval never
```

#### Step 6: Verify

```bash
# Get the CloudFront domain from CDK output or:
PROD_CF=$(aws cloudformation describe-stacks \
  --stack-name KkmnowProductionFrontend \
  --profile persis-pik --region ap-southeast-5 \
  --query 'Stacks[0].Outputs[?OutputKey==`CloudFrontDomain`].OutputValue' \
  --output text)

curl -s "https://$PROD_CF/api/health"    # Should return {"status":"ok",...}
curl -sI "https://$PROD_CF/"             # Should return 200
```

#### Step 7: Configure GitLab CI/CD variables

See the **GitLab CI/CD Variables** section below.

#### Step 8: Add CloudFront invalidation IAM permission

Update the GitLab runner IAM policy `kkmnow-frontend-cloudfront-permission` to include the production distribution ARN. The policy should cover both distributions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "FrontendCloudFrontInvalidation",
      "Effect": "Allow",
      "Action": "cloudfront:CreateInvalidation",
      "Resource": [
        "arn:aws:cloudfront::624693141495:distribution/E2IEQUEBP9SU1W",
        "arn:aws:cloudfront::624693141495:distribution/<PROD_DISTRIBUTION_ID>"
      ]
    }
  ]
}
```

### Common Issues

| Issue | Cause | Fix |
|---|---|---|
| `exec format error` | ARM64 image on x86_64 Fargate | Add `--platform linux/amd64` to docker build |
| Container exit code 255, no logs | Missing Secrets Manager keys | Ensure all three keys exist in `app-config` secret |
| ECS circuit breaker rollback on first deploy | No image in ECR | Disable circuit breaker, deploy stack, push image, re-enable |
| 403 during Docker build (static generation) | Env vars not resolved | Source full `.env` with `set -a && source .env && set +a` |
| 401 Basic Auth on staging | Expected behavior | Middleware enforces Basic Auth when `NEXT_PUBLIC_APP_ENV=staging` |
| Health check works but pages don't | `/api/*` bypasses middleware | Expected — health check is designed to bypass auth |

## CI/CD Pipeline

The GitLab CI pipeline (`.gitlab-ci.yml`) automates the full deployment lifecycle. **No AWS credentials are stored in CI/CD variables** — the GitLab runner uses an EC2 instance profile.

### Pipeline Stages

```
MR:     quality
        └── lint + typecheck (parallel)

staging branch:
        quality → build_staging → deploy_staging → verify_staging → load_test_staging (manual)

main branch:
        quality → build_production → deploy_production (manual) → verify_production → load_test_production (manual)
```

| Stage | Job | When | Description |
|---|---|---|---|
| quality | `lint` | MR + staging/main | `turbo run lint --filter=kkmnow` |
| quality | `typecheck` | MR + staging/main | `tsc --noEmit` (allow_failure until TS errors fixed) |
| build-and-push | `build_staging` | staging branch | Docker build with staging vars → ECR `:staging` + `:<sha>` |
| build-and-push | `build_production` | main branch | Docker build with production vars → ECR `:main` + `:<sha>` |
| deploy | `deploy_staging` | staging branch | ECS rolling update, waits for stability |
| deploy | `deploy_production` | main branch | **Manual approval required**, then ECS rolling update |
| verify | `verify_staging` | after deploy_staging | CF invalidation + health check + homepage smoke test |
| verify | `verify_production` | after deploy_production | CF invalidation + health check + homepage smoke test |
| load-test | `load_test_staging` | manual (staging) | k6 load test, results saved as artifact |
| load-test | `load_test_production` | manual (main) | k6 load test, results saved as artifact |

### Why Separate Builds Per Environment

`NEXT_PUBLIC_*` variables are **baked into the JavaScript bundle** at Next.js build time. Since staging and production use different API URLs, app URLs, analytics tokens, and `NEXT_PUBLIC_APP_ENV` values, each environment requires a completely separate Docker build. A single "build once, deploy everywhere" approach is not possible with Next.js.

### GitLab CI/CD Variables

Configure in **Settings > CI/CD > Variables**.

#### Global Variables (All Environments)

| Variable | Value | Protected | Masked |
|---|---|---|---|
| `AWS_DEFAULT_REGION` | `ap-southeast-5` | No | No |
| `ECR_REGISTRY` | `624693141495.dkr.ecr.ap-southeast-5.amazonaws.com` | No | No |

#### Environment: `staging`

| Variable | Example Value | Protected | Masked |
|---|---|---|---|
| `NEXT_PUBLIC_APP_URL` | `https://d1zofdcmpfqbdi.cloudfront.net` | No | No |
| `NEXT_PUBLIC_API_URL` | `https://api-staging.data.gov.my` | No | No |
| `NEXT_PUBLIC_S3_URL` | `https://dlz3uh7rpztx1.cloudfront.net` | No | No |
| `NEXT_PUBLIC_I18N_URL` | `https://dlz3uh7rpztx1.cloudfront.net` | No | No |
| `NEXT_PUBLIC_APP_ENV` | `staging` | No | No |
| `NEXT_PUBLIC_API_KEY` | *(staging API key)* | Yes | Yes |
| `NEXT_PUBLIC_AUTHORIZATION_TOKEN` | *(staging auth token)* | Yes | Yes |
| `NEXT_PUBLIC_GA_TAG` | *(optional)* | No | No |
| `NEXT_PUBLIC_MIXPANEL_TOKEN` | *(staging token)* | No | Yes |
| `NEXT_PUBLIC_TINYBIRD_TOKEN` | *(staging token)* | No | Yes |
| `NEXT_PUBLIC_TINYBIRD_URL` | `https://api.tinybird.co` | No | No |
| `NEXT_PUBLIC_TILESERVER_URL` | *(tile server URL)* | No | No |
| `CF_DISTRIBUTION_ID` | `E2IEQUEBP9SU1W` | No | No |
| `HEALTH_CHECK_URL` | `https://d1zofdcmpfqbdi.cloudfront.net` | No | No |
| `BASIC_AUTH_PASS` | *(staging basic auth password)* | Yes | Yes |
| `LOAD_TEST_AUTH_USER` | `admin` | No | No |
| `LOAD_TEST_AUTH_PASS` | *(same as BASIC_AUTH_PASS)* | Yes | Yes |

#### Environment: `production`

> All production variables should be **Protected = Yes** so they are only injected on the `main` protected branch.

| Variable | Example Value | Protected | Masked |
|---|---|---|---|
| `NEXT_PUBLIC_APP_URL` | `https://data.moh.gov.my` | Yes | No |
| `NEXT_PUBLIC_API_URL` | `https://api.data.gov.my` | Yes | No |
| `NEXT_PUBLIC_S3_URL` | *(production dataset CF URL)* | Yes | No |
| `NEXT_PUBLIC_I18N_URL` | *(production i18n CF URL)* | Yes | No |
| `NEXT_PUBLIC_APP_ENV` | `production` | Yes | No |
| `NEXT_PUBLIC_API_KEY` | *(production API key)* | Yes | Yes |
| `NEXT_PUBLIC_AUTHORIZATION_TOKEN` | *(production auth token)* | Yes | Yes |
| `NEXT_PUBLIC_GA_TAG` | *(production GA tag)* | Yes | No |
| `NEXT_PUBLIC_MIXPANEL_TOKEN` | *(production token)* | Yes | Yes |
| `NEXT_PUBLIC_TINYBIRD_TOKEN` | *(production token)* | Yes | Yes |
| `NEXT_PUBLIC_TINYBIRD_URL` | `https://api.tinybird.co` | Yes | No |
| `NEXT_PUBLIC_TILESERVER_URL` | *(tile server URL)* | Yes | No |
| `CF_DISTRIBUTION_ID` | *(from CDK output after first deploy)* | Yes | No |
| `HEALTH_CHECK_URL` | *(production CloudFront domain)* | Yes | No |
| `LOAD_TEST_AUTH_USER` | `admin` | Yes | No |
| `LOAD_TEST_AUTH_PASS` | *(production auth pass)* | Yes | Yes |

**How to scope variables:** When adding the variable, expand **Environments** → type `staging` or `production`. This ensures the variable is only injected into jobs that declare `environment: name: staging/production`.

#### Variables You Do NOT Need to Set

| Variable | Reason |
|---|---|
| AWS credentials | Runner uses EC2 instance profile |
| `ECR_REPOSITORY` | Hardcoded as `kkmnow-frontend` |
| `IMAGE_TAG` | Auto-set to `$CI_COMMIT_SHORT_SHA` |
| `ECS_CLUSTER` / `ECS_SERVICE` | Hardcoded per deploy job |

### Branch Strategy

| Branch | Trigger | Result |
|---|---|---|
| Any (MR) | Create/update MR | Lint + typecheck |
| `staging` | Push | Auto-deploy to staging |
| `main` | Push | Build production image, then **manual approval** required to deploy |

### Rollback

ECS uses rolling deployments with circuit breaker — if new tasks fail health checks, ECS automatically rolls back. Manual rollback to a specific version:

```bash
# Staging
aws ecs update-service \
  --cluster kkmnow-staging \
  --service kkmnow-frontend-staging \
  --task-definition kkmnow-frontend-staging:<previous-revision> \
  --region ap-southeast-5

# Production
aws ecs update-service \
  --cluster kkmnow-production \
  --service kkmnow-frontend-production \
  --task-definition kkmnow-frontend-production:<previous-revision> \
  --region ap-southeast-5
```

To find the previous revision number:

```bash
aws ecs list-task-definitions \
  --family-prefix kkmnow-frontend-production \
  --region ap-southeast-5 --output text
```

## ISR & Caching

### How ISR works on ECS

1. Pages are pre-rendered at build time or on first request (`fallback: 'blocking'`)
2. Next.js serves from filesystem cache (`.next/cache`) for the ISR TTL period (24h)
3. After TTL expires, the next request triggers background regeneration — stale content is served immediately while the page rebuilds
4. On-demand revalidation: backend POSTs to `/api/revalidate` with a bearer token to refresh specific pages

### Multi-task consistency

With 2+ Fargate tasks, each has its own ISR cache. On-demand revalidation hits one task via ALB round-robin. The other task self-heals within its own TTL (24h). CloudFront further masks this — once any task returns fresh content, CloudFront caches it for all users.

## IAM Permissions (GitLab Runner)

The runner role (`gitlab-runner-autoscaled-RunnerWorkerRole-AYQcrmOCa7bc`) has:

- ECR: push/pull images
- ECS: update service, describe tasks/services
- CloudFront: `CreateInvalidation` for both staging and production distributions

The CloudFront permission is an **inline policy** (`kkmnow-frontend-cloudfront-permission`) that must be updated after deploying the production distribution to include its ARN.

## Contributing

1. Branch from `staging` with a descriptive name: `feat/xxx`, `fix/xxx`
2. Develop and test locally
3. `git fetch && git merge origin/staging` to sync changes
4. Push and create a merge request to `staging`
5. Assign a reviewer and wait for approval
6. After staging is verified, changes are promoted to `main` for production deployment

## License

[MIT](./LICENSE.md) — Copyright 2023-2026 Ministry of Health Malaysia
