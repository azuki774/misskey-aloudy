export const DEFAULT_MAX_TEXT_LENGTH = 100;

export const TRUNCATION_SUFFIX = "以下略";

/**
 * 読み上げ用テキストを末尾でカットし、切り詰めたことを示すサフィックスを付与する。
 *
 * `text.length <= maxLength` の場合は入力をそのまま返す。サフィックスは付与しない。
 * そうでない場合は先頭 `maxLength` 文字を残し、末尾に `TRUNCATION_SUFFIX` を付与する。
 * サフィックスは `maxLength` のカウントには含めない (出力は最大 `maxLength + suffix.length` 文字)。
 *
 * `maxLength` のバリデーションは行わない。呼び出し側が妥当な非負整数を渡す責任を持つ。
 *
 * @example
 * truncateForSpeech("short");  // => "short"
 * truncateForSpeech("a".repeat(101));  // => "a".repeat(100) + "以下略"
 */
export function truncateForSpeech(text: string, maxLength?: number): string {
	const effectiveMax = maxLength ?? DEFAULT_MAX_TEXT_LENGTH;
	if (text.length <= effectiveMax) return text;
	return text.slice(0, effectiveMax) + TRUNCATION_SUFFIX;
}
