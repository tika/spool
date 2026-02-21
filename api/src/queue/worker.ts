import type { ConceptInfo } from "../agents/curriculum-agent";
import { generateCurriculum } from "../agents/curriculum-agent";
import {
	createJob,
	generateVideo,
} from "../services/video-service";
import { dequeue } from "./queue";
import type { Job } from "./types";

export interface TopicRepositoryForWorker {
	saveConcepts(topicSlug: string, concepts: ConceptInfo[]): Promise<void>;
	updateTopicStatus(slug: string, status: string): Promise<void>;
	getConceptsByTopic(topicSlug: string): Promise<Array<{ slug: string; name: string; description: string }>>;
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
		const concepts = await deps.topicRepository.getConceptsByTopic(job.topicSlug);
		const targetConcepts = concepts.filter((c) =>
			job.conceptSlugs.includes(c.slug),
		);

		for (const concept of targetConcepts) {
			try {
				const videoJob = createJob({
					conceptId: concept.slug,
					conceptSlug: concept.slug,
					conceptName: concept.name,
					conceptDescription: concept.description,
				});
				await generateVideo(videoJob);
				console.log(`Video generated for ${concept.slug}: ${videoJob.videoUrl}`);
			} catch (err) {
				console.error(`Video generation failed for ${concept.slug}:`, err);
			}
		}
	}
}

export function startWorker(deps: WorkerDeps): void {
	setInterval(async () => {
		const job = dequeue();
		if (!job) return;
		await processJob(job, deps);
	}, 1000);
}
