import type { ConceptInfo } from "../agents/curriculum-agent";
import { generateCurriculum } from "../agents/curriculum-agent";
import { dequeue } from "./queue";
import type { Job } from "./types";

export interface TopicRepositoryForWorker {
	saveConcepts(topicSlug: string, concepts: ConceptInfo[]): Promise<void>;
	updateTopicStatus(slug: string, status: string): Promise<void>;
}

export interface WorkerDeps {
	topicRepository: TopicRepositoryForWorker;
}

async function processJob(job: Job, deps: WorkerDeps): Promise<void> {
	if (job.type === "generate_curriculum") {
		try {
			const result = await generateCurriculum(job.topicName);
			await deps.topicRepository.saveConcepts(job.topicSlug, result.concepts);
			await deps.topicRepository.updateTopicStatus(job.topicSlug, "ready");
		} catch (err) {
			console.error(`Curriculum generation failed for ${job.topicSlug}:`, err);
			await deps.topicRepository.updateTopicStatus(job.topicSlug, "failed");
		}
	} else if (job.type === "generate_videos") {
		// TODO: implement when CDA is wired up
		console.warn("generate_videos job not yet implemented:", job);
	}
}

export function startWorker(deps: WorkerDeps): void {
	setInterval(async () => {
		const job = dequeue();
		if (!job) return;
		await processJob(job, deps);
	}, 1000);
}
