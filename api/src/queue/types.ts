export type JobType = "generate_curriculum" | "generate_videos";

export interface ConceptToGenerate {
	id: string;
	slug: string;
	name: string;
	description: string;
}

export type Job =
	| { type: "generate_curriculum"; topicSlug: string; topicName: string }
	| { type: "generate_videos"; topicSlug: string; concepts: ConceptToGenerate[] };
