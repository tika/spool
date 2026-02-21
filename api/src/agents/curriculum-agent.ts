import { z } from "zod";
import { ExternalServiceError } from "../lib/errors";
import { log } from "../lib/logger";
import { createOpenRouterClient } from "../lib/openrouter";
import {
	CURRICULUM_CONTINUE_PROMPT,
	CURRICULUM_GENERATE_PROMPT,
	CURRICULUM_SYSTEM_PROMPT,
} from "../lib/prompts";

const CURRICULUM_MODEL = "google/gemini-2.5-pro";

const ConceptSchema = z.object({
	slug: z.string(),
	name: z.string(),
	description: z.string(),
	difficulty: z.number().min(1).max(10),
	order_hint: z.number(),
	requires: z.array(z.string()),
});

const CurriculumOutputSchema = z.object({
	concepts: z.array(ConceptSchema),
});

export type ConceptInfo = z.infer<typeof ConceptSchema>;

export type CurriculumResult = {
	concepts: ConceptInfo[];
};

function parseJsonResponse(text: string): unknown {
	// Strip markdown code blocks if present
	const stripped = text
		.replace(/^```(?:json)?\s*/i, "")
		.replace(/\s*```$/i, "")
		.trim();
	return JSON.parse(stripped) as unknown;
}

export async function generateCurriculum(
	topic: string
): Promise<CurriculumResult> {
	const startTime = Date.now();
	log.curriculum.info("Generating curriculum", { topic, model: CURRICULUM_MODEL });

	const client = createOpenRouterClient("CA");

	try {
		const result = await client.callModel({
			model: CURRICULUM_MODEL,
			instructions: CURRICULUM_SYSTEM_PROMPT,
			input: CURRICULUM_GENERATE_PROMPT(topic),
			text: {
				format: { type: "json_object" },
			},
		});

		const text = await result.getText();
		log.curriculum.debug("LLM response received", {
			topic,
			responseLength: text.length,
			durationMs: Date.now() - startTime,
		});

		const parsed = parseJsonResponse(text);
		const validated = CurriculumOutputSchema.parse(parsed);

		log.curriculum.info("Curriculum generated successfully", {
			topic,
			concepts: validated.concepts.length,
			durationMs: Date.now() - startTime,
		});

		return validated;
	} catch (error) {
		log.curriculum.error("Curriculum generation failed", {
			topic,
			error: error instanceof Error ? error.message : String(error),
			durationMs: Date.now() - startTime,
		});

		if (error instanceof z.ZodError) {
			throw new ExternalServiceError(
				"OpenRouter",
				"Invalid curriculum response from LLM",
				{ issues: error.issues }
			);
		}

		throw error;
	}
}

export async function continueCurriculum(
	topic: string,
	existingConcepts: Array<{ slug: string; name: string; description: string }>
): Promise<CurriculumResult> {
	const startTime = Date.now();
	log.curriculum.info("Continuing curriculum", {
		topic,
		existingCount: existingConcepts.length,
		model: CURRICULUM_MODEL,
	});

	const client = createOpenRouterClient("CA");

	try {
		const result = await client.callModel({
			model: CURRICULUM_MODEL,
			instructions: CURRICULUM_SYSTEM_PROMPT,
			input: CURRICULUM_CONTINUE_PROMPT(topic, existingConcepts),
			text: {
				format: { type: "json_object" },
			},
		});

		const text = await result.getText();
		const parsed = parseJsonResponse(text);
		const validated = CurriculumOutputSchema.parse(parsed);

		log.curriculum.info("Curriculum continuation complete", {
			topic,
			newConcepts: validated.concepts.length,
			durationMs: Date.now() - startTime,
		});

		return validated;
	} catch (error) {
		log.curriculum.error("Curriculum continuation failed", {
			topic,
			error: error instanceof Error ? error.message : String(error),
			durationMs: Date.now() - startTime,
		});
		throw error;
	}
}
