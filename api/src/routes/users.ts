import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { helix } from "../lib/helix";

const CreateUserSchema = z.object({
	username: z.string().min(1).max(50),
});

export const usersRoutes = new Hono()
	.post("/", zValidator("json", CreateUserSchema), async (c) => {
		const { username } = c.req.valid("json");
		const result = await helix.query("CreateUser", { username });
		const user = result.user?.[0] ?? result.user;
		return c.json(user, 201);
	})
	.get("/:id", async (c) => {
		const id = c.req.param("id");
		const result = await helix.query("GetUser", { user_id: id });
		console.log(result);
		const user = result.user?.[0];
		if (!user) return c.json({ error: "Not found" }, 404);
		return c.json(user);
	});
