import { log } from "../lib/logger";
import {
	feedRepository,
	type ConceptWithPrereqs,
	type QuizWithConcepts,
} from "../repositories/feed-repository";
import { topicRepository } from "../repositories/topic-repository";

export type FeedItem =
	| {
			type: "reel";
			conceptSlug: string;
			conceptName: string;
			conceptDescription: string;
			difficulty: number;
			videoUrl: string | null;
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
	};
}

function quizToFeedItem(q: QuizWithConcepts): FeedItem {
	return {
		type: "quiz",
		quizId: q.id,
		question: q.question,
		answerChoices: q.answerChoices,
		correctAnswer: q.correctAnswer,
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

	const sorted = topologicalSort(concepts);
	const quizzes = await feedRepository.getQuizzesByTopic(topicSlug);
	return buildMergedFeed(sorted, quizzes);
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
