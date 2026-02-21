# Unscroll Infrastructure

Pulumi project that provisions the video generation pipeline:
- **AWS IAM** — Role + policies for Remotion Lambda
- **AWS S3** — Bucket for Remotion site bundle & render assets
- **Cloudflare R2** — Bucket for final rendered videos
- **Remotion CLI** — Deploys Lambda function + site via `@pulumi/command`

## Prerequisites

```bash
# AWS CLI — configure with your IAM credentials
brew install awscli
aws configure
# It'll ask for: Access Key ID, Secret Access Key, Region (us-east-2), Output (json)
# Get keys from: AWS Console → IAM → Users → Your user → Security credentials → Create access key

# Pulumi
brew install pulumi

# Wrangler (for Cloudflare API token)
npm i -g wrangler
wrangler login
```

## Setup

```bash
cd infra
npm install

# Create the dev stack
pulumi stack init dev

# Set required config
pulumi config set aws:region us-east-2
pulumi config set --secret cloudflare:apiToken <your-cf-api-token>
pulumi config set cfAccountId <your-cf-account-id>

# Deploy
pulumi up
```

## What gets created

| Resource | Provider | Purpose |
|----------|----------|---------|
| `remotion-lambda-role` | AWS IAM | Role assumed by the Remotion render function |
| `remotion-user-policy` | AWS IAM | Policy for your deployer user / API server |
| `unscroll-remotion` | AWS S3 | Remotion site bundle + render assets |
| `unscroll-videos` | Cloudflare R2 | Final rendered videos |
| Remotion Lambda function | AWS Lambda (via CLI) | Renders videos |
| Remotion site | AWS S3 (via CLI) | Hosts the Remotion bundle |

## After deploy

Pulumi will output the key values. Copy them into your `api/.env`:

```bash
REMOTION_LAMBDA_FUNCTION=<from pulumi output>
REMOTION_SERVE_URL=<from pulumi output>
REMOTION_S3_BUCKET=unscroll-remotion
AWS_REGION=us-east-2
R2_BUCKET_NAME=unscroll-videos
```

## Teardown

```bash
pulumi destroy
```
