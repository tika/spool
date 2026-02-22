import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { handleZodError } from "../lib/validation";
import { feedRepository } from "../repositories/feed-repository";
import { topicRepository } from "../repositories/topic-repository";

const SlugParamSchema = z.object({
	slug: z.string().min(1, "Slug is required").max(255),
});

const QuizIdParamSchema = SlugParamSchema.extend({
	quizId: z.string().uuid("Invalid quiz ID"),
});

export const quizzesRoutes = new Hono()
	.get(
		"/:slug/quizzes",
		zValidator("param", SlugParamSchema, handleZodError),
		async (c) => {
			const { slug } = c.req.valid("param");
			const topic = await topicRepository.getTopicBySlug(slug);
			if (!topic || topic.status !== "ready") {
				return c.json(
					{ error: { code: "NOT_FOUND", message: "Topic not found" } },
					404,
				);
			}

			const quizzes = await feedRepository.getQuizzesByTopic(slug);
			return c.json({
				quizzes: quizzes.map((q) => ({
					id: q.id,
					question: q.question,
					answerChoices: q.answerChoices,
					correctAnswer: q.correctAnswer,
				})),
			});
		},
	)
	.get(
		"/:slug/quizzes/:quizId",
		zValidator("param", QuizIdParamSchema, handleZodError),
		async (c) => {
			const { slug, quizId } = c.req.valid("param");
			const topic = await topicRepository.getTopicBySlug(slug);
			if (!topic || topic.status !== "ready") {
				return c.json(
					{ error: { code: "NOT_FOUND", message: "Topic not found" } },
					404,
				);
			}

			const quiz = await feedRepository.getQuizById(slug, quizId);
			if (!quiz) {
				return c.json(
					{ error: { code: "NOT_FOUND", message: "Quiz not found" } },
					404,
				);
			}

			return c.json({
				id: quiz.id,
				question: quiz.question,
				answerChoices: quiz.answerChoices,
				correctAnswer: quiz.correctAnswer,
			});
		},
	);
