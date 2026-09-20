/**
 * Persistence boundary for business initiatives.
 *
 * Same contract as `OfficeEngagementRepository`, for the same reasons:
 *
 *  - never throws — callers get a `PersistenceResult`-shaped outcome;
 *  - normalizes on read, so a hand-edited, partially-written or legacy
 *    document cannot crash a dashboard that rolls it up;
 *  - degrades to the local mirror this repository keeps when the database is
 *    unavailable.
 *
 * The normalizer is deliberately generous about what it accepts and strict
 * about what it returns: an initiative captured against an older schema, or
 * hand-edited straight in SQL, still loads with every field at a usable
 * default rather than taking the portfolio down.
 */

import { MirroredList, createFailureResult } from '../persistence';
import type { PersistenceResult } from '../persistence';
import { newPrefixedId } from '../../lib/ids';
import { createSupabaseBusinessInitiativeRepository } from './SupabaseBusinessInitiativeRepository';
import { loadSupabaseDataClient } from '../adapters';
import { isInitiativeCode, nextInitiativeCode } from '../../lib/eaTerminology';
import {
  BUSINESS_INITIATIVE_SCHEMA_VERSION,
  type BusinessInitiative,
  type InitiativeDocument,
  type InitiativeDocumentFile,
  type InitiativeDocumentKind,
  type InitiativeHorizon,
  type InitiativeKpi,
  type InitiativeMilestone,
  type InitiativeMilestoneStatus,
  type InitiativePriority,
  type InitiativeRisk,
  type InitiativeRiskLevel,
  type InitiativeStakeholder,
  type InitiativeStakeholderKind,
  type InitiativeStatus,
  type InitiativeOutcome,
} from './BusinessInitiativeTypes';

export const newInitiativeId = (): string => newPrefixedId('init');
export const newOutcomeId = (): string => newPrefixedId('out');
export const newKpiId = (): string => newPrefixedId('kpi');
export const newRiskId = (): string => newPrefixedId('risk');
export const newStakeholderId = (): string => newPrefixedId('sth');
export const newDocumentId = (): string => newPrefixedId('doc');
export const newMilestoneId = (): string => newPrefixedId('ms');

const STATUSES: readonly InitiativeStatus[] = [
  'draft', 'proposed', 'approved', 'in-progress',
  'on-hold', 'delivered', 'realized', 'cancelled',
];
const PRIORITIES: readonly InitiativePriority[] = ['critical', 'high', 'medium', 'low'];
const HORIZONS: readonly InitiativeHorizon[] = ['now', 'next', 'later'];
const RISK_LEVELS: readonly InitiativeRiskLevel[] = ['low', 'medium', 'high', 'critical'];
const STAKEHOLDER_KINDS: readonly InitiativeStakeholderKind[] = [
  'sponsor', 'business-owner', 'architecture-lead', 'stakeholder',
];
const DOCUMENT_KINDS: readonly InitiativeDocumentKind[] = [
  'business-case', 'requirement', 'regulation', 'analysis', 'minutes', 'other',
];
const MILESTONE_STATUSES: readonly InitiativeMilestoneStatus[] = [
  'pending', 'at-risk', 'met', 'missed',
];

const asString = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

const asTrimmed = (value: unknown, fallback = ''): string => asString(value, fallback).trim();

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];

const asIsoDate = (value: unknown, fallback: string): string =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : fallback;

const asOptionalIsoDate = (value: unknown): string | undefined =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : undefined;

const asOptionalNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;

const normalizeOutcome = (value: unknown): InitiativeOutcome | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const statement = asTrimmed(raw.statement);
  if (!statement) return null;
  return {
    id: asString(raw.id) || newOutcomeId(),
    statement,
    measure: asTrimmed(raw.measure) || undefined,
  };
};

const normalizeKpi = (value: unknown): InitiativeKpi | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const name = asTrimmed(raw.name);
  if (!name) return null;
  return {
    id: asString(raw.id) || newKpiId(),
    name,
    unit: asTrimmed(raw.unit),
    baseline: asOptionalNumber(raw.baseline),
    target: asOptionalNumber(raw.target),
    current: asOptionalNumber(raw.current),
    measuredAt: asOptionalIsoDate(raw.measuredAt),
  };
};

const normalizeRisk = (value: unknown): InitiativeRisk | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const description = asTrimmed(raw.description);
  if (!description) return null;
  return {
    id: asString(raw.id) || newRiskId(),
    description,
    level: oneOf(raw.level, RISK_LEVELS, 'medium'),
    mitigation: asTrimmed(raw.mitigation) || undefined,
  };
};

const normalizeStakeholder = (value: unknown): InitiativeStakeholder | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const name = asTrimmed(raw.name);
  if (!name) return null;
  return {
    id: asString(raw.id) || newStakeholderId(),
    name,
    role: asTrimmed(raw.role),
    kind: oneOf(raw.kind, STAKEHOLDER_KINDS, 'stakeholder'),
    email: asTrimmed(raw.email) || undefined,
  };
};

/**
 * El archivo de un documento, cuando se subió a Storage.
 *
 * Se exige la identidad completa —cubo, ruta, id del objeto y checksum— o nada.
 * Una referencia a medias es peor que ninguna: la fila diría que hay un archivo
 * y la descarga fallaría sin poder decir cuál falta.
 */
const normalizeDocumentFile = (value: unknown): InitiativeDocumentFile | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const bucket = asTrimmed(raw.bucket);
  const path = asTrimmed(raw.path);
  const objectId = asTrimmed(raw.objectId);
  const sha256 = asTrimmed(raw.sha256);
  const mimeType = asTrimmed(raw.mimeType);
  const sizeBytes = typeof raw.sizeBytes === 'number' && Number.isFinite(raw.sizeBytes) ? raw.sizeBytes : null;
  if (!bucket || !path || !objectId || !sha256 || !mimeType || sizeBytes === null) return undefined;
  return { bucket, path, objectId, mimeType, sizeBytes, sha256 };
};

const normalizeDocument = (value: unknown, now: string): InitiativeDocument | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const name = asTrimmed(raw.name);
  if (!name) return null;
  const url = asTrimmed(raw.url);
  const content = asString(raw.content);
  const file = normalizeDocumentFile(raw.file);
  // A document with no link, no content and no file is an empty row: it would
  // occupy the list and open onto nothing.
  if (!url && !content.trim() && !file) return null;
  return {
    id: asString(raw.id) || newDocumentId(),
    name,
    kind: oneOf(raw.kind, DOCUMENT_KINDS, 'other'),
    url: url || undefined,
    content: content.trim() ? content : undefined,
    file,
    notes: asTrimmed(raw.notes) || undefined,
    addedAt: asIsoDate(raw.addedAt, now),
    addedBy: asTrimmed(raw.addedBy, 'Desconocido'),
  };
};

const normalizeMilestone = (value: unknown, now: string): InitiativeMilestone | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const name = asTrimmed(raw.name);
  if (!name) return null;
  return {
    id: asString(raw.id) || newMilestoneId(),
    name,
    dueAt: asIsoDate(raw.dueAt, now),
    status: oneOf(raw.status, MILESTONE_STATUSES, 'pending'),
    completedAt: asOptionalIsoDate(raw.completedAt),
  };
};

const mapDefined = <T>(value: unknown, map: (item: unknown) => T | null): T[] =>
  Array.isArray(value)
    ? value.map(map).filter((item): item is T => item !== null)
    : [];

/**
 * Turns whatever is stored into a usable initiative.
 *
 * Returns `null` only when there is no identity to work with — an entry with
 * no id is not an initiative with missing fields, it is not an initiative.
 */
export const normalizeInitiative = (
  value: unknown,
  fallbackUserId = '',
): BusinessInitiative | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = asString(raw.id);
  if (!id) return null;

  const now = new Date().toISOString();
  const createdAt = asIsoDate(raw.createdAt, now);
  const code = asTrimmed(raw.code);

  return {
    id,
    schemaVersion: BUSINESS_INITIATIVE_SCHEMA_VERSION,
    // A malformed code would silently break the join with the architecture
    // projects, so it degrades to empty rather than to something plausible.
    code: isInitiativeCode(code) ? code : '',
    title: asTrimmed(raw.title, 'Iniciativa sin título'),
    need: asString(raw.need),
    driver: asString(raw.driver),
    objectives: asStringArray(raw.objectives),
    expectedOutcomes: mapDefined(raw.expectedOutcomes, normalizeOutcome),
    affectedCapabilities: asStringArray(raw.affectedCapabilities),
    businessUnits: asStringArray(raw.businessUnits),
    status: oneOf(raw.status, STATUSES, 'draft'),
    priority: oneOf(raw.priority, PRIORITIES, 'medium'),
    horizon: oneOf(raw.horizon, HORIZONS, 'next'),
    riskLevel: oneOf(raw.riskLevel, RISK_LEVELS, 'medium'),
    risks: mapDefined(raw.risks, normalizeRisk),
    regulatoryDrivers: asStringArray(raw.regulatoryDrivers),
    kpis: mapDefined(raw.kpis, normalizeKpi),
    milestones: mapDefined(raw.milestones, (item) => normalizeMilestone(item, now)),
    stakeholders: mapDefined(raw.stakeholders, normalizeStakeholder),
    documents: mapDefined(raw.documents, (item) => normalizeDocument(item, now)),
    startDate: asOptionalIsoDate(raw.startDate),
    targetEndDate: asOptionalIsoDate(raw.targetEndDate),
    actualEndDate: asOptionalIsoDate(raw.actualEndDate),
    estimatedInvestment: asOptionalNumber(raw.estimatedInvestment),
    currency: asTrimmed(raw.currency) || undefined,
    expectedBenefit: asTrimmed(raw.expectedBenefit) || undefined,
    dependsOnCodes: asStringArray(raw.dependsOnCodes).filter(isInitiativeCode),
    notes: asStringArray(raw.notes),
    provenance: raw.provenance === 'ai-assisted' ? 'ai-assisted' : 'manual',
    userId: asString(raw.userId, fallbackUserId),
    createdAt,
    updatedAt: asIsoDate(raw.updatedAt, createdAt),
    // El testigo de fila sobrevive a la normalización porque el espejo local
    // guarda el objeto entero y lo vuelve a leer por aquí. Nunca viene del
    // documento remoto —el repositorio lo quita antes de enviarlo—, así que un
    // `revision` presente sólo puede haberlo puesto esta aplicación. Perderlo
    // haría que todo lo leído de la caché valiera 0 y chocara contra un
    // conflicto en la siguiente escritura.
    revision: typeof raw.revision === 'number' && Number.isInteger(raw.revision) && raw.revision > 0
      ? raw.revision
      : undefined,
  };
};

export interface CreateInitiativeInput {
  title: string;
  need: string;
  driver?: string;
  objectives?: string[];
  priority?: InitiativePriority;
  horizon?: InitiativeHorizon;
  startDate?: string;
  targetEndDate?: string;
  code?: string;
  provenance?: BusinessInitiative['provenance'];
}

/**
 * Builds a new initiative with every collection empty rather than absent, so
 * every consumer can map over them without a guard.
 */
export const buildInitiative = (
  input: CreateInitiativeInput,
  userId: string,
  existingCodes: readonly string[],
  now: string = new Date().toISOString(),
): BusinessInitiative => ({
  id: newInitiativeId(),
  schemaVersion: BUSINESS_INITIATIVE_SCHEMA_VERSION,
  code: input.code && isInitiativeCode(input.code)
    ? input.code
    : nextInitiativeCode(existingCodes, new Date(now).getFullYear()),
  title: input.title.trim(),
  need: input.need.trim(),
  driver: (input.driver ?? '').trim(),
  objectives: (input.objectives ?? []).map((item) => item.trim()).filter(Boolean),
  expectedOutcomes: [],
  affectedCapabilities: [],
  businessUnits: [],
  status: 'draft',
  priority: input.priority ?? 'medium',
  horizon: input.horizon ?? 'next',
  riskLevel: 'medium',
  risks: [],
  regulatoryDrivers: [],
  kpis: [],
  milestones: [],
  stakeholders: [],
  documents: [],
  startDate: input.startDate,
  targetEndDate: input.targetEndDate,
  estimatedInvestment: undefined,
  currency: undefined,
  expectedBenefit: undefined,
  dependsOnCodes: [],
  notes: [],
  provenance: input.provenance ?? 'manual',
  userId,
  createdAt: now,
  updatedAt: now,
});

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

/**
 * El espejo está indexado por dueño, no por proyecto: `owner_id` es contra lo
 * que las políticas de `api.business_initiatives` autorizan leer y escribir,
 * igual que en `api.architecture_projects`. Por eso `deleteInitiative` exige
 * que el llamador diga de quién es la lista que hay que podar — si no, una
 * iniciativa borrada sobrevive en el espejo local y reaparece la próxima vez
 * que la base de datos no conteste.
 */
const mirror = new MirroredList<BusinessInitiative>((userId) => `businessInitiatives_${userId}`);

let remote: ReturnType<typeof createSupabaseBusinessInitiativeRepository> | null = null;

const getRemote = async () => {
  if (!remote) {
    const client = await loadSupabaseDataClient();
    remote = createSupabaseBusinessInitiativeRepository(
      client as unknown as Parameters<typeof createSupabaseBusinessInitiativeRepository>[0],
    );
  }
  return remote;
};

/** Solo para pruebas: olvida el repositorio remoto memorizado. */
export const resetInitiativeRepositoryCache = (): void => {
  remote = null;
  mirror.clear();
};

/**
 * Fuente única: PostgreSQL. El único espejo que sobrevive es el local, y nunca
 * se informa como confirmación remota.
 */
export const listInitiatives = async (userId: string): Promise<BusinessInitiative[]> => {
  const cached = mirror.cached(userId);
  const stored = cached ?? await (async () => {
    try {
      return mirror.remember(userId, await (await getRemote()).list(userId));
    } catch {
      return mirror.fallback(userId);
    }
  })();
  return stored
    .map((item) => normalizeInitiative(item, userId))
    .filter((item): item is BusinessInitiative => item !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
};

export const saveInitiative = async (
  initiative: BusinessInitiative,
): Promise<PersistenceResult<BusinessInitiative | void>> => {
  const next: BusinessInitiative = { ...initiative, updatedAt: new Date().toISOString() };
  let result: PersistenceResult<BusinessInitiative | void>;
  try {
    result = await (await getRemote()).save(next, next.userId);
  } catch (error) {
    result = createFailureResult('saveBusinessInitiative', error);
  }
  // El espejo guarda lo confirmado cuando lo hay —con su revisión nueva— y lo
  // enviado cuando no: en degradación el trabajo no se pierde, y `result` ya
  // dice que sólo está en local. Guardar lo enviado tras una confirmación
  // dejaría el testigo caducado y convertiría la siguiente escritura en un
  // conflicto.
  const stored = result.success && result.data ? result.data : next;
  mirror.upsert(stored.userId, stored, result);
  return result;
};

export const deleteInitiative = async (
  userId: string,
  initiativeId: string,
  expectedRevision = 0,
): Promise<PersistenceResult<void>> => {
  let result: PersistenceResult<void>;
  try {
    // La revisión del snapshot que se está viendo, no la de la última lectura.
    result = await (await getRemote()).remove(initiativeId, userId, expectedRevision);
  } catch (error) {
    result = createFailureResult('deleteBusinessInitiative', error);
  }
  if (result.success) mirror.remove(userId, initiativeId);
  return result;
};

/** Olvida lo cacheado. Lo usa el cierre de sesión. */
export const clearInitiativeCache = (): void => {
  mirror.clear();
};
