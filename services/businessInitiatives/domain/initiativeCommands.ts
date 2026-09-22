/**
 * Lo que se le puede hacer a una Iniciativa, dicho con su nombre (F3-05).
 *
 * Hasta aquí había una sola operación: `updateInitiative(id, patch)`, con un
 * `Partial<BusinessInitiative>` que cada panel de React construía a mano. Dos
 * consecuencias, y las dos eran reglas de negocio escritas en componentes:
 *
 *  - **Las reglas vivían en el panel.** Registrar el valor de un indicador
 *    fechaba la medición; marcar un hito como cumplido fechaba su cierre; un
 *    hito nuevo se insertaba en orden. Cada una en un `useCallback` distinto,
 *    y sólo comprobable renderizando.
 *  - **Un parche no dice qué pasó.** `{ kpis: [...] }` puede ser añadir,
 *    quitar o medir; el rastro, la validación y el mensaje de error no pueden
 *    distinguirlo.
 *
 * Aquí cada operación tiene nombre, se valida entera y devuelve un resultado
 * tipado: una iniciativa nueva, o un rechazo que la pantalla muestra. No hay
 * E/S, ni React, ni reloj implícito — `now` y la acuñación de ids entran por
 * `options`, así que las pruebas no necesitan un solo mock.
 *
 * Lo que **no** está, a propósito: editar el título o la necesidad. La
 * necesidad es lo que el negocio dijo, y una vez guardada es el registro
 * (CLAUDE.md, *Assisted capture*, regla 4); una necesidad distinta es otra
 * iniciativa.
 */

import type {
  BusinessInitiative,
  InitiativeDocument,
  InitiativeHorizon,
  InitiativeKpi,
  InitiativeMilestone,
  InitiativeMilestoneStatus,
  InitiativePriority,
  InitiativeRisk,
  InitiativeRiskLevel,
  InitiativeStakeholder,
  InitiativeStakeholderKind,
  InitiativeStatus,
} from './BusinessInitiativeTypes';
import {
  newKpiId,
  newMilestoneId,
  newOutcomeId,
  newRiskId,
  newStakeholderId,
} from './initiativeIdentity';

/** Un indicador tal y como se propone, antes de tener id. */
export interface ProposedKpi {
  readonly name: string;
  readonly unit: string;
  readonly baseline?: number;
  readonly target?: number;
}

/** Un riesgo tal y como se propone, antes de tener id. */
export interface ProposedRisk {
  readonly description: string;
  readonly level: InitiativeRiskLevel;
  readonly mitigation?: string;
}

/** Un resultado esperado tal y como se propone, antes de tener id. */
export interface ProposedOutcome {
  readonly statement: string;
  readonly measure?: string;
}

export type InitiativeCommand =
  | {
      readonly kind: 'reclassify';
      readonly status?: InitiativeStatus;
      readonly priority?: InitiativePriority;
      readonly horizon?: InitiativeHorizon;
      readonly riskLevel?: InitiativeRiskLevel;
    }
  | { readonly kind: 'restate-driver'; readonly driver: string }
  /** `null` borra la fecha; ausente la deja como está. */
  | { readonly kind: 'reschedule'; readonly startDate?: string | null; readonly targetEndDate?: string | null }
  | { readonly kind: 'add-objective'; readonly objective: string }
  | { readonly kind: 'remove-objective'; readonly index: number }
  | ({ readonly kind: 'add-outcome' } & ProposedOutcome)
  | { readonly kind: 'remove-outcome'; readonly outcomeId: string }
  | ({ readonly kind: 'add-kpi' } & ProposedKpi)
  /** `value` ausente borra la medición. */
  | { readonly kind: 'record-kpi-measurement'; readonly kpiId: string; readonly value?: number }
  | { readonly kind: 'remove-kpi'; readonly kpiId: string }
  | { readonly kind: 'add-milestone'; readonly name: string; readonly dueAt: string }
  | { readonly kind: 'set-milestone-status'; readonly milestoneId: string; readonly status: InitiativeMilestoneStatus }
  | { readonly kind: 'remove-milestone'; readonly milestoneId: string }
  | ({ readonly kind: 'add-risk' } & ProposedRisk)
  | { readonly kind: 'remove-risk'; readonly riskId: string }
  | {
      readonly kind: 'add-stakeholder';
      readonly name: string;
      readonly role: string;
      readonly stakeholderKind: InitiativeStakeholderKind;
      readonly email?: string;
    }
  | { readonly kind: 'remove-stakeholder'; readonly stakeholderId: string }
  /** El documento llega con id: el archivo ya se subió con él en la ruta. */
  | { readonly kind: 'attach-document'; readonly document: InitiativeDocument }
  | { readonly kind: 'remove-document'; readonly documentId: string }
  /**
   * Lo que el asistente propuso al crear la iniciativa, aceptado por quien la
   * crea. Es una sola operación porque es una sola decisión.
   */
  | {
      readonly kind: 'adopt-intake-draft';
      readonly outcomes: readonly ProposedOutcome[];
      readonly kpis: readonly ProposedKpi[];
      readonly risks: readonly ProposedRisk[];
      readonly affectedCapabilities: readonly string[];
      readonly regulatoryDrivers: readonly string[];
      readonly openQuestions: readonly string[];
    };

export type InitiativeCommandKind = InitiativeCommand['kind'];

export type InitiativeCommandRejectionCode = 'empty' | 'not-found' | 'invalid-date' | 'invalid-document';

export interface InitiativeCommandRejection {
  readonly code: InitiativeCommandRejectionCode;
  readonly message: string;
}

export type InitiativeCommandResult =
  | { readonly ok: true; readonly initiative: BusinessInitiative }
  | { readonly ok: false; readonly rejection: InitiativeCommandRejection };

export interface InitiativeCommandOptions {
  /** Costura para pruebas. Por defecto, ahora. */
  readonly now?: string;
}

const reject = (code: InitiativeCommandRejectionCode, message: string): InitiativeCommandResult =>
  ({ ok: false, rejection: { code, message } });

const isIsoDate = (value: string): boolean => !Number.isNaN(Date.parse(value));

const toIso = (value: string): string => new Date(value).toISOString();

/** Lo que cambia, con `updatedAt` puesto: la marca de la última operación. */
const withChanges = (
  initiative: BusinessInitiative,
  changes: Partial<BusinessInitiative>,
  now: string,
): InitiativeCommandResult => ({ ok: true, initiative: { ...initiative, ...changes, updatedAt: now } });

/** Quita un elemento por id, o dice que no estaba. */
const without = <T extends { readonly id: string }>(
  items: readonly T[],
  id: string,
  noun: string,
): { ok: true; items: T[] } | { ok: false; result: InitiativeCommandResult } => {
  if (!items.some((item) => item.id === id)) {
    return { ok: false, result: reject('not-found', `${noun} ya no existe en la iniciativa.`) };
  }
  return { ok: true, items: items.filter((item) => item.id !== id) };
};

const toKpi = (proposal: ProposedKpi): InitiativeKpi | null => {
  const name = proposal.name.trim();
  if (!name) return null;
  return { id: newKpiId(), name, unit: proposal.unit.trim(), baseline: proposal.baseline, target: proposal.target };
};

const toRisk = (proposal: ProposedRisk): InitiativeRisk | null => {
  const description = proposal.description.trim();
  if (!description) return null;
  return {
    id: newRiskId(),
    description,
    level: proposal.level,
    mitigation: proposal.mitigation?.trim() || undefined,
  };
};

const toOutcome = (proposal: ProposedOutcome) => {
  const statement = proposal.statement.trim();
  if (!statement) return null;
  return { id: newOutcomeId(), statement, measure: proposal.measure?.trim() || undefined };
};

const defined = <T>(items: readonly (T | null)[]): T[] => items.filter((item): item is T => item !== null);

/** Aplica una operación. Pura: no escribe, no lee, no pregunta la hora si se le da. */
export const applyInitiativeCommand = (
  initiative: BusinessInitiative,
  command: InitiativeCommand,
  options: InitiativeCommandOptions = {},
): InitiativeCommandResult => {
  const now = options.now ?? new Date().toISOString();

  switch (command.kind) {
    case 'reclassify': {
      const changes: Partial<BusinessInitiative> = {};
      if (command.status) changes.status = command.status;
      if (command.priority) changes.priority = command.priority;
      if (command.horizon) changes.horizon = command.horizon;
      if (command.riskLevel) changes.riskLevel = command.riskLevel;
      return withChanges(initiative, changes, now);
    }

    case 'restate-driver':
      return withChanges(initiative, { driver: command.driver.trim() }, now);

    case 'reschedule': {
      const changes: Partial<BusinessInitiative> = {};
      for (const field of ['startDate', 'targetEndDate'] as const) {
        const value = command[field];
        if (value === undefined) continue;
        if (value === null || value === '') {
          changes[field] = undefined;
        } else if (!isIsoDate(value)) {
          return reject('invalid-date', 'La fecha no es válida.');
        } else {
          changes[field] = toIso(value);
        }
      }
      return withChanges(initiative, changes, now);
    }

    case 'add-objective': {
      const objective = command.objective.trim();
      if (!objective) return reject('empty', 'Un objetivo necesita texto.');
      return withChanges(initiative, { objectives: [...initiative.objectives, objective] }, now);
    }

    case 'remove-objective': {
      if (command.index < 0 || command.index >= initiative.objectives.length) {
        return reject('not-found', 'Ese objetivo ya no existe en la iniciativa.');
      }
      return withChanges(initiative, {
        objectives: initiative.objectives.filter((_, position) => position !== command.index),
      }, now);
    }

    case 'add-outcome': {
      const outcome = toOutcome(command);
      if (!outcome) return reject('empty', 'Un resultado esperado necesita un enunciado.');
      return withChanges(initiative, { expectedOutcomes: [...initiative.expectedOutcomes, outcome] }, now);
    }

    case 'remove-outcome': {
      const next = without(initiative.expectedOutcomes, command.outcomeId, 'El resultado esperado');
      return next.ok ? withChanges(initiative, { expectedOutcomes: next.items }, now) : next.result;
    }

    case 'add-kpi': {
      const kpi = toKpi(command);
      if (!kpi) return reject('empty', 'Un indicador necesita nombre.');
      return withChanges(initiative, { kpis: [...initiative.kpis, kpi] }, now);
    }

    case 'record-kpi-measurement': {
      if (!initiative.kpis.some((kpi) => kpi.id === command.kpiId)) {
        return reject('not-found', 'El indicador ya no existe en la iniciativa.');
      }
      // Una medición sin fecha no se puede poner en una serie; borrar la
      // medición borra también su fecha, para no fechar un valor que no está.
      const measuredAt = command.value === undefined ? undefined : now;
      return withChanges(initiative, {
        kpis: initiative.kpis.map((kpi) => (kpi.id === command.kpiId
          ? { ...kpi, current: command.value, measuredAt }
          : kpi)),
      }, now);
    }

    case 'remove-kpi': {
      const next = without(initiative.kpis, command.kpiId, 'El indicador');
      return next.ok ? withChanges(initiative, { kpis: next.items }, now) : next.result;
    }

    case 'add-milestone': {
      const name = command.name.trim();
      if (!name) return reject('empty', 'Un hito necesita nombre.');
      if (!command.dueAt || !isIsoDate(command.dueAt)) return reject('invalid-date', 'Un hito necesita una fecha válida.');
      const milestone: InitiativeMilestone = { id: newMilestoneId(), name, dueAt: toIso(command.dueAt), status: 'pending' };
      // Los hitos se leen como un calendario: el orden es por fecha, no por
      // el momento en que alguien se acordó de apuntarlos.
      return withChanges(initiative, {
        milestones: [...initiative.milestones, milestone].sort((a, b) => a.dueAt.localeCompare(b.dueAt)),
      }, now);
    }

    case 'set-milestone-status': {
      if (!initiative.milestones.some((milestone) => milestone.id === command.milestoneId)) {
        return reject('not-found', 'El hito ya no existe en la iniciativa.');
      }
      // Sólo un hito cumplido tiene fecha de cierre; volver a otro estado la quita.
      return withChanges(initiative, {
        milestones: initiative.milestones.map((milestone) => (milestone.id === command.milestoneId
          ? { ...milestone, status: command.status, completedAt: command.status === 'met' ? now : undefined }
          : milestone)),
      }, now);
    }

    case 'remove-milestone': {
      const next = without(initiative.milestones, command.milestoneId, 'El hito');
      return next.ok ? withChanges(initiative, { milestones: next.items }, now) : next.result;
    }

    case 'add-risk': {
      const risk = toRisk(command);
      if (!risk) return reject('empty', 'Un riesgo necesita descripción.');
      return withChanges(initiative, { risks: [...initiative.risks, risk] }, now);
    }

    case 'remove-risk': {
      const next = without(initiative.risks, command.riskId, 'El riesgo');
      return next.ok ? withChanges(initiative, { risks: next.items }, now) : next.result;
    }

    case 'add-stakeholder': {
      const name = command.name.trim();
      if (!name) return reject('empty', 'Una persona necesita nombre.');
      const stakeholder: InitiativeStakeholder = {
        id: newStakeholderId(),
        name,
        role: command.role.trim(),
        kind: command.stakeholderKind,
        email: command.email?.trim() || undefined,
      };
      return withChanges(initiative, { stakeholders: [...initiative.stakeholders, stakeholder] }, now);
    }

    case 'remove-stakeholder': {
      const next = without(initiative.stakeholders, command.stakeholderId, 'La persona');
      return next.ok ? withChanges(initiative, { stakeholders: next.items }, now) : next.result;
    }

    case 'attach-document': {
      const { document } = command;
      // Un documento sin enlace, sin contenido y sin archivo es una fila vacía:
      // ocupa la lista y abre a nada. La misma regla que aplica la lectura.
      if (!document.name.trim() || (!document.url && !document.content?.trim() && !document.file)) {
        return reject('invalid-document', 'Un documento necesita nombre y un enlace, un contenido o un archivo.');
      }
      if (initiative.documents.some((item) => item.id === document.id)) {
        return reject('invalid-document', 'Ese documento ya está adjunto.');
      }
      return withChanges(initiative, { documents: [...initiative.documents, document] }, now);
    }

    case 'remove-document': {
      const next = without(initiative.documents, command.documentId, 'El documento');
      return next.ok ? withChanges(initiative, { documents: next.items }, now) : next.result;
    }

    case 'adopt-intake-draft':
      return withChanges(initiative, {
        expectedOutcomes: [...initiative.expectedOutcomes, ...defined(command.outcomes.map(toOutcome))],
        kpis: [...initiative.kpis, ...defined(command.kpis.map(toKpi))],
        risks: [...initiative.risks, ...defined(command.risks.map(toRisk))],
        affectedCapabilities: [...command.affectedCapabilities],
        regulatoryDrivers: [...command.regulatoryDrivers],
        // Lo que el asistente no pudo deducir queda escrito donde se ve, en vez
        // de perderse: es trabajo pendiente para quien firma la iniciativa.
        notes: command.openQuestions.length > 0
          ? [...initiative.notes, `Preguntas abiertas del asistente: ${command.openQuestions.join(' · ')}`]
          : initiative.notes,
      }, now);
  }
};
