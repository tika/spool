import { z } from "zod";

export const QuizResponseSchema = z.object({
	id: z.string().uuid(),
	question: z.string(),
	answerChoices: z.array(z.string()),
	correctAnswer: z.string(),
});

export type QuizResponse = z.infer<typeof QuizResponseSchema>;
