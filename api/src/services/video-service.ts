import { generateScript } from "../agents/video-scripting-agent";
import { formatError } from "../lib/errors";
import { log } from "../lib/logger";
import { reelRepository } from "../repositories/reel-repository";
import type {
  VideoJob,
  VideoJobInput,
  VideoJobStatus,
  BackgroundType,
  RenderInput,
  CaptionWord,
} from "../types/video";
import { BACKGROUND_GRADIENT_COLORS } from "../types/video";
import { generateTTSWithCaptions } from "./tts-service";
import { fetchStockMedia } from "./stock-media-service";
import {
	uploadAudioToS3,
	uploadVideo,
	getPresignedUrl,
} from "./storage-service";
import { renderVideo } from "./render-service";
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
    // Get or create a draft reel for idempotency
    const reel = await reelRepository.upsertDraftReel({
      conceptId: input.conceptId,
      name: input.conceptName,
      description: input.conceptDescription,
    });

    // Already completed — skip entirely
    if (reel.status === "completed" && reel.videoUrl) {
      jobLog.info("Skipping — reel already completed", { videoUrl: reel.videoUrl });
      updateJobStatus(job.id, "completed", 100, { videoUrl: reel.videoUrl });
      return reel.videoUrl;
    }

    // Step 1: Generate script (skip if transcript already saved)
    let transcript: string;
    let tone: string;
    let backgroundType: BackgroundType;

    if (reel.transcript && reel.tone) {
      jobLog.debug("Step 1/7: Reusing existing script");
      transcript = reel.transcript;
      tone = reel.tone;
      backgroundType = (reel.point || "minimal_gradient") as BackgroundType;
    } else {
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

      transcript = script.transcript;
      tone = script.tone;
      backgroundType = (script.background || "minimal_gradient") as BackgroundType;

      // Persist script results so we don't regenerate on retry
      await reelRepository.updateReel(reel.id, {
        transcript,
        tone,
        point: backgroundType,
      });
    }

    // Step 2: Generate TTS (skip if audio already uploaded — stored in source field)
    let tts: { audioBuffer: Buffer; captions: CaptionWord[]; durationSeconds: number };
    let audioUrl: string;

    if (reel.source?.startsWith("s3:")) {
      jobLog.debug("Step 2/7: Reusing existing TTS audio");
      const audioKey = reel.source.slice(3);
      audioUrl = await getPresignedUrl(audioKey);
      // We need captions + duration for render — re-generate TTS
      jobLog.debug("Step 2b/7: Regenerating TTS for captions");
      updateJobStatus(job.id, "generating_tts", 25);
      tts = await generateTTSWithCaptions(transcript);
    } else {
      jobLog.debug("Step 2/7: Generating TTS");
      updateJobStatus(job.id, "generating_tts", 25);
      const ttsStart = Date.now();
      tts = await generateTTSWithCaptions(transcript);
      jobLog.debug("TTS generated", {
        durationMs: Date.now() - ttsStart,
        durationSeconds: tts.durationSeconds,
        captions: tts.captions.length,
      });

      // Step 3: Upload audio to S3
      jobLog.debug("Step 3/7: Uploading audio");
      updateJobStatus(job.id, "rendering", 50);
      audioUrl = await uploadAudioToS3(tts.audioBuffer, job.id);

      // Persist audio S3 key and duration so we don't re-generate TTS on retry
      const audioKey = `render-assets/${job.id}/audio.mp3`;
      await reelRepository.updateReel(reel.id, {
        source: `s3:${audioKey}`,
        durationSeconds: tts.durationSeconds,
      });
    }

    // Step 4: Fetch stock media (cheap, always re-fetch)
    jobLog.debug("Step 4/7: Fetching stock media");
    updateJobStatus(job.id, "fetching_media", 40);
    const stockMedia = await fetchStockMedia(backgroundType);
    jobLog.debug("Stock media fetched", {
      type: stockMedia?.type || "gradient",
      hasMedia: !!stockMedia?.url,
    });

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

    // Step 6: Render video via Modal
    jobLog.debug("Step 6/7: Rendering video");
    const renderStart = Date.now();
    const videoBuffer = await renderVideo(renderInput, (progress) => {
      updateJobStatus(job.id, "rendering", 50 + Math.round(progress * 0.35));
    });
    jobLog.debug("Render completed", {
      durationMs: Date.now() - renderStart,
    });

    // Step 7: Upload rendered video to assets bucket
    jobLog.debug("Step 7/7: Uploading final video");
    updateJobStatus(job.id, "uploading", 90);
    const videoUrl = await uploadVideo(videoBuffer, input.conceptSlug);

    // Mark reel as completed
    await reelRepository.updateReel(reel.id, {
      videoUrl,
      source: "generated",
      status: "completed",
    });

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
