import {
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
} from "remotion";
import type { CaptionWord } from "../types";

interface CaptionsProps {
  captions: CaptionWord[];
}

const WORDS_PER_LINE = 4;

export const Captions: React.FC<CaptionsProps> = ({ captions }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentTime = frame / fps;

  // Find current word index
  const currentWordIndex = captions.findIndex(
    (w) => currentTime >= w.startTime && currentTime < w.endTime
  );

  // If no current word, find the last spoken word
  const activeIndex =
    currentWordIndex >= 0
      ? currentWordIndex
      : captions.findIndex((w) => currentTime < w.startTime) - 1;

  if (activeIndex < 0 && currentTime < (captions[0]?.startTime ?? 0)) {
    return null; // Before first word
  }

  // Calculate which line group we're on
  const lineGroupIndex = Math.floor(Math.max(0, activeIndex) / WORDS_PER_LINE);
  const startIndex = lineGroupIndex * WORDS_PER_LINE;
  const visibleWords = captions.slice(startIndex, startIndex + WORDS_PER_LINE);

  return (
    <div style={styles.container}>
      <div style={styles.captionBox}>
        {visibleWords.map((word, i) => {
          const globalIndex = startIndex + i;
          const isActive = globalIndex === activeIndex;
          const isPast = globalIndex < activeIndex;
          const isFuture = globalIndex > activeIndex;

          // Spring animation for active word
          const scale = isActive
            ? spring({
                frame: frame - word.startTime * fps,
                fps,
                config: {
                  damping: 15,
                  stiffness: 200,
                },
              }) *
                0.15 +
              1
            : 1;

          // Opacity based on timing
          const opacity = isFuture
            ? 0.4
            : isPast
              ? 0.7
              : interpolate(
                  currentTime,
                  [word.startTime, word.startTime + 0.05],
                  [0.7, 1],
                  { extrapolateRight: "clamp" }
                );

          return (
            <span
              key={`${word.word}-${globalIndex}`}
              style={{
                ...styles.word,
                color: isActive ? "#FFD700" : "#FFFFFF",
                transform: `scale(${scale})`,
                opacity,
                textShadow: isActive
                  ? "0 0 20px rgba(255, 215, 0, 0.5), 2px 2px 8px rgba(0,0,0,0.9)"
                  : "2px 2px 8px rgba(0,0,0,0.9)",
              }}
            >
              {word.word}{" "}
            </span>
          );
        })}
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: "absolute",
    bottom: 200,
    left: 0,
    right: 0,
    display: "flex",
    justifyContent: "center",
    padding: "0 60px",
  },
  captionBox: {
    textAlign: "center",
    maxWidth: "100%",
  },
  word: {
    fontFamily: "Montserrat, system-ui, sans-serif",
    fontWeight: 800,
    fontSize: 56,
    lineHeight: 1.3,
    display: "inline",
    transition: "color 0.1s ease-out",
  },
};
