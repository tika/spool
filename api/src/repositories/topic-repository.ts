import { count, eq } from "drizzle-orm";
import type { ConceptInfo } from "../agents/curriculum-agent";
import { db, topics, concepts, conceptPrerequisites } from "../db";
import type { TopicRepositoryForWorker } from "../queue";

export type TopicStatus = "generating" | "ready" | "failed";

export interface Topic {
	slug: string;
	name: string;
	description: string;
	status: TopicStatus;
	conceptCount?: number;
	createdAt: Date;
}

export class TopicRepository implements TopicRepositoryForWorker {
	async createTopic(data: {
		slug: string;
		name: string;
		description?: string;
		status: TopicStatus;
	}): Promise<void> {
		await db.insert(topics).values({
			slug: data.slug,
			name: data.name,
			description: data.description ?? "",
			status: data.status,
		});
	}

	async getTopicBySlug(slug: string): Promise<Topic | null> {
		const [topic] = await db
			.select()
			.from(topics)
			.where(eq(topics.slug, slug))
			.limit(1);

		if (!topic) return null;

		const [countResult] = await db
			.select({ count: count() })
			.from(concepts)
			.where(eq(concepts.topicId, topic.id));

		return {
			slug: topic.slug,
			name: topic.name,
			description: topic.description ?? "",
			status: topic.status as TopicStatus,
			conceptCount: countResult?.count ?? 0,
			createdAt: topic.createdAt,
		};
	}

	async updateTopicStatus(slug: string, status: string): Promise<void> {
		await db.update(topics).set({ status }).where(eq(topics.slug, slug));
	}

	async saveConcepts(
		topicSlug: string,
		conceptInfos: ConceptInfo[],
	): Promise<void> {
		// 1. Look up the topic
		const [topic] = await db
			.select({ id: topics.id })
			.from(topics)
			.where(eq(topics.slug, topicSlug))
			.limit(1);

		if (!topic) throw new Error(`Topic not found: ${topicSlug}`);

		// 2. Insert all concepts and collect their IDs
		const slugToId = new Map<string, string>();

		for (const concept of conceptInfos) {
			const [created] = await db
				.insert(concepts)
				.values({
					topicId: topic.id,
					slug: concept.slug,
					name: concept.name,
					description: concept.description,
					difficulty: concept.difficulty,
					orderIndex: concept.order_hint,
				})
				.returning({ id: concepts.id });

			slugToId.set(concept.slug, created.id);
		}

		// 3. Create prerequisite relationships
		for (const concept of conceptInfos) {
			const conceptId = slugToId.get(concept.slug);
			if (!conceptId) continue;

			for (const reqSlug of concept.requires) {
				let prereqId = slugToId.get(reqSlug);

				// Prerequisite might be from a previous batch (already in DB)
				if (!prereqId) {
					const [existing] = await db
						.select({ id: concepts.id })
						.from(concepts)
						.where(eq(concepts.slug, reqSlug))
						.limit(1);
					prereqId = existing?.id;
				}

				if (prereqId) {
					await db
						.insert(conceptPrerequisites)
						.values({
							conceptId,
							prerequisiteId: prereqId,
						})
						.onConflictDoNothing();
				}
			}
		}
	}

	async getConceptsByTopic(
		topicSlug: string,
	): Promise<Array<{ id: string; slug: string; name: string; description: string }>> {
		const result = await db
			.select({
				id: concepts.id,
				slug: concepts.slug,
				name: concepts.name,
				description: concepts.description,
			})
			.from(concepts)
			.innerJoin(topics, eq(concepts.topicId, topics.id))
			.where(eq(topics.slug, topicSlug))
			.orderBy(concepts.orderIndex);

		return result.map((c) => ({
			id: c.id,
			slug: c.slug,
			name: c.name,
			description: c.description ?? "",
		}));
	}
}

export const topicRepository = new TopicRepository();
