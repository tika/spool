import { eq } from "drizzle-orm";
import { db, topics, concepts, reels } from "../db";
import { generateAudioReel } from "../services/audio-reel-service";

async function main() {
	console.log("=== Audio Reel Generator ===\n");

	const targetTopicSlug = process.argv[2];

	// Get topics
	const allTopics = targetTopicSlug
		? await db
				.select({ id: topics.id, slug: topics.slug, name: topics.name })
				.from(topics)
				.where(eq(topics.slug, targetTopicSlug))
		: await db
				.select({ id: topics.id, slug: topics.slug, name: topics.name })
				.from(topics);

	if (allTopics.length === 0) {
		console.log(targetTopicSlug ? `Topic not found: ${targetTopicSlug}` : "No topics found");
		process.exit(1);
	}

	console.log(`Processing ${allTopics.length} topic(s)\n`);

	let generated = 0;
	let skipped = 0;
	let failed = 0;

	for (const topic of allTopics) {
		console.log(`\n--- ${topic.name} (${topic.slug}) ---`);

		// Get all concepts for this topic
		const topicConcepts = await db
			.select({
				id: concepts.id,
				slug: concepts.slug,
				name: concepts.name,
				description: concepts.description,
			})
			.from(concepts)
			.where(eq(concepts.topicId, topic.id))
			.orderBy(concepts.orderIndex);

		console.log(`  ${topicConcepts.length} concepts`);

		for (const concept of topicConcepts) {
			// Check if this concept already has an audio reel
			const [existingReel] = await db
				.select({ id: reels.id, audioUrl: reels.audioUrl })
				.from(reels)
				.where(eq(reels.conceptId, concept.id))
				.limit(1);

			if (existingReel?.audioUrl) {
				console.log(`  ✓ ${concept.slug} — already has audio`);
				skipped++;
				continue;
			}

			console.log(`  ⏳ ${concept.slug} — generating...`);

			try {
				const result = await generateAudioReel({
					conceptId: concept.id,
					conceptSlug: concept.slug,
					conceptName: concept.name,
					conceptDescription: concept.description ?? "",
				});

				console.log(
					`  ✓ ${concept.slug} — ${result.durationSeconds.toFixed(1)}s, ${result.captions.length} words`,
				);
				generated++;
			} catch (error) {
				console.error(
					`  ✗ ${concept.slug} — ${error instanceof Error ? error.message : error}`,
				);
				failed++;
			}
		}
	}

	console.log(`\n=== Complete ===`);
	console.log(`Generated: ${generated}`);
	console.log(`Skipped: ${skipped}`);
	console.log(`Failed: ${failed}`);

	process.exit(0);
}

main().catch((error) => {
	console.error("Audio reel generation failed:", error);
	process.exit(1);
});
