/**
 * The digest a compacted range of conversation is replaced by (F5-03).
 *
 * Two halves build one: `services/chat` writes it without a model
 * (`deterministicCompactionDigest`) and `services/ai` asks a model for it
 * (`compactChatMessages`). The compacting half used to live in `services/chat`
 * and import the AI layer, which put chat above the AI layer while the project
 * aggregate — below it — writes chat history: the edge that closed the domain
 * component. A contract with no behaviour that both halves need lives in a leaf.
 */
export interface CompactionDigest {
  /** Title summarising the compacted range. */
  title: string;
  /** Key decisions / conclusions worth preserving. */
  decisions: string[];
  /** Open questions or follow-ups discussed in the range. */
  openQuestions: string[];
  /** Topics covered — used both for the marker preview and for future search. */
  topics: string[];
  /** Free-form summary paragraph (≤ ~600 chars). */
  summary: string;
}
