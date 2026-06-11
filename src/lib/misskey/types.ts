export interface User {
  id: string;
  name: string | null;
  username: string;
  host: string | null;
  avatarUrl: string | null;
  avatarBlurhash: string | null;
  isBot: boolean | null;
  isCat: boolean | null;
  emojis: Emoji[];
}

export interface Emoji {
  name: string;
  url: string;
}

export interface DriveFile {
  id: string;
  name: string;
  type: string;
  url: string;
  thumbnailUrl: string | null;
  blurhash: string | null;
  isSensitive: boolean;
}

export type NoteVisibility = 'public' | 'home' | 'followers' | 'specified';

export interface Note {
  id: string;
  createdAt: string;
  text: string | null;
  cw: string | null;
  user: User;
  userId: User['id'];
  visibility: NoteVisibility;
  localOnly: boolean;
  renoteCount: number;
  repliesCount: number;
  reactions: Record<string, number>;
  emojis: Emoji[];
  files: DriveFile[];
  replyId: Note['id'] | null;
  renoteId: Note['id'] | null;
  uri: string;
  url: string;
}

export type ClientMessage =
  | { type: 'connect'; body: { channel: string; id?: string; params?: Record<string, unknown> } }
  | { type: 'disconnect'; body: { id: string } }
  | { type: 'channel'; body: { id: string; type: string; body?: unknown } }
  | { type: 'ping' };

export type ServerMessage =
  | { type: 'connected'; body: { id: string } }
  | { type: 'disconnected'; body: { id: string } }
  | { type: 'channel'; body: { id: string; type: string; body: unknown } }
  | { type: 'ping' }
  | { type: 'pong' };

export type GlobalTimelineEvent = { type: 'note'; body: Note };

export type ChannelEvent = { id: string; type: 'note'; body: Note };
