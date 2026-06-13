export type MisskeyClientErrorKind =
	| "invalid_url"
	| "connection"
	| "http_upgrade"
	| "heartbeat_timeout"
	| "destroyed"
	| "not_connected";

export class MisskeyClientError extends Error {
	readonly kind: MisskeyClientErrorKind;
	readonly status?: number;

	constructor(message: string, kind: MisskeyClientErrorKind, status?: number) {
		super(message);
		this.name = "MisskeyClientError";
		this.kind = kind;
		this.status = status;
	}
}
