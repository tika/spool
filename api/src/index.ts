import { Hono } from "hono";
import { startWorker } from "./queue";
import { topicRepository } from "./repositories/topic-repository";
import { feedRoutes } from "./routes/feed";
import { topicsRoutes } from "./routes/topics";
import { usersRoutes } from "./routes/users";
import { videosRoutes } from "./routes/videos";
import { webhooksRoutes } from "./routes/webhooks";

const app = new Hono();

app.get("/", (c) => {
	return c.text("Hello Hono!");
});

app.route("/users", usersRoutes);
app.route("/topics", topicsRoutes);
app.route("/feed", feedRoutes);
app.route("/videos", videosRoutes);
app.route("/webhooks", webhooksRoutes);

startWorker({ topicRepository });

export default {
	fetch: app.fetch,
	port: 3001,
};
