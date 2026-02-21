import { generateScript } from "../agents/video-scripting-agent";
import type {
  VideoJob,
  VideoJobInput,
  VideoJobStatus,
  BackgroundType,
  RenderInput,
} from "../types/video";
import { BACKGROUND_GRADIENT_COLORS } from "../types/video";
import { generateTTSWithCaptions } from "./tts-service";
import { fetchStockMedia } from "./stock-media-service";
import {
  uploadAudioToS3,
  uploadVideo,
  downloadToBuffer,
} from "./storage-service";
import { triggerRender, waitForRender } from "./remotion-service";
import { randomUUID } from "crypto";

// In-memory job store (replace with Redis/DB in production)
const jobs = new Map<string, VideoJob>();

export function createJob(input: VideoJobInput): VideoJob {
  const job: VideoJob = {
    id: randomUUID(),
    status: "queued",
    input,
    progress: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  jobs.set(job.id, job);
  return job;
}

export function getJob(jobId: string): VideoJob | undefined {
  return jobs.get(jobId);
}

export function updateJobStatus(
  jobId: string,
  status: VideoJobStatus,
  progress: number,
  extra?: Partial<VideoJob>
): void {
  const job = jobs.get(jobId);
  if (job) {
    job.status = status;
    job.progress = progress;
    job.updatedAt = new Date().toISOString();
    if (extra) {
      Object.assign(job, extra);
    }
  }
}

/**
 * Main video generation pipeline
 */
export async function generateVideo(job: VideoJob): Promise<string> {
  const { input } = job;

  try {
    // Step 1: Generate script
    updateJobStatus(job.id, "scripting", 10);
    const script = await generateScript({
      name: input.conceptName,
      description: input.conceptDescription,
    });

    // Step 2: Generate TTS with timestamps
    updateJobStatus(job.id, "generating_tts", 25);
    const tts = await generateTTSWithCaptions(script.transcript);

    // Step 3: Fetch stock media
    updateJobStatus(job.id, "fetching_media", 40);
    const backgroundType = (script.background || "minimal_gradient") as BackgroundType;
    const stockMedia = await fetchStockMedia(backgroundType);

    // Step 4: Upload audio to S3 for Remotion
    updateJobStatus(job.id, "rendering", 50);
    const audioUrl = await uploadAudioToS3(tts.audioBuffer, job.id);

    // Step 5: Prepare render input
    const renderInput: RenderInput = {
      audioUrl,
      backgroundUrl: stockMedia?.url || "",
      backgroundType: stockMedia?.type || "gradient",
      captions: tts.captions,
      durationInSeconds: tts.durationSeconds + 1, // Add 1 second buffer
      gradientColors: BACKGROUND_GRADIENT_COLORS[backgroundType],
    };

    // Step 6: Trigger Remotion Lambda render
    const { renderId, bucketName } = await triggerRender(renderInput);

    // Step 7: Wait for render to complete
    const outputUrl = await waitForRender(
      renderId,
      bucketName,
      (progress) => {
        updateJobStatus(job.id, "rendering", 50 + Math.round(progress * 0.35));
      }
    );

    // Step 8: Download rendered video and upload to assets bucket
    updateJobStatus(job.id, "uploading", 90);
    const videoBuffer = await downloadToBuffer(outputUrl);
    const videoUrl = await uploadVideo(videoBuffer, input.conceptSlug);

    // Step 9: Complete
    updateJobStatus(job.id, "completed", 100, { videoUrl });

    // Fire webhook if configured
    if (input.webhookUrl) {
      await fireWebhook(input.webhookUrl, {
        jobId: job.id,
        status: "completed",
        videoUrl,
      });
    }

    return videoUrl;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    updateJobStatus(job.id, "failed", 0, { error: errorMessage });

    // Fire webhook on failure too
    if (input.webhookUrl) {
      await fireWebhook(input.webhookUrl, {
        jobId: job.id,
        status: "failed",
        error: errorMessage,
      });
    }

    throw error;
  }
}

async function fireWebhook(
  url: string,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.error("Failed to fire webhook:", error);
  }
}
