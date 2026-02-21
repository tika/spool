import { AbsoluteFill, Audio } from "remotion";
import { Background } from "../components/Background";
import { Captions } from "../components/Captions";
import { ProgressBar } from "../components/ProgressBar";
import type { ReelProps } from "../types";

export const EducationalReel: React.FC<ReelProps> = ({
  audioUrl,
  backgroundUrl,
  backgroundType,
  captions,
  gradientColors,
}) => {
  return (
    <AbsoluteFill>
      {/* Background layer */}
      <Background
        type={backgroundType}
        url={backgroundUrl}
        gradientColors={gradientColors}
      />

      {/* Audio track */}
      {audioUrl && <Audio src={audioUrl} />}

      {/* Captions overlay */}
      <Captions captions={captions} />

      {/* Progress indicator */}
      <ProgressBar />
    </AbsoluteFill>
  );
};
