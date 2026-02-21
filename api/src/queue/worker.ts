import type { ConceptInfo } from "../agents/curriculum-agent";
import { generateCurriculum } from "../agents/curriculum-agent";
import { formatError, JobError } from "../lib/errors";
import { log } from "../lib/logger";
import { createJob, generateVideo } from "../services/video-service";
import { dequeue } from "./queue";
import type { Job } from "./types";

export interface TopicRepositoryForWorker {
  saveConcepts(topicSlug: string, concepts: ConceptInfo[]): Promise<void>;
  updateTopicStatus(slug: string, status: string): Promise<void>;
  getConceptsByTopic(
    topicSlug: string
  ): Promise<Array<{ slug: string; name: string; description: string }>>;
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
    await deps.topicRepository.saveConcepts(job.topicSlug, result.concepts);

    await deps.topicRepository.updateTopicStatus(job.topicSlug, "ready");
    jobLog.info("Curriculum job completed", {
      topic: job.topicSlug,
      totalDurationMs: Date.now() - startTime,
    });
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
  deps: WorkerDeps
): Promise<void> {
  const jobLog = log.worker.child("video");

  jobLog.info("Starting video generation batch", {
    topic: job.topicSlug,
    requestedConcepts: job.conceptSlugs.length,
  });

  const concepts = await deps.topicRepository.getConceptsByTopic(job.topicSlug);
  const targetConcepts = concepts.filter((c) =>
    job.conceptSlugs.includes(c.slug)
  );

  jobLog.info("Found concepts to process", {
    requested: job.conceptSlugs.length,
    found: targetConcepts.length,
  });

  let completed = 0;
  let failed = 0;

  for (const concept of targetConcepts) {
    const conceptLog = jobLog.child(concept.slug);
    const startTime = Date.now();

    try {
      conceptLog.info("Starting video generation", { name: concept.name });

      const videoJob = createJob({
        conceptId: concept.slug,
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
    total: targetConcepts.length,
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
