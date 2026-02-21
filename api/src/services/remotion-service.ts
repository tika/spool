import {
  renderMediaOnLambda,
  getRenderProgress,
  AwsRegion,
} from "@remotion/lambda/client";
import type { RenderInput } from "../types/video";

const REMOTION_FUNCTION_NAME = process.env.REMOTION_LAMBDA_FUNCTION || "remotion-render";
const REMOTION_SERVE_URL = process.env.REMOTION_SERVE_URL || "";
const AWS_REGION = (process.env.AWS_REGION || "us-east-1") as AwsRegion;

export interface RenderResult {
  renderId: string;
  bucketName: string;
}

export interface RenderProgress {
  done: boolean;
  progress: number;
  outputUrl?: string;
  error?: string;
}

/**
 * Triggers a render on Remotion Lambda
 */
export async function triggerRender(
  props: RenderInput
): Promise<RenderResult> {
  const { renderId, bucketName } = await renderMediaOnLambda({
    region: AWS_REGION,
    functionName: REMOTION_FUNCTION_NAME,
    serveUrl: REMOTION_SERVE_URL,
    composition: "EducationalReel",
    inputProps: props,
    codec: "h264",
    imageFormat: "jpeg",
    maxRetries: 1,
    privacy: "public",
    downloadBehavior: {
      type: "download",
      fileName: "reel.mp4",
    },
  });

  return { renderId, bucketName };
}

/**
 * Polls render progress until complete or failed
 */
export async function pollRenderProgress(
  renderId: string,
  bucketName: string
): Promise<RenderProgress> {
  const progress = await getRenderProgress({
    renderId,
    bucketName,
    region: AWS_REGION,
    functionName: REMOTION_FUNCTION_NAME,
  });

  if (progress.fatalErrorEncountered) {
    return {
      done: true,
      progress: 0,
      error: progress.errors?.[0]?.message || "Render failed",
    };
  }

  if (progress.done) {
    return {
      done: true,
      progress: 100,
      outputUrl: progress.outputFile,
    };
  }

  return {
    done: false,
    progress: Math.round((progress.overallProgress || 0) * 100),
  };
}

/**
 * Waits for render to complete, polling every 2 seconds
 */
export async function waitForRender(
  renderId: string,
  bucketName: string,
  onProgress?: (progress: number) => void,
  timeoutMs: number = 300000 // 5 minutes
): Promise<string> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const status = await pollRenderProgress(renderId, bucketName);

    if (onProgress) {
      onProgress(status.progress);
    }

    if (status.done) {
      if (status.error) {
        throw new Error(`Render failed: ${status.error}`);
      }
      if (!status.outputUrl) {
        throw new Error("Render completed but no output URL");
      }
      return status.outputUrl;
    }

    // Wait 2 seconds before polling again
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  throw new Error(`Render timed out after ${timeoutMs}ms`);
}
