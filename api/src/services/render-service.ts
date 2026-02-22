import { ModalClient } from "modal";
import { log } from "../lib/logger";
import type { RenderInput } from "../types/video";

const MOCK_RENDER = process.env.MOCK_RENDER === "true";
const RENDER_IMAGE = process.env.MODAL_RENDER_IMAGE || "unscroll/render";

const modal = new ModalClient();

const RENDER_SCRIPT = `
import { renderVideo } from '@revideo/renderer';
import { readFileSync } from 'node:fs';

const input = JSON.parse(readFileSync('/tmp/input.json', 'utf-8'));

const file = await renderVideo({
  projectFile: './src/project.ts',
  variables: {
    audioUrl: input.audioUrl ?? '',
    backgroundUrl: input.backgroundUrl ?? '',
    backgroundType: input.backgroundType ?? 'gradient',
    captions: input.captions ?? [],
    durationInSeconds: input.durationInSeconds ?? 30,
    gradientColors: input.gradientColors ?? ['#1a1a2e', '#16213e'],
  },
  settings: {
    outFile: 'output.mp4',
    outDir: '/tmp',
    dimensions: [540, 960],
    logProgress: true,
    puppeteer: {
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
    },
    progressCallback: (_worker, progress) => {
      process.stdout.write(JSON.stringify({ progress: Math.round(progress * 100) }) + '\\n');
    },
  },
});

process.stdout.write(JSON.stringify({ done: true, file }) + '\\n');
`;

/**
 * Renders a video using a Modal Sandbox with Revideo.
 * Returns the rendered video as a Buffer.
 */
export async function renderVideo(
	props: RenderInput,
	onProgress?: (progress: number) => void,
): Promise<Buffer> {
	if (MOCK_RENDER) {
		log.video.info("Mock render mode - skipping Modal render", {
			duration: props.durationInSeconds,
		});
		if (onProgress) onProgress(100);
		return Buffer.from("mock-video");
	}

	const app = await modal.apps.fromName("unscroll", { createIfMissing: true });
	const image = modal.images.fromRegistry(RENDER_IMAGE);

	log.video.debug("Creating Modal sandbox for render");
	const sb = await modal.sandboxes.create(app, image, {
		memoryMiB: 8192,
		timeoutMs: 300_000,
		workdir: "/app",
	});

	try {
		const encoder = new TextEncoder();

		// Write input props
		const inputHandle = await sb.open("/tmp/input.json", "w");
		await inputHandle.write(encoder.encode(JSON.stringify(props)));
		await inputHandle.close();

		// Write render script
		const scriptHandle = await sb.open("/app/render.mjs", "w");
		await scriptHandle.write(encoder.encode(RENDER_SCRIPT));
		await scriptHandle.close();

		log.video.debug("Starting render in Modal sandbox", {
			sandboxId: sb.sandboxId,
		});

		// Execute render (uses tsx to run ESM TypeScript)
		const proc = await sb.exec(["npx", "tsx", "/app/render.mjs"], {
			stdout: "pipe",
			stderr: "pipe",
		});

		// Stream stdout line-by-line for real-time progress logging
		const stdoutChunks: string[] = [];
		const stderrChunks: string[] = [];

		const stdoutPromise = (async () => {
			const text = await proc.stdout.readText();
			for (const line of text.split("\n")) {
				if (!line.trim()) continue;
				stdoutChunks.push(line);
				try {
					const msg = JSON.parse(line);
					if (msg.progress !== undefined) {
						log.video.debug("Render progress", { progress: msg.progress });
						if (onProgress) onProgress(msg.progress);
					}
					if (msg.done) {
						log.video.debug("Render script completed");
					}
				} catch {
					log.video.debug("Render stdout", { line });
				}
			}
		})();

		const stderrPromise = (async () => {
			const text = await proc.stderr.readText();
			if (text.trim()) {
				stderrChunks.push(text);
				log.video.debug("Render stderr", { text: text.slice(0, 500) });
			}
		})();

		await Promise.all([stdoutPromise, stderrPromise]);
		const exitCode = await proc.wait();

		if (exitCode !== 0) {
			const stderr = stderrChunks.join("\n");
			log.video.error("Modal render failed", {
				stderr: stderr.slice(0, 1000),
				exitCode,
			});
			throw new Error(`Render failed (exit ${exitCode}): ${stderr}`);
		}

		// Read rendered video from sandbox filesystem
		log.video.debug("Reading rendered video from sandbox");
		const videoHandle = await sb.open("/tmp/output.mp4", "r");
		const videoData = await videoHandle.read();
		await videoHandle.close();

		log.video.debug("Render complete", {
			sandboxId: sb.sandboxId,
			videoSizeBytes: videoData.byteLength,
		});

		return Buffer.from(videoData);
	} finally {
		await sb.terminate();
	}
}
