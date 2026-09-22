/**
 * Mantener el documento de historial por debajo del límite de Firestore.
 *
 * Estaba en `services/firestoreService.ts` aunque la compactación —
 * `deterministicCompactionDigest`— siempre ha sido de este módulo. Un contexto
 * que no puede decir cómo se guardan sus propios datos es una carpeta.
 *
 * `saveHistory` reescribe el array `messages[]` entero en un documento en cada
 * guardado. Sin tope, una conversación larga se va derecha contra el muro de
 * 1 MiB y a partir de ahí simplemente deja de guardarse. Los artefactos
 * recibieron una guarda de tamaño en el endurecimiento de la persistencia;
 * este documento nunca la tuvo.
 *
 * Los turnos más antiguos se colapsan en un marcador de compactación que la UI
 * ya sabe pintar (`ChatMessageMeta.kind === 'compaction'`). El resumen es el
 * **determinista** a propósito: un camino de persistencia no puede depender de
 * una llamada al modelo — haría que guardar fallara cuando el proveedor está
 * caído, y gastaría tokens en cada autoguardado.
 */

import type { ChatMessage } from './ChatTypes';
import { observabilityService } from '../observability';
// The leaf, not the compactor: this module is reachable from the boot path and
// `chatCompactor` imports the AI layer. See `compactionDigest.ts`.
import { deterministicCompactionDigest } from './compactionDigest';
import { estimateBytes } from '../../lib/jsonSafe';

const CHAT_HISTORY_BUDGET_BYTES = 400_000;
/** Recent turns always kept verbatim, so compaction never eats live context. */
const CHAT_HISTORY_KEEP_RECENT = 30;

/**
 * Keep the chat-history row under a declared budget.
 *
 * `saveChatHistory` rewrites the whole `messages[]` array on every save. The
 * original reason for a cap was Firestore's 1 MiB per document; PostgreSQL has
 * no such wall, and the cap stays anyway because the *product* reason outlived
 * the provider: an unbounded history is one nobody can reread, one that costs a
 * full round trip on every autosave, and one that would be sent to a model as
 * context.
 *
 * The oldest turns collapse into a compaction marker, which the UI already
 * knows how to render (`ChatMessageMeta.kind === 'compaction'`). The digest is
 * the **deterministic** one on purpose: a persistence path must not depend on a
 * model call — it would make saving fail when the provider is down, and it
 * would spend tokens on every autosave.
 */
export const capChatHistoryForPersistence = (
    projectId: string,
    messages: ChatMessage[],
): ChatMessage[] => {
    if (estimateBytes(messages) <= CHAT_HISTORY_BUDGET_BYTES) return messages;

    let recent = messages.slice(-CHAT_HISTORY_KEEP_RECENT);
    let older = messages.slice(0, messages.length - recent.length);

    // A single enormous turn can exceed the budget on its own; shrink the tail
    // rather than emitting a document that still will not fit.
    while (recent.length > 1 && estimateBytes(recent) > CHAT_HISTORY_BUDGET_BYTES) {
        older = messages.slice(0, messages.length - recent.length + 1);
        recent = recent.slice(1);
    }

    const digest = deterministicCompactionDigest(older);
    const marker: ChatMessage = {
        role: 'model',
        content: digest.summary,
        timestamp: new Date().toISOString(),
        meta: {
            kind: 'compaction',
            compactedCount: older.length,
            compactedRange: {
                start: older[0]?.timestamp ?? '',
                end: older[older.length - 1]?.timestamp ?? '',
            },
        },
    };

    observabilityService.recordWarning({
        source: 'operation',
        title: 'Historial de chat compactado al guardar',
        message: `Se compactaron ${older.length} mensaje(s) para mantener el documento por debajo del límite de Firestore.`,
        metadata: { projectId, compacted: older.length, kept: recent.length },
        recoverable: true,
        userVisible: false,
    });

    return [marker, ...recent];
};
