import { makeScene2D, Video, Img, Rect, Txt, Node, Layout } from "@revideo/2d";
import {
  all,
  createRef,
  useScene,
  waitFor,
  Reference,
  tween,
  easeOutBack,
  usePlayback,
} from "@revideo/core";
import type { CaptionWord, ReelProps } from "../types";

const WORDS_PER_LINE = 4;
const DEFAULT_FPS = 30;

export default makeScene2D(function* (view) {
  // Get variables passed from render service
  const vars = useScene().variables;
  const audioUrl = vars.get("audioUrl", "")();
  const backgroundUrl = vars.get("backgroundUrl", "")();
  const backgroundType = vars.get("backgroundType", "gradient")() as ReelProps["backgroundType"];
  const captions = vars.get("captions", [])() as CaptionWord[];
  const durationInSeconds = vars.get("durationInSeconds", 30)();
  const gradientColors = vars.get("gradientColors", ["#1a1a2e", "#16213e"])() as [string, string];

  // ─── Background Layer ───────────────────────────────────────────────
  if (backgroundType === "video" && backgroundUrl) {
    const videoRef = createRef<Video>();
    view.add(
      <Video
        ref={videoRef}
        src={backgroundUrl}
        width={540}
        height={960}
        play={true}
      />
    );
    view.add(
      <Rect width={540} height={960} fill="rgba(0, 0, 0, 0.4)" />
    );
  } else if (backgroundType === "image" && backgroundUrl) {
    const imgRef = createRef<Img>();
    view.add(
      <Img
        ref={imgRef}
        src={backgroundUrl}
        width={540}
        height={960}
      />
    );
    view.add(
      <Rect width={540} height={960} fill="rgba(0, 0, 0, 0.5)" />
    );
  } else {
    // Gradient background (default)
    view.add(
      <Rect
        width={540}
        height={960}
        fill={gradientColors[0]}
      />
    );
  }

  // ─── Captions Container ─────────────────────────────────────────────
  const captionContainer = createRef<Layout>();
  view.add(
    <Layout
      ref={captionContainer}
      y={280}
      layout
      direction="row"
      gap={20}
      justifyContent="center"
      width={480}
    />
  );

  // Create text refs for each word slot (max 4 words visible)
  const wordRefs: Reference<Txt>[] = [];
  for (let i = 0; i < WORDS_PER_LINE; i++) {
    const ref = createRef<Txt>();
    wordRefs.push(ref);
    captionContainer().add(
      <Txt
        ref={ref}
        fontFamily="Montserrat, system-ui, sans-serif"
        fontWeight={800}
        fontSize={56}
        fill="#FFFFFF"
        opacity={0.4}
      />
    );
  }

  // ─── Progress Bar ───────────────────────────────────────────────────
  const progressRef = createRef<Rect>();
  view.add(
    <Rect
      ref={progressRef}
      x={-268}
      y={460}
      width={0}
      height={4}
      fill="#FFD700"
      radius={2}
    />
  );

  // ─── Main Animation ─────────────────────────────────────────────────
  // Animate captions and progress bar over the duration
  let lastActiveIndex = -1;

  yield* tween(durationInSeconds, (t) => {
    const currentTime = t * durationInSeconds;

    // Update progress bar
    progressRef().width(t * 536);

    // Find current word index
    let currentWordIndex = captions.findIndex(
      (w) => currentTime >= w.startTime && currentTime < w.endTime
    );

    if (currentWordIndex < 0) {
      const nextWordIndex = captions.findIndex((w) => currentTime < w.startTime);
      currentWordIndex = nextWordIndex > 0 ? nextWordIndex - 1 : captions.length - 1;
    }

    // Don't show captions before first word
    if (currentTime < (captions[0]?.startTime ?? 0)) {
      for (const ref of wordRefs) {
        ref().text("");
      }
      return;
    }

    // Calculate which line group we're on
    const lineGroupIndex = Math.floor(Math.max(0, currentWordIndex) / WORDS_PER_LINE);
    const startIndex = lineGroupIndex * WORDS_PER_LINE;
    const visibleWords = captions.slice(startIndex, startIndex + WORDS_PER_LINE);

    // Update each word slot
    for (let i = 0; i < WORDS_PER_LINE; i++) {
      const ref = wordRefs[i];
      const word = visibleWords[i];

      if (!word) {
        ref().text("");
        continue;
      }

      const globalIndex = startIndex + i;
      const isActive = globalIndex === currentWordIndex;
      const isPast = globalIndex < currentWordIndex;
      const isFuture = globalIndex > currentWordIndex;

      ref().text(word.word);
      ref().fill(isActive ? "#FFD700" : "#FFFFFF");

      if (isFuture) {
        ref().opacity(0.4);
      } else if (isPast) {
        ref().opacity(0.7);
      } else {
        ref().opacity(1);
      }

      // Scale effect for active word
      if (isActive && globalIndex !== lastActiveIndex) {
        ref().scale(1.15);
      } else if (isActive) {
        const currentScale = ref().scale().x;
        ref().scale(currentScale + (1 - currentScale) * 0.15);
      } else {
        ref().scale(1);
      }
    }

    lastActiveIndex = currentWordIndex;
  });
});
