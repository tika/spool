import {
  Audio,
  Img,
  Layout,
  makeScene2D,
  Rect,
  Txt,
  Video,
} from "@revideo/2d";
import type { View2D } from "@revideo/2d";
import { all, createRef, useScene, waitFor } from "@revideo/core";

const WORDS_PER_LINE = 4;
const FONT_SIZE = 56;

export default makeScene2D("EducationalReel", function* (view) {
  const audioUrl = useScene().variables.get("audioUrl", "")();
  const backgroundUrl = useScene().variables.get("backgroundUrl", "")();
  const backgroundType = useScene().variables.get("backgroundType", "gradient")();
  const captions = useScene().variables.get("captions", [])() as {
    word: string;
    startTime: number;
    endTime: number;
  }[];
  const durationInSeconds = useScene().variables.get("durationInSeconds", 30)();
  const gradientColors = useScene().variables.get("gradientColors", [
    "#1a1a2e",
    "#16213e",
  ])() as [string, string];

  const duration = durationInSeconds;
  const captionContainerRef = createRef<Layout>();

  // Background layer
  if (backgroundType === "video" && backgroundUrl) {
    yield view.add(
      <>
        <Video
          src={backgroundUrl}
          play={true}
          size={["100%", "100%"]}
          layout={false}
          width={"100%"}
          height={"100%"}
        />
        <Rect
          width={"100%"}
          height={"100%"}
          fill={"rgba(0, 0, 0, 0.4)"}
          layout={false}
        />
      </>,
    );
  } else if (backgroundType === "image" && backgroundUrl) {
    yield view.add(
      <>
        <Img src={backgroundUrl} width={"100%"} height={"100%"} />
        <Rect
          width={"100%"}
          height={"100%"}
          fill={"rgba(0, 0, 0, 0.5)"}
          layout={false}
        />
      </>,
    );
  } else {
    // Revideo fill uses solid colors; use first gradient color
    yield view.add(
      <Rect
        width={"100%"}
        height={"100%"}
        fill={gradientColors[0]}
        layout={false}
      />,
    );
  }

  // Audio track
  if (audioUrl) {
    yield view.add(<Audio src={audioUrl} play={true} />);
  }

  // Caption container
  yield view.add(
    <Layout
      ref={captionContainerRef}
      position={[0, 720]}
      width={"100%"}
      layout
      direction={"column"}
      alignItems={"center"}
      justifyContent={"center"}
    />,
  );

  // Captions and progress bar - run in parallel
  yield* all(
    displayCaptions(captionContainerRef, captions, duration),
    displayProgressBar(view, duration),
  );
});

function* displayProgressBar(view: View2D, duration: number) {
  const fillRef = createRef<Rect>();

  yield view.add(
    <Layout
      position={[0, 880]}
      width={960}
      height={6}
      layout
      direction={"row"}
      alignItems={"center"}
      fill={"rgba(255, 255, 255, 0.2)"}
      radius={3}
    >
      <Rect
        ref={fillRef}
        width={"0%"}
        height={6}
        fill={"#FFD700"}
        radius={3}
      />
    </Layout>,
  );

  // Animate progress bar from 0 to 100% over duration
  yield* fillRef().width("100%", duration);
}

function* displayCaptions(
  containerRef: ReturnType<typeof createRef<Layout>>,
  captions: { word: string; startTime: number; endTime: number }[],
  totalDuration: number,
) {
  if (captions.length === 0) {
    yield* waitFor(totalDuration);
    return;
  }

  let waitBefore = captions[0].startTime;

  for (let i = 0; i < captions.length; i += WORDS_PER_LINE) {
    const batch = captions.slice(i, i + WORDS_PER_LINE);
    const nextBatchStart =
      i + WORDS_PER_LINE < captions.length
        ? captions[i + WORDS_PER_LINE].startTime
        : null;
    const lastInBatch = batch[batch.length - 1];
    const waitAfter = i + WORDS_PER_LINE >= captions.length ? 1 : 0;

    yield* waitFor(waitBefore);

    const textRef = createRef<Layout>();
    const wordRefs: ReturnType<typeof createRef<Txt>>[] = [];

    const lineLayout = (
      <Layout
        ref={textRef}
        layout
        direction={"row"}
        justifyContent={"center"}
        alignItems={"center"}
        gap={4}
      >
        {batch.map((word) => {
          const wordRef = createRef<Txt>();
          wordRefs.push(wordRef);
          return (
            <Txt
              ref={wordRef}
              text={`${word.word} `}
              fontSize={FONT_SIZE}
              fontFamily={"Montserrat, system-ui, sans-serif"}
              fontWeight={800}
              fill={"#FFFFFF"}
            />
          );
        })}
      </Layout>
    );

    yield containerRef().add(lineLayout);

    // Highlight words as they're spoken
    yield* highlightWords(batch, wordRefs, waitAfter);

    yield textRef().remove();
    waitBefore =
      nextBatchStart !== null ? nextBatchStart - lastInBatch.endTime : 0;
  }
}

function* highlightWords(
  batch: { word: string; startTime: number; endTime: number }[],
  wordRefs: ReturnType<typeof createRef<Txt>>[],
  waitAfter: number,
) {
  let nextWordStart = 0;

  for (let i = 0; i < batch.length; i++) {
    yield* waitFor(nextWordStart);
    const word = batch[i];
    wordRefs[i]().fill("#FFD700");
    yield* waitFor(word.endTime - word.startTime);
    wordRefs[i]().fill("#FFFFFF");
    nextWordStart = batch[i + 1]
      ? batch[i + 1].startTime - word.endTime
      : waitAfter;
  }

  if (waitAfter > 0) {
    yield* waitFor(waitAfter);
  }
}
