import { makeScene2D, Video, Img, Rect, Txt, Layout, Audio } from "@revideo/2d";
import { createRef, useScene, tween } from "@revideo/core";
import type { Reference } from "@revideo/core";
import type { CaptionWord, PatternInterrupt, ReelProps } from "../types";

const WORDS_PER_LINE = 4;

export default makeScene2D(function* (view) {
  // Get variables passed from render service
  const vars = useScene().variables;
  const audioUrl = vars.get("audioUrl", "")();
  const backgroundUrl = vars.get("backgroundUrl", "")();
  const backgroundType = vars.get("backgroundType", "gradient")() as ReelProps["backgroundType"];
  const captions = vars.get("captions", [])() as CaptionWord[];
  const durationInSeconds = vars.get("durationInSeconds", 30)();
  const gradientColors = vars.get("gradientColors", ["#1a1a2e", "#16213e"])() as [string, string];
  const hook = vars.get("hook", "")();
  const patternInterrupts = vars.get("patternInterrupts", [])() as PatternInterrupt[];

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
        loop={true}
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

  // ─── Audio (invisible, merged into output) ───────────────────────────
  if (audioUrl) {
    view.add(<Audio src={audioUrl} play={true} />);
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

  // ─── Hook Text (first 3 seconds) ────────────────────────────────────
  const hookRef = createRef<Txt>();
  view.add(
    <Txt
      ref={hookRef}
      text={hook}
      fontFamily="Montserrat, system-ui, sans-serif"
      fontWeight={900}
      fontSize={72}
      fill="#FFFFFF"
      textAlign="center"
      width={480}
      y={-80}
    />
  );

  // ─── Pattern Interrupt Images ───────────────────────────────────────
  const interruptRefs: Reference<Img>[] = [];
  for (const interrupt of patternInterrupts) {
    const ref = createRef<Img>();
    interruptRefs.push(ref);
    view.add(
      <Img
        ref={ref}
        src={interrupt.imageUrl}
        width={360}
        height={360}
        opacity={0}
        scale={0.8}
      />
    );
  }

  // ─── Main Animation ─────────────────────────────────────────────────
  // Animate captions and progress bar over the duration
  let lastActiveIndex = -1;

  yield* tween(durationInSeconds, (t) => {
    const currentTime = t * durationInSeconds;

    // Update progress bar
    progressRef().width(t * 536);

    // Hook: show for first 3 seconds, then hide
    hookRef().opacity(currentTime < 3 ? 1 : 0);

    // Pattern interrupts: scale-up and fade per interrupt
    for (let i = 0; i < patternInterrupts.length; i++) {
      const interrupt = patternInterrupts[i];
      const ref = interruptRefs[i];
      const localT = currentTime - interrupt.startTime;
      if (localT < 0 || localT > interrupt.duration) {
        ref().opacity(0);
      } else {
        const fadeIn = 0.3;
        const fadeOut = 0.3;
        if (localT < fadeIn) {
          ref().opacity(localT / fadeIn);
          ref().scale(0.8 + (localT / fadeIn) * 0.2);
        } else if (localT > interrupt.duration - fadeOut) {
          ref().opacity((interrupt.duration - localT) / fadeOut);
          ref().scale(1);
        } else {
          ref().opacity(1);
          ref().scale(1);
        }
      }
    }

    // Find current word index
    let currentWordIndex = captions.findIndex(
      (w) => currentTime >= w.startTime && currentTime < w.endTime
    );

    if (currentWordIndex < 0) {
      const nextWordIndex = captions.findIndex((w) => currentTime < w.startTime);
      currentWordIndex = nextWordIndex > 0 ? nextWordIndex - 1 : captions.length - 1;
    }

    // Don't show captions during hook phase (first 3s) or before first word
    if (currentTime < 3 || currentTime < (captions[0]?.startTime ?? 0)) {
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
