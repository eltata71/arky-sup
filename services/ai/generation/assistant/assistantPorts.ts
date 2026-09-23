/**
 * What the assistant vertical needs to know about a conversation and a course,
 * declared here rather than imported (F5-01, corte 7).
 *
 * `services/chat` and the Training Center both import `services/ai`, so naming
 * their types from inside this layer would close a cycle — even a type-only
 * import counts, because it is still a dependency on what the type means.
 * These are the fields the prompts read and nothing else: `ChatMessage` and
 * `Course` satisfy them structurally, and a caller never converts anything.
 */

/** One turn of a conversation, as the prompts read it. */
export interface AssistantConversationTurn {
    role: 'user' | 'model';
    content: string;
}

/** What the general assistant reads from a Training Center course. */
export interface AssistantCourseSummary {
    title: string;
    description: string;
    category: string;
    level: string;
    modules?: ReadonlyArray<{
        lessons?: ReadonlyArray<{ title: string; description: string }>;
    }>;
}
