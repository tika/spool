import { Hono } from "hono";
import { AppError, formatError } from "./lib/errors";
import { log } from "./lib/logger";
import { startWorker } from "./queue";
import { topicRepository } from "./repositories/topic-repository";
import { feedRoutes } from "./routes/feed";
import { topicsRoutes } from "./routes/topics";
import { usersRoutes } from "./routes/users";
import { videosRoutes } from "./routes/videos";
import { webhooksRoutes } from "./routes/webhooks";

const app = new Hono();

// Request logging middleware
app.use("*", async (c, next) => {
  const start = Date.now();
  const method = c.req.method;
  const path = c.req.path;

  await next();

  const duration = Date.now() - start;
  const status = c.res.status;

  if (status >= 400) {
    log.api.warn(`${method} ${path}`, { status, durationMs: duration });
  } else {
    log.api.info(`${method} ${path}`, { status, durationMs: duration });
  }
});

// Global error handler
app.onError((err, c) => {
  if (err instanceof AppError) {
    log.api.error(err.message, {
      code: err.code,
      status: err.statusCode,
      details: err.details,
    });
    return c.json(err.toJSON(), err.statusCode as 400 | 404 | 500);
  }

  // Zod validation errors from @hono/zod-validator
  if (err.name === "ZodError" || "issues" in err) {
    const zodErr = err as { issues: Array<{ path: string[]; message: string }> };
    log.api.warn("Validation error", {
      issues: zodErr.issues?.map((i) => `${i.path.join(".")}: ${i.message}`),
    });
    return c.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid request",
          details: zodErr.issues,
        },
      },
      400
    );
  }

  // Unknown errors
  const formatted = formatError(err);
  log.api.error("Unhandled error", {
    error: formatted.message,
    stack: formatted.stack,
  });

  return c.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message:
          process.env.NODE_ENV === "production"
            ? "Internal server error"
            : formatted.message,
      },
    },
    500
  );
});

// Health check
app.get("/", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Routes
app.route("/users", usersRoutes);
app.route("/topics", topicsRoutes);
app.route("/feed", feedRoutes);
app.route("/videos", videosRoutes);
app.route("/webhooks", webhooksRoutes);

// Start background worker
startWorker({ topicRepository });

log.api.info("Server started", { port: 3001 });

export default {
  fetch: app.fetch,
  port: 3001,
};
