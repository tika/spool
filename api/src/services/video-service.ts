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

/** Hardcoded audio URL to bypass TTS when quota is exceeded. Set via env or use fallback. */
const HARDCODED_AUDIO_URL =
	process.env.HARDCODED_AUDIO_URL ||
	"https://unscroll-assets.s3.us-east-2.amazonaws.com/render-assets/19a1ec6e-f8cb-4f48-b028-d98e6537ad73/audio.mp3";
/** Duration (seconds) when using hardcoded audio. */
const HARDCODED_AUDIO_DURATION = 90;
/** When true, skip TTS entirely and always use hardcoded audio. */
const USE_HARDCODED_AUDIO_ONLY =
	process.env.USE_HARDCODED_AUDIO_ONLY === "true";

import { fetchStockMedia } from "./stock-media-service";
import {
	uploadAudioToS3,
	uploadVideo,
	downloadToBuffer,
	ensurePresignedUrlForAssets,
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
	extra?: Partial<VideoJob>,
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

		// Step 2: Generate TTS or use hardcoded audio (bypasses TTS when quota exceeded)
		let audioUrl: string;
		let captions: CaptionWord[];
		let durationSeconds: number;

		if (USE_HARDCODED_AUDIO_ONLY) {
			jobLog.debug("Step 2/7: Using hardcoded audio (TTS skipped)");
			updateJobStatus(job.id, "generating_tts", 25);
			audioUrl = await ensurePresignedUrlForAssets(HARDCODED_AUDIO_URL);
			captions = [];
			durationSeconds = HARDCODED_AUDIO_DURATION;
		} else {
			try {
				jobLog.debug("Step 2/7: Generating TTS");
				updateJobStatus(job.id, "generating_tts", 25);
				const ttsStart = Date.now();
				const tts = await generateTTSWithCaptions(script.transcript);
				jobLog.debug("TTS generated", {
					durationMs: Date.now() - ttsStart,
					durationSeconds: tts.durationSeconds,
					captions: tts.captions.length,
				});
				audioUrl = await uploadAudioToS3(tts.audioBuffer, job.id);
				captions = tts.captions;
				durationSeconds = tts.durationSeconds;
			} catch (ttsError) {
				const errMsg =
					ttsError instanceof Error ? ttsError.message : String(ttsError);
				const isQuotaError =
					errMsg.includes("quota_exceeded") || errMsg.includes("401");
				if (isQuotaError) {
					jobLog.warn("TTS failed (quota/401), using hardcoded audio", {
						error: errMsg.slice(0, 80),
					});
				} else {
					throw ttsError;
				}
				audioUrl = await ensurePresignedUrlForAssets(HARDCODED_AUDIO_URL);
				captions = [];
				durationSeconds = HARDCODED_AUDIO_DURATION;
			}
		}

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

		// Step 4: Prepare render input
		jobLog.debug("Step 4/7: Preparing render");
		updateJobStatus(job.id, "rendering", 50);
		const renderInput: RenderInput = {
			audioUrl,
			backgroundUrl: stockMedia?.url || "",
			backgroundType: stockMedia?.type || "gradient",
			captions,
			durationInSeconds: durationSeconds + 1,
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

		// Save reel to database
		jobLog.debug("Saving reel to database");
		await reelRepository.createReel({
			conceptId: input.conceptId,
			name: input.conceptName,
			description: input.conceptDescription,
			transcript: script.transcript,
			videoUrl,
			durationSeconds,
			tone: script.tone,
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
	payload: Record<string, unknown>,
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
