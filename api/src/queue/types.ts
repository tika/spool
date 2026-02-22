export type JobType = "generate_curriculum" | "generate_videos" | "generate_audio_reels" | "expand_curriculum";

export interface ConceptToGenerate {
	id: string;
	slug: string;
	name: string;
	description: string;
}

export type Job =
	| { type: "generate_curriculum"; topicSlug: string; topicName: string }
	| { type: "generate_videos"; topicSlug: string; concepts: ConceptToGenerate[] }
	| { type: "generate_audio_reels"; topicSlug: string; concepts: ConceptToGenerate[] }
	| { type: "expand_curriculum"; topicSlug: string; topicName: string };
