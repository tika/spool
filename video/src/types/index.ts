export interface CaptionWord {
  word: string;
  startTime: number;
  endTime: number;
}

export interface PatternInterrupt {
  startTime: number;
  duration: number;
  imageUrl: string;
  label?: string;
}

export interface ReelProps {
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
