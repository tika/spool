import type { ConceptInfo } from "../agents/curriculum-agent";
import { helix } from "../lib/helix";
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

// In-memory status tracking until Topic node gains a status field in Helix
const topicStatuses = new Map<string, TopicStatus>();

export class TopicRepository implements TopicRepositoryForWorker {
	async createTopic(data: {
		slug: string;
		name: string;
		description?: string;
		status: TopicStatus;
	}): Promise<void> {
		await helix.query("CreateTopic", {
			slug: data.slug,
			name: data.name,
			description: data.description ?? "",
		});
		topicStatuses.set(data.slug, data.status);
	}

	async getTopicBySlug(slug: string): Promise<Topic | null> {
		const result = await helix.query("GetTopicBySlug", { slug });
		const nodes = result.topic;
		if (!Array.isArray(nodes) || nodes.length === 0) return null;
		const t = nodes[0];

		// Get concept count
		let conceptCount: number | undefined;
		try {
			const graphResult = await helix.query("GetConceptsByTopic", {
				topic_id: t.id,
			});
			conceptCount = Array.isArray(graphResult.concepts)
				? graphResult.concepts.length
				: undefined;
		} catch {
			// topic may not have concepts yet
		}

		return {
			slug: t.slug,
			name: t.name,
			description: t.description ?? "",
			status: topicStatuses.get(slug) ?? "ready",
			conceptCount,
			createdAt: t.created_at ? new Date(t.created_at) : new Date(),
		};
	}

	async updateTopicStatus(slug: string, status: TopicStatus): Promise<void> {
		topicStatuses.set(slug, status);
	}

	async saveConcepts(
		topicSlug: string,
		concepts: ConceptInfo[],
	): Promise<void> {
		// 1. Look up the topic
		const topicResult = await helix.query("GetTopicBySlug", {
			slug: topicSlug,
		});
		const topicNode = topicResult.topic?.[0];
		if (!topicNode) throw new Error(`Topic not found: ${topicSlug}`);
		const topicId = topicNode.id;

		// 2. Create all concept nodes and collect their IDs
		const slugToId = new Map<string, string>();

		for (const concept of concepts) {
			const result = await helix.query("CreateConcept", {
				slug: concept.slug,
				name: concept.name,
				description: concept.description,
				difficulty: concept.difficulty,
				order_hint: concept.order_hint,
			});
			const created = result.concept?.[0] ?? result.concept;
			const conceptId = created.id;
			slugToId.set(concept.slug, conceptId);

			// 3. Link Topic -> HasConcept -> Concept
			await helix.query("AddHasConcept", {
				topic_id: topicId,
				concept_id: conceptId,
			});
		}

		// 4. Create Requires edges (prerequisite DAG)
		for (const concept of concepts) {
			const conceptId = slugToId.get(concept.slug);
			if (!conceptId) continue;

			for (const reqSlug of concept.requires) {
				let prereqId = slugToId.get(reqSlug);
				// Prerequisite might be from a previous batch
				if (!prereqId) {
					try {
						const existing = await helix.query("GetConceptBySlug", {
							slug: reqSlug,
						});
						prereqId = existing.concept?.[0]?.id;
					} catch {
						// skip missing prerequisites
					}
				}
				if (prereqId) {
					await helix.query("AddRequires", {
						concept_id: conceptId,
						prerequisite_concept_id: prereqId,
					});
				}
			}
		}
	}

	async getConceptsByTopic(
		topicSlug: string,
	): Promise<Array<{ slug: string; name: string; description: string }>> {
		const topicResult = await helix.query("GetTopicBySlug", {
			slug: topicSlug,
		});
		const topicNode = topicResult.topic?.[0];
		if (!topicNode) return [];

		const graphResult = await helix.query("GetConceptsByTopic", {
			topic_id: topicNode.id,
		});
		const concepts = graphResult.concepts;
		if (!Array.isArray(concepts)) return [];

		return concepts.map((c: { slug: string; name: string; description: string }) => ({
			slug: c.slug,
			name: c.name,
			description: c.description ?? "",
		}));
	}
}

export const topicRepository = new TopicRepository();
