export interface CaptionWord {
  word: string;
  startTime: number;
  endTime: number;
}

export interface ReelProps {
  audioUrl: string;
  backgroundUrl: string;
  backgroundType: "video" | "image" | "gradient";
  captions: CaptionWord[];
  durationInSeconds: number;
  gradientColors?: [string, string];
}

export type BackgroundType =
  | "code_editor"
  | "whiteboard"
  | "minimal_gradient"
  | "diagram"
  | "abstract";
