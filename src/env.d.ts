/// <reference types="astro/client" />

interface ImportMetaEnv {
	readonly VOICEVOX_URL?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
