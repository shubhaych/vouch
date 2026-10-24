# Vouch design system (extracted from Constructa)

Source: `shubhaych/Constructa` (`src/styles/app.css`, `src/routes/index.tsx`, `src/components/landing/*`, `src/components/ui/*`), read on Oct 24. We copy its look, not its logic or content. Reference screenshot: `e2e/constructa-ref.png`.

## Libraries
| Constructa | Vouch | Why |
| --- | --- | --- |
| Tailwind 4 (`@tailwindcss/vite`) | Tailwind 4 (`@tailwindcss/turbopack`) | Same utility layer; Constructa writes most styles as named classes in one CSS file, so do we (`app/globals.css`) |
| `@react-three/fiber` + `@react-three/drei` + `three` | same | The hero's moving background |
| GSAP + ScrollTrigger (section reveal, data band) | `motion` (spec: Framer Motion) | `whileInView` reproduces `LandingScrollReveal` (opacity 0 → 1, y 28 → 0, 0.85 s, power2.out) |
| `lucide-react` icons | same | |
| MapLibre + deck.gl (US map) | `react-globe.gl` (three.js) | Our flagship is a globe, not a US map |
| Plus Jakarta Sans + JetBrains Mono (Google Fonts) | same, via `next/font/google` | |

## Tokens (`:root` in Constructa, copied into `app/globals.css`)
| Token | Constructa | Vouch |
| --- | --- | --- |
| `--bg` light section background | `#f0f3f8` | same |
| `--bg-dark` command deck | `#0b0f14` | same |
| `--bg-dark-elevated` | `#111820` | same |
| `--surface` | `#ffffff` | same |
| `--ink` / `--ink-soft` | `#111820` / `#5c6678` | same |
| `--ink-dark` / `--ink-soft-dark` (text on dark) | `#e8edf2` / `#8b9aab` | same |
| `--line` / `--line-dark` | `#dfe4ec` / `rgba(255,255,255,0.1)` | same |
| `--accent` (brand) | `#c8553d` terracotta | **renamed to cyan `#22d3ee`** (Constructa's own `--glow-cyan`): terracotta reads as "fraud red" next to Vouch's status colours |
| `--accent-warm` / `--glow-amber` | `#f59e0b` / `#fbbf24` | kept: amber is "review" and the primary CTA glow |
| `--radius` | `10px` | same (cards 12px, controls 8px per spec) |
| `--maxw` | `1080px` | same |
| Status colours (new) | n/a | honest `#34d399`, review `#fbbf24`, fraud `#f87171`, credential `#a78bfa`, neutral `#94a3b8` |

## Components and their jobs
- **Nav** (`SiteNav`): sticky dark strip with a floating pill (`border-radius: 999px`, 82% dark + `backdrop-filter: blur(16px) saturate(1.4)`, 1px `line-dark` border, faint cyan ring). Brand dot is a cyan→amber gradient with glow. Links are muted, brighten on hover; one small CTA at the right. Vouch adds a live pill (simulated day + green dot when SpacetimeDB is connected) and "Run demo".
- **Buttons**: `btn--glow` (amber→terracotta gradient, amber border and glow, lifts 1px on hover) is the primary CTA; `btn--ghost-dark` (4% white, blur, cyan border on hover) the secondary; `btn--primary` (accent gradient) on light sections; `btn--sm` in the nav.
- **Hero** (`hero--command`): full-height dark section. Layers bottom to top: the 3D canvas (`HeroCanvas`), a 48px cyan grid overlay masked to an ellipse, a left-to-right scrim, then a glass copy card (`hud-glass`: 4% white, 12% white border, 18px radius, blur 20px) holding an eyebrow pill with a cyan dot, a balanced 3.5rem title, a muted sub, two CTAs and a mono "proof" row under a hairline.
- **Moving background** (`HeroCanvas`): a low-poly district of apartment blocks on a wireframe grid floor, fog into the page colour, slow auto-rotate that the visitor can drag (a "Drag to rotate" hint fades on first touch). SSR-safe: a radial-gradient poster until mounted. Vouch's copy (`components/background/hero-canvas.tsx`) keeps the scene and changes only colours (dark storefront blocks with cyan and amber lit windows) and density (more, smaller lots).
- **Section divider** (`SectionDivider`): a 1px gradient band (cyan → amber → cyan) with a cyan pulse sweeping across every 4.5 s. Between every home section.
- **Feature cards** (`feature--telemetry`): white card, cyan-tinted border, a 2px cyan line along the top, mono kicker ("01 · Find"), title, muted body; lifts 3px with a soft shadow on hover. Three in a row.
- **HUD frame** (`HudFrame`, `map-intel`): dark gradient panel with cyan corner reticles, a mono label and badge in the top bar ("LIVE INTEL" with a pulsing red dot), and film grain at 4%. Used for the map teaser; Vouch uses it for the live demo panel and the globe preview.
- **Section scaffolding**: `section__eyebrow` (mono, 0.72rem, uppercase, muted on the landing), `section__title` (clamp 1.5–2.1rem, tight tracking), sections 5rem padding (compact 2.75rem).

## Home page section order
| # | Constructa section | Its job | Vouch content in that slot |
| --- | --- | --- | --- |
| 1 | Hero (3D district, glass copy, 2 CTAs, proof row) | Say what it is and show it moving | Same layout. Eyebrow "Cal Hacks 13.0", "Trust that travels with every purchase.", "Enter Vouch World" / "File a refund", proof row → four live counters (agents, purchases, refunds investigated, patterns confirmed) |
| 2 | "Why Constructa": three telemetry feature cards | The loop in three steps | "Live demo: buy, then verify" (the spec's signature section) sits right after the hero; the three cards become "Three experiences" (Consumer app, Business dashboard, Vouch World) |
| 3 | Map teaser: copy left, dark HUD map right | The flagship view, previewed | "How it works" pipeline (Purchase → Refund video → Evidence Analyst → Refund Investigator → Business decision → Credit update → Globe) with sponsor tags, next to a live globe thumbnail in the HUD frame |
| 4 | Coverage explorer | Breadth | "Built on": CREAO, SpacetimeDB, Factory cards, each with one live number |
| 5 | Interactive mini demo | Try it | Closing CTA ("Try it yourself") and the footer line "Simulated agents and businesses. No real shoppers are tracked." |

Constructa has no footer; we add a one-line footer in the nav's style.

## App pages
Constructa's map page runs the whole viewport dark (`body:has(.map-page-v2)`) with floating glass panels; `/world`, `/business`, `/lab` and `/system` follow that. `/shop` and `/claim/[id]` use the light section look (white cards on `--bg`) because they are the consumer's phone flow.

## Motion
Panels slide in from their edge over 240 ms ease-out; lists stagger children by 40 ms; numbers tween; every arriving live row flashes its accent colour for 600 ms; camera moves are 1,200 ms. `prefers-reduced-motion` keeps fades and drops movement.
