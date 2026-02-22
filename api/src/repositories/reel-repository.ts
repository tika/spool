import { and, eq } from "drizzle-orm";
import { db, reels, concepts, type Reel } from "../db";

export interface CreateReelInput {
	conceptId: string;
	name: string;
	description?: string;
	transcript?: string;
	videoUrl: string;
	audioUrl?: string;
	captions?: Array<{ word: string; startTime: number; endTime: number }>;
	thumbnailUrl?: string;
	durationSeconds?: number;
	source?: string;
	tone?: string;
	status?: string;
}

export class ReelRepository {
	async createReel(input: CreateReelInput): Promise<Reel> {
		const [reel] = await db
			.insert(reels)
			.values({
				conceptId: input.conceptId,
				name: input.name,
				description: input.description,
				transcript: input.transcript,
				videoUrl: input.videoUrl,
				audioUrl: input.audioUrl,
				captions: input.captions,
				thumbnailUrl: input.thumbnailUrl,
				durationSeconds: input.durationSeconds,
				source: input.source || "generated",
				tone: input.tone,
				status: input.status || "completed",
			})
			.returning();

		return reel;
	}

	async updateReelAudio(
		reelId: string,
		data: {
			audioUrl: string;
			transcript: string;
			captions: Array<{ word: string; startTime: number; endTime: number }>;
			durationSeconds: number;
			tone?: string;
		},
	): Promise<void> {
		await db
			.update(reels)
			.set({
				audioUrl: data.audioUrl,
				transcript: data.transcript,
				captions: data.captions,
				durationSeconds: data.durationSeconds,
				tone: data.tone,
			})
			.where(eq(reels.id, reelId));
	}

	async getReelByConceptId(conceptId: string): Promise<Reel | null> {
		const [reel] = await db
			.select()
			.from(reels)
			.where(eq(reels.conceptId, conceptId))
			.limit(1);

		return reel ?? null;
	}

	/** Returns a completed reel for the concept, if one exists. Used for idempotency. */
	async getCompletedReelByConceptId(conceptId: string): Promise<Reel | null> {
		const [reel] = await db
			.select()
			.from(reels)
			.where(
				and(
					eq(reels.conceptId, conceptId),
					eq(reels.status, "completed"),
				),
			)
			.limit(1);

		return reel ?? null;
	}

	async getReelsByConceptIds(
		conceptIds: string[]
	): Promise<Map<string, Reel>> {
		if (conceptIds.length === 0) return new Map();

		const rows = await db
			.select()
			.from(reels)
			.where(eq(reels.status, "completed"));

		const map = new Map<string, Reel>();
		for (const reel of rows) {
			if (conceptIds.includes(reel.conceptId)) {
				// Keep the first (or best quality) reel per concept
				if (!map.has(reel.conceptId)) {
					map.set(reel.conceptId, reel);
				}
			}
		}

		return map;
	}

	async updateReelStatus(reelId: string, status: string): Promise<void> {
		await db.update(reels).set({ status }).where(eq(reels.id, reelId));
	}

	async updateReel(
		reelId: string,
		data: Partial<NewReel>,
	): Promise<void> {
		await db.update(reels).set(data).where(eq(reels.id, reelId));
	}

	async upsertDraftReel(input: {
		conceptId: string;
		name: string;
		description?: string;
	}): Promise<Reel> {
		// Return existing draft/failed reel for this concept, or create a new one
		const existing = await this.getReelByConceptId(input.conceptId);
		if (existing && existing.status !== "completed") {
			return existing;
		}
		if (existing && existing.status === "completed") {
			// Already done — return it
			return existing;
		}
		const [reel] = await db
			.insert(reels)
			.values({
				conceptId: input.conceptId,
				name: input.name,
				description: input.description,
				status: "processing",
			})
			.returning();
		return reel;
	}

	async getConceptIdBySlug(slug: string): Promise<string | null> {
		const [concept] = await db
			.select({ id: concepts.id })
			.from(concepts)
			.where(eq(concepts.slug, slug))
			.limit(1);

		return concept?.id ?? null;
	}
}

export const reelRepository = new ReelRepository();
