import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { log } from "../lib/logger";
import { enqueue } from "../queue";
import { handleZodError } from "../lib/validation";
import { topicRepository } from "../repositories/topic-repository";
import { reelRepository } from "../repositories/reel-repository";
import { createJob, getJob, generateVideo } from "../services/video-service";

const GenerateVideoSchema = z.object({
	conceptId: z.string().min(1, "Concept ID is required"),
	conceptSlug: z.string().min(1, "Concept slug is required"),
	conceptName: z.string().min(1, "Concept name is required"),
	conceptDescription: z.string().min(1, "Concept description is required"),
	webhookUrl: z.url("Invalid webhook URL").optional(),
});

const JobIdParamSchema = z.object({
	jobId: z.uuid("Invalid job ID format"),
});

const TopicSlugParamSchema = z.object({
	topicSlug: z.string().min(1, "Topic slug is required"),
});

const RequeueQuerySchema = z.object({
	limit: z.coerce.number().int().min(1).max(20).optional(),
});

export const videosRoutes = new Hono()
	.post(
		"/generate",
		zValidator("json", GenerateVideoSchema, handleZodError),
		async (c) => {
			const input = c.req.valid("json");
			const job = createJob(input);

			log.video.info("Video generation requested", {
				jobId: job.id,
				concept: input.conceptSlug,
			});

			// Run pipeline in background
			generateVideo(job).catch((err) => {
				log.video.error("Background video generation failed", {
					jobId: job.id,
					error: err instanceof Error ? err.message : String(err),
				});
			});

			return c.json({ jobId: job.id, status: job.status }, 202);
		},
	)
	.get(
		"/jobs/:jobId",
		zValidator("param", JobIdParamSchema, handleZodError),
		async (c) => {
			const { jobId } = c.req.valid("param");
			const job = getJob(jobId);

			if (!job) {
				return c.json(
					{ error: { code: "NOT_FOUND", message: "Job not found" } },
					404,
				);
			}

			return c.json({
				jobId: job.id,
				status: job.status,
				progress: job.progress,
				videoUrl: job.videoUrl,
				error: job.error,
				createdAt: job.createdAt,
				updatedAt: job.updatedAt,
			});
		},
	)
	// Requeue video generation for concepts without reels
	.post(
		"/requeue/:topicSlug",
		zValidator("param", TopicSlugParamSchema, handleZodError),
		zValidator("query", RequeueQuerySchema, handleZodError),
		async (c) => {
			const { topicSlug } = c.req.valid("param");
			const { limit = 5 } = c.req.valid("query");

			// Get all concepts for the topic
			const concepts = await topicRepository.getConceptsByTopic(topicSlug);
			if (concepts.length === 0) {
				return c.json(
					{ error: { code: "NOT_FOUND", message: "No concepts found" } },
					404,
				);
			}

			// Find concepts without completed reels
			const reelsMap = await reelRepository.getReelsByConceptIds(
				concepts.map((c) => c.id),
			);

			const conceptsWithoutReels = concepts.filter((c) => !reelsMap.has(c.id));

			const toGenerate = conceptsWithoutReels.slice(0, limit);

			if (toGenerate.length === 0) {
				return c.json({ message: "All concepts have reels", queued: 0 });
			}

			log.video.info("Requeueing video generation", {
				topic: topicSlug,
				count: toGenerate.length,
			});

			enqueue({
				type: "generate_videos",
				topicSlug,
				concepts: toGenerate.map((c) => ({
					id: c.id,
					slug: c.slug,
					name: c.name,
					description: c.description,
				})),
			});

			return c.json({
				message: "Video generation queued",
				queued: toGenerate.length,
				concepts: toGenerate.map((c) => c.slug),
			});
		},
	);
