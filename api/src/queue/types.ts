export type JobType = "generate_curriculum" | "generate_videos";

export type Job =
	| { type: "generate_curriculum"; topicSlug: string; topicName: string }
	| { type: "generate_videos"; topicSlug: string; conceptSlugs: string[] };
