/**
 * La captura asistida, ya montada para cada nivel de la jerarquía.
 *
 * Sin esto cada pantalla repetía las mismas cuatro líneas —el hook, el
 * contexto memoizado, el enlace para los paneles y la lista de lo que falta— y
 * las repetía distinto: la creación y el mantenimiento de una iniciativa
 * acabaron contando de forma diferente qué campos estaban pendientes, que es
 * exactamente el tipo de divergencia que el usuario percibe como que «a veces
 * el botón hace otra cosa».
 *
 * También es lo que mantiene bajo el fan-out de las pantallas: seis
 * formularios entran a la asistencia por un hook en vez de importar dos
 * módulos de dominio cada uno. La regla del gate —una pantalla usa capacidades,
 * no *es* la capa de aplicación— se cumple aquí en lugar de en cada `.tsx`.
 */

import { useMemo } from 'react';
import { useCaptureAssistant, type CaptureAssistantApi } from './useCaptureAssistant';
import {
  attentionCaptureSubject,
  captureContextForAttention,
  captureContextForDeliverable,
  captureContextForInitiative,
  pendingFieldsForAttention,
  pendingFieldsForDeliverable,
  initiativeCaptureSubject,
  pendingFieldsForInitiative,
  type AttentionCaptureSubject,
  type DeliverableCaptureSubject,
  type InitiativeCaptureSubject,
} from '../services/architectureOffice';
import type { BusinessInitiative } from '../services/businessInitiatives';
import type { Project } from '../types';
import type { CaptureContext, CaptureFieldId } from '../lib/capture';

export interface LevelCapture {
  assistant: CaptureAssistantApi;
  /** `null` cuando todavía no hay de dónde partir; el botón lo dice y no llama. */
  context: CaptureContext | null;
  /** Lo que los paneles y los campos reciben tal cual. */
  binding: { assistant: CaptureAssistantApi; context: CaptureContext | null };
  pendingFields: CaptureFieldId[];
  /** Pide de una vez todo lo que falta. No escribe nada: rellena las propuestas. */
  askForm: () => void;
  formLoading: boolean;
}

const useLevelCapture = (
  context: CaptureContext,
  pendingFields: CaptureFieldId[],
  enabled: boolean,
): LevelCapture => {
  const assistant = useCaptureAssistant();
  const scopedContext = enabled ? context : null;
  const binding = useMemo(
    () => ({ assistant, context: scopedContext }),
    [assistant, scopedContext],
  );
  return {
    assistant,
    context: scopedContext,
    binding,
    pendingFields,
    askForm: () => {
      if (!scopedContext || pendingFields.length === 0) return;
      void assistant.askForm(pendingFields, scopedContext);
    },
    formLoading: assistant.pendingField === 'form',
  };
};

/** Iniciativa de negocio — en su diálogo de creación y en su sala. */
export const useInitiativeCapture = (subject: InitiativeCaptureSubject): LevelCapture => {
  const context = useMemo(() => captureContextForInitiative(subject), [subject]);
  const pending = useMemo(() => pendingFieldsForInitiative(subject), [subject]);
  // La necesidad es de lo que parte todo lo demás: sin ella cualquier propuesta
  // sería genérica, y una propuesta genérica ocupa el sitio de una buena.
  return useLevelCapture(context, pending, Boolean(subject.need?.trim()));
};

/** Proyecto de arquitectura — la atención, con las iniciativas que responde. */
export const useAttentionCapture = (
  subject: AttentionCaptureSubject,
  parents: readonly BusinessInitiative[],
): LevelCapture => {
  const context = useMemo(() => captureContextForAttention(subject, parents), [subject, parents]);
  const pending = useMemo(() => pendingFieldsForAttention(subject), [subject]);
  // Con una iniciativa arriba ya hay de dónde partir aunque el proyecto esté
  // en blanco: ése es justo el momento en que la ayuda más vale.
  return useLevelCapture(context, pending, parents.length > 0 || Boolean(subject.name?.trim()));
};

/** Solicitud de entregable — con su proyecto y las iniciativas que sirve. */
export const useDeliverableCapture = (
  subject: DeliverableCaptureSubject,
  attention: { name?: string; description?: string; context?: string[] } | undefined,
  parents: readonly BusinessInitiative[],
): LevelCapture => {
  const context = useMemo(
    () => captureContextForDeliverable(subject, attention, parents),
    [subject, attention, parents],
  );
  const pending = useMemo(() => pendingFieldsForDeliverable(subject), [subject]);
  return useLevelCapture(
    context,
    pending,
    Boolean(attention?.name) || parents.length > 0 || Boolean(subject.title?.trim()),
  );
};

/**
 * Las dos variantes que parten del agregado guardado, para las pantallas de
 * mantenimiento.
 *
 * El mapeo del agregado al sujeto de captura vive en el dominio y se llama
 * desde aquí, no desde la pantalla: una sala que lo hiciera a mano decidiría,
 * de paso, qué partes de su registro ve el asistente.
 */
export const useInitiativeRecordCapture = (
  initiative: BusinessInitiative | undefined,
): LevelCapture => {
  const subject = useMemo(
    () => (initiative ? initiativeCaptureSubject(initiative) : {}),
    [initiative],
  );
  return useInitiativeCapture(subject);
};

export const useAttentionRecordCapture = (
  project: Project | undefined,
  initiatives: readonly BusinessInitiative[],
): LevelCapture => {
  const subject = useMemo(
    () => (project ? attentionCaptureSubject(project) : {}),
    [project],
  );
  const parents = useMemo(
    () => initiatives.filter((candidate) => (project?.initiativeIds ?? []).includes(candidate.id)),
    [initiatives, project],
  );
  return useAttentionCapture(subject, parents);
};
