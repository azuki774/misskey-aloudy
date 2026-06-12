export type VoiceVoxErrorKind = "config" | "connection" | "audio_query" | "synthesis";

export class VoiceVoxError extends Error {
	readonly kind: VoiceVoxErrorKind;
	readonly status?: number;

	constructor(message: string, kind: VoiceVoxErrorKind, status?: number) {
		super(message);
		this.name = "VoiceVoxError";
		this.kind = kind;
		this.status = status;
	}
}
