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
 * Uploads audio to S3 for the render service to access during rendering
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

  return getPresignedUrlForKey(key);
}

/**
 * Returns a presigned URL for an existing S3 object in the assets bucket.
 * Use for private objects that Remotion Lambda needs to fetch (e.g. hardcoded audio).
 */
export async function getPresignedUrlForKey(key: string): Promise<string> {
  return getSignedUrl(
    s3Client,
    new GetObjectCommand({
      Bucket: ASSETS_BUCKET,
      Key: key,
    }),
    { expiresIn: 3600 },
  );
}

/**
 * Parses S3 key from a URL like https://bucket.s3.region.amazonaws.com/key
 */
export function parseS3KeyFromUrl(url: string, bucket: string): string | null {
  const region = process.env.AWS_REGION || "us-east-2";
  const prefix = `https://${bucket}.s3.${region}.amazonaws.com/`;
  if (!url.startsWith(prefix)) return null;
  return url.slice(prefix.length) || null;
}

/**
 * If the URL points to our assets bucket, returns a presigned URL for Lambda access.
 * Otherwise returns the original URL (for public/external URLs).
 */
export async function ensurePresignedUrlForAssets(
  url: string,
): Promise<string> {
  const key = parseS3KeyFromUrl(url, ASSETS_BUCKET);
  if (!key) return url;
  return getPresignedUrlForKey(key);
}

/**
 * Generates a presigned URL for an existing S3 key
 */
export async function getPresignedUrl(
	key: string,
	expiresIn = 3600,
): Promise<string> {
	return getSignedUrl(
		s3Client,
		new GetObjectCommand({
			Bucket: ASSETS_BUCKET,
			Key: key,
		}),
		{ expiresIn },
	);
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
