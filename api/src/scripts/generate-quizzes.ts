import { eq, count } from "drizzle-orm";
import { db, topics, concepts, quizzes, quizConcepts } from "../db";
import { createOpenRouterClient } from "../lib/openrouter";

const QUIZ_MODEL = "google/gemini-2.5-pro";

interface ConceptForQuiz {
	id: string;
	slug: string;
	name: string;
	description: string;
}

interface GeneratedQuiz {
	question: string;
	answer_choices: string[];
	correct_answer: string;
	concept_slugs: string[];
}

function parseJsonResponse(text: string): unknown {
	const stripped = text
		.replace(/^```(?:json)?\s*/i, "")
		.replace(/\s*```$/i, "")
		.trim();
	return JSON.parse(stripped) as unknown;
}

// Split concepts into batches of 3-5 for quiz generation.
// A quiz is placed after every batch, matching the curriculum agent behavior.
function batchConcepts(allConcepts: ConceptForQuiz[]): ConceptForQuiz[][] {
	const batches: ConceptForQuiz[][] = [];
	let i = 0;
	while (i < allConcepts.length) {
		const remaining = allConcepts.length - i;
		// If remaining is 6-7, split into two balanced groups instead of 5+1 or 5+2
		let batchSize: number;
		if (remaining <= 5) {
			batchSize = remaining;
		} else if (remaining <= 7) {
			batchSize = Math.ceil(remaining / 2);
		} else {
			// Pick a random size between 3-5 for variety
			batchSize = 3 + Math.floor(Math.random() * 3);
		}
		batches.push(allConcepts.slice(i, i + batchSize));
		i += batchSize;
	}
	// Drop any batch with fewer than 3 concepts (can't make a good quiz)
	return batches.filter((b) => b.length >= 3);
}

async function generateQuizForBatch(
	topicName: string,
	batch: ConceptForQuiz[],
): Promise<GeneratedQuiz | null> {
	const client = createOpenRouterClient("CA");

	const conceptList = batch
		.map((c) => `- ${c.slug}: ${c.name} — ${c.description}`)
		.join("\n");

	const prompt = `You are an expert quiz designer. Generate exactly ONE multiple-choice quiz question that tests understanding across the following ${batch.length} concepts from the topic "${topicName}".

Concepts:
${conceptList}

The quiz must:
- Ask a question that requires understanding of all (or most) of these concepts together
- Have exactly 4 answer choices with one correct answer
- Reference the concept slugs it covers (use the exact slugs listed above)

Output JSON only, no markdown:
{"question":"...","answer_choices":["A","B","C","D"],"correct_answer":"B","concept_slugs":["slug1","slug2","slug3"]}`;

	const result = await client.callModel({
		model: QUIZ_MODEL,
		input: prompt,
		text: { format: { type: "json_object" } },
	});

	const text = await result.getText();
	const parsed = parseJsonResponse(text) as GeneratedQuiz;

	// Validate
	if (!parsed.answer_choices.includes(parsed.correct_answer)) {
		console.warn(`  Skipping quiz (correct_answer not in choices): "${parsed.question.substring(0, 60)}..."`);
		return null;
	}

	const validSlugs = parsed.concept_slugs.filter((s) =>
		batch.some((c) => c.slug === s),
	);
	if (validSlugs.length < 2) {
		console.warn(`  Skipping quiz (too few valid concept refs): "${parsed.question.substring(0, 60)}..."`);
		return null;
	}

	parsed.concept_slugs = validSlugs;
	return parsed;
}

async function saveQuizzes(
	topicId: string,
	generatedQuizzes: GeneratedQuiz[],
	slugToId: Map<string, string>,
	startOrderIndex: number,
): Promise<number> {
	let saved = 0;

	for (let i = 0; i < generatedQuizzes.length; i++) {
		const quiz = generatedQuizzes[i];
		const conceptIds: string[] = [];

		for (const slug of quiz.concept_slugs) {
			const id = slugToId.get(slug);
			if (id) conceptIds.push(id);
		}

		if (conceptIds.length === 0) continue;

		const [created] = await db
			.insert(quizzes)
			.values({
				topicId,
				question: quiz.question,
				correctAnswer: quiz.correct_answer,
				answerChoices: quiz.answer_choices,
				orderIndex: startOrderIndex + i,
			})
			.returning({ id: quizzes.id });

		for (const conceptId of conceptIds) {
			await db
				.insert(quizConcepts)
				.values({ quizId: created.id, conceptId })
				.onConflictDoNothing();
		}

		saved++;
	}

	return saved;
}

async function main() {
	console.log("=== Quiz Generator for Imported Videos ===\n");

	// Get all topics
	const allTopics = await db
		.select({ id: topics.id, slug: topics.slug, name: topics.name })
		.from(topics);

	console.log(`Found ${allTopics.length} topics\n`);

	let totalGenerated = 0;
	let totalSkipped = 0;

	for (const topic of allTopics) {
		console.log(`\n--- Topic: ${topic.name} (${topic.slug}) ---`);

		// Get existing quiz count
		const [quizCount] = await db
			.select({ count: count() })
			.from(quizzes)
			.where(eq(quizzes.topicId, topic.id));

		const existingQuizzes = quizCount?.count ?? 0;

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

		console.log(`  Concepts: ${topicConcepts.length}, Existing quizzes: ${existingQuizzes}`);

		if (topicConcepts.length < 3) {
			console.log(`  Skipping: need at least 3 concepts to generate quizzes`);
			totalSkipped++;
			continue;
		}

		if (existingQuizzes > 0) {
			console.log(`  Skipping: quizzes already exist (use --force to regenerate)`);
			totalSkipped++;
			continue;
		}

		// Build slug -> id map
		const slugToId = new Map<string, string>();
		for (const c of topicConcepts) {
			slugToId.set(c.slug, c.id);
		}

		const conceptsForQuiz: ConceptForQuiz[] = topicConcepts.map((c) => ({
			id: c.id,
			slug: c.slug,
			name: c.name,
			description: c.description ?? "",
		}));

		// Split into batches of 3-5 concepts, one quiz per batch
		const batches = batchConcepts(conceptsForQuiz);
		console.log(`  Split ${conceptsForQuiz.length} concepts into ${batches.length} batches for quizzes`);

		const generated: GeneratedQuiz[] = [];
		for (let i = 0; i < batches.length; i++) {
			const batch = batches[i];
			const batchSlugs = batch.map((c) => c.slug).join(", ");
			console.log(`  Batch ${i + 1}/${batches.length} (${batch.length} concepts): ${batchSlugs}`);

			try {
				const quiz = await generateQuizForBatch(topic.name, batch);
				if (quiz) {
					generated.push(quiz);
					console.log(`    ✓ "${quiz.question.substring(0, 70)}..."`);
				}
			} catch (error) {
				console.error(`    ✗ Failed to generate quiz for batch ${i + 1}:`, error);
			}
		}

		console.log(`  Generated ${generated.length}/${batches.length} quizzes`);

		const saved = await saveQuizzes(topic.id, generated, slugToId, 0);
		console.log(`  Saved ${saved} quizzes to database`);
		totalGenerated += saved;
	}

	console.log(`\n=== Quiz Generation Complete ===`);
	console.log(`Generated: ${totalGenerated}`);
	console.log(`Topics skipped: ${totalSkipped}`);

	process.exit(0);
}

// Handle --force flag to regenerate even if quizzes exist
const forceRegenerate = process.argv.includes("--force");

if (forceRegenerate) {
	console.log("Force mode: will delete existing quizzes and regenerate\n");

	// Override the skip logic by deleting existing quizzes first
	const originalMain = main;
	async function forceMain() {
		const allTopics = await db
			.select({ id: topics.id, slug: topics.slug })
			.from(topics);

		for (const topic of allTopics) {
			const deleted = await db
				.delete(quizzes)
				.where(eq(quizzes.topicId, topic.id))
				.returning({ id: quizzes.id });

			if (deleted.length > 0) {
				console.log(`Deleted ${deleted.length} existing quizzes for ${topic.slug}`);
			}
		}

		await originalMain();
	}

	forceMain().catch((error) => {
		console.error("Quiz generation failed:", error);
		process.exit(1);
	});
} else {
	main().catch((error) => {
		console.error("Quiz generation failed:", error);
		process.exit(1);
	});
}
