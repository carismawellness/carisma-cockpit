# Salvatore Pizza — Landing Page Design Specification

Build-ready spec for a single-page site. Pair with `copy/COPY.md` (exact copy) and `brand/BRAND_BRIEF.md` (palette, tone, motifs). Order of sections below matches COPY.md, starting at the utility bar.

---

## 1. Design principles

- **Editorial restraint.** Read like an Italian food magazine, not a takeaway flyer. One idea per screen, never two.
- **Generous white space.** Off-White and Pure White carry the layout. Density is reserved for the menu.
- **Food-first photography.** The cheese pull is the hero. Type supports the photo, never the reverse.
- **Navy as the structural anchor.** Body copy, headings, dividers, and the footer block all sit on Deep Navy. Everything stable is navy.
- **Red used for action, not decoration.** Salvatore Red appears only on CTAs, the logo mark, the utility bar, the awning illustration, and the cornicione favicon. Never as a page background, never as a divider.

---

## 2. Tokens

Drop directly into `:root` in the stylesheet.

```css
:root {
  /* === Color === */
  --color-red:           #C8102E; /* Salvatore Red — CTAs, logo mark, utility bar */
  --color-red-hover:     #A60D26; /* CTA hover (~10% darker)                    */
  --color-navy:          #0E2A47; /* Deep Navy — body text, headings, footer    */
  --color-navy-80:       rgba(14, 42, 71, 0.80);
  --color-navy-60:       rgba(14, 42, 71, 0.60);
  --color-white:         #FFFFFF; /* Pure White — primary canvas                */
  --color-off-white:     #F7F1E3; /* Off-White — secondary canvas, story bg     */
  --color-yellow:        #F4C430; /* Mozzarella Yellow — focus ring, accent     */
  --color-charcoal:      #1C1C1C; /* Charcoal — alt dark surfaces, photo bg     */
  --color-crust:         #E8D8B7; /* Crust Cream — texture, footer divider tint */
  --color-charred:       #3A1F1A; /* Charred Edge — overlays, gradient stops    */

  /* === Typography === */
  --font-display: 'Playfair Display', 'Times New Roman', serif;
  --font-body:    'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;

  /* Desktop scale (px). Mobile uses clamp() — see below per size. */
  --fs-h1:        72px;  --lh-h1: 1.05; --ls-h1: -0.02em; --fw-h1: 900;
  --fs-h2:        48px;  --lh-h2: 1.10; --ls-h2: -0.01em; --fw-h2: 700;
  --fs-h3:        32px;  --lh-h3: 1.15; --ls-h3: -0.005em; --fw-h3: 700;
  --fs-h4:        22px;  --lh-h4: 1.25; --ls-h4: 0;       --fw-h4: 700;
  --fs-eyebrow:   13px;  --lh-eb: 1.20; --ls-eb: 0.18em;  --fw-eb: 500; /* uppercase, Inter */
  --fs-body:      17px;  --lh-body: 1.55; --ls-body: 0;   --fw-body: 400;
  --fs-small:     14px;  --lh-small: 1.50; --ls-small: 0; --fw-small: 400;
  --fs-caption:   12px;  --lh-cap: 1.40; --ls-cap: 0.04em; --fw-cap: 400; /* italic, Playfair */

  /* Mobile fluid sizes — drop into the rule for each element */
  /* h1: clamp(40px, 9vw, 72px)   line-height: 1.05 */
  /* h2: clamp(30px, 6vw, 48px)   line-height: 1.10 */
  /* h3: clamp(24px, 4vw, 32px)   line-height: 1.15 */
  /* h4: clamp(18px, 2.8vw, 22px) line-height: 1.25 */
  /* body: clamp(15px, 1.6vw, 17px) */

  /* === Spacing (4px base) === */
  --s-1:   4px;
  --s-2:   8px;
  --s-3:   12px;
  --s-4:   16px;
  --s-5:   24px;
  --s-6:   32px;
  --s-7:   48px;
  --s-8:   64px;
  --s-9:   96px;
  --s-10:  128px;

  /* === Radius === */
  --r-0:    0;     /* editorial blocks, hero, section dividers */
  --r-card: 8px;   /* menu cards, review cards, value cards    */
  --r-pill: 999px; /* primary CTA, secondary CTA               */

  /* === Shadow === */
  --shadow-soft:   0 2px 8px rgba(14, 42, 71, 0.06), 0 8px 24px rgba(14, 42, 71, 0.04);
  --shadow-strong: 0 8px 16px rgba(14, 42, 71, 0.10), 0 24px 48px rgba(14, 42, 71, 0.12);

  /* === Layout === */
  --container-max:    1200px;
  --gutter-mobile:    24px;
  --gutter-desktop:   48px;

  /* === Motion === */
  --ease-out:    cubic-bezier(0.2, 0.7, 0.2, 1);
  --dur-fast:    150ms;
  --dur-base:    250ms;
  --dur-reveal:  400ms;
}

/* Breakpoints (use in @media queries) */
/* mobile:  max-width: 640px           */
/* tablet:  641px – 1024px             */
/* desktop: min-width: 1025px          */

/* Grid */
/* desktop: 12 cols, 24px column gap   */
/* tablet:   6 cols, 20px column gap   */
/* mobile:   4 cols, 16px column gap   */
```

**Focus ring (apply to every interactive element):**
```css
:focus-visible {
  outline: 2px solid var(--color-yellow);
  outline-offset: 2px;
  border-radius: inherit;
}
```

---

## 3. Section-by-section layout

The vertical order matches COPY.md. Section numbering keeps COPY.md's numbers for traceability (Meta = #1 is skipped — not visual).

### §2 — Top utility bar
- **Layout:** Full-width strip, 36px tall on desktop / 32px on mobile. Single line, centered. On mobile (≤640px) the line collapses to: `19 Gurko Str. · (+359 2) 981 27 07` + a right-aligned `Order Online` link; hours move to footer-only.
- **Background:** `--color-red`. Text `--color-white`, `--fs-small`, weight 500.
- **Spacing:** 0 above (page top), 0 below. Sticks above the nav initially, scrolls away with the page (does NOT stick).
- **Interactive:** `Order Online` is bold + underlined on hover; phone number is `tel:` link.

### §3 — Navigation
- **Layout:** Full-width, 80px tall desktop / 64px mobile. Logo lockup (Playfair "Salvatore" with the sealed cornicione crescent mark to the left in Salvatore Red) on the left. Nav items right-aligned, 32px gap between items.
- **Background:** Transparent over the hero (white text). After 80px scroll: `--color-white` background with `--shadow-soft`, nav text switches to `--color-navy`. See §Motion.
- **Spacing:** Sits flush under utility bar. No top/bottom margin on the nav itself.
- **Type:** Nav items in Inter, `--fs-small`, weight 500, letter-spacing 0.04em, uppercase.
- **Mobile:** Logo left, hamburger icon (Lucide `menu`) right. Tap opens the mobile drawer (see Components §4).
- **Interactive:** "Reserve a Table" is rendered as the pill primary CTA inside the nav (right-most item), even at the nav scale — see Components.

### §4 — Hero section
- **Layout:** Full-bleed, 100vh on desktop (min 720px), 88vh on mobile. Split: left 55% copy block (padded to align with container left edge, 12-col equivalent of cols 1–6), right 45% is a single full-bleed image of the cheese pull that bleeds off the right edge of the viewport.
- **Background:** `--color-charcoal` base. The right-side photo overlays it; the left copy block sits on a thin gradient from `--color-charcoal` 100% → `--color-charcoal` 80% at the photo seam, so the photo edge softens into the copy area without a hard line.
- **Spacing:** Eyebrow → H1 = 16px (`--s-4`). H1 → subhead = 24px (`--s-5`). Subhead → CTA row = 40px (between `--s-6` and `--s-7`, use 40px). CTA row → trust line = 24px (`--s-5`). Copy block vertically centered.
- **Type:**
  - Eyebrow: `--fs-eyebrow`, uppercase, `--color-yellow`.
  - H1: `--fs-h1`, Playfair 900, `--color-white`. Italic the word **hiding** (Playfair italic 900) for editorial emphasis.
  - Subhead: `--fs-body` × 1.2 (≈20px), Inter 400, `--color-white` at 85% opacity.
  - Trust line: `--fs-small`, uppercase, letter-spacing 0.12em, `--color-yellow` for the dots, `--color-white` for the words.
- **Image:** `hero-cheese-pull.jpg` — vertical 3:4 crop on mobile (stacks above copy on mobile, copy on `--color-charcoal` below). Subject: a hand lifting a slice with mozzarella stretching out of the charred rim. Warm low-key light. See Imagery §5.
- **Interactive:** Two CTAs stacked side by side desktop (Primary red pill + Secondary outline pill, 16px gap), stacked vertically on mobile, primary first, full-width minus 24px gutter. Hero photo gets the parallax noted in §Motion.

### §5 — "The crust is the secret"
- **Layout:** Two-column on desktop (60% text left, 40% image right). Image: macro of the cross-section showing molten cheese inside the rim. On mobile: image on top (16:10), text below.
- **Background:** `--color-off-white`. The image sits inside a `--r-card` rounded container with `--shadow-strong`.
- **Spacing:** Section vertical padding: 128px top, 128px bottom desktop (`--s-10`); 80px / 80px mobile. H2 → body = 32px (`--s-6`). Body → feature bullets = 32px. Bullets → mini-CTA = 24px.
- **Type:**
  - H2: Playfair 700, `--fs-h2`, `--color-navy`. Italic on the word **secret**.
  - Body: `--fs-body`, `--color-navy` at 90%.
  - Feature bullets: 3 stacked rows, each row = small custom icon (cornicione crescent, 24px, in red) + 16px gap + bold label (`--fs-h4`, `--color-navy`). No bullet dots.
  - Mini-CTA caption: `--fs-small`, italic Playfair, `--color-navy`, with the price "24 BGN" in Inter tabular nums, weight 700, no italic.
- **Image:** `crust-cross-section.jpg`. Macro shot, top-down or 30° angle, showing the molten interior.
- **Interactive:** Mini-CTA caption is a ghost link that triggers a smooth scroll to the menu section.

### §6 — Menu preview
- **Layout:** Full-bleed band. Inside: a 12-col grid with a 2-column section heading (intro line) on the left and the menu groups on the right, OR (selected) a centered single column max-width 880px because the menu reads as one editorial card. Menu groups stack vertically; within each group the items are full-width rows with the dotted leader pattern (see Components §4 — Menu item card).
- **Background:** `--color-white`.
- **Spacing:** Section padding 128px / 80px (desktop / mobile). Between menu groups: 64px (`--s-8`). Within a group, group header → first item = 24px (`--s-5`). Between item rows = 16px (`--s-4`).
- **Type:**
  - Intro line ("A taste of what is on the wood block tonight…"): `--fs-h4`, Playfair italic 400, `--color-navy` at 70%, max-width 640px.
  - Group title (e.g. "Classic Napoletana"): `--fs-h3`, Playfair 700, `--color-navy`. A 1px `--color-crust` divider sits 12px below the title and runs full column width.
  - Group descriptor ("For the purists…"): `--fs-small`, italic Playfair, `--color-navy` at 70%, sits between divider and items, with 16px spacing.
  - Item name: Playfair 700, `--fs-h4`, `--color-navy`.
  - Item description: Inter 400, `--fs-small`, `--color-navy` at 70%, sits inline after the item name on desktop (em-dash separator), wraps below on mobile.
  - Price: Inter 700, `--fs-body`, `--color-navy`, tabular nums (`font-variant-numeric: tabular-nums`).
- **"Full Menu CTA"**: Centered below all groups, 64px of space above. Secondary outline button.
- **Interactive:** Items are static (no hover). The Full Menu CTA opens a PDF or routes to `#menu-full` — placeholder href `#`.

### §7 — Our story
- **Layout:** Two-column on desktop. Left column 6/12 holds a portrait/kitchen image (`story-salvatore-oven.jpg`, 4:5 aspect). Right column 6/12 holds the H2 + body. On mobile: image above, copy below.
- **Background:** `--color-navy`. All text `--color-off-white`. The image sits inside a `--r-card` container.
- **Spacing:** Section padding 128px / 80px. Column gap 64px desktop. H2 → body = 32px.
- **Type:**
  - H2: Playfair 700, `--fs-h2`, `--color-off-white`. Italic the words **stubborn idea**.
  - Body: Inter 400, `--fs-body`, `--color-off-white` at 85%.
  - Pull-quote treatment: the first sentence of the body is bumped up to `--fs-h4` Playfair italic 400 for a magazine-style drop intro, followed by the rest at body size.
- **Image:** Salvatore at the oven, candid, hands-in-flour or pulling a pie out. Warm side-light, slight grain.
- **Interactive:** None.

### §8 — Why Salvatore (3 value-prop cards)
- **Layout:** 3 equal cards in a row on desktop (4/4/4 of 12). On tablet: 3 in a row, narrower. On mobile: stacked, each card full-width.
- **Background:** Section `--color-off-white`. Cards `--color-white` with `--r-card` and `--shadow-soft`.
- **Spacing:** Section padding 128px / 80px. Cards gap 24px desktop, 16px mobile. Card inner padding 32px. Icon → headline = 24px. Headline → body = 12px.
- **Type:**
  - Card headline: Playfair 700, `--fs-h3`, `--color-navy`.
  - Card body: Inter 400, `--fs-body`, `--color-navy` at 80%.
- **Icon:** 48px Lucide icon, stroke 1.5px, `--color-red`. Per card: see §6 Iconography.
- **Interactive:** Card hover → `--shadow-strong` and translateY(-2px), 150ms ease. Not a link, just tactile.

### §9 — Reviews / social proof
- **Layout:** 3 review cards in a horizontal row on desktop (4/4/4). On tablet: 3 in a row, narrower. On mobile: horizontal scroll snap carousel, one card visible (90% width), peek of next card at 5% on each side.
- **Background:** `--color-white`. Cards `--color-off-white` with `--r-card`, no shadow (intentionally flat, editorial).
- **Spacing:** Section padding 128px / 80px. Section heading "What Sofia is saying." sits centered above the row, with 48px gap. Cards gap 24px / 16px (desktop / mobile). Card inner padding 32px.
- **Type:**
  - Section heading: Playfair 700, `--fs-h2`, `--color-navy`, italic the word **saying**. Centered.
  - Quote body: Playfair italic 400, `--fs-h4`, `--color-navy`, line-height 1.45.
  - Attribution: Inter 500, `--fs-small`, `--color-navy` at 70%. Name in `--color-navy` 100%, neighborhood in 70%.
  - Quotation mark: A large Playfair italic 900 "❝" in `--color-red` sits absolutely positioned top-left of the card, 48px size, offset (-12px, -12px) from card corner.
- **Interactive:** Mobile carousel uses `scroll-snap-type: x mandatory`. No autoplay.

### §10 — Visit us
- **Layout:** Two-column on desktop. Left 5/12: H2 + address block + hours + phone + how-to-find paragraph + Map CTA. Right 7/12: a static map image (or embedded Google Map iframe) with a red pin styled in Salvatore Red.
- **Background:** `--color-off-white`. Map container has `--r-card` and `--shadow-soft`.
- **Spacing:** Section padding 128px / 80px. Column gap 64px. H2 → address = 32px. Address block internal spacing 12px between lines. How-to-find → Map CTA = 24px.
- **Type:**
  - H2: Playfair 700, `--fs-h2`, `--color-navy`. Italic **Gurko**.
  - Address & hours: Inter 500, `--fs-body`, `--color-navy`. Labels (e.g. "Hours:") in `--color-navy` at 60% to differentiate from values.
  - How-to-find paragraph: Inter 400, `--fs-body`, `--color-navy` at 85%.
  - Each datapoint prefixed with a 16px Lucide icon (see §6).
- **Image:** Static Google Maps screenshot styled to match brand (light theme) at zoom 16 centered on 19 Gurko Str. — or live iframe. Aspect ratio 4:3.
- **Interactive:** Phone number is `tel:+35929812707`. "Open in Maps" is a ghost link with Lucide `external-link` icon to the right.

### §11 — Reservation / order CTAs (paired card row)
- **Layout:** Two equal cards in a row on desktop. Card 1: "Reserve a table." Card 2: "Take the stuffed crust home." On mobile: stacked, reservation first.
- **Background:** Section `--color-charcoal`. Card 1 background `--color-navy`. Card 2 background `--color-red`. Both text `--color-off-white`. This is the **one moment** where red is used as a flat area — justified because the card *is* the CTA.
- **Spacing:** Section padding 128px / 80px. Card gap 24px. Card inner padding 48px desktop / 32px mobile. H3 → subhead = 16px. Subhead → button = 32px. Button → microcopy = 16px.
- **Type:**
  - H3: Playfair 700, `--fs-h3`, `--color-off-white`. Italic the last word in each headline ("tonight." / "home.").
  - Subhead: Inter 400, `--fs-body`, `--color-off-white` at 80%.
  - Button: Primary pill on Card 1 (red on navy), Inverted primary on Card 2 (white pill with red text on red bg) — see Components §4.
  - Microcopy: Inter 400, `--fs-small`, `--color-off-white` at 65%.
- **Interactive:** Each card is hover-tilted by 0; only the button reacts. Phone number in microcopy is a `tel:` link, color `--color-off-white`, underlined on hover.

### §12 — Newsletter
- **Layout:** Single centered column, max-width 640px. H3 + subhead stacked above an inline email-input + button.
- **Background:** `--color-off-white`. The input + button row is white with a 1px `--color-crust` border and `--r-pill` rounding (the input on the left, button on the right, no internal divider).
- **Spacing:** Section padding 96px / 64px (smaller than other sections — this is a quieter moment). H3 → subhead = 16px. Subhead → form = 32px. Form → privacy reassurance = 16px.
- **Type:**
  - H3: Playfair 700, `--fs-h3`, `--color-navy`, italic **next pie**. Centered.
  - Subhead: Inter 400, `--fs-body`, `--color-navy` at 80%. Centered.
  - Privacy reassurance: Inter 400, `--fs-small`, `--color-navy` at 60%, centered, italic Playfair OK if it differentiates.
- **Interactive:** See Components §4 — Form input + Primary button.

### §13 — Footer
- **Layout:** Full-bleed dark block. Top row: tagline + contact line, centered, with the cornicione crescent logo mark in Mozzarella Yellow above the tagline (48px). Middle row: 3 columns (Eat / Visit / Follow), each with a label and a vertical list of links. Bottom row: social icons left, copyright right (desktop) — stacked centered on mobile.
- **Background:** `--color-navy`. Text `--color-off-white`.
- **Spacing:** Footer padding 96px top, 48px bottom desktop; 64px / 32px mobile. Top row → middle row = 64px. Middle row → bottom row = 48px (with a 1px `--color-crust` at 20% opacity divider above the bottom row).
- **Type:**
  - Tagline: Playfair italic 700, `--fs-h2` scaled to 36px, `--color-off-white`. Centered.
  - Contact line: Inter 400, `--fs-body`, `--color-off-white` at 80%. Centered.
  - Column labels ("Eat", "Visit", "Follow"): Inter 500, `--fs-eyebrow`, uppercase, `--color-yellow`.
  - Link list items: Inter 400, `--fs-body`, `--color-off-white` at 85%, hover → 100% + `--color-yellow` underline.
  - Copyright: `--fs-small`, `--color-off-white` at 55%.
- **Interactive:** Social icons (Lucide) 24px, stroke 1.5px, color `--color-off-white`, hover → `--color-yellow`.

### §14 — Microcopy bank
Not a visual section. Strings live in their respective places:
- 404 page (separate route): Centered single column, headline in Playfair italic, ghost link below. Use the same nav + footer.
- Cookie banner: Bottom-left floating card (max-width 420px), `--color-navy` bg, `--color-off-white` text, `--fs-small`. Accept button = small primary pill. Dismiss "X" Lucide icon top-right.
- Newsletter success / Reservation success: Replace the form area in §12 / the button area in §11 with the success string in Playfair italic, `--fs-h4`, `--color-navy`, with a small Lucide `check-circle` in `--color-red` to its left.

---

## 4. Components

### Primary button (pill)
- Height 56px desktop / 52px mobile. Padding 0 32px. `--r-pill` radius. Background `--color-red`. Text `--color-white`, Inter 700, `--fs-body`, letter-spacing 0.02em, uppercase.
- States:
  - **Hover:** background `--color-red-hover`; `translateY(-1px)`; `--shadow-soft`; 150ms `--ease-out`.
  - **Active:** `translateY(0)`; background `--color-red-hover`; no shadow.
  - **Focus-visible:** 2px `--color-yellow` outline, 2px offset.
  - **Disabled:** background `--color-navy-60`; cursor not-allowed; no hover.

### Inverted primary (used in Card 2 of §11)
Same as primary but background `--color-white`, text `--color-red`. Hover: background `--color-off-white`.

### Secondary button (outline pill)
- Same dimensions and pill shape. Background `transparent`. Border 1.5px solid `--color-navy`. Text `--color-navy`, Inter 700, `--fs-body`, uppercase, letter-spacing 0.02em.
- States: Hover → background `--color-navy`, text `--color-off-white`. Active → `--color-charred` border/bg. Focus-visible → yellow ring. Disabled → 40% opacity.
- On dark surfaces (hero, §11 Card 1, footer), border + text switch to `--color-off-white`. Hover inverts to `--color-off-white` bg + `--color-navy` text.

### Ghost link
- Inline text, no underline at rest. Color `--color-navy` on light surfaces, `--color-off-white` on dark.
- Hover: 1px solid `--color-red` underline (`text-decoration-thickness: 1px`, `text-underline-offset: 4px`); color stays the same. 150ms ease.
- Visited: same as default. Focus-visible: yellow ring.

### Menu item card (row with dotted leader)
- Single row, baseline-aligned. Left: item name (Playfair 700, `--fs-h4`) + em-dash + description (Inter 400, `--fs-small`, `--color-navy` at 70%). Right: price (Inter 700, tabular nums). The dots in between are CSS-rendered using `border-bottom: 1px dotted var(--color-navy-60)` on a flex spacer that fills available width, with a 4px gap on each side. Row vertical padding 12px.
- Hover: no state needed — these are not links. Keep static.

### Review card
- Padding 32px. Background `--color-off-white`. `--r-card`. No border, no shadow. Position relative for the floating quotation mark.
- Min-height 280px so cards stay even with varying quote lengths.

### Value prop card
- Padding 32px. Background `--color-white`. `--r-card`. `--shadow-soft`.
- Internal stack: icon (48px, red, stroke 1.5) → 24px gap → headline → 12px gap → body. Left-aligned text.
- Hover: `--shadow-strong` + `translateY(-2px)`, 150ms `--ease-out`.

### Top utility bar
- See §3 §2. 36px tall, full-width red strip, white Inter 500 `--fs-small`, single line. Centered. Phone is `tel:` link.

### Sticky nav
- 80px tall desktop / 64px mobile. Transparent over hero; switches to white background + `--shadow-soft` after 80px scroll. Nav text color animates from `--color-white` → `--color-navy` over 200ms.
- Logo: cornicione crescent SVG (16px) in `--color-red` + "Salvatore" wordmark in Playfair 700 (20px). Color animates too.
- Reserve-a-table CTA in the nav uses the primary button at a smaller scale: 44px tall, padding 0 20px, `--fs-small`.

### Mobile menu drawer
- Slide in from the right, 80% viewport width, max 360px. Background `--color-off-white`. `--shadow-strong` on the left edge. Backdrop is `--color-navy` at 50% opacity, click-to-close.
- Header: close X (Lucide `x`, 24px, navy) top-right, logo top-left, 24px padding.
- Body: 5 nav items stacked, each row 56px tall, full-width tap target, Inter 500, `--fs-h4`, `--color-navy`. Divider 1px `--color-crust` between rows.
- Footer of drawer: contact line + social icons.
- Animation: `transform: translateX(100%)` → `translateX(0)`, 300ms `--ease-out`. Backdrop fades 250ms.

### Form input (newsletter)
- Composite "pill row": container has `--r-pill`, 1px `--color-crust` border, background `--color-white`, height 56px, padding 4px 4px 4px 24px (extra right space lets the button sit inside).
- Input: transparent, no border, Inter 400, `--fs-body`, `--color-navy`. Placeholder `--color-navy` at 50%.
- Visible label: 14px Inter 500 above the input row, `--color-navy`, sr-only NOT used — label must be visible per accessibility rule.
- Button: primary pill, sits flush inside the right end of the container, 48px tall.
- States: Focus on input → container border becomes 2px `--color-yellow` (this doubles as the focus ring; outline is suppressed on the input itself).
- Error: border `--color-red`, helper text below in `--color-red`, `--fs-small`.
- Success: see §13 microcopy.

### Footer
- See §3 §13.

---

## 5. Imagery direction

The dev should source from Unsplash (free, commercial-OK) using the search terms below. If a shot is unavailable, fall back to a CSS-rendered placeholder block in `--color-charcoal` with a 1px `--color-crust` border and a centered Lucide `image` icon — and a small credit line "Photo: TBD" in `--fs-caption` italic. Final brand shoot to replace later.

| Slot | Content | Mood | Aspect ratio | Section | Unsplash search |
|---|---|---|---|---|---|
| `hero-cheese-pull.jpg` | Hand lifting a slice; mozzarella stretches a long thread from the rim | Low-key warm light, dark background, intimate | 4:5 mobile, 3:4 desktop | Hero §4 | `pizza cheese pull`, `neapolitan pizza slice` |
| `crust-cross-section.jpg` | Macro of the cornicione sliced open, molten cheese inside | Tight macro, candlelight feel | 4:3 | Signature §5 | `pizza crust macro`, `stuffed crust pizza` |
| `story-salvatore-oven.jpg` | Pizzaiolo at the wood oven, hands in motion, sparks/flames visible | Documentary, warm fire glow | 4:5 portrait | Our Story §7 | `pizzaiolo wood oven`, `pizza chef naples` |
| `value-prop-bg.jpg` | (Optional) leopard-spot crust underside | Texture only, used at 8% opacity behind cards | 16:9 | Why Salvatore §8 background | `pizza leopard spotting`, `charred crust` |
| `menu-divider.jpg` | Flour dust on dark wood, top-down | Texture, abstract | 16:5 | Menu §6 between groups (optional) | `flour dark surface`, `pizza dough flour` |
| `map-screenshot.jpg` | Google Maps centered on 19 Gurko Str. with red pin | Map, light theme | 4:3 | Visit §10 | n/a (use Google Static Maps API or screenshot) |
| `cta-pizza-box.jpg` | Pizza box with red branding, vent cut visible | Studio, on red surface | 1:1 | §11 Card 2 background (12% opacity overlay) | `pizza takeaway box`, `pizza delivery box` |
| `og-image.jpg` | Hero crop — same as hero-cheese-pull but social-optimized | Per brand brief OG alt | 1.91:1 | Open Graph | crop from hero-cheese-pull |
| `favicon-source.svg` | Cornicione crescent line icon on red square | Iconic | 1:1 | Favicon | custom SVG |

All images must include a meaningful `alt` attribute. Photo credit lines, if any required by the source, go in the footer at `--fs-caption`, `--color-off-white` at 50%.

---

## 6. Iconography

Use **Lucide** (lucide.dev — open-source, MIT). Install via CDN script or `lucide-static` package. Default stroke 1.5px.

### Value prop cards (§8)
- Card 1 "Slow dough" → `clock` (clock face evokes the 48-hour wait)
- Card 2 "Real ingredients" → `wheat` (grain → flour → dough)
- Card 3 "Wood, fast" → `flame` (the fire)

### Utility bar / Visit section / Footer
- Address: `map-pin`
- Phone: `phone`
- Hours: `clock`
- External link (Maps CTA): `external-link`
- Email: `mail`

### Social (footer)
- Instagram: `instagram`
- Facebook: `facebook`
- TikTok: not in Lucide stock — use a 24×24 custom SVG matching Lucide's visual weight (stroke 1.5, square corners, square viewbox) included in `assets/icons/tiktok.svg`.

### UI
- Mobile menu open: `menu`
- Mobile menu close: `x`
- Newsletter / form success: `check-circle`
- Newsletter / form error: `alert-circle`
- Image placeholder: `image`

All icons sized 16px (utility), 24px (UI/footer), 48px (value cards). Color inherits via CSS `color:` on a `currentColor` SVG stroke.

---

## 7. Motion

- **Scroll reveal** on each section enter (use `IntersectionObserver`): `opacity: 0` → `opacity: 1`, `translateY(8px)` → `translateY(0)`. Duration `--dur-reveal` (400ms), easing `--ease-out`. Triggers once at 15% visibility. Apply to direct children of each `<section>` for staggered feel (40ms stagger).
- **Sticky nav transition**: at scroll Y ≥ 80px, the nav's background transitions from `transparent` → `var(--color-white)`, `box-shadow` from `none` → `--shadow-soft`, and text colors from white → navy. All over 200ms ease. Reverse smoothly on scroll up past 80px.
- **CTA hover** (all buttons): 150ms `--ease-out`, slight darken + 1px `translateY` up. See Components for exact tokens.
- **Hero cheese-pull parallax**: the hero image element gets `transform: translateY(calc(var(--scroll) * -0.10))` driven by a passive scroll listener that updates a CSS custom property. Effective range: -10% translateY across the full hero scroll. Subtle, never more than 10%.
- **Mobile menu drawer**: 300ms slide from right, backdrop fade 250ms.
- **Reduced motion**: wrap all transforms and transitions in `@media (prefers-reduced-motion: no-preference)`. In reduced-motion mode: no parallax, no reveals (everything starts at final state), CTA hover still does color change but no translate.

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

---

## 8. Accessibility

- **Contrast (WCAG AA verified):**
  - `--color-navy #0E2A47` on white = 14.4:1 ✅ AAA
  - `--color-navy` on `--color-off-white` = 13.0:1 ✅ AAA
  - White on `--color-red #C8102E` = 5.9:1 ✅ AA for all text sizes
  - White on `--color-navy` = 14.4:1 ✅ AAA
  - `--color-yellow #F4C430` on `--color-navy` = 10.5:1 ✅ AAA — use for eyebrow/labels
  - `--color-red #C8102E` text on `--color-white` = 5.9:1 ✅ — but constraint: red text on white is **only used at ≥18.66px regular OR ≥14px bold**. In practice this means only the price callout on Card 2 §11 inverted button and any red link text. Never use red on white for body copy.
  - `--color-yellow` on white fails AA — never use yellow as text on white. Yellow is reserved for navy/dark backgrounds.
- **Focus rings:** 2px `--color-yellow` outline, 2px offset, on every interactive element. Never `outline: none` without a replacement.
- **Skip-to-content link:** First focusable item, visually hidden until focus, then slides down from top, `--color-navy` bg, `--color-off-white` text, 16px padding, `--r-card`.
- **Alt text:** Every `<img>` needs a descriptive alt. The OG image alt is already written in COPY.md §1; dev supplies per-image alts. Decorative images (texture, background) → `alt=""` + `role="presentation"`.
- **Form labels:** Visible `<label>` above each input. Never placeholder-only.
- **Semantic landmarks:** `<header>` (utility bar + nav), `<nav>` (inside header), `<main>` (all sections from hero through newsletter), `<footer>`. Each `<section>` has an `aria-labelledby` pointing to its H2.
- **Keyboard:** All CTAs and links reachable via tab. Mobile menu drawer must trap focus while open and return focus to the menu button on close. ESC closes the drawer and the cookie banner.
- **Reduced motion:** see §7.

---

## 9. SEO / meta

From COPY.md §1, paste into `<head>`:

```html
<title>Salvatore Pizza — Neapolitan Stuffed Crust in Sofia</title>
<meta name="description" content="Naples-trained dough, a cheese-stuffed cornicione, and a wood fire at 480°C. Sofia's stuffed-crust Neapolitan pizzeria on Gurko Str.">
<meta property="og:title" content="The crust is the secret. — Salvatore Pizza, Sofia">
<meta property="og:description" content="A 48-hour Neapolitan dough sealed around stretched mozzarella, finished in a wood fire on Gurko Str.">
<meta property="og:image" content="/assets/og-image.jpg">
<meta property="og:image:alt" content="A lifted slice of Neapolitan pizza with molten mozzarella stretching from inside the charred, leopard-spotted crust.">
<meta property="og:type" content="restaurant.restaurant">
<meta property="og:locale" content="en_GB">
<link rel="canonical" href="https://salvatorepizza.bg/">
```

**Favicon spec:** Sealed cornicione crescent (the brand's "swoosh" from BRAND_BRIEF §8.3) as a 1px-stroke line illustration in `--color-white`, centered on a `--color-red` square. Export sizes:
- `favicon.ico` 32×32
- `favicon-192.png` 192×192 (PWA / Android)
- `favicon-512.png` 512×512 (PWA splash)
- `apple-touch-icon.png` 180×180 (iOS)

**Structured data (JSON-LD):** Add a Restaurant schema in `<head>`.

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Restaurant",
  "name": "Salvatore Pizza",
  "description": "Authentic Neapolitan pizzeria with a 48-hour fermented, cheese-stuffed cornicione, wood-fired at 480°C.",
  "image": "https://salvatorepizza.bg/assets/og-image.jpg",
  "url": "https://salvatorepizza.bg/",
  "telephone": "+35929812707",
  "priceRange": "BGN 16–32",
  "servesCuisine": ["Neapolitan", "Italian", "Pizza"],
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "19 Gurko Str.",
    "addressLocality": "Sofia",
    "addressCountry": "BG"
  },
  "openingHoursSpecification": [{
    "@type": "OpeningHoursSpecification",
    "dayOfWeek": ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"],
    "opens": "11:00",
    "closes": "23:00"
  }],
  "acceptsReservations": "True"
}
</script>
```

---

## 10. Dev handoff notes

- **Stack:** Single HTML page, vanilla HTML + CSS + JS. No framework required, no build step required. If a bundler is used, keep it Vite-thin.
- **CSS:** A single `styles.css` file. All tokens live in `:root` per §2. Mobile-first — base styles target mobile, `@media (min-width: 641px)` for tablet, `@media (min-width: 1025px)` for desktop.
- **Fonts:** Google Fonts via `<link>` in `<head>` with `display=swap`:
  ```html
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400;1,700;1,900&family=Inter:wght@400;500;700&display=swap" rel="stylesheet">
  ```
- **Icons:** Lucide via CDN: `<script src="https://unpkg.com/lucide@latest"></script>` then `lucide.createIcons()` on DOM ready. Custom TikTok SVG inline.
- **Images:** Lazy-load all images below the fold with `loading="lazy"`. Hero image is eager-loaded with `fetchpriority="high"` and a low-quality `<img srcset>` placeholder. Provide WebP with JPG fallback.
- **JS:** Keep under 5KB. Three small scripts:
  1. Sticky-nav scroll listener (passive).
  2. Mobile drawer toggle + focus trap.
  3. IntersectionObserver for scroll reveals.
- **Performance:** Target Lighthouse Performance ≥ 90 mobile, ≥ 95 desktop. LCP element = hero photo, preload it. CLS = 0; set explicit width/height on all images.
- **Testing:** Verify on 360px (small mobile), 768px (tablet), 1280px (desktop), 1920px (wide). Test keyboard nav end-to-end and screen-reader pass with VoiceOver.
- **File structure:**
  ```
  /index.html
  /styles.css
  /scripts.js
  /assets/
    hero-cheese-pull.jpg (+ .webp)
    crust-cross-section.jpg
    story-salvatore-oven.jpg
    og-image.jpg
    favicon.ico
    favicon-192.png
    apple-touch-icon.png
    icons/tiktok.svg
  ```
- **Browser support:** Latest 2 versions of Chrome, Safari, Firefox, Edge. iOS 15+. No IE.

---

*Spec authored against COPY.md and BRAND_BRIEF.md. If copy length changes materially, type sizes in the hero and §11 cards may need a fluid re-tune — keep clamp() rules as the single source of truth.*
