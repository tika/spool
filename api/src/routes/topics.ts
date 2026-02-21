import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { CreateTopicSchema } from "../schemas/topic";
import { topicService } from "../services/topic-service";

export const topicsRoutes = new Hono()
	.post("/", zValidator("json", CreateTopicSchema), async (c) => {
		const { title } = c.req.valid("json");
		const result = await topicService.createTopic(title);
		return c.json(result, 202);
	})
	.get("/:slug", async (c) => {
		const topic = await topicService.getTopicBySlug(c.req.param("slug"));
		if (!topic) return c.json({ error: "Not found" }, 404);
		return c.json({
			slug: topic.slug,
			name: topic.name,
			status: topic.status,
			conceptCount: topic.conceptCount,
			createdAt: topic.createdAt,
		});
	});
