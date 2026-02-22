export interface CaptionWord {
  word: string;
  startTime: number;
  endTime: number;
}

export interface VideoJobInput {
  conceptId: string;
  conceptSlug: string;
  conceptName: string;
  conceptDescription: string;
  webhookUrl?: string;
}

export interface VideoJob {
  id: string;
  status: VideoJobStatus;
  input: VideoJobInput;
  progress: number;
  videoUrl?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export type VideoJobStatus =
  | "queued"
  | "scripting"
  | "generating_tts"
  | "fetching_media"
  | "rendering"
  | "uploading"
  | "completed"
  | "failed";

export interface TTSResult {
  audioBuffer: Buffer;
  captions: CaptionWord[];
  durationSeconds: number;
}

export interface StockMediaResult {
  url: string;
  type: "video" | "image";
  attribution?: string;
}

export interface PatternInterrupt {
  startTime: number;
  duration: number;
  imageUrl: string;
  label?: string;
}

export interface RenderInput {
  audioUrl: string;
  backgroundUrl: string;
  backgroundType: "video" | "image" | "gradient";
  captions: CaptionWord[];
  durationInSeconds: number;
  gradientColors?: [string, string];
  hook?: string;
  patternInterrupts?: PatternInterrupt[];
}

export type BackgroundType =
  | "code_editor"
  | "whiteboard"
  | "minimal_gradient"
  | "diagram"
  | "abstract";

export const BACKGROUND_SEARCH_QUERIES: Record<BackgroundType, string> = {
  code_editor: "coding programming computer screen dark",
  whiteboard: "whiteboard education classroom clean",
  minimal_gradient: "abstract gradient dark",
  diagram: "flowchart diagram technology",
  abstract: "abstract motion dark technology",
};

export const BACKGROUND_GRADIENT_COLORS: Record<
  BackgroundType,
  [string, string]
> = {
  code_editor: ["#0d1117", "#161b22"],
  whiteboard: ["#f5f5f5", "#e0e0e0"],
  minimal_gradient: ["#1a1a2e", "#16213e"],
  diagram: ["#1e3a5f", "#0d2137"],
  abstract: ["#2d1b4e", "#1a0a2e"],
};
