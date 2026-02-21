import { z } from "zod";
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
	const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
	return JSON.parse(stripped) as unknown;
}

export async function generateCurriculum(topic: string): Promise<CurriculumResult> {
	const client = createOpenRouterClient("CA");

	const result = await client.callModel({
		model: CURRICULUM_MODEL,
		instructions: CURRICULUM_SYSTEM_PROMPT,
		input: CURRICULUM_GENERATE_PROMPT(topic),
		text: {
			format: { type: "json_object" },
		},
	});

	const text = await result.getText();
	const parsed = parseJsonResponse(text);
	return CurriculumOutputSchema.parse(parsed);
}

export async function continueCurriculum(
	topic: string,
	existingConcepts: Array<{ slug: string; name: string; description: string }>
): Promise<CurriculumResult> {
	const client = createOpenRouterClient("CA");

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
	return CurriculumOutputSchema.parse(parsed);
}
