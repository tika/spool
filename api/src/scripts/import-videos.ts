import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import { db, topics, concepts, reels } from "../db";
import { eq } from "drizzle-orm";
import { uploadVideo } from "../services/storage-service";
import { OpenRouter } from "@openrouter/sdk";

// Generate a sourceId from filename - hashes the cleaned title for consistency
function generateSourceId(filename: string): string {
	const title = filename
		.replace(/\.[^.]+$/, "") // remove extension
		.replace(/\s*\[[^\]]+\]$/, "") // remove [videoId]
		.trim();
	return `file:${createHash("md5").update(title).digest("hex").substring(0, 16)}`;
}

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const ANALYSIS_MODEL = "anthropic/claude-sonnet-4";

const VIDEOS_FOR_SPOOL_DIR = "/Users/tika/Jupiter/videos-for-spool";

interface VideoFile {
	path: string;
	filename: string;
	sourceId: string;
}

interface ExistingConcept {
	id: string;
	slug: string;
	name: string;
	topicSlug: string;
}

interface MatchResult {
	conceptId: string;
	conceptSlug: string;
	conceptName: string;
	title: string;
	description: string;
}

async function loadExistingConcepts(): Promise<ExistingConcept[]> {
	const rows = await db
		.select({
			id: concepts.id,
			slug: concepts.slug,
			name: concepts.name,
			topicSlug: topics.slug,
		})
		.from(concepts)
		.innerJoin(topics, eq(concepts.topicId, topics.id));

	return rows;
}

function collectVideos(): VideoFile[] {
	const videos: VideoFile[] = [];

	if (!existsSync(VIDEOS_FOR_SPOOL_DIR)) {
		console.log("videos-for-spool directory not found");
		return videos;
	}

	const entries = readdirSync(VIDEOS_FOR_SPOOL_DIR, { withFileTypes: true });
	const mp4Files = entries.filter(
		(e) => e.isFile() && e.name.endsWith(".mp4") && !e.name.startsWith("."),
	);

	for (const entry of mp4Files) {
		videos.push({
			path: join(VIDEOS_FOR_SPOOL_DIR, entry.name),
			filename: entry.name,
			sourceId: generateSourceId(entry.name),
		});
	}

	console.log(`Found ${videos.length} videos in videos-for-spool`);
	return videos;
}

function parseJsonResponse(text: string): unknown {
	const stripped = text
		.replace(/^```(?:json)?\s*/i, "")
		.replace(/\s*```$/i, "")
		.trim();
	return JSON.parse(stripped) as unknown;
}

function formatConceptsForPrompt(conceptsList: ExistingConcept[]): string {
	const byTopic = new Map<string, ExistingConcept[]>();
	for (const c of conceptsList) {
		const list = byTopic.get(c.topicSlug) ?? [];
		list.push(c);
		byTopic.set(c.topicSlug, list);
	}

	const lines: string[] = [];
	for (const [topicSlug, list] of byTopic) {
		const items = list.map((c) => `  - ${c.slug} (${c.name})`).join("\n");
		lines.push(`${topicSlug}:\n${items}`);
	}
	return lines.join("\n\n");
}

async function matchVideoToConcept(
	video: VideoFile,
	existingConcepts: ExistingConcept[],
): Promise<MatchResult | null> {
	const openrouter = new OpenRouter({ apiKey: OPENROUTER_API_KEY });

	const titleFromFile = video.filename
		.replace(/\.[^.]+$/, "")
		.replace(/\s*\[[^\]]+\]$/, "")
		.trim();

	const conceptsText = formatConceptsForPrompt(existingConcepts);
	const validSlugs = new Set(existingConcepts.map((c) => c.slug));

	const prompt = `You are matching a video to an existing concept. The video title is: "${titleFromFile}"

Existing concepts (by topic):
${conceptsText}

Pick the ONE concept that best matches this video. You must return a concept slug that exists in the list above.
Respond in JSON only:
{ "conceptSlug": "exact-slug-from-list" }`;

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
			const parsed = parseJsonResponse(text) as { conceptSlug: string };
			const slug = parsed.conceptSlug?.trim();
			if (slug && validSlugs.has(slug)) {
				const concept = existingConcepts.find((c) => c.slug === slug);
				if (concept) {
					console.log(`  Matched: ${concept.topicSlug} -> ${concept.slug}`);
					return {
						conceptId: concept.id,
						conceptSlug: concept.slug,
						conceptName: concept.name,
						title: titleFromFile,
						description: `Imported video: ${titleFromFile}`,
					};
				}
			}
		}
	} catch (error) {
		console.error("AI matching failed:", error);
	}

	return null;
}

async function importVideo(
	video: VideoFile,
	match: MatchResult,
): Promise<"imported" | "skipped"> {
	const [existingBySource] = await db
		.select({ id: reels.id })
		.from(reels)
		.where(eq(reels.point, video.sourceId))
		.limit(1);

	if (existingBySource) {
		console.log(`  Already imported (${video.sourceId}), skipping`);
		return "skipped";
	}

	const videoBuffer = readFileSync(video.path);
	console.log(
		`  Uploading ${video.filename} (${(videoBuffer.length / 1024 / 1024).toFixed(2)} MB)...`,
	);

	const videoUrl = await uploadVideo(videoBuffer, match.conceptSlug);
	console.log(`  Uploaded to: ${videoUrl}`);

	await db.insert(reels).values({
		conceptId: match.conceptId,
		name: match.title,
		description: match.description,
		videoUrl,
		point: video.sourceId,
		source: "imported",
		status: "completed",
	});

	console.log(`  Created reel for concept ${match.conceptSlug}`);
	return "imported";
}

async function main() {
	console.log("=== Video Importer ===\n");

	console.log("Loading existing concepts...");
	const existingConcepts = await loadExistingConcepts();
	if (existingConcepts.length === 0) {
		console.error("No concepts found in database. Create topics and concepts first.");
		process.exit(1);
	}
	console.log(`Loaded ${existingConcepts.length} concepts\n`);

	console.log("Collecting videos...");
	const videos = collectVideos();
	console.log();

	if (videos.length === 0) {
		console.log("No videos to process.");
		process.exit(0);
	}

	let imported = 0;
	let skipped = 0;
	let failed = 0;

	for (const video of videos) {
		try {
			console.log(`\nProcessing: ${video.filename}`);

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

			const match = await matchVideoToConcept(video, existingConcepts);
			if (!match) {
				console.error(`  Could not match to any concept, skipping`);
				failed++;
				continue;
			}

			const importResult = await importVideo(video, match);
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
