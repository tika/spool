import type { Job } from "./types";

const jobs: Job[] = [];

export function enqueue(job: Job): void {
	jobs.push(job);
}

export function dequeue(): Job | undefined {
	return jobs.shift();
}
