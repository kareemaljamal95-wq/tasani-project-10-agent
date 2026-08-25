# TASAMI design system

The tokens below are the ones the app actually ships, read from
`src/app/globals.css` and the components — not an aspirational palette. Anything
generated against this file should drop into the product without retuning.

## Language and direction

Arabic, **RTL**. The root element is `<html lang="ar" dir="rtl">`. A horizontal
flow therefore reads **right to left**, and a connector or arrow between steps
points **left**. Getting this backwards is the most common mistake in generated
layouts here.

Interface copy is Arabic. Code, identifiers and agent system prompts stay
English.

## Palette

| Token | Value | Use |
|---|---|---|
| `--color-space-base` | `#0A0B12` | page ground |
| `--color-space-card` | `rgba(255,255,255,0.06)` | card fill |
| `--color-glow-electric` | `#3B82F6` | primary accent |
| `--color-glow-violet` | `#8B5CF6` | secondary accent, brand gradient end |

The body is not a flat fill — it is
`radial-gradient(circle at top right, #1a1b2e, #0a0b12)`.

Dark only. There is no light theme, and adding one is a project, not a detail.

## Surfaces

Cards are `rounded-2xl border border-white/10 bg-white/5 p-5`. Rows and smaller
elements drop to `rounded-xl`. Hover lifts the fill to `bg-white/10` and the
border to `border-white/25`. The global border default is `border-white/10`.

Text ladder: `text-white` for primary, `text-white/60` for supporting copy,
`text-white/40` for metadata, `text-white/25` for bullets and separators.

## Status colours

A consistent triple — a `/15` fill, a `/30` border, a `-300` text:

- green — active, succeeded, won, grade A
- amber — pending, needs approval, at limit, grade B
- red — failed, blocked, lost
- blue — in progress, contacted
- violet — qualified, primary action
- white/10 + `text-white/50` — neutral, stopped, grade C

Amber specifically carries "waiting on the human". The approval gate uses it.

## Brand mark

Three nodes converging on one decision point, on `#0A0B12`, in a
`#3B82F6 → #6366F1 → #8B5CF6` gradient. Lives at `src/app/icon.svg`. It must
stay legible at 32×32.

## Voice

The product's core promise is that **nothing goes out without the owner's
approval**, and the interface says so plainly rather than burying it. Copy is
direct and unhyped: it states what happened, what is waiting, and what is
missing. A screen with no data says it has no data — it never shows a
placeholder figure.

## Constraints for generated work

- Tailwind utility classes only. No CSS files, no inline style objects.
- Icons from `lucide-react`. No other icon library.
- Wide content (tables, canvases) scrolls inside its own `overflow-x-auto`
  container; the page body never scrolls sideways.
- Real `<button type="button">` for clickable things, with `aria-label` on
  grouped regions.
- Never render invented sample data to fill a layout. Render the empty state.
