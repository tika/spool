import { Hono } from "hono";
import { feedService } from "../services/feed-service";

export const feedRoutes = new Hono().get("/:topicSlug/:username", async (c) => {
	const { topicSlug, username } = c.req.param();
	const items = await feedService.getFeed(topicSlug, username);
	return c.json(items);
});
