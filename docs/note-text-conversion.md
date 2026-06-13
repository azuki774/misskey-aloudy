# Note → Reading Text — Design

> Status: Implemented.
> Related issue: #14 (ノート→テキスト変換)
> Related dependencies: #11 (ノート型定義, merged)

## 1. Goal

Provide a pure function `toReadingText(note)` that converts a Misskey `Note` into a Japanese reading-aloud-friendly string, suitable to feed into the VoiceVox TTS pipeline.

This layer is the bridge between the streaming layer (#12) and the TTS pipeline (#19). It does **not** call VoiceVox; it only produces the text that will later be sent there.

## 2. Decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| Code structure | Pipeline of small, single-purpose functions (`classifyNote` → `describePrefix` / `preprocessText` / `describeAttachments` → `combine`) | Micro-adjustments stay local: tweaking the CW phrasing touches one function, not a 200-line monolith. Each function is independently testable. |
| Internal helpers exported | Yes — `classifyNote`, `describePrefix`, `preprocessText`, `describeAttachments` are all exported | Tests can pin each stage's contract independently. The public entry point `toReadingText` is also exported. |
| Documentation | JSDoc with `@example` on every public function | Lets editors surface expected behavior inline. |
| Tests | Stage-level describes for each helper, plus an integration describe for `toReadingText` | Maps the public API 1:1 to test names. Future regression in one stage is pinpointed by the failing describe block. |
| Rule data (table-driven) | Not in this revision | The current rule set is small (4 attachment kinds, 2 text patterns, 5 note kinds) and rules-with-data would over-engineer. If it grows past ~10 rules we can refactor. |
| CW (Content Warning) | Output only the CW text + a fixed phrase; omit the body and attachments | Matches the issue acceptance criteria. The user confirms the CW first, then chooses whether to "open" it. |
| Renote | `"<username> のリノート"`. Do **not** recurse into the renote's body | Renote chains are unbounded; recursing would balloon the spoken text. |
| Reply (with `replyId`, no `renoteId`) | `"<username> への返信" + text` | Spoken context for the user. |
| Reply on a Renote (`replyId` + `renoteId`) | `"<username> のリノートへの返信" + text` | The UI shows this distinction; we mirror it. |
| URLs | Stripped entirely | URLs are useless when spoken aloud. |
| `:emoji_name:` custom emoji | Stripped entirely | Custom emoji are images; reading the name is awkward. |
| Unicode emoji (e.g. `👍`) | Kept as-is | VoiceVox can attempt to read them; if not, the user will hear silence or a beep, which is acceptable. |
| Whitespace | Multiple spaces / newlines collapsed to one; leading/trailing trimmed | Keeps the spoken output natural. |
| Deleted notes (`deletedAt` set) | Empty string | Caller can use that to drop the note from the queue. |
| Empty text and no files | Empty string | Same handling. |
| File description | `image/*` → 「画像が投稿されました」, `video/*` → 「動画が投稿されました」, `audio/*` → 「音声が投稿されました」, other → 「ファイルが投稿されました」. Multiple files → 「N 個のファイルが投稿されました」 | Matches the issue text. |
| `files` field absent | Treat as `[]` | Defensive: not every Note in the wild has the field populated. |

## 3. Public API

```ts
// src/lib/misskey/textConverter.ts
import type { Note, DriveFile } from "./types.ts";

export type NoteKind = "renote" | "reply" | "cw" | "normal" | "empty";

export function classifyNote(note: Note): NoteKind;
export function describePrefix(note: Note, kind: "renote" | "reply"): string;
export function preprocessText(text: string): string;
export function describeAttachments(files: DriveFile[]): string;
export function toReadingText(note: Note): string;
```

All five functions are pure. `toReadingText` is the public entry point; the others are exported for testing and for downstream layers that may want to compose differently.

## 4. Behavior

### 4.1 `classifyNote`

Returns exactly one of:

- `"reply"` — `note.replyId` is set (regardless of `renoteId`)
- `"renote"` — `note.renoteId` is set
- `"cw"` — `note.cw` is a non-empty string
- `"normal"` — `note.text` is a non-empty string or `note.files` has at least one entry
- `"empty"` — none of the above

The order of the checks matters: `replyId` takes priority over `renoteId` because a reply has a body worth reading, while a pure renote does not. A reply on a renote is therefore classified as `"reply"` so the reply's text is read out (with a "リノートへの返信" prefix) instead of being dropped.

### 4.2 `describePrefix`

- `kind === "renote"` → `"<user.name ?? user.username> のリノート"`
- `kind === "reply"`:
  - With `renoteId`: `"<user.name ?? user.username> のリノートへの返信"`
  - Without `renoteId`: `"<user.name ?? user.username> への返信"`

`<user.name ?? user.username>` prefers the display name and falls back to the username if name is null.

### 4.3 `preprocessText`

Pipeline applied in order:

1. Remove `https?://\S+` (URLs).
2. Remove `:[A-Za-z0-9_]+:` (custom emoji shortcodes).
3. Collapse runs of whitespace to a single space.
4. Trim.

### 4.4 `describeAttachments`

If the input is empty, returns `""`. Otherwise:

| Condition | Output |
| --- | --- |
| Exactly 1 file, `image/*` | `"画像が投稿されました"` |
| Exactly 1 file, `video/*` | `"動画が投稿されました"` |
| Exactly 1 file, `audio/*` | `"音声が投稿されました"` |
| Exactly 1 file, other | `"ファイルが投稿されました"` |
| N files (N ≥ 2) | `"N 個のファイルが投稿されました"` |

The "N files" message does not split by kind; the caller can re-introduce kind-specific phrasing later if needed.

### 4.5 `toReadingText` (entry point)

```
if note.deletedAt: return ""
kind = classifyNote(note)
if kind == "empty": return ""
if kind == "renote": return describePrefix(note, "renote")
if kind == "reply":
  prefix = describePrefix(note, "reply")
  body = note.text ? preprocessText(note.text) : ""
  return body ? `${prefix}。${body}` : prefix
if kind == "cw": return `${note.cw ?? ""} の注記があります`
// kind == "normal"
body = note.text ? preprocessText(note.text) : ""
files = describeAttachments(note.files ?? [])
if !body and !files: return ""
if !body: return files
if !files: return body
return `${body}。${files}`
```

The full stop `。` between body and file description is intentional: it gives VoiceVox a brief pause cue.

## 5. Input / output examples

| Input | Output |
| --- | --- |
| `{text: "こんにちは", user: {name: "アリス", username: "alice"}}` | `"こんにちは"` |
| `{text: "見てね https://example.com/foo よろしく", user: {...}}` | `"見てね よろしく"` |
| `{text: "Hello :smile: world 👍", user: {...}}` | `"Hello world 👍"` |
| `{text: "hello\n\n\n  world", user: {...}}` | `"hello world"` |
| `{text: "", files: [{type: "image/png"}], user: {...}}` | `"画像が投稿されました"` |
| `{text: "見て", files: [{type: "image/png"}, {type: "video/mp4"}], user: {...}}` | `"見て。2 個のファイルが投稿されました"` |
| `{text: "本文", cw: "ネタバレ", user: {...}}` | `"ネタバレ の注記があります"` |
| `{renoteId: "r1", user: {name: "アリス", username: "alice"}}` | `"アリス のリノート"` |
| `{replyId: "rep1", text: "了解", user: {name: "ボブ", username: "bob"}}` | `"ボブ への返信。了解"` |
| `{replyId: "rep1", renoteId: "r1", text: "これはリプ", user: {...}}` | `"アリス のリノートへの返信。これはリプ"` |
| `{deletedAt: "2026-06-13T00:00:00.000Z"}` | `""` |
| `{}` (empty) | `""` |
| `{text: "", files: []}` | `""` |
| `{text: "hi", files: []}` | `"hi"` |
| `{text: "", files: [{type: "image/png"}, {type: "image/jpeg"}, {type: "video/mp4"}]}` | `"3 個のファイルが投稿されました"` |

## 6. Edge cases (handled)

- `note.deletedAt` set → empty string
- `note.text` is `null` (vs `""`) → treat as no text
- `note.cw` is `null` or `""` → not a CW
- `note.files` is `undefined` → treat as `[]`
- `note.user.name` is `null` → fall back to `user.username`
- File with no recognizable `type` prefix → "ファイル" bucket

## 7. Edge cases (explicitly NOT handled)

- MFM (Misskey Flavored Markdown) syntax: `**bold**`, `~~strike~~`, `$[x2 foo]`, etc. are left as literal text. Decoding MFM is a separate layer.
- Mentions: `@user` is left as-is. Reading `@alice` as "あっと えーりーしーいー" is not desirable; we accept the awkward pronunciation for now.
- Hashtags: `#tag` is left as-is.
- Quoted text inside `note.text` (the `text` field can include inline quote markup). Same — left as-is.
- Visibility filter: we do not skip notes by `visibility`. That's the caller's responsibility.
- Polls: the `poll` field is ignored in v1. If we want to read out "投票: 1. yes 2. no" later, that's a follow-up.
- Sensitive (NSFW) flag: we do not gate on it. CW already covers the main "is this OK to read aloud" case.

## 8. Testing

Tests live in `src/lib/misskey/textConverter.test.ts`. Five `describe` blocks, one per public function, plus an integration `describe` for the entry point.

- `describe("classifyNote")` — 10 cases: normal text, normal with files, normal with both, CW only, CW with text, CW with files, renote, reply, reply on renote, deleted.
- `describe("describePrefix")` — 5 cases: renote, reply, reply-on-renote, username fallback, name vs username.
- `describe("preprocessText")` — 6 cases: URL removal, emoji shortcode removal, Unicode emoji preserved, multiple whitespaces, leading/trailing whitespace, empty string.
- `describe("describeAttachments")` — 6 cases: empty, single image, single video, single audio, single other, multiple (N ≥ 2).
- `describe("toReadingText")` — 12 cases: maps directly to the Issue #14 acceptance criteria plus the in/out examples from §5.

Total: ~38 cases.

## 9. Micro-adjustment guide

When a user wants to tweak the behavior, here's where to look:

| Want to change… | Touch… |
| --- | --- |
| Add a new file type bucket (e.g. "ボイス") | `describeAttachments` switch in §4.4 |
| Change the CW phrasing | `toReadingText` `kind === "cw"` branch in §4.5 |
| Keep URLs instead of stripping | `preprocessText` in §4.3 |
| Treat emojis differently | `preprocessText` in §4.3 |
| Change Renote/Reply phrasing | `describePrefix` in §4.2 |
| Skip notes by visibility | Add a guard at the top of `toReadingText` in §4.5 |

## 10. Out of scope

- Reading poll options.
- Decoding MFM.
- User-configurable rules.
- Pronunciation hints for VoiceVox (e.g. `<phoneme>` tags).
- Multi-language note text (Japanese-only in MVP per `docs/requirements.md`).

## 11. Documentation updates

- `docs/requirements.md`: no edit required. The "Playback Controls" / "Note Filtering" rows in Phase 2 cover future work; this layer is the Phase 1 foundation for those.
- `README.md`: not required; this layer is internal.

## 12. Open questions

None.
