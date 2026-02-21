import { eq } from "drizzle-orm";
import { db, concepts, conceptPrerequisites, topics } from "../db";

export interface ConceptWithPrereqs {
	id: string;
	slug: string;
	name: string;
	description: string;
	difficulty: number;
	orderIndex: number;
	prerequisiteIds: string[];
}

export class FeedRepository {
	async getConceptsWithPrerequisites(
		topicSlug: string
	): Promise<ConceptWithPrereqs[]> {
		// Get topic
		const [topic] = await db
			.select({ id: topics.id })
			.from(topics)
			.where(eq(topics.slug, topicSlug))
			.limit(1);

		if (!topic) return [];

		// Get all concepts for the topic
		const conceptRows = await db
			.select({
				id: concepts.id,
				slug: concepts.slug,
				name: concepts.name,
				description: concepts.description,
				difficulty: concepts.difficulty,
				orderIndex: concepts.orderIndex,
			})
			.from(concepts)
			.where(eq(concepts.topicId, topic.id));

		if (conceptRows.length === 0) return [];

		// Get all prerequisite relationships for these concepts
		const conceptIds = conceptRows.map((c) => c.id);
		const prereqRows = await db
			.select({
				conceptId: conceptPrerequisites.conceptId,
				prerequisiteId: conceptPrerequisites.prerequisiteId,
			})
			.from(conceptPrerequisites);

		// Filter to only prerequisites within this topic's concepts
		const conceptIdSet = new Set(conceptIds);
		const prereqMap = new Map<string, string[]>();

		for (const row of prereqRows) {
			if (conceptIdSet.has(row.conceptId) && conceptIdSet.has(row.prerequisiteId)) {
				const existing = prereqMap.get(row.conceptId) || [];
				existing.push(row.prerequisiteId);
				prereqMap.set(row.conceptId, existing);
			}
		}

		return conceptRows.map((c) => ({
			id: c.id,
			slug: c.slug,
			name: c.name,
			description: c.description ?? "",
			difficulty: c.difficulty,
			orderIndex: c.orderIndex,
			prerequisiteIds: prereqMap.get(c.id) || [],
		}));
	}
}

export const feedRepository = new FeedRepository();
