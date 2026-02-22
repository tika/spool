import { Composition } from "remotion";
import { EducationalReel } from "./compositions/EducationalReel";
import type { ReelProps } from "./types";

const FPS = 30;

export const Root: React.FC = () => {
	return (
		<>
			<Composition
				id="EducationalReel"
				component={EducationalReel}
				durationInFrames={30 * FPS} // Default 30 seconds, overridden by props
				fps={FPS}
				width={540}
				height={960}
				defaultProps={
					{
						audioUrl: "",
						backgroundUrl: "",
						backgroundType: "gradient" as const,
						captions: [],
						durationInSeconds: 30,
						gradientColors: ["#1a1a2e", "#16213e"] as [string, string],
					} satisfies ReelProps
				}
				calculateMetadata={({ props }) => {
					return {
						durationInFrames: Math.ceil(props.durationInSeconds * FPS),
					};
				}}
			/>
		</>
	);
};
