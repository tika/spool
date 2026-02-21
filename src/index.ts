import { Hono } from "hono";
import { startWorker } from "./queue";
import { topicRepository } from "./repositories/topic-repository";
import { feedRoutes } from "./routes/feed";
import { topicsRoutes } from "./routes/topics";

const app = new Hono();

app.get("/", (c) => {
	return c.text("Hello Hono!");
});

app.route("/topics", topicsRoutes);
app.route("/feed", feedRoutes);

startWorker({ topicRepository });

export default {
	fetch: app.fetch,
	port: 3001,
};
