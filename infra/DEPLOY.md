# Deployment Guide

## Architecture Overview

Video rendering uses **Modal** sandboxes with **Revideo**. The video project (`video/src/`) is bundled into a Docker image that runs in Modal. The API invokes Modal to render videos.

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
                                               │  5. Modal render ─┼──▶ ┌──────────────────┐
                                               │  6. Poll progress  │    │ Modal Sandbox    │
                                               │  7. Download .mp4  │◀───│ (Revideo +       │
                                               │  8. Upload final   │    │  Chromium)       │
                                               │     to S3/R2       │    └──────────────────┘
                                               └───────────────────┘
```

## First-Time Setup

### 1. AWS Credentials (for S3/R2 assets)

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

This creates: IAM policies, `unscroll-assets` S3 bucket (if used).

### 3. Set API Environment Variables

```bash
# api/.env
AWS_ACCESS_KEY_ID=<your key>
AWS_SECRET_ACCESS_KEY=<your secret>
AWS_REGION=us-east-2
ASSETS_BUCKET=unscroll-assets
MODAL_TOKEN_ID=<your Modal token>
MODAL_TOKEN_SECRET=<your Modal secret>
ELEVENLABS_API_KEY=<your key>
ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM
PEXELS_API_KEY=<your key>
```

### 4. Build & Push Render Image

The render runs in a Modal sandbox using a Docker image. Build and push:

```bash
cd video
docker build -f Dockerfile.render -t unscroll/render .
# Push to your registry and ensure MODAL_RENDER_IMAGE in api/.env points to it
```

### 5. Install API Dependencies & Run

```bash
cd api
bun install
bun run dev
```

## When to Redeploy What

| You changed... | What to do |
|---|---|
| `video/src/` (scenes, project) | Rebuild and push the render Docker image |
| `api/src/` (services, routes, agents) | Just restart the API server (`bun run dev`) |
| `infra/index.ts` (IAM, buckets) | `pulumi up` |

## Redeploying the Render Image

When you change video compositions or Revideo code:

```bash
cd video
docker build -f Dockerfile.render -t unscroll/render .
# Push to registry
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
# → { "status": "completed", "videoUrl": "https://..." }
```

The pipeline runs: script generation → TTS with captions → stock media fetch → Revideo render (Modal) → upload to S3/R2.

## Troubleshooting

**"Cannot find module '@revideo/renderer'"** — Ensure the render Docker image has the video project and dependencies installed.

**Modal sandbox times out** — Default is 300s. For longer videos, increase `timeoutMs` in render-service.ts.

**"Render failed"** — Check Modal logs and that the render image includes Chromium (`PUPPETEER_EXECUTABLE_PATH`).
