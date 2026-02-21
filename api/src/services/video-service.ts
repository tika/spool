import { generateScript } from "../agents/video-scripting-agent";
import { ExternalServiceError, formatError } from "../lib/errors";
import { log } from "../lib/logger";
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

  log.video.debug("Job created", {
    jobId: job.id,
    concept: input.conceptSlug,
  });

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
    const prevStatus = job.status;
    job.status = status;
    job.progress = progress;
    job.updatedAt = new Date().toISOString();
    if (extra) {
      Object.assign(job, extra);
    }

    if (prevStatus !== status) {
      log.video.debug("Job status changed", {
        jobId,
        from: prevStatus,
        to: status,
        progress,
      });
    }
  }
}

/**
 * Main video generation pipeline
 */
export async function generateVideo(job: VideoJob): Promise<string> {
  const { input } = job;
  const jobLog = log.video.child(job.id.slice(0, 8));
  const startTime = Date.now();

  jobLog.info("Pipeline started", { concept: input.conceptSlug });

  try {
    // Step 1: Generate script
    jobLog.debug("Step 1/7: Generating script");
    updateJobStatus(job.id, "scripting", 10);
    const scriptStart = Date.now();
    const script = await generateScript({
      name: input.conceptName,
      description: input.conceptDescription,
    });
    jobLog.debug("Script generated", {
      durationMs: Date.now() - scriptStart,
      background: script.background,
    });

    // Step 2: Generate TTS with timestamps
    jobLog.debug("Step 2/7: Generating TTS");
    updateJobStatus(job.id, "generating_tts", 25);
    const ttsStart = Date.now();
    const tts = await generateTTSWithCaptions(script.transcript);
    jobLog.debug("TTS generated", {
      durationMs: Date.now() - ttsStart,
      durationSeconds: tts.durationSeconds,
      captions: tts.captions.length,
    });

    // Step 3: Fetch stock media
    jobLog.debug("Step 3/7: Fetching stock media");
    updateJobStatus(job.id, "fetching_media", 40);
    const mediaStart = Date.now();
    const backgroundType = (script.background ||
      "minimal_gradient") as BackgroundType;
    const stockMedia = await fetchStockMedia(backgroundType);
    jobLog.debug("Stock media fetched", {
      durationMs: Date.now() - mediaStart,
      type: stockMedia?.type || "gradient",
      hasMedia: !!stockMedia?.url,
    });

    // Step 4: Upload audio to S3 for Remotion
    jobLog.debug("Step 4/7: Uploading audio");
    updateJobStatus(job.id, "rendering", 50);
    const audioUrl = await uploadAudioToS3(tts.audioBuffer, job.id);

    // Step 5: Prepare render input
    jobLog.debug("Step 5/7: Preparing render");
    const renderInput: RenderInput = {
      audioUrl,
      backgroundUrl: stockMedia?.url || "",
      backgroundType: stockMedia?.type || "gradient",
      captions: tts.captions,
      durationInSeconds: tts.durationSeconds + 1,
      gradientColors: BACKGROUND_GRADIENT_COLORS[backgroundType],
    };

    // Step 6: Trigger Remotion Lambda render
    jobLog.debug("Step 6/7: Rendering video");
    const renderStart = Date.now();
    const { renderId, bucketName } = await triggerRender(renderInput);
    jobLog.debug("Render triggered", { renderId, bucketName });

    // Step 7: Wait for render to complete
    const outputUrl = await waitForRender(renderId, bucketName, (progress) => {
      updateJobStatus(job.id, "rendering", 50 + Math.round(progress * 0.35));
    });
    jobLog.debug("Render completed", {
      durationMs: Date.now() - renderStart,
    });

    // Step 8: Download rendered video and upload to assets bucket
    jobLog.debug("Step 7/7: Uploading final video");
    updateJobStatus(job.id, "uploading", 90);
    const videoBuffer = await downloadToBuffer(outputUrl);
    const videoUrl = await uploadVideo(videoBuffer, input.conceptSlug);

    // Complete
    updateJobStatus(job.id, "completed", 100, { videoUrl });

    jobLog.info("Pipeline completed", {
      concept: input.conceptSlug,
      videoUrl,
      totalDurationMs: Date.now() - startTime,
    });

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
    const err = formatError(error);
    updateJobStatus(job.id, "failed", 0, { error: err.message });

    jobLog.error("Pipeline failed", {
      concept: input.conceptSlug,
      error: err.message,
      durationMs: Date.now() - startTime,
    });

    // Fire webhook on failure too
    if (input.webhookUrl) {
      await fireWebhook(input.webhookUrl, {
        jobId: job.id,
        status: "failed",
        error: err.message,
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
    log.video.debug("Firing webhook", { url, status: payload.status });
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    const err = formatError(error);
    log.video.warn("Webhook failed", { url, error: err.message });
  }
}
