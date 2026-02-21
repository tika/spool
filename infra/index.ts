import * as aws from "@pulumi/aws";
import * as command from "@pulumi/command/local";
import * as pulumi from "@pulumi/pulumi";

// ─── 1. IAM Role: remotion-lambda-role ─────────────────────────────
// This is the execution role that the Remotion Lambda function assumes
// when it runs. It needs to:
//   - Read/write Remotion's own S3 buckets (remotionlambda-*)
//   - Invoke other Lambda functions (Remotion uses fan-out for parallel chunk rendering)
//   - Write CloudWatch logs
//   - Pull Remotion's Chromium/FFMPEG binary layers from their hosted account

const remotionRole = new aws.iam.Role("remotion-lambda-role", {
  name: "remotion-lambda-role",
  assumeRolePolicy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: { Service: "lambda.amazonaws.com" },
        Action: "sts:AssumeRole",
      },
    ],
  }),
});

new aws.iam.RolePolicy("remotion-lambda-role-policy", {
  role: remotionRole.name,
  policy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "RemotionS3Access",
        Effect: "Allow",
        Action: [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:ListBucket",
          "s3:GetBucketLocation",
          "s3:PutObjectAcl",
        ],
        Resource: [
          "arn:aws:s3:::remotionlambda-*",
          "arn:aws:s3:::remotionlambda-*/*",
        ],
      },
      {
        Sid: "LambdaFanOut",
        Effect: "Allow",
        Action: [
          "lambda:InvokeFunction",
          "lambda:InvokeAsync",
          "lambda:GetFunction",
        ],
        Resource: "arn:aws:lambda:*:*:function:remotion-render-*",
      },
      {
        Sid: "CloudWatchLogs",
        Effect: "Allow",
        Action: [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:PutRetentionPolicy",
        ],
        Resource: "arn:aws:logs:*:*:log-group:/aws/lambda/remotion-render-*",
      },
      {
        Sid: "RemotionBinaryLayers",
        Effect: "Allow",
        Action: ["lambda:GetLayerVersion"],
        Resource: "arn:aws:lambda:*:678892195805:layer:remotion-binaries-*",
      },
    ],
  }),
});

// ─── 2. IAM Policy: remotion-user-policy ───────────────────────────
// Attached to your IAM user. Grants permissions for:
//   - Deploying/managing Remotion Lambda functions (create, delete, invoke)
//   - Creating/managing Remotion's S3 buckets and site bundles
//   - Passing the remotion-lambda-role to new functions
//   - Validating permissions via npx remotion lambda policies validate

new aws.iam.Policy("remotion-user-policy", {
  name: "remotion-user-policy",
  policy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "ValidatePermissions",
        Effect: "Allow",
        Action: ["iam:SimulatePrincipalPolicy"],
        Resource: "*",
      },
      {
        Sid: "PassRoleToLambda",
        Effect: "Allow",
        Action: ["iam:PassRole"],
        Resource: "arn:aws:iam::*:role/remotion-lambda-role",
      },
      {
        Sid: "RemotionBucketManagement",
        Effect: "Allow",
        Action: [
          "s3:GetObject",
          "s3:DeleteObject",
          "s3:PutObjectAcl",
          "s3:PutObject",
          "s3:CreateBucket",
          "s3:ListBucket",
          "s3:GetBucketLocation",
          "s3:PutBucketAcl",
          "s3:DeleteBucket",
          "s3:PutBucketOwnershipControls",
          "s3:PutBucketPublicAccessBlock",
          "s3:PutBucketPolicy",
        ],
        Resource: "arn:aws:s3:::remotionlambda-*",
      },
      {
        Sid: "ListBuckets",
        Effect: "Allow",
        Action: ["s3:ListAllMyBuckets"],
        Resource: "arn:aws:s3:::*",
      },
      {
        Sid: "RemotionBinaryLayers",
        Effect: "Allow",
        Action: ["lambda:GetLayerVersion"],
        Resource: "arn:aws:lambda:*:678892195805:layer:remotion-binaries-*",
      },
      {
        Sid: "ManageLambdaFunctions",
        Effect: "Allow",
        Action: [
          "lambda:GetFunction",
          "lambda:InvokeAsync",
          "lambda:InvokeFunction",
          "lambda:DeleteFunction",
          "lambda:PutFunctionEventInvokeConfig",
          "lambda:CreateFunction",
          "lambda:PutRuntimeManagementConfig",
          "lambda:TagResource",
        ],
        Resource: "arn:aws:lambda:*:*:function:remotion-render-*",
      },
      {
        Sid: "ListLambdaFunctions",
        Effect: "Allow",
        Action: ["lambda:ListFunctions"],
        Resource: "*",
      },
      {
        Sid: "LambdaLogGroups",
        Effect: "Allow",
        Action: ["logs:CreateLogGroup", "logs:PutRetentionPolicy"],
        Resource: "arn:aws:logs:*:*:log-group:/aws/lambda/remotion-render-*",
      },
    ],
  }),
});

// ─── 3. S3 Bucket: unscroll-assets ─────────────────────────────────
// Our bucket for storing:
//   - Final rendered videos (reels/<slug>/<id>.mp4)
//   - Temp render assets like TTS audio (render-assets/<jobId>/audio.mp3)
// Public read so video URLs are directly servable.
// Remotion has its OWN separate auto-managed buckets (remotionlambda-*).

const assetsBucket = new aws.s3.BucketV2("unscroll-assets", {
  bucket: "unscroll-assets",
  forceDestroy: true,
});

new aws.s3.BucketPublicAccessBlock("unscroll-assets-public-access", {
  bucket: assetsBucket.id,
  blockPublicAcls: false,
  blockPublicPolicy: false,
  ignorePublicAcls: false,
  restrictPublicBuckets: false,
});

new aws.s3.BucketPolicy("unscroll-assets-policy", {
  bucket: assetsBucket.id,
  policy: pulumi.interpolate`{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Sid": "PublicRead",
        "Effect": "Allow",
        "Principal": "*",
        "Action": "s3:GetObject",
        "Resource": "arn:aws:s3:::${assetsBucket.bucket}/*"
      }
    ]
  }`,
});

// ─── 4. Remotion Lambda Deploy ─────────────────────────────────────
// Remotion's Lambda is special — it bundles Chromium + FFMPEG in custom
// layers and has its own runtime. We can't replicate it with a raw
// aws.lambda.Function, so we shell out to the Remotion CLI.
//
// `functions deploy` — creates the Lambda function with Remotion's runtime
// `sites create`     — bundles the video/ Remotion project and uploads
//                      it to Remotion's S3 bucket as a static site that
//                      the Lambda reads composition code from

const remotionDeploy = new command.Command(
  "remotion-deploy",
  {
    dir: "../video",
    create: pulumi.interpolate`npx remotion lambda functions deploy --memory=2048 --timeout=240 --region=${aws.config.region} --enable-v5-runtime --yes 2>&1 | tail -5`,
    delete: pulumi.interpolate`npx remotion lambda functions rmall --region=${aws.config.region} --yes 2>&1 || true`,
  },
  { dependsOn: [remotionRole] },
);

const remotionSite = new command.Command("remotion-site", {
  dir: "../video",
  create: pulumi.interpolate`npx remotion lambda sites create --region=${aws.config.region} --site-name=unscroll-video 2>&1 | tail -5`,
  delete: pulumi.interpolate`npx remotion lambda sites rmall --region=${aws.config.region} --yes 2>&1 || true`,
});

// ─── Exports ───────────────────────────────────────────────────────
// After `pulumi up`, copy these into your api/.env

export const awsRegion = aws.config.region;
export const assetsBucketName = assetsBucket.bucket;
export const assetsBucketUrl = pulumi.interpolate`https://${assetsBucket.bucketRegionalDomainName}`;
export const remotionRoleArn = remotionRole.arn;
export const remotionDeployOutput = remotionDeploy.stdout;
export const remotionSiteOutput = remotionSite.stdout;
