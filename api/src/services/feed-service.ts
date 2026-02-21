import { log } from "../lib/logger";
import {
	feedRepository,
	type ConceptWithPrereqs,
} from "../repositories/feed-repository";
import { topicRepository } from "../repositories/topic-repository";

export interface FeedItem {
	conceptSlug: string;
	conceptName: string;
	conceptDescription: string;
	difficulty: number;
	videoUrl: string | null;
}

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
		conceptSlug: c.slug,
		conceptName: c.name,
		conceptDescription: c.description,
		difficulty: c.difficulty,
		videoUrl: null,
	};
}

async function getSortedConcepts(
	topicSlug: string,
): Promise<ConceptWithPrereqs[] | null> {
	const topic = await topicRepository.getTopicBySlug(topicSlug);
	if (!topic || topic.status !== "ready") {
		return null;
	}

	const concepts = await feedRepository.getConceptsWithPrerequisites(topicSlug);
	if (concepts.length === 0) {
		return [];
	}

	return topologicalSort(concepts);
}

export const feedService = {
	async getItem(
		topicSlug: string,
		_username: string,
		cursor: number,
		direction: "next" | "prev",
	): Promise<FeedItemResult | null> {
		const sorted = await getSortedConcepts(topicSlug);
		if (!sorted || sorted.length === 0) {
			return null;
		}

		// Calculate target index based on direction
		const targetIndex =
			direction === "next" ? cursor : Math.max(0, cursor - 1);

		if (targetIndex < 0 || targetIndex >= sorted.length) {
			return null;
		}

		const concept = sorted[targetIndex];
		const hasNext = targetIndex + 1 < sorted.length;
		const hasPrev = targetIndex > 0;

		log.api.debug("Feed item", {
			topicSlug,
			direction,
			cursor,
			targetIndex,
			conceptSlug: concept.slug,
		});

		return {
			item: conceptToFeedItem(concept),
			cursor: targetIndex,
			hasNext,
			hasPrev,
		};
	},

	async getFeed(topicSlug: string, _username: string): Promise<FeedItem[]> {
		const startTime = Date.now();

		const sorted = await getSortedConcepts(topicSlug);
		if (!sorted) {
			log.api.debug("Feed requested for unknown/non-ready topic", {
				topicSlug,
			});
			return [];
		}

		log.api.info("Feed generated", {
			topicSlug,
			concepts: sorted.length,
			durationMs: Date.now() - startTime,
		});

		return sorted.map(conceptToFeedItem);
	},
};
