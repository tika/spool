import { log } from "../lib/logger";
import type { RenderInput } from "../types/video";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Modal endpoint URL - set via environment variable
const MODAL_ENDPOINT = process.env.MODAL_RENDER_ENDPOINT || "";

// Fallback to local rendering if Modal not configured
const USE_LOCAL_RENDER = !MODAL_ENDPOINT;

// Fetch timeout (slightly less than Modal's 900s) - fail before Modal times out
const MODAL_FETCH_TIMEOUT_MS = 850_000;

/**
 * Renders a video using Modal (or local fallback).
 * Returns the local file path of the rendered MP4.
 */
export async function renderWithRevideo(
	input: RenderInput,
	jobId: string,
	onProgress?: (progress: number) => void,
): Promise<string> {
	const renderLog = log.video.child(`render-${jobId.slice(0, 8)}`);

	renderLog.info("Starting render", {
		duration: input.durationInSeconds,
		background: input.backgroundType,
		captionCount: input.captions.length,
		patternInterrupts: input.patternInterrupts?.length ?? 0,
		useModal: !USE_LOCAL_RENDER,
	});

	if (USE_LOCAL_RENDER) {
		return renderLocal(input, jobId, onProgress);
	}

	return renderWithModal(input, jobId, onProgress);
}

async function renderWithModal(
	input: RenderInput,
	jobId: string,
	onProgress?: (progress: number) => void,
): Promise<string> {
	const renderLog = log.video.child(`render-${jobId.slice(0, 8)}`);

	renderLog.info("Calling Modal render endpoint", {
		endpoint: MODAL_ENDPOINT.replace(/\/[^/]*$/, "/..."),
		timeoutMs: MODAL_FETCH_TIMEOUT_MS,
	});

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), MODAL_FETCH_TIMEOUT_MS);

	let response: Response;
	try {
		response = await fetch(MODAL_ENDPOINT, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				audioUrl: input.audioUrl,
				backgroundUrl: input.backgroundUrl,
				backgroundType: input.backgroundType,
				captions: input.captions,
				durationInSeconds: input.durationInSeconds,
				gradientColors: input.gradientColors || ["#1a1a2e", "#16213e"],
				hook: input.hook,
				patternInterrupts: input.patternInterrupts || [],
			}),
			signal: controller.signal,
		});
	} catch (err) {
		if (err instanceof Error && err.name === "AbortError") {
			renderLog.error("Modal render timed out", {
				timeoutMs: MODAL_FETCH_TIMEOUT_MS,
			});
			throw new Error(
				`Render timed out after ${MODAL_FETCH_TIMEOUT_MS / 1000}s. Check Modal logs for progress.`,
			);
		}
		throw err;
	} finally {
		clearTimeout(timeoutId);
	}

	if (!response.ok) {
		throw new Error(`Modal render failed: ${response.status} ${response.statusText}`);
	}

	const result = (await response.json()) as {
		success: boolean;
		videoBase64?: string;
		error?: string;
		size?: number;
	};

	if (!result.success) {
		renderLog.error("Modal render failed", { error: result.error });
		throw new Error(`Modal render failed: ${result.error}`);
	}

	if (!result.videoBase64) {
		throw new Error("Modal render returned no video data");
	}

	// Decode base64 and save to temp file
	const videoBuffer = Buffer.from(result.videoBase64, "base64");
	const outputPath = path.join(os.tmpdir(), `render-${jobId}.mp4`);

	await fs.promises.writeFile(outputPath, videoBuffer);

	renderLog.info("Modal render completed", {
		fileSize: videoBuffer.length,
		outputPath,
	});

	if (onProgress) {
		onProgress(100);
	}

	return outputPath;
}

async function renderLocal(
	input: RenderInput,
	jobId: string,
	onProgress?: (progress: number) => void,
): Promise<string> {
	// Dynamic import to avoid loading Revideo when using Modal
	const { renderVideo } = await import("@revideo/renderer");

	const renderLog = log.video.child(`render-${jobId.slice(0, 8)}`);
	const outDir = os.tmpdir();
	const outFile = `render-${jobId}.mp4` as `${string}.mp4`;
	const outputPath = path.join(outDir, outFile);
	const projectFile = path.resolve(__dirname, "../../../video/src/project.ts");

	await renderVideo({
		projectFile,
		variables: {
			audioUrl: input.audioUrl,
			backgroundUrl: input.backgroundUrl,
			backgroundType: input.backgroundType,
			captions: input.captions,
			durationInSeconds: input.durationInSeconds,
			gradientColors: input.gradientColors || ["#1a1a2e", "#16213e"],
			hook: input.hook,
			patternInterrupts: input.patternInterrupts || [],
		},
		settings: {
			outDir,
			outFile,
			logProgress: true,
			progressCallback: (_workerId: number, progress: number) => {
				if (onProgress) {
					onProgress(progress * 100);
				}
			},
		},
	});

	if (!fs.existsSync(outputPath)) {
		throw new Error("Render completed but output file not found");
	}

	const stats = fs.statSync(outputPath);
	renderLog.info("Local render completed", {
		fileSize: stats.size,
		outputPath,
	});

	return outputPath;
}

/**
 * Get current render queue status
 */
export function getRenderQueueStatus(): {
	useModal: boolean;
	modalEndpoint: string;
} {
	return {
		useModal: !USE_LOCAL_RENDER,
		modalEndpoint: MODAL_ENDPOINT,
	};
}
