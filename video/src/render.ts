import { renderVideo } from "@revideo/renderer";
import { readFileSync } from "node:fs";

const input = JSON.parse(
  readFileSync("/tmp/input.json", "utf-8"),
);

async function render() {
  const file = await renderVideo({
    projectFile: "./src/project.ts",
    variables: {
      audioUrl: input.audioUrl ?? "",
      backgroundUrl: input.backgroundUrl ?? "",
      backgroundType: input.backgroundType ?? "gradient",
      captions: input.captions ?? [],
      durationInSeconds: input.durationInSeconds ?? 30,
      gradientColors: input.gradientColors ?? ["#1a1a2e", "#16213e"],
    },
    settings: {
      outFile: "output.mp4",
      outDir: "/tmp",
      dimensions: [1080, 1920],
      logProgress: true,
      puppeteer: {
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
      },
      progressCallback: (_worker: number, progress: number) => {
        process.stdout.write(
          JSON.stringify({ progress: Math.round(progress * 100) }) + "\n",
        );
      },
    },
  });

  process.stdout.write(JSON.stringify({ done: true, file }) + "\n");
}

render().catch((err) => {
  console.error(err);
  process.exit(1);
});
