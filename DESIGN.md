# Design System — MENO

## Product Context
- **What this is:** macOS desktop app that records meetings, transcribes them locally (Whisper), writes structured meeting notes (Qwen), and uploads to Notion. Local-first, private.
- **Who it's for:** Korean professionals who sit through back-to-back meetings and want clean notes without cloud services.
- **Space/industry:** AI meeting-notes tools (peers: Granola, Otter, Notion AI, Superwhisper).
- **Project type:** Native macOS Electron app (not a web SaaS).

## Memorable Thing
**"느긋한 친구가 회의록은 알아서 챙겨준다."** A calm companion. The product should feel
like a friendly, unhurried helper that takes care of the notes so you can relax in the
meeting — derived directly from the sloth mascot.

## Aesthetic Direction — "Calm Companion"
- **Direction:** Soft, rounded, friendly with a navy line-art identity. Calm, not corporate; friendly, not childish.
- **Decoration level:** intentional — paper grain in empty states, the mascot appears in empty states, soft shadows.
- **Mood:** Warm, reassuring, unhurried. A well-made personal notebook that happens to be intelligent.
- **Why not the alternatives:** Every meeting app is either generic SaaS blue (Otter/Linear) or now copies Granola's chartreuse. MENO is local + private + Korean + native, with a navy-ink sloth mascot. Its face should come from the mascot, not the category.
- **Reference:** The MENO mascot (navy ink line-art sloth holding a notepad, blue pencil) is the source of truth for color, shape, and tone.

## Typography
- **Display/Headings/Brand:** `--font-display` = `ui-rounded` (SF Pro Rounded on macOS) — carries the mascot's friendly, calm character. Native, zero-load. Korean falls back to Apple SD Gothic Neo / Pretendard.
- **Body / UI:** `--font-sans` = SF Pro Text + Apple SD Gothic Neo + Pretendard. Best Korean readability, zero-load.
- **Data / Timestamps:** `--font-mono` = SF Mono / JetBrains Mono (tabular).
- **Tracking:** headings + body use `--tracking-tight` (-0.011em); large display uses `--tracking-display` (-0.022em).
- **Applied via:** global rule on `h1, h2, h3, .sidebar-brand` in `tokens.css`.

## Color
Palette extracted from the mascot.

| Token | Light | Dark | Role |
|-------|-------|------|------|
| `--accent` | `#2d5bd0` | `#5b8ef0` | Pencil blue — primary actions, links, active nav |
| `--accent-hover` | `#2249b0` | `#6f9ef5` | Hover |
| `--accent-soft` | `rgba(45,91,208,.10)` | `rgba(91,142,240,.16)` | Tints, selected backgrounds |
| navy ink (brand) | `#1c3854` | — | Mascot outline; structural accents, secondary buttons |
| `--text` | `#16263a` | `#eaf0f8` | Near-black navy / soft cool white |
| `--text-muted` | `#52525b` | `#a6b0c0` | Secondary text |
| `--text-faint` | `#a1a1aa` | `#6a7484` | Tertiary |
| `--bg` | `#fbfbf9` | `#181b22` | Warm near-white paper / navy-tinted dark |
| `--bg-soft` | `#f5f6f8` | `#20242c` | Raised surfaces |
| `--bg-sunk` | `#eef0f4` | `#14171d` | Sunk surfaces, scrubber track |
| `--danger` | `#dc2626` | `#f87171` | Destructive only (회의 종료, 삭제) |
| `--success` | `#16a34a` | `#4ade80` | Notion uploaded, completed |

- **Approach:** restrained. Navy ink is the dominant brand color (structure + text); pencil blue is the single action accent. Red is reserved strictly for destructive actions.
- **Dark mode:** navy-tinted neutrals (not cold gray), accent brightened for contrast.

## Spacing
- **Base unit:** 4px. Scale: `--space-1`(4) … `--space-10`(40).
- **Density:** comfortable.

## Layout
- **Approach:** hybrid — grid-disciplined app shell (232px sidebar + 52px header), friendlier editorial touches in empty states and the recording stage.
- **Sidebar:** 232px, macOS vibrancy material.
- **Border radius:** generous, echoing the mascot's curves — `--radius-sm`(8) `--radius`(12) `--radius-lg`(18) `--radius-pill`(999). Buttons trend pill-shaped.
- **Shadows:** soft and low — `--shadow-sm`, `--shadow`, `--shadow-lg`.

## Motion
- **Approach:** intentional. Entrance fades, smooth state transitions; nothing flashy.
- **Easing:** `--ease-out` = cubic-bezier(0.16, 1, 0.3, 1).

## Tone / Voice (microcopy)
- Calm, reassuring, unhurried. "느긋하게. 기록은 제가 챙길게요."
- Empty states feature the mascot and gentle prompts ("아직 회의가 없어요 — 천천히 시작해요").
- Never hustle-y or corporate.

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-05-22 | Adopted "Calm Companion" mascot-driven system | Created via /design-consultation. Replaced generic SaaS blue (#2563eb) with mascot-derived navy ink + pencil blue (#2d5bd0), bumped radius for soft/rounded feel, added ui-rounded display font. Editorial "Ink on Paper" direction was rejected in favor of carrying the mascot's friendly character. |
