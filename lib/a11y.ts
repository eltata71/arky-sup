/**
 * The accessibility rules this codebase enforces, written down once.
 *
 * These are not style preferences. Each one names a defect that was found in
 * the running app with a screen reader, and the reasoning that makes the fix
 * non-obvious — so the next person does not reintroduce it.
 *
 * ## 1 · `title` is not an accessibility affordance
 *
 * When an element already has an accessible **name** — from its own text, from
 * `aria-label`, or from `aria-labelledby` — a `title` attribute becomes its
 * accessible **description**. VoiceOver announces the name and then the
 * description, so `<h1 title={name}>{name}</h1>` is read twice, and a button
 * carrying both `aria-label="Vista de lista"` and `title="Vista de lista"` is
 * read twice. This was the single largest source of duplicated speech in the
 * app, across 28 elements.
 *
 * The trap is that `title` *looks* helpful: on truncated text it gives mouse
 * users the full string. But CSS truncation does not remove the text from the
 * DOM — a screen reader already reads all of it — so the `title` adds nothing
 * for assistive technology and costs a second announcement. Where the hover
 * affordance genuinely matters, use `components/ui/Tooltip`, which is built to
 * stay silent (see rule 2).
 *
 * The one place `title` is still correct is an element with **no** other name,
 * where the title *is* the name. Prefer `aria-label` even there: it is not
 * shown on hover as a competing, differently-styled tooltip, and it survives
 * touch, where `title` never appears at all.
 *
 * ## 2 · A visual tooltip must not be a second announcement
 *
 * `Tooltip` renders its bubble as a sibling of the trigger. Because the
 * trigger already carries the same text as its accessible name, the bubble is
 * marked `aria-hidden`: it is a *visual* restatement for pointer users, and
 * announcing it would repeat what was just spoken.
 *
 * ## 3 · A stretched overlay must not become a second name
 *
 * The card pattern where an absolutely-positioned button covers the whole
 * surface gives pointer users a large target. Left focusable, it also gives
 * assistive technology a control named after the card, immediately followed by
 * the card's own text — the same content, twice. So the overlay is
 * `aria-hidden` and removed from the tab order, and the card's **title** is the
 * real control. Keyboard and screen-reader users reach the title; pointer users
 * still get the large target.
 *
 * ## 4 · A labelled graphic hides its own internals
 *
 * An `<svg role="img" aria-label="…">` promises that the label describes the
 * whole graphic. Any text inside it — including HTML inside `<foreignObject>` —
 * would otherwise be announced after that label, restating the picture the
 * label just summarised. The internals are therefore `aria-hidden`, and the
 * information they carry is available as real text elsewhere in the DOM.
 *
 * ## 5 · A placeholder is not a second label
 *
 * `<input aria-label="Buscar proyectos…" placeholder="Buscar por nombre o
 * descripción">` is announced as the name *and then* the placeholder — one
 * field, read twice. The remedy is to make them identical, which is really a
 * statement about which one is the label: in a compact row the visible
 * placeholder is what a sighted user reads, so that string is the name. Where
 * the short placeholder was too vague to stand alone ("Base"), the placeholder
 * grows rather than the name shrinking — the field is wide enough and every
 * reader gains.
 *
 * ## 6 · Visible text is not also a description
 *
 * `aria-describedby` pointing at content that is *also* rendered makes
 * VoiceOver read it on entering the container and again on reaching it. The
 * dialog subtitle is therefore ordinary visible text: the reader still hears
 * it, once, in document order. Reserve `aria-describedby` for text that is not
 * otherwise reachable.
 *
 * ## 7 · Decorative repetition
 *
 * An icon next to its own label is decorative (`aria-hidden`), and a component
 * that renders an `sr-only` name must not be placed next to a visible copy of
 * that same name. `PersonaAvatar` takes a `decorative` prop for exactly this.
 */

/**
 * Props for a purely visual element that restates something already announced.
 *
 * Using this instead of writing `aria-hidden` by hand makes the intent legible
 * at the call site: the element is not being hidden because it is unimportant,
 * but because announcing it would duplicate.
 */
export const DECORATIVE = { 'aria-hidden': true } as const;

/**
 * Props for the pointer-only overlay of a stretched-link card (rule 3).
 *
 * Removes the overlay from both the accessibility tree and the tab order, so
 * the card's real control — its title — is the single announced affordance.
 */
export const POINTER_ONLY_OVERLAY = { 'aria-hidden': true, tabIndex: -1 } as const;
