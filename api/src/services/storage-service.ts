import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";

// R2 client (S3-compatible)
const r2Client = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
  },
});

// AWS S3 client for Remotion assets
const s3Client = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
  },
});

const R2_BUCKET = process.env.R2_BUCKET_NAME || "unscroll-videos";
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || "";
const S3_BUCKET = process.env.REMOTION_S3_BUCKET || "unscroll-remotion";

/**
 * Uploads a video to Cloudflare R2
 * @returns Public URL of the uploaded video
 */
export async function uploadVideoToR2(
  videoBuffer: Buffer,
  conceptSlug: string
): Promise<string> {
  const key = `reels/${conceptSlug}/${randomUUID()}.mp4`;

  await r2Client.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: videoBuffer,
      ContentType: "video/mp4",
    })
  );

  return `${R2_PUBLIC_URL}/${key}`;
}

/**
 * Uploads audio to S3 for Remotion Lambda to access
 * @returns S3 URL of the uploaded audio
 */
export async function uploadAudioToS3(
  audioBuffer: Buffer,
  jobId: string
): Promise<string> {
  const key = `render-assets/${jobId}/audio.mp3`;

  await s3Client.send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: audioBuffer,
      ContentType: "audio/mpeg",
    })
  );

  // Generate a presigned URL valid for 1 hour
  const url = await getSignedUrl(
    s3Client,
    new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
    }),
    { expiresIn: 3600 }
  );

  return url;
}

/**
 * Uploads render props JSON to S3 for Remotion Lambda
 */
export async function uploadRenderPropsToS3(
  props: Record<string, unknown>,
  jobId: string
): Promise<string> {
  const key = `render-assets/${jobId}/props.json`;

  await s3Client.send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: JSON.stringify(props),
      ContentType: "application/json",
    })
  );

  return `s3://${S3_BUCKET}/${key}`;
}

/**
 * Downloads a file from a URL and returns as buffer
 */
export async function downloadToBuffer(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download: ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
