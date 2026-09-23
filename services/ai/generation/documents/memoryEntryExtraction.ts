/**
 * Read an uploaded document into short memory entries for one scope. Moved out
 * of the engine in F5-01 (corte 5). The model's answer is not trusted: only
 * strings survive, trimmed, capped at 400 characters and 50 entries, and a
 * response that does not parse yields no entries rather than an error.
 */
import type { Settings } from '../../../../types';
import { cleanJsonString } from '../../../../utils';
import { resolveModelForSettings } from '../../catalog';
import { aiGateway } from '../aiGateway';

/**
 * Extrae apuntes/notas relevantes desde un documento subido por el usuario
 * para alimentar al Centro de Memoria. Devuelve una lista corta y depurada
 * de bullets listos para añadirse como entradas de memoria en el ámbito
 * solicitado (global, proyecto, agente, captura inicial, artefacto).
 */
export async function extractMemoryEntriesFromDocument(
    file: { name: string; type: string; base64Data: string },
    scope: 'global' | 'project' | 'agent' | 'initial-capture' | 'artifact',
    contextHint: string,
    settings: Settings,
): Promise<string[]> {
    const scopeGuidance: Record<typeof scope, string> = {
        'global': 'estándares corporativos, tecnologías preferidas, principios técnicos aplicables a TODOS los proyectos',
        'project': 'requisitos, restricciones, decisiones y supuestos específicos del proyecto actual',
        'agent': 'preferencias del usuario, lecciones aprendidas y reglas que el agente debe recordar para este proyecto',
        'initial-capture': 'información inicial relevante capturada al crear el proyecto: objetivos, alcance, stakeholders, riesgos iniciales',
        'artifact': 'notas, requisitos o restricciones específicas para el artefacto indicado',
    };

    const prompt = `Eres un analista experto en arquitectura de software para una compañía de seguros de Vida y Salud.
Analiza el documento adjunto y extrae únicamente los apuntes, hechos, decisiones y notas RELEVANTES para alimentar la memoria del agente en el ámbito: "${scope}".

Foco del ámbito: ${scopeGuidance[scope]}.

Contexto adicional del usuario:
${contextHint || '(sin contexto adicional)'}

Reglas estrictas:
- NO copies texto literal del documento. Interpreta, resume y reescribe cada apunte en una sola línea clara.
- Cada entrada debe ser autocontenida, accionable o informativa, NO ambigua, máximo 220 caracteres.
- Evita redundancias; agrupa ideas equivalentes.
- Descarta marketing, introducciones, índices, tablas de contenidos y agradecimientos.
- Si el documento no aporta nada relevante para el ámbito, devuelve un array vacío.
- Devuelve EXCLUSIVAMENTE JSON válido con la forma: {"entries": ["..."]}. Sin texto adicional, sin markdown.`;

    const modelName = resolveModelForSettings('default', settings).id;

    const result = await aiGateway.generateContent(
        settings,
        modelName,
        [
            {
                role: 'user',
                parts: [
                    { text: prompt },
                    { inlineData: { mimeType: file.type || 'application/octet-stream', data: file.base64Data } },
                ],
            },
        ],
        {
            temperature: 0.3,
            responseMimeType: 'application/json',
        },
        { maxRetries: 1 },
    );

    const cleaned = cleanJsonString(result.text || '{"entries":[]}');
    try {
        const parsed = JSON.parse(cleaned) as { entries?: unknown };
        const raw = Array.isArray(parsed.entries) ? parsed.entries : [];
        return raw
            .filter((item): item is string => typeof item === 'string')
            .map(item => item.trim())
            .filter(item => item.length > 0 && item.length <= 400)
            .slice(0, 50);
    } catch (error) {
        console.error('extractMemoryEntriesFromDocument: failed to parse JSON', error);
        return [];
    }
}
