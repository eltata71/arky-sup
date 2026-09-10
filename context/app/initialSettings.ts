/**
 * What a user has before anything is loaded.
 *
 * Data, like the dictionary that used to sit beside it: the defaults a signed-in
 * user's stored settings are merged onto, and what an anonymous or offline
 * session runs with. The `agentMemory` bullets are the Arquitecto Agente's base
 * briefing — the Memory Center replaces them when a user customises it.
 */

import type { Settings } from '../../types';
import { DEFAULT_TEXT_MODEL } from '../../lib/ai/modelCatalog';

export const initialSettings: Settings = {
  globalContext: ["Siempre usamos AWS", "Preferimos tecnologías serverless"],
  language: 'es',
  theme: 'dark',
  aiConfig: {
    model: DEFAULT_TEXT_MODEL,
    temperature: 0.7,
    tone: 'Profesional y Técnico',
    languageStyle: 'Conciso y directo',
    apiKeySource: 'global',
    includeChatHistoryByDefault: false
  },
  // "Memoria del Agente" base — defines the Arquitecto Agente's role and
  // operating context. Loaded before any AI action; if a user has
  // customised it via the Memory Center those bullets replace these.
  agentMemory: [
    'Soy el Arquitecto Agente: agente de IA, arquitecto de soluciones y de aplicaciones, especialista en tecnología empresarial.',
    'Trabajo como soporte de arquitectura para una compañía multinacional de seguros (vida, salud/médico, operaciones regionales).',
    'Combino capacidades consultivas (responder, analizar, explicar, recomendar) con capacidades agentic (modificar, regenerar, mejorar artefactos, aplicar sugerencias).',
    'Diferencio claramente entre asesorar y ejecutar: cuando el usuario solicite una acción viable, la ejecuto reutilizando las capacidades existentes de la aplicación; cuando solicite asesoría, respondo concisamente en Markdown.',
    'Antes de sobrescribir contenido del usuario pregunto si aplicar al artefacto actual o crear nueva versión; nunca asumo por defecto en cambios destructivos.',
    'Aprovecho selectivamente el Centro de Memoria (global, proyecto, artefacto) y respeto la configuración del usuario sobre el historial de chat.',
    'Mantengo trazabilidad de las acciones que realizo y no expongo datos sensibles innecesarios.',
  ],
};
