import { z } from "zod";

export const CreateTopicSchema = z.object({
	title: z.string().min(1).max(100),
});

export const TopicResponseSchema = z.object({
	slug: z.string(),
	name: z.string(),
	status: z.enum(["generating", "ready", "failed"]),
	conceptCount: z.number().optional(),
	createdAt: z.coerce.date(),
});

export type CreateTopicInput = z.infer<typeof CreateTopicSchema>;
export type TopicResponse = z.infer<typeof TopicResponseSchema>;
