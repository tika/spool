import type { ConceptInfo } from "../agents/curriculum-agent";
import { generateCurriculum, continueCurriculum } from "../agents/curriculum-agent";
import { formatError, JobError } from "../lib/errors";
import { log } from "../lib/logger";
import { generateAudioReel } from "../services/audio-reel-service";
import { createJob, generateVideo } from "../services/video-service";
import { dequeue, enqueue } from "./queue";
import type { Job, ConceptToGenerate } from "./types";

const INITIAL_VIDEO_BATCH_SIZE = 5;
const AUDIO_REEL_BATCH_SIZE = 5;

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

		// Queue audio reel generation for the first N concepts
		const savedConcepts = await deps.topicRepository.getConceptsByTopic(
			job.topicSlug
		);
		const conceptsToGenerate = savedConcepts.slice(0, AUDIO_REEL_BATCH_SIZE);

		if (conceptsToGenerate.length > 0) {
			jobLog.info("Queueing initial audio reel generation", {
				topic: job.topicSlug,
				count: conceptsToGenerate.length,
			});

			enqueue({
				type: "generate_audio_reels",
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

async function processAudioReelJob(
	job: Extract<Job, { type: "generate_audio_reels" }>,
	_deps: WorkerDeps,
): Promise<void> {
	const jobLog = log.worker.child("audio-reel");

	jobLog.info("Starting audio reel generation batch", {
		topic: job.topicSlug,
		count: job.concepts.length,
	});

	let completed = 0;
	let failed = 0;

	for (const concept of job.concepts) {
		const conceptLog = jobLog.child(concept.slug);
		const startTime = Date.now();

		try {
			conceptLog.info("Generating audio reel", { name: concept.name });

			await generateAudioReel({
				conceptId: concept.id,
				conceptSlug: concept.slug,
				conceptName: concept.name,
				conceptDescription: concept.description,
			});

			conceptLog.info("Audio reel completed", {
				durationMs: Date.now() - startTime,
			});
			completed++;
		} catch (err) {
			const error = formatError(err);
			conceptLog.error("Audio reel generation failed", {
				error: error.message,
				durationMs: Date.now() - startTime,
			});
			failed++;
		}
	}

	jobLog.info("Audio reel batch completed", {
		topic: job.topicSlug,
		completed,
		failed,
		total: job.concepts.length,
	});
}

async function processExpandCurriculumJob(
	job: Extract<Job, { type: "expand_curriculum" }>,
	deps: WorkerDeps,
): Promise<void> {
	const jobLog = log.worker.child("expand-curriculum");
	const startTime = Date.now();

	jobLog.info("Expanding curriculum", { topic: job.topicSlug });

	try {
		const existingConcepts = await deps.topicRepository.getConceptsByTopic(
			job.topicSlug,
		);

		const result = await continueCurriculum(
			job.topicName,
			existingConcepts.map((c) => ({
				slug: c.slug,
				name: c.name,
				description: c.description,
			})),
		);

		jobLog.info("Curriculum expanded", {
			topic: job.topicSlug,
			newConcepts: result.concepts.length,
			quizzes: result.quizzes?.length ?? 0,
			durationMs: Date.now() - startTime,
		});

		const slugToId = await deps.topicRepository.saveConcepts(
			job.topicSlug,
			result.concepts,
		);

		if (result.quizzes?.length) {
			await deps.topicRepository.saveQuizzes(
				job.topicSlug,
				result.quizzes,
				slugToId,
			);
		}

		// Queue audio reel generation for the new concepts
		const newConcepts = result.concepts.map((c) => ({
			id: slugToId.get(c.slug)!,
			slug: c.slug,
			name: c.name,
			description: c.description,
		})).filter((c) => c.id);

		if (newConcepts.length > 0) {
			const batch = newConcepts.slice(0, AUDIO_REEL_BATCH_SIZE);
			jobLog.info("Queueing audio reel generation for new concepts", {
				topic: job.topicSlug,
				count: batch.length,
			});

			enqueue({
				type: "generate_audio_reels",
				topicSlug: job.topicSlug,
				concepts: batch,
			});
		}
	} catch (err) {
		const error = formatError(err);
		jobLog.error("Curriculum expansion failed", {
			topic: job.topicSlug,
			error: error.message,
			durationMs: Date.now() - startTime,
		});
		throw new JobError(
			"expand_curriculum",
			job.topicSlug,
			`Failed to expand curriculum: ${error.message}`,
			err instanceof Error ? err : undefined,
		);
	}
}

async function processJob(job: Job, deps: WorkerDeps): Promise<void> {
	if (job.type === "generate_curriculum") {
		await processCurriculumJob(job, deps);
	} else if (job.type === "generate_videos") {
		await processVideoJob(job, deps);
	} else if (job.type === "generate_audio_reels") {
		await processAudioReelJob(job, deps);
	} else if (job.type === "expand_curriculum") {
		await processExpandCurriculumJob(job, deps);
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
