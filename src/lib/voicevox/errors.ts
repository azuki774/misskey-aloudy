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

export type VoiceVoxPlayerErrorKind = "empty_buffer" | "media_error" | "unsupported_environment";

export class VoiceVoxPlayerError extends Error {
	readonly kind: VoiceVoxPlayerErrorKind;

	constructor(message: string, kind: VoiceVoxPlayerErrorKind) {
		super(message);
		this.name = "VoiceVoxPlayerError";
		this.kind = kind;
	}
}
