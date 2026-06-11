export type UserLite = {
	id: string;
	name: string | null;
	username: string;
	host: string | null;
	avatarUrl: string;
	avatarBlurhash: string | null;
	avatarDecorations: {
		id: string;
		angle?: number;
		flipH?: boolean;
		url: string;
		offsetX?: number;
		offsetY?: number;
	}[];
	isBot?: boolean;
	isCat?: boolean;
	requireSigninToViewContents?: boolean;
	makeNotesFollowersOnlyBefore?: number | null;
	makeNotesHiddenBefore?: number | null;
	instance?: {
		name: string | null;
		softwareName: string | null;
		softwareVersion: string | null;
		iconUrl: string | null;
		faviconUrl: string | null;
		themeColor: string | null;
	};
	emojis: Record<string, string>;
	onlineStatus: 'unknown' | 'online' | 'active' | 'offline';
	badgeRoles?: {
		name: string;
		iconUrl: string | null;
		displayOrder: number;
	}[];
};

export type EmojiSimple = {
	aliases: string[];
	name: string;
	category: string | null;
	url: string;
	localOnly?: boolean;
	isSensitive?: boolean;
	roleIdsThatCanBeUsedThisEmojiAsReaction?: string[];
};

export type DriveFile = {
	id: string;
	createdAt: string;
	name: string;
	type: string;
	md5: string;
	size: number;
	isSensitive: boolean;
	blurhash: string | null;
	properties: {
		width?: number;
		height?: number;
		orientation?: number;
		avgColor?: string;
	};
	url: string;
	thumbnailUrl: string | null;
	comment: string | null;
	folderId: string | null;
	folder?: DriveFolder | null;
	userId: string | null;
	user?: UserLite | null;
};

export type DriveFolder = {
	id: string;
	createdAt: string;
	name: string;
	parentId: string | null;
	foldersCount?: number;
	filesCount?: number;
	parent?: DriveFolder | null;
};

export type NoteVisibility = 'public' | 'home' | 'followers' | 'specified';

export type NoteReactionAcceptance =
	| 'likeOnly'
	| 'likeOnlyForRemote'
	| 'nonSensitiveOnly'
	| 'nonSensitiveOnlyForLocalLikeOnlyForRemote'
	| null;

export type Note = {
	id: string;
	createdAt: string;
	deletedAt?: string | null;
	text: string | null;
	cw?: string | null;
	userId: string;
	user: UserLite;
	replyId?: string | null;
	renoteId?: string | null;
	reply?: Note | null;
	renote?: Note | null;
	isHidden?: boolean;
	visibility: NoteVisibility;
	mentions?: string[];
	visibleUserIds?: string[];
	fileIds?: string[];
	files?: DriveFile[];
	tags?: string[];
	poll?: {
		expiresAt?: string | null;
		multiple: boolean;
		choices: {
			isVoted: boolean;
			text: string;
			votes: number;
		}[];
	} | null;
	emojis?: Record<string, string>;
	channelId?: string | null;
	channel?: {
		id: string;
		name: string;
		color: string;
		isSensitive: boolean;
		allowRenoteToExternal: boolean;
		userId: string | null;
	} | null;
	localOnly?: boolean;
	reactionAcceptance: NoteReactionAcceptance;
	reactionEmojis: Record<string, string>;
	reactions: Record<string, number>;
	reactionCount: number;
	renoteCount: number;
	repliesCount: number;
	uri?: string;
	url?: string;
	reactionAndUserPairCache?: string[];
	clippedCount?: number;
	hasPoll?: boolean;
	myReaction?: string | null;
};

export type GlobalTimelineParams = {
	withRenotes?: boolean;
	withFiles?: boolean;
};

export type ClientMessage =
	| { type: 'connect'; body: { channel: string; id: string; params?: GlobalTimelineParams } }
	| { type: 'disconnect'; body: { id: string } }
	| { type: 'ch'; body: { id: string; type: string; body?: unknown } };

export type GlobalTimelineNoteEvent = {
	id: string;
	type: 'note';
	body: Note;
};

export type ServerMessage =
	| { type: 'channel'; body: { id: string; type: string; body: unknown } };
