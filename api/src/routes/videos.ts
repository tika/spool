import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import {
	createJob,
	getJob,
	generateVideo,
} from "../services/video-service";

const GenerateVideoSchema = z.object({
	conceptId: z.string().min(1),
	conceptSlug: z.string().min(1),
	conceptName: z.string().min(1),
	conceptDescription: z.string().min(1),
	webhookUrl: z.string().url().optional(),
});

export const videosRoutes = new Hono()
	.post("/generate", zValidator("json", GenerateVideoSchema), async (c) => {
		const input = c.req.valid("json");
		const job = createJob(input);

		// Run pipeline in background
		generateVideo(job).catch((err) => {
			console.error(`Video generation failed for job ${job.id}:`, err);
		});

		return c.json({ jobId: job.id, status: job.status }, 202);
	})
	.get("/jobs/:jobId", async (c) => {
		const job = getJob(c.req.param("jobId"));
		if (!job) return c.json({ error: "Job not found" }, 404);

		return c.json({
			jobId: job.id,
			status: job.status,
			progress: job.progress,
			videoUrl: job.videoUrl,
			error: job.error,
			createdAt: job.createdAt,
			updatedAt: job.updatedAt,
		});
	});
