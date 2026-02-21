import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { getJob, updateJobStatus } from "../services/video-service";

const VideoCompleteSchema = z.object({
	jobId: z.string().min(1),
	status: z.enum(["completed", "failed"]),
	videoUrl: z.url().optional(),
	error: z.string().optional(),
});

export const webhooksRoutes = new Hono().post(
	"/video-complete",
	zValidator("json", VideoCompleteSchema),
	async (c) => {
		const { jobId, status, videoUrl, error } = c.req.valid("json");

		const job = getJob(jobId);
		if (!job) return c.json({ error: "Job not found" }, 404);

		if (status === "completed" && videoUrl) {
			updateJobStatus(jobId, "completed", 100, { videoUrl });
		} else {
			updateJobStatus(jobId, "failed", 0, { error: error || "Unknown error" });
		}

		return c.json({ ok: true });
	},
);
