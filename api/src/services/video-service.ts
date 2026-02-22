import * as fs from "fs";
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
	PatternInterrupt,
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

import {
	fetchStockMedia,
	fetchStockImage,
} from "./stock-media-service";
import {
	uploadAudioToS3,
	uploadVideo,
	ensurePresignedUrlForAssets,
} from "./storage-service";
import { renderWithRevideo } from "./revideo-render-service";
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
 * Main video generation pipeline.
 * Idempotent: if a completed reel already exists for this concept, returns it
 * immediately without regenerating script, TTS, or video.
 */
export async function generateVideo(job: VideoJob): Promise<string> {
	const { input } = job;
	const jobLog = log.video.child(job.id.slice(0, 8));
	const startTime = Date.now();

	jobLog.info("Pipeline started", { concept: input.conceptSlug });

	try {
		// Idempotency: skip pipeline if already completed for this concept
		const existingReel =
			await reelRepository.getCompletedReelByConceptId(input.conceptId);
		if (existingReel?.status === "completed" && existingReel.videoUrl) {
			jobLog.info("Reel already exists for concept, returning immediately", {
				concept: input.conceptSlug,
				videoUrl: existingReel.videoUrl,
			});
			updateJobStatus(job.id, "completed", 100, {
				videoUrl: existingReel.videoUrl,
			});
			if (input.webhookUrl) {
				await fireWebhook(input.webhookUrl, {
					jobId: job.id,
					status: "completed",
					videoUrl: existingReel.videoUrl,
				});
			}
			return existingReel.videoUrl;
		}

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
		const stockMedia = await fetchStockMedia(
			backgroundType,
			script.backgroundSearchQuery,
		);
		jobLog.debug("Stock media fetched", {
			durationMs: Date.now() - mediaStart,
			type: stockMedia?.type || "gradient",
			hasMedia: !!stockMedia?.url,
		});

		// Step 4: Prepare render input (incl. pattern interrupts every 4s)
		jobLog.debug("Step 4/7: Preparing render");
		updateJobStatus(job.id, "rendering", 50);
		const patternInterrupts = await buildPatternInterrupts(
			durationSeconds,
			backgroundType,
			script.backgroundSearchQuery,
		);
		const renderInput: RenderInput = {
			audioUrl,
			backgroundUrl: stockMedia?.url || "",
			backgroundType: stockMedia?.type || "gradient",
			captions,
			durationInSeconds: durationSeconds + 1,
			gradientColors: BACKGROUND_GRADIENT_COLORS[backgroundType],
			hook: script.hook,
			patternInterrupts,
		};

		// Step 5: Render video with Revideo
		jobLog.info("Step 5/6: Rendering video (this may take several minutes)");
		const renderStart = Date.now();
		const outputPath = await renderWithRevideo(
			renderInput,
			job.id,
			(progress) => {
				updateJobStatus(job.id, "rendering", 50 + Math.round(progress * 0.35));
			},
		);
		jobLog.info("Render completed", {
			durationMs: Date.now() - renderStart,
			outputPath,
		});

		// Step 6: Upload rendered video to assets bucket
		jobLog.debug("Step 6/6: Uploading final video");
		updateJobStatus(job.id, "uploading", 90);
		const videoBuffer = await fs.promises.readFile(outputPath);
		const videoUrl = await uploadVideo(videoBuffer, input.conceptSlug);

		// Clean up temp file
		await fs.promises.unlink(outputPath).catch(() => {});

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

/** Build time-based pattern interrupts every 4 seconds (Option A). */
async function buildPatternInterrupts(
	durationSeconds: number,
	backgroundType: BackgroundType,
	topicQuery?: string,
): Promise<PatternInterrupt[]> {
	const INTERRUPT_INTERVAL = 4;
	const INTERRUPT_DURATION = 3;
	const interrupts: PatternInterrupt[] = [];
	let startTime = INTERRUPT_INTERVAL;

	while (startTime < durationSeconds - 1) {
		const img = await fetchStockImage(backgroundType, topicQuery);
		if (img?.url) {
			interrupts.push({
				startTime,
				duration: INTERRUPT_DURATION,
				imageUrl: img.url,
			});
		}
		startTime += INTERRUPT_INTERVAL;
	}

	return interrupts;
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
