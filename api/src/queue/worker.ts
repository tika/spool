import type { ConceptInfo } from "../agents/curriculum-agent";
import { generateCurriculum } from "../agents/curriculum-agent";
import { formatError, JobError } from "../lib/errors";
import { log } from "../lib/logger";
import { createJob, generateVideo } from "../services/video-service";
import { dequeue, enqueue } from "./queue";
import type { Job, ConceptToGenerate } from "./types";

const INITIAL_VIDEO_BATCH_SIZE = 5;

export interface TopicRepositoryForWorker {
	saveConcepts(
		topicSlug: string,
		concepts: ConceptInfo[],
	): Promise<Map<string, string>>;
	saveQuizzes(
		topicSlug: string,
		quizzes: Array<{
			question: string;
			answer_choices: string[];
			correct_answer: string;
			concept_slugs: string[];
		}>,
		slugToConceptId: Map<string, string>,
	): Promise<void>;
	updateTopicStatus(slug: string, status: string): Promise<void>;
	getConceptsByTopic(
		topicSlug: string
	): Promise<Array<{ id: string; slug: string; name: string; description: string }>>;
}

export interface WorkerDeps {
	topicRepository: TopicRepositoryForWorker;
}

async function processCurriculumJob(
	job: Extract<Job, { type: "generate_curriculum" }>,
	deps: WorkerDeps
): Promise<void> {
	const jobLog = log.worker.child("curriculum");

	jobLog.info("Starting curriculum generation", { topic: job.topicSlug });
	const startTime = Date.now();

	try {
		jobLog.debug("Calling LLM for curriculum", { topicName: job.topicName });
		const result = await generateCurriculum(job.topicName);

		jobLog.info("Curriculum generated", {
			topic: job.topicSlug,
			concepts: result.concepts.length,
			durationMs: Date.now() - startTime,
		});

		jobLog.debug("Saving concepts to database", {
			count: result.concepts.length,
		});
		const slugToId = await deps.topicRepository.saveConcepts(
			job.topicSlug,
			result.concepts,
		);

		if (result.quizzes?.length) {
			jobLog.debug("Saving quizzes to database", {
				count: result.quizzes.length,
			});
			await deps.topicRepository.saveQuizzes(
				job.topicSlug,
				result.quizzes,
				slugToId,
			);
		}

		await deps.topicRepository.updateTopicStatus(job.topicSlug, "ready");
		jobLog.info("Curriculum job completed", {
			topic: job.topicSlug,
			totalDurationMs: Date.now() - startTime,
		});

		// Queue video generation for the first N concepts
		const savedConcepts = await deps.topicRepository.getConceptsByTopic(
			job.topicSlug
		);
		const conceptsToGenerate = savedConcepts.slice(0, INITIAL_VIDEO_BATCH_SIZE);

		if (conceptsToGenerate.length > 0) {
			jobLog.info("Queueing initial video generation", {
				topic: job.topicSlug,
				count: conceptsToGenerate.length,
			});

			enqueue({
				type: "generate_videos",
				topicSlug: job.topicSlug,
				concepts: conceptsToGenerate.map((c) => ({
					id: c.id,
					slug: c.slug,
					name: c.name,
					description: c.description,
				})),
			});
		}
	} catch (err) {
		const error = formatError(err);
		jobLog.error("Curriculum generation failed", {
			topic: job.topicSlug,
			error: error.message,
			durationMs: Date.now() - startTime,
		});
		await deps.topicRepository.updateTopicStatus(job.topicSlug, "failed");
		throw new JobError(
			"generate_curriculum",
			job.topicSlug,
			`Failed to generate curriculum: ${error.message}`,
			err instanceof Error ? err : undefined
		);
	}
}

async function processVideoJob(
	job: Extract<Job, { type: "generate_videos" }>,
	_deps: WorkerDeps
): Promise<void> {
	const jobLog = log.worker.child("video");

	jobLog.info("Starting video generation batch", {
		topic: job.topicSlug,
		count: job.concepts.length,
	});

	let completed = 0;
	let failed = 0;

	for (const concept of job.concepts) {
		const conceptLog = jobLog.child(concept.slug);
		const startTime = Date.now();

		try {
			conceptLog.info("Starting video generation", { name: concept.name });

			const videoJob = createJob({
				conceptId: concept.id,
				conceptSlug: concept.slug,
				conceptName: concept.name,
				conceptDescription: concept.description,
			});

			const videoUrl = await generateVideo(videoJob);

			conceptLog.info("Video completed", {
				videoUrl,
				durationMs: Date.now() - startTime,
			});
			completed++;
		} catch (err) {
			const error = formatError(err);
			conceptLog.error("Video generation failed", {
				error: error.message,
				durationMs: Date.now() - startTime,
			});
			failed++;
		}
	}

	jobLog.info("Video batch completed", {
		topic: job.topicSlug,
		completed,
		failed,
		total: job.concepts.length,
	});
}

async function processJob(job: Job, deps: WorkerDeps): Promise<void> {
	if (job.type === "generate_curriculum") {
		await processCurriculumJob(job, deps);
	} else if (job.type === "generate_videos") {
		await processVideoJob(job, deps);
	}
}

export function startWorker(deps: WorkerDeps): void {
	log.worker.info("Worker started", { pollIntervalMs: 1000 });

	setInterval(async () => {
		const job = dequeue();
		if (!job) return;

		try {
			await processJob(job, deps);
		} catch (err) {
			// Error already logged in process functions
			// This catch prevents the worker from crashing
		}
	}, 1000);
}
