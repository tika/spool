import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

// ─── S3 Bucket: unscroll-assets ─────────────────────────────────
// Our bucket for storing:
//   - Final rendered videos (reels/<slug>/<id>.mp4)
//   - Temp render assets like TTS audio (render-assets/<jobId>/audio.mp3)
// Public read so video URLs are directly servable.

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

// ─── Exports ───────────────────────────────────────────────────────
// After `pulumi up`, copy these into your api/.env

export const awsRegion = aws.config.region;
export const assetsBucketName = assetsBucket.bucket;
export const assetsBucketUrl = pulumi.interpolate`https://${assetsBucket.bucketRegionalDomainName}`;
