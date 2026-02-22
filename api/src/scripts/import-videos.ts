import { readFileSync, readdirSync, existsSync } from "fs";
import { execSync } from "child_process";
import { join, basename } from "path";
import { createHash } from "crypto";
import { db, topics, concepts, reels } from "../db";
import { eq } from "drizzle-orm";
import { uploadVideo } from "../services/storage-service";
import { OpenRouter } from "@openrouter/sdk";

// Generate a sourceId from filename - hashes the cleaned title for consistency
// This matches the backfill script which only has access to the title (not video ID)
function generateSourceId(filename: string): string {
	const title = filename
		.replace(/\.[^.]+$/, "") // remove extension
		.replace(/\s*\[[^\]]+\]$/, "") // remove [videoId]
		.trim();
	return `file:${createHash("md5").update(title).digest("hex").substring(0, 16)}`;
}

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const ANALYSIS_MODEL = "anthropic/claude-sonnet-4";

const TOPICS = ["ancient-history", "linear-algebra", "black-holes"] as const;
type TopicSlug = (typeof TOPICS)[number];

interface VideoFile {
	path: string;
	filename: string;
	sourceId: string; // YouTube video ID or filename hash for idempotency
	suggestedTopic?: TopicSlug;
}

interface AnalysisResult {
	topic: TopicSlug;
	conceptSlug: string;
	conceptName: string;
	title: string;
	description: string;
	transcript?: string;
}

const DOWNLOAD_DIR = "/Users/tika/Jupiter/unscroll/downloads";
const VIDEOS_FOR_SPOOL_DIR = "/Users/tika/Jupiter/videos-for-spool";
const VIDS_TXT_PATH = "/Users/tika/Jupiter/unscroll/vids.txt";

// Map folder names to topic slugs
const FOLDER_TO_TOPIC: Record<string, TopicSlug> = {
	"ancient-hist": "ancient-history",
	blackhole: "black-holes",
	"linear-alg": "linear-algebra",
};

async function ensureTopicsExist(): Promise<Map<TopicSlug, string>> {
	const topicMap = new Map<TopicSlug, string>();

	const topicData: Array<{
		slug: TopicSlug;
		name: string;
		description: string;
	}> = [
		{
			slug: "ancient-history",
			name: "Ancient History",
			description:
				"Explore ancient civilizations, empires, and historical events",
		},
		{
			slug: "linear-algebra",
			name: "Linear Algebra",
			description: "Vectors, matrices, transformations, and linear systems",
		},
		{
			slug: "black-holes",
			name: "Black Holes",
			description: "The physics of black holes, event horizons, and spacetime",
		},
	];

	for (const t of topicData) {
		const [existing] = await db
			.select({ id: topics.id })
			.from(topics)
			.where(eq(topics.slug, t.slug))
			.limit(1);

		if (existing) {
			topicMap.set(t.slug, existing.id);
			console.log(`Topic exists: ${t.slug} (${existing.id})`);
		} else {
			const [created] = await db
				.insert(topics)
				.values({
					slug: t.slug,
					name: t.name,
					description: t.description,
					status: "ready",
				})
				.returning({ id: topics.id });
			topicMap.set(t.slug, created.id);
			console.log(`Created topic: ${t.slug} (${created.id})`);
		}
	}

	return topicMap;
}

async function getOrCreateConcept(
	topicId: string,
	conceptSlug: string,
	conceptName: string,
	description: string,
): Promise<string> {
	const [existing] = await db
		.select({ id: concepts.id })
		.from(concepts)
		.where(eq(concepts.slug, conceptSlug))
		.limit(1);

	if (existing) {
		console.log(`Concept exists: ${conceptSlug}`);
		return existing.id;
	}

	// Get max order index for topic
	const existingConcepts = await db
		.select({ orderIndex: concepts.orderIndex })
		.from(concepts)
		.where(eq(concepts.topicId, topicId));

	const maxOrder = existingConcepts.reduce(
		(max, c) => Math.max(max, c.orderIndex),
		-1,
	);

	const [created] = await db
		.insert(concepts)
		.values({
			topicId,
			slug: conceptSlug,
			name: conceptName,
			description,
			difficulty: 1,
			orderIndex: maxOrder + 1,
		})
		.returning({ id: concepts.id });

	console.log(`Created concept: ${conceptSlug} (${created.id})`);
	return created.id;
}

async function downloadYoutubeVideos(): Promise<VideoFile[]> {
	const videos: VideoFile[] = [];

	if (!existsSync(VIDS_TXT_PATH)) {
		console.log("No vids.txt found, skipping YouTube downloads");
		return videos;
	}

	const urls = readFileSync(VIDS_TXT_PATH, "utf-8")
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line && line.startsWith("http"));

	console.log(`Found ${urls.length} YouTube URLs to download`);

	// Ensure download directory exists
	execSync(`mkdir -p "${DOWNLOAD_DIR}"`);

	for (const url of urls) {
		try {
			console.log(`Downloading: ${url}`);

			// Download with yt-dlp, output template includes video ID
			const output = execSync(
				`yt-dlp -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" ` +
					`--merge-output-format mp4 ` +
					`-o "${DOWNLOAD_DIR}/%(title).50s [%(id)s].%(ext)s" ` +
					`--print after_move:filepath "${url}"`,
				{ encoding: "utf-8", maxBuffer: 50 * 1024 * 1024 },
			).trim();

			const filepath = output.split("\n").pop()?.trim();
			if (filepath && existsSync(filepath)) {
				const filename = basename(filepath);
				videos.push({
					path: filepath,
					filename,
					sourceId: generateSourceId(filename),
				});
				console.log(`Downloaded: ${filename}`);
			}
		} catch (error) {
			console.error(`Failed to download ${url}:`, error);
		}
	}

	return videos;
}

function collectExistingVideos(): VideoFile[] {
	const videos: VideoFile[] = [];

	if (!existsSync(VIDEOS_FOR_SPOOL_DIR)) {
		console.log("videos-for-spool directory not found");
		return videos;
	}

	const folders = readdirSync(VIDEOS_FOR_SPOOL_DIR, {
		withFileTypes: true,
	}).filter((d) => d.isDirectory() && !d.name.startsWith("."));

	for (const folder of folders) {
		const folderPath = join(VIDEOS_FOR_SPOOL_DIR, folder.name);
		const topicSlug = FOLDER_TO_TOPIC[folder.name];

		const files = readdirSync(folderPath).filter((f) => f.endsWith(".mp4"));

		for (const file of files) {
			videos.push({
				path: join(folderPath, file),
				filename: file,
				sourceId: generateSourceId(file),
				suggestedTopic: topicSlug,
			});
		}
	}

	console.log(`Found ${videos.length} existing videos in videos-for-spool`);
	return videos;
}

function parseJsonResponse(text: string): unknown {
	const stripped = text
		.replace(/^```(?:json)?\s*/i, "")
		.replace(/\s*```$/i, "")
		.trim();
	return JSON.parse(stripped) as unknown;
}

async function analyzeVideo(video: VideoFile): Promise<AnalysisResult> {
	const openrouter = new OpenRouter({ apiKey: OPENROUTER_API_KEY });

	// Extract title from filename (remove extension and video ID)
	const titleFromFile = video.filename
		.replace(/\.[^.]+$/, "") // remove extension
		.replace(/\s*\[[^\]]+\]$/, "") // remove [videoId]
		.trim();

	// If we have a suggested topic from folder structure, use it
	if (video.suggestedTopic) {
		const slug = titleFromFile
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "")
			.substring(0, 50);

		return {
			topic: video.suggestedTopic,
			conceptSlug: slug,
			conceptName: titleFromFile,
			title: titleFromFile,
			description: `Imported video: ${titleFromFile}`,
		};
	}

	// Use AI to analyze and categorize
	const prompt = `Analyze this video title and categorize it into one of these topics:
- ancient-history: Ancient civilizations, Rome, Egypt, historical events before 500 AD
- linear-algebra: Matrices, vectors, linear transformations, math
- black-holes: Black holes, astronomy, space physics, astrophysics

Video title: "${titleFromFile}"

Respond in JSON format only, no markdown:
{
  "topic": "ancient-history" or "linear-algebra" or "black-holes",
  "conceptSlug": "short-kebab-case-concept-name-max-30-chars",
  "conceptName": "Human Readable Concept Name",
  "description": "Brief description of what this video covers"
}`;

	try {
		const result = await openrouter.callModel({
			model: ANALYSIS_MODEL,
			input: prompt,
			text: {
				format: { type: "json_object" },
			},
		});

		const text = await result.getText();
		if (text) {
			const parsed = parseJsonResponse(text) as {
				topic: TopicSlug;
				conceptSlug: string;
				conceptName: string;
				description: string;
			};
			console.log(`  AI categorized: ${parsed.topic} -> ${parsed.conceptSlug}`);
			return {
				topic: parsed.topic,
				conceptSlug: parsed.conceptSlug.substring(0, 50),
				conceptName: parsed.conceptName,
				title: titleFromFile,
				description: parsed.description,
			};
		}
	} catch (error) {
		console.error("AI analysis failed, falling back to heuristics:", error);
	}

	// Fallback: simple keyword matching
	const lower = titleFromFile.toLowerCase();
	let topic: TopicSlug = "ancient-history";

	if (
		lower.includes("matrix") ||
		lower.includes("linear") ||
		lower.includes("vector") ||
		lower.includes("determinant") ||
		lower.includes("eigen") ||
		lower.includes("cross product") ||
		lower.includes("column space")
	) {
		topic = "linear-algebra";
	} else if (
		lower.includes("black hole") ||
		lower.includes("blackhole") ||
		lower.includes("spaghetti") ||
		lower.includes("gravity well")
	) {
		topic = "black-holes";
	} else if (
		lower.includes("rome") ||
		lower.includes("roman") ||
		lower.includes("ancient") ||
		lower.includes("egypt") ||
		lower.includes("sahara") ||
		lower.includes("caesar") ||
		lower.includes("colosseum")
	) {
		topic = "ancient-history";
	}

	const slug = titleFromFile
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.substring(0, 50);

	return {
		topic,
		conceptSlug: slug,
		conceptName: titleFromFile,
		title: titleFromFile,
		description: `Imported video: ${titleFromFile}`,
	};
}

async function importVideo(
	video: VideoFile,
	analysis: AnalysisResult,
	topicMap: Map<TopicSlug, string>,
): Promise<"imported" | "skipped"> {
	// Check if this exact video was already imported (by sourceId stored in `point` field)
	const [existingBySource] = await db
		.select({ id: reels.id })
		.from(reels)
		.where(eq(reels.point, video.sourceId))
		.limit(1);

	if (existingBySource) {
		console.log(`  Already imported (${video.sourceId}), skipping`);
		return "skipped";
	}

	const topicId = topicMap.get(analysis.topic);
	if (!topicId) {
		throw new Error(`Topic not found: ${analysis.topic}`);
	}

	// Get or create concept
	const conceptId = await getOrCreateConcept(
		topicId,
		analysis.conceptSlug,
		analysis.conceptName,
		analysis.description,
	);

	// Read video file and upload to S3
	const videoBuffer = readFileSync(video.path);
	console.log(
		`  Uploading ${video.filename} (${(videoBuffer.length / 1024 / 1024).toFixed(2)} MB)...`,
	);

	const videoUrl = await uploadVideo(videoBuffer, analysis.conceptSlug);
	console.log(`  Uploaded to: ${videoUrl}`);

	// Create reel record with sourceId in `point` field for idempotency
	const [reel] = await db
		.insert(reels)
		.values({
			conceptId,
			name: analysis.title,
			description: analysis.description,
			transcript: analysis.transcript,
			videoUrl,
			point: video.sourceId, // Store sourceId for idempotency checks
			source: "imported",
			status: "completed",
		})
		.returning({ id: reels.id });

	console.log(`  Created reel: ${reel.id} for concept ${analysis.conceptSlug}`);
	return "imported";
}

async function main() {
	console.log("=== Video Importer ===\n");

	// Ensure topics exist
	console.log("Ensuring topics exist...");
	const topicMap = await ensureTopicsExist();
	console.log();

	// Collect videos from both sources
	console.log("Collecting existing videos...");
	const existingVideos = collectExistingVideos();
	console.log();

	console.log("Downloading YouTube videos...");
	const downloadedVideos = await downloadYoutubeVideos();
	console.log();

	const allVideos = [...existingVideos, ...downloadedVideos];
	console.log(`Total videos to process: ${allVideos.length}\n`);

	// Process each video
	let imported = 0;
	let skipped = 0;
	let failed = 0;

	for (const video of allVideos) {
		try {
			console.log(`\nProcessing: ${video.filename}`);

			// Check if already imported before doing AI analysis
			const [existingBySource] = await db
				.select({ id: reels.id })
				.from(reels)
				.where(eq(reels.point, video.sourceId))
				.limit(1);

			if (existingBySource) {
				console.log(`  Already imported (${video.sourceId}), skipping`);
				skipped++;
				continue;
			}

			const analysis = await analyzeVideo(video);
			console.log(`  Topic: ${analysis.topic}`);
			console.log(`  Concept: ${analysis.conceptSlug}`);

			const importResult = await importVideo(video, analysis, topicMap);
			if (importResult === "imported") {
				imported++;
			} else {
				skipped++;
			}
		} catch (error) {
			console.error(`Failed to import ${video.filename}:`, error);
			failed++;
		}
	}

	console.log(`\n=== Import Complete ===`);
	console.log(`Imported: ${imported}`);
	console.log(`Skipped: ${skipped}`);
	console.log(`Failed: ${failed}`);

	process.exit(0);
}

main().catch((error) => {
	console.error("Import failed:", error);
	process.exit(1);
});
