import type { ConceptInfo } from "../agents/curriculum-agent";
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

const topics = new Map<string, Topic>();

export class TopicRepository implements TopicRepositoryForWorker {
	async createTopic(data: {
		slug: string;
		name: string;
		description?: string;
		status: TopicStatus;
	}): Promise<void> {
		topics.set(data.slug, {
			slug: data.slug,
			name: data.name,
			description: data.description ?? "",
			status: data.status,
			createdAt: new Date(),
		});
	}

	async getTopicBySlug(slug: string): Promise<Topic | null> {
		return topics.get(slug) ?? null;
	}

	async updateTopicStatus(slug: string, status: TopicStatus): Promise<void> {
		const topic = topics.get(slug);
		if (topic) {
			topic.status = status;
		}
	}

	async saveConcepts(
		topicSlug: string,
		concepts: ConceptInfo[],
	): Promise<void> {
		const topic = topics.get(topicSlug);
		if (topic) {
			topic.conceptCount = concepts.length;
		}
		// TODO: persist to HelixDB when client is implemented
	}
}

export const topicRepository = new TopicRepository();
