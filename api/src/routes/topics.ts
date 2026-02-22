import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { handleZodError } from "../lib/validation";
import { CreateTopicSchema } from "../schemas/topic";
import { topicService } from "../services/topic-service";

const SlugParamSchema = z.object({
	slug: z.string().min(1, "Slug is required").max(255),
});

export const topicsRoutes = new Hono()
	.get("/", async (c) => {
		const topics = await topicService.listTopics();
		return c.json({
			topics: topics.map((t) => ({
				slug: t.slug,
				name: t.name,
				status: t.status,
				conceptCount: t.conceptCount,
				createdAt: t.createdAt.toISOString(),
			})),
		});
	})
	.post(
		"/",
		zValidator("json", CreateTopicSchema, handleZodError),
		async (c) => {
			const { title } = c.req.valid("json");
			const result = await topicService.createTopic(title);
			return c.json(result, 202);
		},
	)
	.get(
		"/:slug",
		zValidator("param", SlugParamSchema, handleZodError),
		async (c) => {
			const { slug } = c.req.valid("param");
			const topic = await topicService.getTopicBySlug(slug);
			if (!topic)
				return c.json(
					{ error: { code: "NOT_FOUND", message: "Topic not found" } },
					404,
				);
			return c.json({
				slug: topic.slug,
				name: topic.name,
				status: topic.status,
				conceptCount: topic.conceptCount,
				createdAt: topic.createdAt,
			});
		},
	);
