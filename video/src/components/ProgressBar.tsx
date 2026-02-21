import { useCurrentFrame, useVideoConfig, interpolate } from "remotion";

export const ProgressBar: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const progress = interpolate(frame, [0, durationInFrames], [0, 100], {
    extrapolateRight: "clamp",
  });

  return (
    <div style={styles.container}>
      <div style={styles.track}>
        <div
          style={{
            ...styles.fill,
            width: `${progress}%`,
          }}
        />
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: "absolute",
    bottom: 80,
    left: 60,
    right: 60,
  },
  track: {
    height: 6,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    borderRadius: 3,
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    backgroundColor: "#FFD700",
    borderRadius: 3,
    transition: "width 0.1s linear",
  },
};
