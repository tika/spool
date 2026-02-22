import { makeProject } from "@revideo/core";
import educationalReel from "./scenes/EducationalReel?scene";

export default makeProject({
  scenes: [educationalReel],
  variables: {
    audioUrl: "",
    backgroundUrl: "",
    backgroundType: "gradient" as const,
    captions: [] as { word: string; startTime: number; endTime: number }[],
    durationInSeconds: 30,
    gradientColors: ["#1a1a2e", "#16213e"] as [string, string],
  },
  settings: {
    shared: {
      size: { x: 1080, y: 1920 },
    },
  },
});
