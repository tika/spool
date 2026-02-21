import { log } from "../lib/logger";
import type { Job } from "./types";

const jobs: Job[] = [];

export function enqueue(job: Job): void {
  jobs.push(job);
  log.queue.info("Job enqueued", {
    type: job.type,
    ...(job.type === "generate_curriculum" && { topic: job.topicSlug }),
    ...(job.type === "generate_videos" && {
      topic: job.topicSlug,
      concepts: job.conceptSlugs.length,
    }),
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
