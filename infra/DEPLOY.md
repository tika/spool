# Deployment Guide

## Architecture Overview

There are **two separate things** that get deployed:

1. **Remotion Site Bundle** (in S3) — Your video compositions (`video/src/`). This is a static JS bundle that the Lambda reads to know *how* to render. **You redeploy this every time you change video code.**

2. **Remotion Lambda Function** (in AWS Lambda) — Remotion's rendering engine (Chromium + FFMPEG). Managed by Remotion. **You almost never redeploy this** — only when upgrading the `remotion` package version.

Your **API server** (`api/`) runs separately (e.g. `bun run dev`) and calls the Lambda to render. Changes to the API don't require any Lambda redeployment.

```
┌─────────────┐     POST /videos/generate     ┌───────────────────┐
│   Client     │ ──────────────────────────▶   │   API Server      │
└─────────────┘                                │   (Hono/Bun)      │
                                               │                   │
                                               │  1. Generate script│
                                               │  2. 11Labs TTS     │
                                               │  3. Pexels media   │
                                               │  4. Upload audio   │
                                               │     to S3          │
                                               │  5. Invoke Lambda ─┼──▶ ┌──────────────────┐
                                               │  6. Poll progress  │    │ Remotion Lambda   │
                                               │  7. Download .mp4  │◀───│ (reads site from  │
                                               │  8. Upload final   │    │  remotionlambda-* │
                                               │     to unscroll-   │    │  bucket, renders,  │
                                               │     assets         │    │  outputs to S3)    │
                                               └───────────────────┘    └──────────────────┘
```

## First-Time Setup

### 1. AWS Credentials

```bash
aws configure
# Access Key ID:     <from IAM console>
# Secret Access Key: <from IAM console>
# Region:            us-east-2
# Output format:     json
```

### 2. Deploy Infrastructure

```bash
cd infra
npm install
pulumi stack init dev
pulumi config set aws:region us-east-2
pulumi up
```

This creates: IAM role + policies, `unscroll-assets` S3 bucket, deploys the Remotion Lambda function, and uploads the site bundle.

### 3. Set API Environment Variables

After `pulumi up`, grab the outputs and set them in your API env:

```bash
# api/.env
AWS_ACCESS_KEY_ID=<your key>
AWS_SECRET_ACCESS_KEY=<your secret>
AWS_REGION=us-east-2
ASSETS_BUCKET=unscroll-assets
REMOTION_LAMBDA_FUNCTION=<from pulumi output>
REMOTION_SERVE_URL=<from pulumi output>
ELEVENLABS_API_KEY=<your key>
ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM
PEXELS_API_KEY=<your key>
```

### 4. Install API Dependencies & Run

```bash
cd api
bun install
bun run dev
```

## When to Redeploy What

| You changed... | What to do |
|---|---|
| `video/src/` (compositions, components, styles) | Redeploy the **site bundle** |
| `remotion` package version in `video/package.json` | Redeploy the **Lambda function** + site bundle |
| `api/src/` (services, routes, agents) | Just restart the API server (`bun run dev`) |
| `infra/index.ts` (IAM, buckets) | `pulumi up` |

## Redeploying the Site Bundle (most common)

This is what you do when you change anything in `video/src/` — like caption styles, background effects, composition layout, etc.

```bash
cd video
npx remotion lambda sites create --region=us-east-2 --site-name=unscroll-video
```

That's it. The Lambda function automatically uses the latest site bundle on the next render. No Lambda redeploy needed.

## Redeploying the Lambda Function (rare)

Only needed when you upgrade the `remotion` package version:

```bash
cd video
npx remotion lambda functions deploy --memory=2048 --timeout=240 --region=us-east-2 --enable-v5-runtime --yes
```

## Generating a Video

Once everything is deployed:

```bash
curl -X POST http://localhost:3001/videos/generate \
  -H "Content-Type: application/json" \
  -d '{
    "conceptId": "test-1",
    "conceptSlug": "what-is-recursion",
    "conceptName": "Recursion",
    "conceptDescription": "A function that calls itself to solve smaller subproblems"
  }'
# → { "jobId": "abc-123", "status": "queued" }

# Poll for status:
curl http://localhost:3001/videos/jobs/abc-123
# → { "status": "rendering", "progress": 65 }
# → { "status": "completed", "videoUrl": "https://unscroll-assets.s3..." }
```

The pipeline runs: script generation → TTS with captions → stock media fetch → Remotion Lambda render → upload to S3.

## Troubleshooting

**"Cannot find module '@remotion/lambda/client'"** — Run `bun install` in `api/`.

**Lambda times out** — Default is 240s. For longer videos, increase with `--timeout=300`.

**"Render failed: no output URL"** — Check that the site bundle is deployed (`npx remotion lambda sites ls --region=us-east-2`).

**Permission errors** — Run `npx remotion lambda policies validate` from `video/` to check IAM setup.
