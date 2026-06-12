export type AudioQuery = {
	accent_phrases: unknown[];
	speedScale: number;
	pitchScale: number;
	intonationScale: number;
	volumeScale: number;
	prePhonemeLength: number;
	postPhonemeLength: number;
	outputSamplingRate: number;
	outputStereo: boolean;
	kana: string;
};

export type AudioQueryOptions = {
	text: string;
	speaker: number;
	baseUrl?: string;
	signal?: AbortSignal;
};

export type SynthesisOptions = {
	query: AudioQuery;
	speaker: number;
	baseUrl?: string;
	signal?: AbortSignal;
};

export type SynthesizeOptions = {
	text: string;
	speaker?: number;
	baseUrl?: string;
	signal?: AbortSignal;
};

export const DEFAULT_SPEAKER = 1;
export const DEFAULT_BASE_URL = "http://localhost:50021";
