import { and, eq, inArray } from "drizzle-orm";
import {
	db,
	concepts,
	conceptPrerequisites,
	topics,
	reels,
	quizzes,
	quizConcepts,
} from "../db";

export interface ConceptWithPrereqs {
	id: string;
	slug: string;
	name: string;
	description: string;
	difficulty: number;
	orderIndex: number;
	prerequisiteIds: string[];
	videoUrl: string | null;
	audioUrl: string | null;
	transcript: string | null;
	captions: Array<{ word: string; startTime: number; endTime: number }> | null;
	durationSeconds: number | null;
}

export interface QuizWithConcepts {
	id: string;
	question: string;
	answerChoices: string[];
	correctAnswer: string;
	conceptIds: string[];
}

export class FeedRepository {
	async getConceptsWithPrerequisites(
		topicSlug: string
	): Promise<ConceptWithPrereqs[]> {
		// Get topic
		const [topic] = await db
			.select({ id: topics.id })
			.from(topics)
			.where(eq(topics.slug, topicSlug))
			.limit(1);

		if (!topic) return [];

		// Get all concepts for the topic
		const conceptRows = await db
			.select({
				id: concepts.id,
				slug: concepts.slug,
				name: concepts.name,
				description: concepts.description,
				difficulty: concepts.difficulty,
				orderIndex: concepts.orderIndex,
			})
			.from(concepts)
			.where(eq(concepts.topicId, topic.id));

		if (conceptRows.length === 0) return [];

		const conceptIds = conceptRows.map((c) => c.id);

		// Get all prerequisite relationships for these concepts
		const prereqRows = await db
			.select({
				conceptId: conceptPrerequisites.conceptId,
				prerequisiteId: conceptPrerequisites.prerequisiteId,
			})
			.from(conceptPrerequisites);

		// Filter to only prerequisites within this topic's concepts
		const conceptIdSet = new Set(conceptIds);
		const prereqMap = new Map<string, string[]>();

		for (const row of prereqRows) {
			if (
				conceptIdSet.has(row.conceptId) &&
				conceptIdSet.has(row.prerequisiteId)
			) {
				const existing = prereqMap.get(row.conceptId) || [];
				existing.push(row.prerequisiteId);
				prereqMap.set(row.conceptId, existing);
			}
		}

		// Get reels for these concepts (completed ones only)
		const reelRows = await db
			.select({
				conceptId: reels.conceptId,
				videoUrl: reels.videoUrl,
				audioUrl: reels.audioUrl,
				transcript: reels.transcript,
				captions: reels.captions,
				durationSeconds: reels.durationSeconds,
			})
			.from(reels)
			.where(eq(reels.status, "completed"));

		// Map concept ID to reel data
		const reelMap = new Map<string, (typeof reelRows)[number]>();
		for (const reel of reelRows) {
			if (conceptIdSet.has(reel.conceptId)) {
				if (!reelMap.has(reel.conceptId)) {
					reelMap.set(reel.conceptId, reel);
				}
			}
		}

		return conceptRows.map((c) => {
			const reel = reelMap.get(c.id);
			return {
				id: c.id,
				slug: c.slug,
				name: c.name,
				description: c.description ?? "",
				difficulty: c.difficulty,
				orderIndex: c.orderIndex,
				prerequisiteIds: prereqMap.get(c.id) || [],
				videoUrl: reel?.videoUrl ?? null,
				audioUrl: reel?.audioUrl ?? null,
				transcript: reel?.transcript ?? null,
				captions: (reel?.captions as ConceptWithPrereqs["captions"]) ?? null,
				durationSeconds: reel?.durationSeconds ?? null,
			};
		});
	}

	async getQuizzesByTopic(topicSlug: string): Promise<QuizWithConcepts[]> {
		const [topic] = await db
			.select({ id: topics.id })
			.from(topics)
			.where(eq(topics.slug, topicSlug))
			.limit(1);

		if (!topic) return [];

		const quizRows = await db
			.select({
				id: quizzes.id,
				question: quizzes.question,
				answerChoices: quizzes.answerChoices,
				correctAnswer: quizzes.correctAnswer,
			})
			.from(quizzes)
			.where(eq(quizzes.topicId, topic.id))
			.orderBy(quizzes.orderIndex);

		if (quizRows.length === 0) return [];

		const quizIds = quizRows.map((q) => q.id);
		const qcAllRows = await db
			.select({
				quizId: quizConcepts.quizId,
				conceptId: quizConcepts.conceptId,
			})
			.from(quizConcepts)
			.where(inArray(quizConcepts.quizId, quizIds));

		const quizIdSet = new Set(quizIds);
		const conceptMap = new Map<string, string[]>();
		for (const row of qcAllRows) {
			if (quizIdSet.has(row.quizId)) {
				const existing = conceptMap.get(row.quizId) || [];
				existing.push(row.conceptId);
				conceptMap.set(row.quizId, existing);
			}
		}

		return quizRows.map((q) => ({
			id: q.id,
			question: q.question,
			answerChoices: (q.answerChoices ?? []) as string[],
			correctAnswer: q.correctAnswer,
			conceptIds: conceptMap.get(q.id) || [],
		}));
	}

	async getQuizById(
		topicSlug: string,
		quizId: string,
	): Promise<QuizWithConcepts | null> {
		const [topic] = await db
			.select({ id: topics.id })
			.from(topics)
			.where(eq(topics.slug, topicSlug))
			.limit(1);

		if (!topic) return null;

		const [quiz] = await db
			.select({
				id: quizzes.id,
				question: quizzes.question,
				answerChoices: quizzes.answerChoices,
				correctAnswer: quizzes.correctAnswer,
			})
			.from(quizzes)
			.where(
				and(
					eq(quizzes.topicId, topic.id),
					eq(quizzes.id, quizId),
				),
			)
			.limit(1);

		if (!quiz) return null;

		const qcRows = await db
			.select({ conceptId: quizConcepts.conceptId })
			.from(quizConcepts)
			.where(eq(quizConcepts.quizId, quiz.id));

		return {
			id: quiz.id,
			question: quiz.question,
			answerChoices: (quiz.answerChoices ?? []) as string[],
			correctAnswer: quiz.correctAnswer,
			conceptIds: qcRows.map((r) => r.conceptId),
		};
	}
}

export const feedRepository = new FeedRepository();
