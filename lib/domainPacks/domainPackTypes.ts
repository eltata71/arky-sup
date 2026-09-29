/**
 * What an industry knows, declared once (plan de diagramas, 6.4).
 *
 * Health-insurance knowledge used to live in two places that did not know
 * about each other: a validator that ran after generation with its own
 * regular expressions, and a prompt that mentioned HIPAA in passing. The
 * model was never told what a claim flow looks like, and then was graded on
 * whether it drew one. Life insurance was in neither.
 *
 * A pack is the single source both read: the prompt gets its entities,
 * flows, standards and data rules; the validator gets its detectors. It is
 * data with no behaviour, so it lives in a leaf.
 */

/** A term the pack recognises, and the word it is reported by. */
export interface DomainTerm {
    label: string;
    pattern: RegExp;
}

export interface DomainStandard {
    name: string;
    /** When to use it — a standard named without its use is decoration. */
    use: string;
}

export interface DomainPack {
    id: 'health-insurance' | 'life-insurance';
    /** How the prompt and the trace name it. */
    name: string;
    /**
     * Terms that activate the pack. A regulatory term activates it from an
     * initiative on its own; two distinct vocabulary terms are needed
     * anywhere else, so one passing word does not reshape a diagram.
     */
    regulatoryTerms: readonly DomainTerm[];
    vocabulary: readonly DomainTerm[];
    entities: readonly string[];
    flows: readonly string[];
    standards: readonly DomainStandard[];
    dataRules: readonly string[];
}
