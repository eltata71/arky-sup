/**
 * The design tokens of ArkyPro — the single place the product's visual
 * language is written down.
 *
 * Foundation layer on purpose: these are declarations with no behaviour, and
 * three layers need them (the `components/ui` primitives, the screens that
 * compose them, and the motion helpers in `hooks/`). A contract with no
 * behaviour belongs in a leaf.
 *
 * **What is here and what is not.** Colour stays in `tailwind.config.cjs`,
 * because Tailwind's scanner is what turns `bg-primary-600` into CSS and a
 * second definition in TypeScript would be a palette nobody compiles. What is
 * here is everything Tailwind cannot express as a class: the *named steps* of
 * elevation, radius and motion, so a panel is `ELEVATION.floating` rather than
 * whichever shadow its author liked that afternoon.
 *
 * The rule these exist to enforce: **a surface's depth says what it is, not how
 * important its author felt it was.** Before this file the repository carried
 * `shadow-sm`, `shadow-md`, `shadow-soft`, `shadow-pop` and four hand-written
 * `shadow-[...]` arbitraries across screens that render the same kind of panel,
 * which is how a modal and a hover state ended up at the same depth.
 */

/* ----------------------------------------------------------------- motion */

/**
 * Durations, in milliseconds.
 *
 * The band is 120–320 ms and that is a decision rather than a preference: below
 * ~100 ms a transition is not perceived as motion at all (it reads as a jump),
 * and above ~350 ms an interface the user drives — a hover, a tab, a panel —
 * starts to feel like it is waiting for the animation to finish. `slow` is for
 * the two cases where a longer arc carries meaning: a panel travelling in from
 * off-screen, and a figure counting up to its value.
 */
export const DURATION = {
  /** A state that must feel instant: hover, focus, a pressed button. */
  instant: 120,
  /** The default for a colour, border or shadow change. */
  fast: 160,
  /** Entering content: a card, a row, a chip. */
  base: 220,
  /** A surface that travels: a drawer, a sheet, a dock. */
  slow: 320,
} as const;

export type DurationToken = keyof typeof DURATION;

/** The same steps in seconds, which is the unit Motion's `transition` wants. */
export const DURATION_S = {
  instant: DURATION.instant / 1000,
  fast: DURATION.fast / 1000,
  base: DURATION.base / 1000,
  slow: DURATION.slow / 1000,
} as const;

/**
 * Easing curves.
 *
 * `enter` decelerates (fast out of the gate, settling at the end) because
 * content arriving should feel like it was already on its way; `exit`
 * accelerates away, because content leaving should not ask to be watched.
 * `emphasis` overshoots slightly and is reserved for something the user just
 * caused — never for something that merely appeared.
 */
export const EASING = {
  enter: [0.22, 1, 0.36, 1],
  exit: [0.4, 0, 1, 1],
  standard: [0.4, 0, 0.2, 1],
  emphasis: [0.34, 1.56, 0.64, 1],
} as const satisfies Record<string, readonly [number, number, number, number]>;

export type EasingToken = keyof typeof EASING;

/** The CSS forms, for the transitions that are plain classes rather than Motion. */
export const EASING_CSS = {
  enter: 'cubic-bezier(0.22, 1, 0.36, 1)',
  exit: 'cubic-bezier(0.4, 0, 1, 1)',
  standard: 'cubic-bezier(0.4, 0, 0.2, 1)',
  emphasis: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
} as const;

/**
 * The spring used for surfaces the user drags into view — drawers, docks and
 * the rail's active indicator.
 *
 * Critically damped enough not to wobble: a panel that bounces reads as a toy,
 * and this product is used to sign off architecture decisions.
 */
export const SPRING = { type: 'spring', stiffness: 380, damping: 34, mass: 0.9 } as const;

/**
 * The transition every list, grid and panel entrance should use.
 *
 * Exported as an object rather than described in prose because the point is
 * that callers pass the *same* one — `transition={TRANSITION.enter}` — instead
 * of each inventing `{ duration: 0.3 }`.
 */
export const TRANSITION = {
  instant: { duration: DURATION_S.instant, ease: EASING.standard },
  fast: { duration: DURATION_S.fast, ease: EASING.standard },
  enter: { duration: DURATION_S.base, ease: EASING.enter },
  exit: { duration: DURATION_S.fast, ease: EASING.exit },
  surface: SPRING,
} as const;

/**
 * How long to wait between siblings in a staggered entrance.
 *
 * Small on purpose. A stagger exists to make a group read as a group; past
 * ~60 ms per item a row of six KPI cards takes half a second to finish
 * arriving, and the reader watches the animation instead of the numbers.
 */
export const STAGGER = 0.04;

/* -------------------------------------------------------------- elevation */

/**
 * The five depths, and what each one *means*.
 *
 * Depth is a statement about layering, not about importance: `card` is
 * something resting on the page, `floating` is something detached from it, and
 * `modal` is something that has taken the page away. A panel that wants
 * attention gets it from a tint or a border, never from being raised a step.
 */
export const ELEVATION = {
  /** Flush with the page. Table rows, inline groups, the mesh background. */
  base: 'shadow-none',
  /** Resting on the page. The default for a `Card`. */
  card: 'shadow-[0_1px_2px_rgba(15,23,42,0.05),0_1px_3px_rgba(15,23,42,0.04)]',
  /** Lifted: a hovered card, a highlighted panel, a selected row. */
  elevated: 'shadow-[0_2px_4px_rgba(15,23,42,0.05),0_8px_20px_-8px_rgba(15,23,42,0.14)]',
  /** Detached from the page: dropdowns, popovers, the command palette. */
  floating: 'shadow-[0_4px_8px_rgba(15,23,42,0.06),0_16px_40px_-12px_rgba(15,23,42,0.22)]',
  /** The page is behind it: drawers, dialogs, sheets. */
  modal: 'shadow-[0_8px_16px_rgba(15,23,42,0.08),0_32px_64px_-16px_rgba(15,23,42,0.32)]',
} as const;

export type ElevationToken = keyof typeof ELEVATION;

/* ----------------------------------------------------------------- radius */

/**
 * The radius scale, bound to control size rather than to taste.
 *
 * The rule: **a radius belongs to a size class, not to a component.** A chip
 * and a button of the same height must share one, or a toolbar of both reads as
 * two toolbars. Larger surfaces take a larger radius so the curvature stays
 * visually constant against the longer edge.
 */
export const RADIUS = {
  /** Chips, badges, dense tags. */
  xs: 'rounded-md',
  /** Inputs, small and medium buttons, list rows. */
  sm: 'rounded-lg',
  /** Icon tiles, segmented controls, inner panels. */
  md: 'rounded-xl',
  /** Cards and standalone panels — the product's signature radius. */
  lg: 'rounded-2xl',
  /** Hero surfaces and full-bleed regions. */
  xl: 'rounded-3xl',
  /** Avatars, dots, pill controls. */
  full: 'rounded-full',
} as const;

export type RadiusToken = keyof typeof RADIUS;

/* ------------------------------------------------------------- typography */

/**
 * The type scale, named by the job each step does on a screen.
 *
 * Named for the role and not for the size so that "section title" is one
 * decision made once, rather than `text-base font-semibold` in eleven files
 * that drift apart. Every step ships its own colour: an ink that varies per
 * screen is the fastest way to lose a hierarchy that the sizes established.
 */
export const TYPE = {
  /** The one number or word a hero surface exists to show. */
  display: 'text-3xl md:text-display-md font-bold tracking-tight text-gray-950 dark:text-gray-50',
  /** The `h1` of a screen. Exactly one per page. */
  pageTitle: 'text-2xl md:text-display-sm font-bold tracking-tight text-gray-900 dark:text-gray-50',
  /** The `h2` of a region within a screen. */
  sectionTitle: 'text-lg font-bold tracking-tight text-gray-900 dark:text-white',
  /** The `h3` of a card or panel. */
  cardTitle: 'text-base font-semibold leading-tight tracking-tight text-gray-900 dark:text-white',
  /** Running text. */
  body: 'text-sm leading-relaxed text-gray-600 dark:text-gray-300',
  /** Supporting detail under a title — quieter than body, same size. */
  metadata: 'text-xs leading-snug text-gray-500 dark:text-gray-400',
  /** The smallest readable step. Hints, counts, footnotes. */
  caption: 'text-2xs leading-snug text-gray-500 dark:text-gray-400',
  /** The uppercase eyebrow over a title or a stat. */
  label: 'text-2xs font-semibold uppercase tracking-widest-2 text-gray-500 dark:text-gray-400',
  /** The same eyebrow when it names an accent region. */
  labelAccent: 'text-2xs font-semibold uppercase tracking-widest-2 text-primary-600 dark:text-primary-400',
  /** Any figure. `tabular-nums` so a column of them does not jitter. */
  metric: 'font-bold tabular-nums tracking-tight text-gray-900 dark:text-gray-50',
} as const;

export type TypeToken = keyof typeof TYPE;

/* --------------------------------------------------------------- surfaces */

/**
 * The background/border pairs a panel can sit on, light and dark together.
 *
 * Dark mode is designed here rather than inverted: `page` is not `gray-50`
 * flipped, it is `gray-950`, and `sunken` in the light theme is *darker* than
 * the page while in the dark theme it is *lighter*. Inverting a light palette
 * gives a dark theme where recessed areas glow, which is the single most common
 * way a dark mode reads as an afterthought.
 */
export const SURFACE = {
  /** The page itself. */
  page: 'bg-gray-50 dark:bg-gray-950',
  /** A panel resting on the page. */
  raised: 'bg-white dark:bg-gray-900',
  /** A region recessed into a panel: a well, a code block, an inner list. */
  sunken: 'bg-gray-50 dark:bg-gray-950/60',
  /** A panel over content that must stay partly legible behind it. */
  overlay: 'bg-white/85 dark:bg-gray-900/85 backdrop-blur-md',
  /** The hairline every surface uses. */
  border: 'border border-gray-200 dark:border-gray-800',
  /** The quieter hairline, for divisions *inside* a panel. */
  borderSubtle: 'border-gray-100 dark:border-gray-800/70',
} as const;

export type SurfaceToken = keyof typeof SURFACE;

/**
 * The one focus ring in the product.
 *
 * Written once because a focus ring that varies by component is a keyboard user
 * relearning where they are on every screen. `focus-visible` rather than
 * `focus` so a mouse click does not leave a ring behind.
 */
export const FOCUS_RING =
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-950';

/** The same ring without an offset, for controls flush against their container. */
export const FOCUS_RING_INSET =
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500';

/**
 * The minimum hit area for anything a finger has to reach, per WCAG 2.2 AA
 * (2.5.8 Target Size, Minimum). Applied as a floor: a control may be visually
 * smaller as long as its target is not.
 */
export const TOUCH_TARGET = 'min-h-11 min-w-11';
