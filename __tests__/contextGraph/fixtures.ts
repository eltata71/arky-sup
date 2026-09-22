/**
 * Shared fixtures for the Architecture Context Graph test suite.
 * Not a spec file — vitest only collects `*.test.ts`.
 */

import type { Settings } from '../../types';
import type { Artifact } from '../../lib/artifacts';
import type { Project } from '../../services/architectureProjects';

export const makeArtifact = (over: Partial<Artifact> = {}): Artifact => ({
  id: 'art-1',
  versionGroupId: 'vg-1',
  version: 1,
  createdAt: '2026-05-01T00:00:00.000Z',
  name: 'Artefacto',
  type: 'markdown',
  phase: 'Diseño',
  architecturalView: 'Vista Lógica y de Diseño',
  content: '',
  objective: '',
  keyConcepts: [],
  representation: 'document',
  ...over,
});

export const makeSettings = (over: Partial<Settings> = {}): Settings => ({
  globalContext: [],
  language: 'es',
  theme: 'light',
  aiConfig: {
    model: 'gemini-2.5-flash',
    temperature: 0.5,
    tone: 'Profesional y Técnico',
    languageStyle: 'es',
    apiKeySource: 'global',
  },
  ...over,
});

export const makeProject = (over: Partial<Project> = {}): Project => ({
  id: 'proj-1',
  name: 'Plataforma de Seguros',
  description: '',
  projectContext: [],
  artifacts: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-05-01T00:00:00.000Z',
  ...over,
});

/** A reasonably rich project so packs have more than the minimal topK. */
export const makeRichProject = (over: Partial<Project> = {}): Project =>
  makeProject({
    name: 'Plataforma de Pólizas Digital',
    description:
      'Plataforma para gestionar pólizas y reclamaciones de seguros de salud. ' +
      'Backend en Node.js con PostgreSQL, mensajería con Apache Kafka y despliegue en AWS. ' +
      'El portal de clientes se integra con Stripe para los pagos.',
    projectContext: [
      'El sistema debe cumplir con HIPAA y SOC 2.',
      'Decidimos usar arquitectura de microservicios.',
      'Riesgo: la red hospitalaria puede tener caídas de disponibilidad.',
      'Restricción: el despliegue debe ser on-premise para los datos sensibles.',
      'Los administradores y operadores gestionan las reclamaciones.',
      'Se integra con Salesforce como CRM.',
    ],
    agentMemory: ['El equipo prefiere Redis como cache de sesiones.'],
    initialCapture: ['Operación inicial en México y Colombia.'],
    ...over,
  });
