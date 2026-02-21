import { z } from "zod";
import type { ConceptInfo } from "./curriculum-agent";
import { createOpenRouterClient } from "../lib/openrouter";
import {
	VIDEO_SCRIPT_SYSTEM_PROMPT,
	VIDEO_SCRIPT_USER_PROMPT,
} from "../lib/prompts";

// const VIDEO_SCRIPT_MODEL = "google/gemini-2.5-flash";
const VIDEO_SCRIPT_MODEL = "openai/gpt-oss-120b";

const ScriptOutputSchema = z.object({
	transcript: z.string(),
	point: z.string(),
	tone: z.string(),
	voice_type: z.string(),
	background: z.string(),
	quality_score: z.number().min(0).max(100),
});

export type ScriptResult = z.infer<typeof ScriptOutputSchema>;

function parseJsonResponse(text: string): unknown {
	const stripped = text
		.replace(/^```(?:json)?\s*/i, "")
		.replace(/\s*```$/i, "")
		.trim();
	return JSON.parse(stripped) as unknown;
}

export async function generateScript(
	concept: ConceptInfo,
	options?: { angle?: string },
): Promise<ScriptResult> {
	const client = createOpenRouterClient("CDA");

	const result = await client.callModel({
		model: VIDEO_SCRIPT_MODEL,
		instructions: VIDEO_SCRIPT_SYSTEM_PROMPT,
		input: VIDEO_SCRIPT_USER_PROMPT(
			concept.name,
			concept.description,
			options?.angle,
		),
		text: {
			format: { type: "json_object" },
		},
	});

	const text = await result.getText();
	const parsed = parseJsonResponse(text);
	return ScriptOutputSchema.parse(parsed);
}
