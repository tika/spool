import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { log } from "../lib/logger";
import { handleZodError } from "../lib/validation";
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
	);
