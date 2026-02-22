import { log } from "../lib/logger";
import type { Job } from "./types";

const jobs: Job[] = [];

export function enqueue(job: Job): void {
  jobs.push(job);
  log.queue.info("Job enqueued", {
    type: job.type,
    topic: job.topicSlug,
    ...("concepts" in job && { concepts: job.concepts.length }),
    queueLength: jobs.length,
  });
}

export function dequeue(): Job | undefined {
  const job = jobs.shift();
  if (job) {
    log.queue.debug("Job dequeued", {
      type: job.type,
      remaining: jobs.length,
    });
  }
  return job;
}

export function getQueueLength(): number {
  return jobs.length;
}

/** Check if an expand_curriculum job for this topic is already queued */
export function hasExpandForTopic(topicSlug: string): boolean {
  return jobs.some(
    (j) => j.type === "expand_curriculum" && j.topicSlug === topicSlug
  );
}
