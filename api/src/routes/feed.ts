import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { feedService } from "../services/feed-service";

const FeedParamsSchema = z.object({
	topicSlug: z.string().min(1, "Topic slug is required").max(255),
	username: z.string().min(1, "Username is required").max(50),
});

export const feedRoutes = new Hono().get(
	"/:topicSlug/:username",
	zValidator("param", FeedParamsSchema),
	async (c) => {
		const { topicSlug, username } = c.req.valid("param");
		const items = await feedService.getFeed(topicSlug, username);
		return c.json(items);
	}
);
