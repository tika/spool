import { slugify } from "../lib/slugify";
import type { Topic, TopicStatus } from "../repositories/topic-repository";
import { topicRepository } from "../repositories/topic-repository";
import { enqueue } from "../queue";

export interface CreateTopicResult {
	slug: string;
	status: TopicStatus;
}

export const topicService = {
	async createTopic(title: string): Promise<CreateTopicResult> {
		const slug = slugify(title) || "topic";
		await topicRepository.createTopic({
			slug,
			name: title,
			status: "generating",
		});
		enqueue({ type: "generate_curriculum", topicSlug: slug, topicName: title });
		return { slug, status: "generating" };
	},

	async getTopicBySlug(slug: string): Promise<Topic | null> {
		return topicRepository.getTopicBySlug(slug);
	},
};
