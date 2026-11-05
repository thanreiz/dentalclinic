# Molar & Co. design tokens

Source: approved logo. Logo teal `#326564` = brand-700. Ground `#D8ECE7` is the logo mint; the app ground is a lighter, calmer version of it.
Drop-in: `brand/tokens.css` (Tailwind v4 `@theme`, same `--color-brand-50..900` names the app already uses).

## 1. Brand ramp (hue ~178, muted)

| Step | Hex | White on step | Body ink on step |
|---|---|---|---|
| 50 | `#F0F7F6` | 1.09:1 | 13.16:1 |
| 100 | `#DDEDEA` | 1.21:1 | 11.82:1 |
| 200 | `#BDDAD6` | 1.48:1 | 9.64:1 |
| 300 | `#94C2BC` | 1.96:1 | 7.28:1 |
| 400 | `#68A59E` | 2.81:1 | 5.08:1 |
| 500 | `#478A84` | 4.01:1 | 3.56:1 |
| 600 | `#3B7571` | 5.29:1 | 2.70:1 |
| 700 | `#326564` | 6.60:1 | 2.16:1 |
| 800 | `#274F4E` | 9.07:1 | 1.57:1 |
| 900 | `#1B3736` | 12.76:1 | 1.12:1 |

Contrast on white for the three action steps (white text on step, same ratio):
- 600 `#3B7571`: **5.29:1** (AA body text)
- 700 `#326564`: **6.60:1** (AA and AAA large; main action)
- 800 `#274F4E`: **9.07:1** (hover/pressed)

## 2. Accent: terracotta (hue ~12, distinct from the teal)

| Step | Hex | Use |
|---|---|---|
| 100 | `#FBE6DE` | tint behind an accent badge/callout |
| 500 | `#D4694F` | one icon, dot, or highlight per screen (non-text) |
| 700 | `#9B432D` | accent text, or white-text accent button |

## 3. Neutrals

| Token | Hex | Role |
|---|---|---|
| ground | `#F3F8F7` | page background (faint teal tint) |
| surface | `#FFFFFF` | cards, tables, inputs |
| ink | `#1F2D2C` | body text |
| ink-muted | `#53625F` | secondary text, labels, placeholders |
| line | `#D4E0DD` | hairline borders, dividers |
| line-strong | `#7E938F` | input borders, focus-adjacent edges (3:1) |

## 4. Appointment status

Chips: text = fg on bg tint. Dot = solid marker for calendars/legends/charts.

| Status | Text | Tint | Dot | Hue family |
|---|---|---|---|---|
| Pending | `#85580A` | `#FDF1D3` | `#D99A1E` | amber |
| Scheduled | `#1D5A96` | `#E2EEFA` | `#3C87D0` | blue |
| Attended | `#1D6A3A` | `#E0F3E6` | `#35A05A` | green |
| Cancelled | `#4B5855` | `#E8EDEC` | `#8A9895` | slate gray |
| No-show | `#A02A2A` | `#FBE7E5` | `#D9534F` | red |

No status uses teal, so brand actions never read as a status. Do not rely on color alone: always pair the chip with its label text.

## 5. Fonts (Google Fonts, 2 families max)

- **DM Sans** weights 400, 500, 700: all app UI text.
- **Jost** weights 300, 500: logo wordmark, social posts and print only. Not loaded in the app.

## 6. Where color may go

Full strength (brand-600..800, accent-500/700): buttons, active nav icon, focus ring, links, selected state border, data marks (chart bars, status dots), small badges.

Tints only (brand-50..200, accent-100, status tints, ground): any area bigger than a button: page background, sidebar, cards, table row hover/selected, banners, empty states, calendar cells.

Rules:
1. One primary button per view. Primary = brand-700 fill, white text.
2. Never a full-strength brand fill on a large block (panels, headers, full-width bars). Use brand-50/100.
3. Body text is always ink or ink-muted, never brand color. Brand-700 text only for links and active labels.
4. Accent: at most one element per screen. Never for status, never for primary actions.
5. Status colors only for appointment status chips and calendar markers.
6. On brand-700/800 fills use white text only. On tints use the matching 800/fg text.
7. Focus ring: brand-600, 2px, always visible.

## Contrast table (every pair, WCAG 2.x)

| Pair | Text/fg | Bg | Ratio | Result (needs) |
|---|---|---|---|---|
| White text on brand-600 | #FFFFFF | #3B7571 | 5.29:1 | pass (4.5:1) |
| White text on brand-700 (primary button) | #FFFFFF | #326564 | 6.60:1 | pass (4.5:1) |
| White text on brand-800 (hover/pressed) | #FFFFFF | #274F4E | 9.07:1 | pass (4.5:1) |
| Brand-700 text on white (links) | #326564 | #FFFFFF | 6.60:1 | pass (4.5:1) |
| Brand-700 text on ground | #326564 | #F3F8F7 | 6.16:1 | pass (4.5:1) |
| Brand-800 text on brand-50 | #274F4E | #F0F7F6 | 8.36:1 | pass (4.5:1) |
| Brand-800 text on brand-100 (selected row, active nav) | #274F4E | #DDEDEA | 7.51:1 | pass (4.5:1) |
| Body text on ground | #1F2D2C | #F3F8F7 | 13.32:1 | pass (4.5:1) |
| Body text on white | #1F2D2C | #FFFFFF | 14.29:1 | pass (4.5:1) |
| Muted text on ground | #53625F | #F3F8F7 | 5.97:1 | pass (4.5:1) |
| Muted text on white | #53625F | #FFFFFF | 6.40:1 | pass (4.5:1) |
| Accent-700 text on accent-100 | #9B432D | #FBE6DE | 5.40:1 | pass (4.5:1) |
| Accent-700 text on white | #9B432D | #FFFFFF | 6.49:1 | pass (4.5:1) |
| White text on accent-700 | #FFFFFF | #9B432D | 6.49:1 | pass (4.5:1) |
| Pending: text on tint | #85580A | #FDF1D3 | 5.50:1 | pass (4.5:1) |
| Scheduled: text on tint | #1D5A96 | #E2EEFA | 6.04:1 | pass (4.5:1) |
| Attended: text on tint | #1D6A3A | #E0F3E6 | 5.71:1 | pass (4.5:1) |
| Cancelled: text on tint | #4B5855 | #E8EDEC | 6.28:1 | pass (4.5:1) |
| No-show: text on tint | #A02A2A | #FBE7E5 | 6.18:1 | pass (4.5:1) |
| Border on ground (non-text, 3:1) | #7E938F | #F3F8F7 | 3.03:1 | pass (3:1) |
| Brand-500 icon/data on white (non-text, 3:1) | #478A84 | #FFFFFF | 4.01:1 | pass (3:1) |
| Accent-500 on white (non-text, 3:1) | #D4694F | #FFFFFF | 3.54:1 | pass (3:1) |
