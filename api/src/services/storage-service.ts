import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";

const s3Client = new S3Client({
  region: process.env.AWS_REGION || "us-east-2",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
  },
});

const ASSETS_BUCKET = process.env.ASSETS_BUCKET || "unscroll-assets";
const ASSETS_PUBLIC_URL =
  process.env.ASSETS_PUBLIC_URL ||
  `https://${ASSETS_BUCKET}.s3.${process.env.AWS_REGION || "us-east-2"}.amazonaws.com`;

/**
 * Uploads a finished video to the assets bucket
 * @returns Public URL of the uploaded video
 */
export async function uploadVideo(
  videoBuffer: Buffer,
  conceptSlug: string,
): Promise<string> {
  const key = `reels/${conceptSlug}/${randomUUID()}.mp4`;

  await s3Client.send(
    new PutObjectCommand({
      Bucket: ASSETS_BUCKET,
      Key: key,
      Body: videoBuffer,
      ContentType: "video/mp4",
    }),
  );

  return `${ASSETS_PUBLIC_URL}/${key}`;
}

/**
 * Uploads audio to S3 for Remotion Lambda to access during rendering
 * @returns Presigned URL valid for 1 hour
 */
export async function uploadAudioToS3(
  audioBuffer: Buffer,
  jobId: string,
): Promise<string> {
  const key = `render-assets/${jobId}/audio.mp3`;

  await s3Client.send(
    new PutObjectCommand({
      Bucket: ASSETS_BUCKET,
      Key: key,
      Body: audioBuffer,
      ContentType: "audio/mpeg",
    }),
  );

  const url = await getSignedUrl(
    s3Client,
    new GetObjectCommand({
      Bucket: ASSETS_BUCKET,
      Key: key,
    }),
    { expiresIn: 3600 },
  );

  return url;
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
