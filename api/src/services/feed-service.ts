import { topicRepository } from "../repositories/topic-repository";

export interface FeedItem {
	videoUrl: string;
	conceptSlug: string;
	conceptName: string;
}

export const feedService = {
	async getFeed(topicSlug: string, _username: string): Promise<FeedItem[]> {
		const topic = await topicRepository.getTopicBySlug(topicSlug);
		if (!topic || topic.status !== "ready") {
			return [];
		}
		// TODO: topological sort DAG, filter watched, pick primary reels
		// Stub for now - returns empty until HelixDB + reels are wired
		return [];
	},
};
