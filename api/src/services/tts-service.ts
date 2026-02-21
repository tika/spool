import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { log } from "../lib/logger";
import type { CaptionWord, TTSResult } from "../types/video";

const client = new ElevenLabsClient({
	apiKey: process.env.ELEVENLABS_API_KEY,
});

const DEFAULT_VOICE_ID =
	process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";

interface CharacterAlignment {
	characters: string[];
	character_start_times_seconds: number[];
	character_end_times_seconds: number[];
}

/**
 * Generates TTS audio with word-level timestamps for captions
 */
export async function generateTTSWithCaptions(
	transcript: string,
	voiceId: string = DEFAULT_VOICE_ID,
): Promise<TTSResult> {
	const response = await client.textToSpeech.convertWithTimestamps(voiceId, {
		text: transcript,
		modelId: "eleven_multilingual_v2",
		outputFormat: "mp3_44100_128",
	});

	// Get audio as buffer
	const audioBase64 = response.audioBase64;
	const audioBuffer = Buffer.from(audioBase64, "base64");

	// Parse alignment into words
	const alignment = response.alignment as CharacterAlignment | undefined;

	let captions: CaptionWord[] = [];
	let durationSeconds = 0;

	if (alignment?.characters && alignment?.character_start_times_seconds) {
		captions = parseAlignmentToWords(transcript, alignment);
		durationSeconds =
			captions.length > 0 ? captions[captions.length - 1].endTime : 0;
	} else {
		// Fallback: estimate duration from audio buffer size
		// MP3 at 128kbps = 16KB per second
		durationSeconds = Math.ceil(audioBuffer.length / 16000);
		log.video.warn("No alignment data from TTS, using estimated duration", {
			estimatedDuration: durationSeconds,
			bufferSize: audioBuffer.length,
		});

		// Create simple word-based captions with estimated timing
		captions = createEstimatedCaptions(transcript, durationSeconds);
	}

	return {
		audioBuffer,
		captions,
		durationSeconds,
	};
}

/**
 * Creates estimated captions when alignment data is unavailable
 */
function createEstimatedCaptions(
	transcript: string,
	totalDuration: number,
): CaptionWord[] {
	const words = transcript.split(/\s+/).filter((w) => w.length > 0);
	if (words.length === 0) return [];

	const timePerWord = totalDuration / words.length;
	return words.map((word, i) => ({
		word,
		startTime: i * timePerWord,
		endTime: (i + 1) * timePerWord,
	}));
}

/**
 * Converts character-level alignment to word-level captions
 */
function parseAlignmentToWords(
	text: string,
	alignment: CharacterAlignment,
): CaptionWord[] {
	const words: CaptionWord[] = [];
	let currentWord = "";
	let wordStartTime = 0;
	let wordEndTime = 0;

	for (let i = 0; i < alignment.characters.length; i++) {
		const char = alignment.characters[i];
		const startTime = alignment.character_start_times_seconds[i] ?? 0;
		const endTime = alignment.character_end_times_seconds[i] ?? startTime;

		// Check if this is a word boundary (space, newline, or punctuation followed by space)
		if (char === " " || char === "\n" || char === "\t") {
			if (currentWord.trim()) {
				words.push({
					word: currentWord.trim(),
					startTime: wordStartTime,
					endTime: wordEndTime,
				});
			}
			currentWord = "";
			continue;
		}

		// Start a new word
		if (currentWord === "") {
			wordStartTime = startTime;
		}

		currentWord += char;
		wordEndTime = endTime;
	}

	// Don't forget the last word
	if (currentWord.trim()) {
		words.push({
			word: currentWord.trim(),
			startTime: wordStartTime,
			endTime: wordEndTime,
		});
	}

	return words;
}

/**
 * Gets available voices from 11Labs
 */
export async function getAvailableVoices() {
	const voices = await client.voices.getAll();
	return voices.voices.map((v) => ({
		id: v.voiceId,
		name: v.name,
		category: v.category,
	}));
}
