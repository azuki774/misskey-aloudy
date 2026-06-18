export type CharacterInfo = {
	readonly id: number;
	readonly name: string;
	readonly creditLabel: string;
};

export const SUPPORTED_CHARACTERS: readonly CharacterInfo[] = [
	{ id: 1, name: "四国めたん", creditLabel: "VOICEVOX:四国めたん" },
	{ id: 3, name: "ずんだもん", creditLabel: "VOICEVOX:ずんだもん" },
] as const;
