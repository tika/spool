import {
  AbsoluteFill,
  OffthreadVideo,
  Img,
  interpolate,
  useCurrentFrame,
} from "remotion";

interface BackgroundProps {
  type: "video" | "image" | "gradient";
  url?: string;
  gradientColors?: [string, string];
}

export const Background: React.FC<BackgroundProps> = ({
  type,
  url,
  gradientColors = ["#1a1a2e", "#16213e"],
}) => {
  const frame = useCurrentFrame();

  if (type === "video" && url) {
    return (
      <AbsoluteFill>
        <OffthreadVideo
          src={url}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
        {/* Dark overlay for text readability */}
        <AbsoluteFill
          style={{
            backgroundColor: "rgba(0, 0, 0, 0.4)",
          }}
        />
      </AbsoluteFill>
    );
  }

  if (type === "image" && url) {
    // Subtle Ken Burns effect
    const scale = interpolate(frame, [0, 900], [1, 1.1], {
      extrapolateRight: "clamp",
    });

    return (
      <AbsoluteFill>
        <Img
          src={url}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: `scale(${scale})`,
          }}
        />
        {/* Dark overlay for text readability */}
        <AbsoluteFill
          style={{
            backgroundColor: "rgba(0, 0, 0, 0.5)",
          }}
        />
      </AbsoluteFill>
    );
  }

  // Gradient background with subtle animation
  const gradientAngle = interpolate(frame, [0, 900], [135, 145], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(${gradientAngle}deg, ${gradientColors[0]}, ${gradientColors[1]})`,
      }}
    />
  );
};
