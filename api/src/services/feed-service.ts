import { log } from "../lib/logger";
import { enqueue, getQueueLength, hasExpandForTopic } from "../queue/queue";
import {
	feedRepository,
	type ConceptWithPrereqs,
	type QuizWithConcepts,
} from "../repositories/feed-repository";
import { topicRepository } from "../repositories/topic-repository";

/** How many "ready" items (with audio or video) must remain ahead before we trigger generation */
const LOOKAHEAD_THRESHOLD = 3;
/** How many concepts without content to generate audio for at once */
const AUDIO_GEN_BATCH_SIZE = 5;
/** Below this many total concepts remaining, expand the curriculum */
const CURRICULUM_EXPAND_THRESHOLD = 5;
/** Don't enqueue expand_curriculum for same topic more than once per this cooldown */
const EXPAND_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
/** Shorter cooldown when truly at end (0 reels left) so we don't leave user stuck */
const EXPAND_COOLDOWN_AT_END_MS = 60 * 1000; // 1 minute

const lastExpandEnqueuedAt = new Map<string, number>();

export type FeedItem =
	| {
			type: "reel";
			conceptSlug: string;
			conceptName: string;
			conceptDescription: string;
			difficulty: number;
			videoUrl: string | null;
			audioUrl: string | null;
			transcript: string | null;
			captions: Array<{ word: string; startTime: number; endTime: number }> | null;
			durationSeconds: number | null;
	  }
	| {
			type: "quiz";
			quizId: string;
			question: string;
			answerChoices: string[];
			correctAnswer: string;
	  };

export interface FeedItemResult {
	item: FeedItem;
	cursor: number;
	hasNext: boolean;
	hasPrev: boolean;
}

/**
 * Kahn's algorithm for topological sort
 * Returns concepts in dependency order (prerequisites first)
 */
function topologicalSort(concepts: ConceptWithPrereqs[]): ConceptWithPrereqs[] {
	const idToConceptMap = new Map(concepts.map((c) => [c.id, c]));
	const inDegree = new Map<string, number>();
	const adjList = new Map<string, string[]>();

	// Initialize in-degree and adjacency list
	for (const concept of concepts) {
		inDegree.set(concept.id, concept.prerequisiteIds.length);
		for (const prereqId of concept.prerequisiteIds) {
			const deps = adjList.get(prereqId) || [];
			deps.push(concept.id);
			adjList.set(prereqId, deps);
		}
	}

	// Find all nodes with no prerequisites (in-degree 0)
	const queue: string[] = [];
	for (const concept of concepts) {
		if (inDegree.get(concept.id) === 0) {
			queue.push(concept.id);
		}
	}

	const sorted: ConceptWithPrereqs[] = [];

	while (queue.length > 0) {
		// Sort queue by orderIndex for stable ordering among peers
		queue.sort((a, b) => {
			const conceptA = idToConceptMap.get(a)!;
			const conceptB = idToConceptMap.get(b)!;
			return conceptA.orderIndex - conceptB.orderIndex;
		});

		const currentId = queue.shift()!;
		const current = idToConceptMap.get(currentId)!;
		sorted.push(current);

		// Reduce in-degree of dependents
		const dependents = adjList.get(currentId) || [];
		for (const depId of dependents) {
			const newDegree = (inDegree.get(depId) || 0) - 1;
			inDegree.set(depId, newDegree);
			if (newDegree === 0) {
				queue.push(depId);
			}
		}
	}

	// Check for cycles (shouldn't happen with valid DAG)
	if (sorted.length !== concepts.length) {
		log.api.warn("Cycle detected in concept prerequisites", {
			expected: concepts.length,
			sorted: sorted.length,
		});
		// Fall back to orderIndex sorting
		return [...concepts].sort((a, b) => a.orderIndex - b.orderIndex);
	}

	return sorted;
}

function conceptToFeedItem(c: ConceptWithPrereqs): FeedItem {
	return {
		type: "reel",
		conceptSlug: c.slug,
		conceptName: c.name,
		conceptDescription: c.description,
		difficulty: c.difficulty,
		videoUrl: c.videoUrl,
		audioUrl: c.audioUrl,
		transcript: c.transcript,
		captions: c.captions,
		durationSeconds: c.durationSeconds,
	};
}

function truncateToWords(text: string, maxWords: number): string {
	const words = text.trim().split(/\s+/).filter(Boolean);
	if (words.length <= maxWords) return text;
	return words.slice(0, maxWords).join(" ");
}

function quizToFeedItem(q: QuizWithConcepts): FeedItem {
	const truncatedChoices = q.answerChoices.map((a) => truncateToWords(a, 8));
	const correctIdx = q.answerChoices.findIndex(
		(a) => a.trim().toLowerCase() === q.correctAnswer.trim().toLowerCase(),
	);
	const correctAnswer =
		correctIdx >= 0 ? truncatedChoices[correctIdx] : truncateToWords(q.correctAnswer, 8);
	return {
		type: "quiz",
		quizId: q.id,
		question: truncateToWords(q.question, 12),
		answerChoices: truncatedChoices,
		correctAnswer,
	};
}

function buildMergedFeed(
	sortedConcepts: ConceptWithPrereqs[],
	quizzes: QuizWithConcepts[],
): FeedItem[] {
	const conceptIdToIndex = new Map<string, number>();
	for (let i = 0; i < sortedConcepts.length; i++) {
		conceptIdToIndex.set(sortedConcepts[i].id, i);
	}

	const quizzesByInsertIndex = new Map<number, QuizWithConcepts[]>();
	for (const quiz of quizzes) {
		let maxIndex = -1;
		for (const cid of quiz.conceptIds) {
			const idx = conceptIdToIndex.get(cid);
			if (idx !== undefined && idx > maxIndex) maxIndex = idx;
		}
		if (maxIndex >= 0) {
			const existing = quizzesByInsertIndex.get(maxIndex) || [];
			existing.push(quiz);
			quizzesByInsertIndex.set(maxIndex, existing);
		}
	}

	const result: FeedItem[] = [];
	for (let i = 0; i < sortedConcepts.length; i++) {
		result.push(conceptToFeedItem(sortedConcepts[i]));
		const quizzesAfter = quizzesByInsertIndex.get(i) || [];
		for (const q of quizzesAfter) {
			result.push(quizToFeedItem(q));
		}
	}
	return result;
}

async function getMergedFeed(
	topicSlug: string,
): Promise<FeedItem[] | null> {
	const topic = await topicRepository.getTopicBySlug(topicSlug);
	if (!topic || topic.status !== "ready") {
		return null;
	}

	const concepts = await feedRepository.getConceptsWithPrerequisites(topicSlug);
	if (concepts.length === 0) {
		return [];
	}

	// Only include concepts that have at least one reel (video or audio)
	const conceptsWithReels = concepts.filter((c) => c.videoUrl || c.audioUrl);
	const sorted = topologicalSort(conceptsWithReels);
	const quizzes = await feedRepository.getQuizzesByTopic(topicSlug);
	return buildMergedFeed(sorted, quizzes);
}

/**
 * Checks if we need to generate more content and queues jobs if so.
 * Called on every feed item request — fires async, does not block the response.
 *
 * Two triggers:
 * 1. Few "ready" reels (with audio/video) remain ahead → queue CDA to generate audio
 * 2. Few concepts remain overall → queue CA to expand curriculum
 */
function maybeQueueMoreContent(
	topicSlug: string,
	items: FeedItem[],
	currentIndex: number,
): void {
	// Don't queue if there's already work pending
	if (getQueueLength() > 0) return;

	const remaining = items.slice(currentIndex + 1);
	const remainingReels = remaining.filter(
		(i): i is Extract<FeedItem, { type: "reel" }> => i.type === "reel",
	);

	// Count reels that have content (audio or video)
	const readyReels = remainingReels.filter((r) => r.audioUrl || r.videoUrl);
	// Reels that need content generated
	const unreadyReels = remainingReels.filter((r) => !r.audioUrl && !r.videoUrl);

	log.feed.info("Look-ahead check", {
		topicSlug,
		cursor: currentIndex,
		totalItems: items.length,
		reelsAhead: remainingReels.length,
		readyAhead: readyReels.length,
		unreadyAhead: unreadyReels.length,
	});

	// Trigger 1: Generate audio for concepts without content
	if (readyReels.length < LOOKAHEAD_THRESHOLD && unreadyReels.length > 0) {
		const batch = unreadyReels.slice(0, AUDIO_GEN_BATCH_SIZE);

		log.feed.info("⚡ Triggering audio generation — user approaching end of ready content", {
			topicSlug,
			readyRemaining: readyReels.length,
			threshold: LOOKAHEAD_THRESHOLD,
			conceptsToGenerate: batch.map((r) => r.conceptSlug),
		});

		// We need concept IDs — look them up async
		feedRepository
			.getConceptsWithPrerequisites(topicSlug)
			.then((allConcepts) => {
				const slugToConceptMap = new Map(allConcepts.map((c) => [c.slug, c]));
				const conceptsToGenerate = batch
					.map((r) => slugToConceptMap.get(r.conceptSlug))
					.filter((c): c is ConceptWithPrereqs => !!c)
					.map((c) => ({
						id: c.id,
						slug: c.slug,
						name: c.name,
						description: c.description,
					}));

				if (conceptsToGenerate.length > 0) {
					enqueue({
						type: "generate_audio_reels",
						topicSlug,
						concepts: conceptsToGenerate,
					});
				}
			})
			.catch((err) => {
				log.feed.error("Failed to queue audio generation", {
					error: err instanceof Error ? err.message : String(err),
				});
			});
	}

	// Trigger 2: Expand curriculum if running low on concepts
	if (remainingReels.length < CURRICULUM_EXPAND_THRESHOLD) {
		const now = Date.now();
		const lastAt = lastExpandEnqueuedAt.get(topicSlug) ?? 0;
		const cooldown =
			remainingReels.length === 0 ? EXPAND_COOLDOWN_AT_END_MS : EXPAND_COOLDOWN_MS;
		if (hasExpandForTopic(topicSlug) || now - lastAt < cooldown) {
			log.feed.debug("Skipping curriculum expansion — already queued or in cooldown", {
				topicSlug,
				conceptsRemaining: remainingReels.length,
			});
		} else {
			log.feed.info("⚡ Triggering curriculum expansion — running low on concepts", {
				topicSlug,
				conceptsRemaining: remainingReels.length,
				threshold: CURRICULUM_EXPAND_THRESHOLD,
			});

			lastExpandEnqueuedAt.set(topicSlug, now);

			topicRepository
				.getTopicBySlug(topicSlug)
				.then((topic) => {
					if (!topic) return;
					enqueue({
						type: "expand_curriculum",
						topicSlug,
						topicName: topic.name,
					});
				})
				.catch((err) => {
					log.feed.error("Failed to queue curriculum expansion", {
						error: err instanceof Error ? err.message : String(err),
					});
				});
		}
	}
}

export const feedService = {
	async getItem(
		topicSlug: string,
		_username: string,
		cursor: number,
		direction: "next" | "prev",
	): Promise<FeedItemResult | null> {
		const items = await getMergedFeed(topicSlug);
		if (!items || items.length === 0) {
			return null;
		}

		const targetIndex =
			direction === "next" ? cursor : Math.max(0, cursor - 1);

		if (targetIndex < 0 || targetIndex >= items.length) {
			return null;
		}

		const item = items[targetIndex];
		const hasNext = targetIndex + 1 < items.length;
		const hasPrev = targetIndex > 0;

		log.api.debug("Feed item", {
			topicSlug,
			direction,
			cursor,
			targetIndex,
			itemType: item.type,
		});

		// Trigger content generation if user is approaching the end
		maybeQueueMoreContent(topicSlug, items, targetIndex);

		return {
			item,
			cursor: targetIndex,
			hasNext,
			hasPrev,
		};
	},

	async getFeed(topicSlug: string, _username: string): Promise<FeedItem[]> {
		const startTime = Date.now();

		const items = await getMergedFeed(topicSlug);
		if (!items) {
			log.api.debug("Feed requested for unknown/non-ready topic", {
				topicSlug,
			});
			return [];
		}

		log.api.info("Feed generated", {
			topicSlug,
			items: items.length,
			durationMs: Date.now() - startTime,
		});

		return items;
	},
};
