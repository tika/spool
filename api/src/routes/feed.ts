import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { handleZodError } from "../lib/validation";
import { feedService } from "../services/feed-service";

const FeedParamsSchema = z.object({
	topicSlug: z.string().min(1, "Topic slug is required").max(255),
	username: z.string().min(1, "Username is required").max(50),
});

const CursorQuerySchema = z.object({
	cursor: z.coerce.number().int().min(0).optional(),
});

export const feedRoutes = new Hono()
	// Get next item in feed
	.get(
		"/:topicSlug/:username/next",
		zValidator("param", FeedParamsSchema, handleZodError),
		zValidator("query", CursorQuerySchema, handleZodError),
		async (c) => {
			const { topicSlug, username } = c.req.valid("param");
			const { cursor } = c.req.valid("query");

			const result = await feedService.getItem(
				topicSlug,
				username,
				cursor ?? 0,
				"next",
			);

			if (!result) {
				return c.json({
					item: null,
					cursor: null,
					hasNext: false,
					hasPrev: false,
				});
			}

			return c.json(result);
		},
	)
	// Get previous item in feed
	.get(
		"/:topicSlug/:username/prev",
		zValidator("param", FeedParamsSchema, handleZodError),
		zValidator("query", CursorQuerySchema, handleZodError),
		async (c) => {
			const { topicSlug, username } = c.req.valid("param");
			const { cursor } = c.req.valid("query");

			const result = await feedService.getItem(
				topicSlug,
				username,
				cursor ?? 0,
				"prev",
			);

			if (!result) {
				return c.json({
					item: null,
					cursor: null,
					hasNext: false,
					hasPrev: false,
				});
			}

			return c.json(result);
		},
	)
	// Get full feed (for debugging/preview)
	.get(
		"/:topicSlug/:username",
		zValidator("param", FeedParamsSchema, handleZodError),
		async (c) => {
			const { topicSlug, username } = c.req.valid("param");
			const items = await feedService.getFeed(topicSlug, username);
			return c.json({ items, total: items.length });
		},
	);
