/// <reference types="astro/client" />

interface ImportMetaEnv {
	readonly PUBLIC_VOICEVOX_URL?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
