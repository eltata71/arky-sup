/**
 * Persistence boundary for business initiatives.
 *
 * Same contract as `OfficeEngagementRepository`, for the same reasons:
 *
 *  - never throws — callers get a `PersistenceResult`-shaped outcome;
 *  - normalizes on read, so a hand-edited, partially-written or legacy
 *    document cannot crash a dashboard that rolls it up;
 *  - degrades to the local mirror this repository keeps when Firestore is
 *    unavailable.
 *
 * The normalizer is deliberately generous about what it accepts and strict
 * about what it returns: an initiative captured against an older schema, or
 * hand-edited in the Firebase console, still loads with every field at a
 * usable default rather than taking the portfolio down.
 */

import { collection, deleteDoc, doc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { db } from '../../firebase';
import { sanitizeForFirestore } from '../../lib/firestoreData';
import {
  BUSINESS_INITIATIVES_COLLECTION,
  MirroredList,
  executeRemoteWrite,
  requireDb,
} from '../persistence';
import type { PersistenceResult } from '../persistence';
import { newPrefixedId } from '../../lib/ids';
import { createSupabaseBusinessInitiativeRepository } from './SupabaseBusinessInitiativeRepository';
import { loadSupabaseDataClient, resolveBackend } from '../adapters';
import { isInitiativeCode, nextInitiativeCode } from '../../lib/eaTerminology';
import {
  BUSINESS_INITIATIVE_SCHEMA_VERSION,
  type BusinessInitiative,
  type InitiativeDocument,
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

const normalizeDocument = (value: unknown, now: string): InitiativeDocument | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const name = asTrimmed(raw.name);
  if (!name) return null;
  const url = asTrimmed(raw.url);
  const content = asString(raw.content);
  // A document with neither a link nor content is an empty row: it would
  // occupy the list and open onto nothing.
  if (!url && !content.trim()) return null;
  return {
    id: asString(raw.id) || newDocumentId(),
    name,
    kind: oneOf(raw.kind, DOCUMENT_KINDS, 'other'),
    url: url || undefined,
    content: content.trim() ? content : undefined,
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
 * El espejo está indexado por dueño, no por proyecto: `userId` es contra lo
 * que `firestore.rules` autoriza leer y escribir aquí, igual que en
 * `projects/{projectId}`. Por eso `deleteInitiative` exige que el llamador diga
 * de quién es la lista que hay que podar — si no, una iniciativa borrada
 * sobrevive en el espejo local y reaparece la próxima vez que Firestore no
 * conteste.
 */
const firebaseMirror = new MirroredList<BusinessInitiative>((userId) => `businessInitiatives_${userId}`);
/** Separado del espejo Firebase: no permite degradar una lectura Supabase a otra fuente remota. */
const supabaseMirror = new MirroredList<BusinessInitiative>((userId) => `supabase_businessInitiatives_${userId}`);

const fetchInitiatives = async (userId: string): Promise<BusinessInitiative[]> => {
  try {
    const snapshot = await getDocs(query(
      collection(requireDb(db), BUSINESS_INITIATIVES_COLLECTION),
      where('userId', '==', userId),
    ));
    return firebaseMirror.remember(
      userId,
      snapshot.docs.map((snap) => ({ ...snap.data(), id: snap.id }) as BusinessInitiative),
    );
  } catch {
    return firebaseMirror.fallback(userId);
  }
};

export const firebaseListInitiatives = async (userId: string): Promise<BusinessInitiative[]> => {
  const stored = firebaseMirror.cached(userId) ?? await fetchInitiatives(userId);
  return stored
    .map((item) => normalizeInitiative(item, userId))
    .filter((item): item is BusinessInitiative => item !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
};

export const firebaseSaveInitiative = async (
  initiative: BusinessInitiative,
): Promise<PersistenceResult<void>> => {
  const next: BusinessInitiative = { ...initiative, updatedAt: new Date().toISOString() };
  const result = await executeRemoteWrite(
    { operationName: 'saveBusinessInitiative', userId: next.userId },
    async () => {
      await setDoc(doc(requireDb(db), BUSINESS_INITIATIVES_COLLECTION, next.id), sanitizeForFirestore(next));
    },
  );
  firebaseMirror.upsert(next.userId, next, result);
  return result as PersistenceResult<void>;
};

export const firebaseDeleteInitiative = async (
  userId: string,
  initiativeId: string,
): Promise<PersistenceResult<void>> => {
  const result = await executeRemoteWrite(
    { operationName: 'deleteBusinessInitiative', userId },
    async () => {
      await deleteDoc(doc(requireDb(db), BUSINESS_INITIATIVES_COLLECTION, initiativeId));
    },
  );
  if (result.success) firebaseMirror.remove(userId, initiativeId);
  return result as PersistenceResult<void>;
};

const runtimeEnv = (): Record<string, string | undefined> => import.meta.env as Record<string, string | undefined>;
let supabaseRepository: ReturnType<typeof createSupabaseBusinessInitiativeRepository> | null = null;

const getSupabaseRepository = async () => {
  if (!supabaseRepository) {
    const client = await loadSupabaseDataClient(runtimeEnv());
    supabaseRepository = createSupabaseBusinessInitiativeRepository(
      client as unknown as Parameters<typeof createSupabaseBusinessInitiativeRepository>[0],
    );
  }
  return supabaseRepository;
};

/**
 * Fuente única por corte. Al activar `VITE_BACKEND_BUSINESSINITIATIVES=supabase`,
 * ni lectura ni escritura vuelven a Firebase; sólo sobrevive el espejo local
 * específico de Supabase, que nunca se informa como confirmación remota.
 */
export const listInitiatives = async (userId: string): Promise<BusinessInitiative[]> => {
  if (resolveBackend(runtimeEnv(), 'businessInitiatives').backend !== 'supabase') {
    return firebaseListInitiatives(userId);
  }
  try {
    const initiatives = await (await getSupabaseRepository()).list(userId);
    return supabaseMirror.remember(userId, initiatives);
  } catch {
    return supabaseMirror.fallback(userId);
  }
};

export const saveInitiative = async (
  initiative: BusinessInitiative,
): Promise<PersistenceResult<BusinessInitiative | void>> => {
  const next: BusinessInitiative = { ...initiative, updatedAt: new Date().toISOString() };
  if (resolveBackend(runtimeEnv(), 'businessInitiatives').backend !== 'supabase') {
    return firebaseSaveInitiative(next);
  }
  const result = await (await getSupabaseRepository()).save(next, next.userId);
  supabaseMirror.upsert(next.userId, next, result);
  return result;
};

export const deleteInitiative = async (
  userId: string,
  initiativeId: string,
): Promise<PersistenceResult<void>> => {
  if (resolveBackend(runtimeEnv(), 'businessInitiatives').backend !== 'supabase') {
    return firebaseDeleteInitiative(userId, initiativeId);
  }
  const result = await (await getSupabaseRepository()).remove(initiativeId, userId);
  if (result.success) supabaseMirror.remove(userId, initiativeId);
  return result;
};

/** Olvida lo cacheado. Lo usa el cierre de sesión. */
export const clearInitiativeCache = (): void => {
  firebaseMirror.clear();
  supabaseMirror.clear();
};
