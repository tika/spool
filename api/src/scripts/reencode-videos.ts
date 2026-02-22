import { $ } from "bun";
import { mkdir, rm, readdir } from "fs/promises";
import { join } from "path";

const S3_BUCKET = "unscroll-assets";
const WORK_DIR = "/tmp/reencode-videos";
const CONCURRENCY = 4; // Process 4 videos at a time

async function listS3Videos(): Promise<string[]> {
	const result =
		await $`aws s3 ls s3://${S3_BUCKET}/reels/ --recursive`.text();
	const lines = result.trim().split("\n").filter(Boolean);

	return lines
		.map((line) => {
			// Format: "2026-02-22 03:34:43    3356490 reels/slug/uuid.mp4"
			const match = line.match(/reels\/.*\.mp4$/);
			return match ? match[0] : null;
		})
		.filter((key): key is string => key !== null);
}

async function checkCodec(filePath: string): Promise<string> {
	try {
		const result =
			await $`ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 ${filePath}`.text();
		return result.trim();
	} catch {
		return "unknown";
	}
}

async function reencodeVideo(
	s3Key: string,
	index: number,
	total: number,
): Promise<{ key: string; status: "skipped" | "reencoded" | "failed" }> {
	const localInput = join(WORK_DIR, "input", s3Key);
	const localOutput = join(WORK_DIR, "output", s3Key);

	try {
		console.log(`[${index + 1}/${total}] Processing: ${s3Key}`);

		// Create directories
		await mkdir(join(WORK_DIR, "input", s3Key.replace(/\/[^/]+$/, "")), {
			recursive: true,
		});
		await mkdir(join(WORK_DIR, "output", s3Key.replace(/\/[^/]+$/, "")), {
			recursive: true,
		});

		// Download from S3
		console.log(`  Downloading...`);
		await $`aws s3 cp s3://${S3_BUCKET}/${s3Key} ${localInput}`.quiet();

		// Check codec
		const codec = await checkCodec(localInput);
		console.log(`  Current codec: ${codec}`);

		if (codec === "h264") {
			console.log(`  Already H.264, skipping`);
			await rm(localInput);
			return { key: s3Key, status: "skipped" };
		}

		// Re-encode to H.264
		console.log(`  Re-encoding to H.264...`);
		await $`ffmpeg -y -i ${localInput} -c:v libx264 -preset medium -crf 23 -c:a aac -b:a 128k -movflags +faststart ${localOutput}`.quiet();

		// Upload back to S3
		console.log(`  Uploading...`);
		await $`aws s3 cp ${localOutput} s3://${S3_BUCKET}/${s3Key} --content-type video/mp4`.quiet();

		// Cleanup
		await rm(localInput);
		await rm(localOutput);

		console.log(`  Done!`);
		return { key: s3Key, status: "reencoded" };
	} catch (error) {
		console.error(`  Failed: ${error}`);
		// Cleanup on error
		try {
			await rm(localInput);
		} catch {}
		try {
			await rm(localOutput);
		} catch {}
		return { key: s3Key, status: "failed" };
	}
}

async function processInBatches<T, R>(
	items: T[],
	batchSize: number,
	processor: (item: T, index: number, total: number) => Promise<R>,
): Promise<R[]> {
	const results: R[] = [];
	for (let i = 0; i < items.length; i += batchSize) {
		const batch = items.slice(i, i + batchSize);
		const batchResults = await Promise.all(
			batch.map((item, batchIndex) =>
				processor(item, i + batchIndex, items.length),
			),
		);
		results.push(...batchResults);
	}
	return results;
}

async function main() {
	console.log("🎬 S3 Video Re-encoder (AV1 → H.264)\n");

	// Setup work directory
	await rm(WORK_DIR, { recursive: true, force: true });
	await mkdir(join(WORK_DIR, "input"), { recursive: true });
	await mkdir(join(WORK_DIR, "output"), { recursive: true });

	// List videos
	console.log("Listing S3 videos...");
	const videos = await listS3Videos();
	console.log(`Found ${videos.length} videos\n`);

	if (videos.length === 0) {
		console.log("No videos found!");
		return;
	}

	// Process videos
	const results = await processInBatches(videos, CONCURRENCY, reencodeVideo);

	// Summary
	const reencoded = results.filter((r) => r.status === "reencoded").length;
	const skipped = results.filter((r) => r.status === "skipped").length;
	const failed = results.filter((r) => r.status === "failed").length;

	console.log("\n📊 Summary:");
	console.log(`  Re-encoded: ${reencoded}`);
	console.log(`  Skipped (already H.264): ${skipped}`);
	console.log(`  Failed: ${failed}`);

	if (failed > 0) {
		console.log("\nFailed videos:");
		results
			.filter((r) => r.status === "failed")
			.forEach((r) => console.log(`  - ${r.key}`));
	}

	// Cleanup
	await rm(WORK_DIR, { recursive: true, force: true });
	console.log("\n✅ Done!");
}

main().catch(console.error);
