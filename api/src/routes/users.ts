import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { handleZodError } from "../lib/validation";
import { userRepository } from "../repositories/user-repository";

const CreateUserSchema = z.object({
	username: z.string().min(1).max(50),
});

const UserIdParamSchema = z.object({
	id: z.uuid("Invalid user ID format"),
});

export const usersRoutes = new Hono()
	.post(
		"/",
		zValidator("json", CreateUserSchema, handleZodError),
		async (c) => {
			const { username } = c.req.valid("json");
			const user = await userRepository.createUser(username);
			return c.json(user, 201);
		},
	)
	.get(
		"/:id",
		zValidator("param", UserIdParamSchema, handleZodError),
		async (c) => {
			const { id } = c.req.valid("param");
			const user = await userRepository.getUserById(id);
			if (!user)
				return c.json(
					{ error: { code: "NOT_FOUND", message: "User not found" } },
					404,
				);
			return c.json(user);
		},
	);
