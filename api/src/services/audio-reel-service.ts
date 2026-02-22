import { generateScript } from "../agents/video-scripting-agent";
import { log } from "../lib/logger";
import { reelRepository } from "../repositories/reel-repository";
import { generateTTSWithCaptions } from "./tts-service";
import { uploadAudioToS3 } from "./storage-service";
import { randomUUID } from "crypto";

export interface AudioReelInput {
	conceptId: string;
	conceptSlug: string;
	conceptName: string;
	conceptDescription: string;
}

export interface AudioReelResult {
	audioUrl: string;
	transcript: string;
	captions: Array<{ word: string; startTime: number; endTime: number }>;
	durationSeconds: number;
}

/**
 * Generates an audio reel for a concept:
 * 1. Generate script via LLM
 * 2. Generate TTS audio + word-level captions via 11Labs
 * 3. Upload audio to S3
 * 4. Save reel to database
 */
export async function generateAudioReel(
	input: AudioReelInput,
): Promise<AudioReelResult> {
	const audioLog = log.video.child("audio-reel");
	const startTime = Date.now();

	audioLog.info("Generating audio reel", { concept: input.conceptSlug });

	// Check for existing audio reel
	const existing = await reelRepository.getCompletedReelByConceptId(input.conceptId);
	if (existing?.audioUrl) {
		audioLog.info("Audio reel already exists", { concept: input.conceptSlug });
		return {
			audioUrl: existing.audioUrl,
			transcript: existing.transcript ?? "",
			captions: (existing.captions as AudioReelResult["captions"]) ?? [],
			durationSeconds: existing.durationSeconds ?? 0,
		};
	}

	// Step 1: Generate script
	audioLog.info("Step 1/3: Generating script", { concept: input.conceptName });
	const scriptStart = Date.now();
	const script = await generateScript({
		name: input.conceptName,
		description: input.conceptDescription,
	});
	audioLog.info("Step 1/3: Script ready", {
		concept: input.conceptSlug,
		words: script.transcript.split(/\s+/).length,
		tone: script.tone,
		durationMs: Date.now() - scriptStart,
	});

	// Step 2: Generate TTS with word-level captions
	audioLog.info("Step 2/3: Generating TTS audio via 11Labs", {
		concept: input.conceptSlug,
		transcriptLength: script.transcript.length,
	});
	const ttsStart = Date.now();
	const tts = await generateTTSWithCaptions(script.transcript);
	audioLog.info("Step 2/3: TTS ready", {
		concept: input.conceptSlug,
		durationSeconds: tts.durationSeconds,
		captionWords: tts.captions.length,
		durationMs: Date.now() - ttsStart,
	});

	// Step 3: Upload audio to S3
	audioLog.info("Step 3/3: Uploading audio to S3", { concept: input.conceptSlug });
	const jobId = randomUUID();
	const audioUrl = await uploadAudioToS3(tts.audioBuffer, jobId);

	// Save reel to database
	// If there's an existing reel (e.g. imported video), update it with audio data
	// Otherwise create a new one
	if (existing) {
		await reelRepository.updateReelAudio(existing.id, {
			audioUrl,
			transcript: script.transcript,
			captions: tts.captions,
			durationSeconds: tts.durationSeconds,
			tone: script.tone,
		});
	} else {
		await reelRepository.createReel({
			conceptId: input.conceptId,
			name: input.conceptName,
			description: input.conceptDescription,
			transcript: script.transcript,
			videoUrl: "",
			audioUrl,
			captions: tts.captions,
			durationSeconds: tts.durationSeconds,
			source: "audio",
			tone: script.tone,
			status: "completed",
		});
	}

	audioLog.info("Audio reel generated", {
		concept: input.conceptSlug,
		durationSeconds: tts.durationSeconds,
		captionWords: tts.captions.length,
		totalMs: Date.now() - startTime,
	});

	return {
		audioUrl,
		transcript: script.transcript,
		captions: tts.captions,
		durationSeconds: tts.durationSeconds,
	};
}
