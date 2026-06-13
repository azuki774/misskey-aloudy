import { MisskeyClientError } from "./errors.ts";
import type { MisskeyClient } from "./client.ts";
import type { Note, ServerMessage } from "./types.ts";

export type GlobalTimelineCallback = (note: Note) => void;

type SubscriptionState = {
	channelId: string;
	offMessage: () => void;
	offState: () => void;
};

const subscriptions = new WeakMap<MisskeyClient, SubscriptionState>();
let nextChannelId = 1;

function allocateChannelId(): string {
	const id = nextChannelId;
	nextChannelId += 1;
	return String(id);
}

function isNoteEvent(
	msg: ServerMessage,
	channelId: string,
): msg is { type: "channel"; body: { id: string; type: "note"; body: Note } } {
	if (msg.type !== "channel") return false;
	const body = msg.body as { id?: unknown; type?: unknown; body?: unknown };
	return body.id === channelId && body.type === "note" && body.body !== undefined;
}

export function subscribeGlobalTimeline(
	client: MisskeyClient,
	callback: GlobalTimelineCallback,
): () => void {
	if (subscriptions.has(client)) {
		throw new MisskeyClientError(
			"Already subscribed to global timeline for this client",
			"connection",
		);
	}

	const channelId = allocateChannelId();
	let active = true;

	const onMessage = (msg: ServerMessage): void => {
		if (!active) return;
		if (!isNoteEvent(msg, channelId)) return;
		callback(msg.body.body);
	};

	const onStateChange = ({ to }: { to: string }): void => {
		if (!active) return;
		if (to !== "connected") return;
		try {
			client.send({
				type: "connect",
				body: { channel: "globalTimeline", id: channelId },
			});
		} catch {
			// The state may have changed again between the listener firing and
			// the send call. The next transition will retry.
		}
	};

	const offMessage = client.on("message", onMessage);
	const offState = client.on("statechange", onStateChange);

	if (client.state === "connected") {
		try {
			client.send({
				type: "connect",
				body: { channel: "globalTimeline", id: channelId },
			});
		} catch {
			// The state will be re-evaluated on the next statechange.
		}
	}

	const unsubscribe = (): void => {
		if (!active) return;
		active = false;
		offMessage();
		offState();

		if (client.state === "connected") {
			try {
				client.send({ type: "disconnect", body: { id: channelId } });
			} catch {
				// The socket is already gone; the channel will be torn down with it.
			}
		}

		subscriptions.delete(client);
	};

	subscriptions.set(client, { channelId, offMessage, offState });

	return unsubscribe;
}
