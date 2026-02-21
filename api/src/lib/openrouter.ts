import { OpenRouter } from "@openrouter/sdk";

export type AgentKey = "CA" | "CDA";

const API_KEYS: Record<AgentKey, string | undefined> = {
	CA: process.env.OPENROUTER_API_KEY_CA,
	CDA: process.env.OPENROUTER_API_KEY_CDA,
};

/**
 * Creates an OpenRouter client for the given agent.
 * Uses OPENROUTER_API_KEY_CA for Curriculum Agent, OPENROUTER_API_KEY_CDA for Content Delivery Agent.
 */
export function createOpenRouterClient(
	agent: AgentKey,
	apiKeyOverride?: string,
): OpenRouter {
	const apiKey = apiKeyOverride ?? API_KEYS[agent];
	if (!apiKey) {
		throw new Error(
			`Missing OpenRouter API key for agent ${agent}. Set OPENROUTER_API_KEY_${agent} in .env`,
		);
	}
	return new OpenRouter({ apiKey });
}
