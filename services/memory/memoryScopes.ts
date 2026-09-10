/**
 * services/memory/memoryScopes — the memory-scope catalogue.
 *
 * The Centro de Memoria organises notes into seven scopes. Each scope is a
 * first-class domain concept (the model exists in `types.MemoryScope`); the
 * catalogue below carries the human-facing label and description for each one.
 * It lives apart from the component so a scope, its wording and its meaning
 * are defined once and shared by the sidebar, the header and any future
 * consumer — the UI renders the catalogue, it does not own it.
 *
 * Pure module: no I/O, no React, no Gemini. The Spanish labels follow the
 * same convention as `lib/eaTerminology.ts`: user-facing copy in a dedicated
 * leaf module, single source of truth.
 */
import type { MemoryScope } from '../../types';

export interface MemoryScopeDefinition {
  id: MemoryScope;
  label: string;
  description: string;
}

export const MEMORY_SCOPES: readonly MemoryScopeDefinition[] = [
  {
    id: 'agent-base',
    label: 'Memoria del Agente (Base)',
    description: 'Define identidad, rol y restricciones del Arquitecto Agente. Se carga ANTES de cualquier acción de IA.',
  },
  {
    id: 'global',
    label: 'Memoria Global de la App',
    description: 'Reglas, estándares y preferencias aplicables a TODOS los proyectos del usuario.',
  },
  {
    id: 'agent',
    label: 'Memoria del Agente (Proyecto)',
    description: 'Lecciones, decisiones y preferencias que el agente debe recordar específicamente para este proyecto.',
  },
  {
    id: 'project',
    label: 'Contexto del Proyecto',
    description: 'Notas específicas del proyecto que la IA usa al generar artefactos.',
  },
  {
    id: 'initial-capture',
    label: 'Captura Inicial',
    description: 'Información clave registrada al crear el proyecto: objetivos, alcance y stakeholders.',
  },
  {
    id: 'artifact',
    label: 'Contexto por Artefacto',
    description: 'Notas asociadas a un artefacto individual del proyecto.',
  },
  {
    id: 'chat-history',
    label: 'Historial de Chats',
    description: 'Gestiona, filtra, depura o compacta las conversaciones con el Arquitecto Agente.',
  },
];