/**
 * Iconography for the Architecture Office.
 *
 * Colour alone never carries meaning in this UI: every status that gets a
 * colour also gets a glyph and a written label. That is what makes the office
 * readable at a glance for everyone, colour-blind readers included, and it is
 * what lets a dense board drop from "read every badge" to "scan the shapes".
 *
 * Glyphs come from Lucide, which `CLAUDE.md` reserves for exactly this kind of
 * set — `components/Icons.tsx` stays the curated append-only Heroicons list.
 */

import React from 'react';
import {
  AlertOctagon,
  BadgeCheck,
  Boxes,
  Briefcase,
  Building2,
  CheckCircle2,
  CircleDashed,
  CircleDot,
  ClipboardList,
  Cloud,
  Cpu,
  Database,
  FileSearch,
  Gavel,
  Hourglass,
  Layers,
  Landmark,
  MinusCircle,
  Network,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Rocket,
  ScrollText,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Target,
  Workflow,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import type { OfficeHealthBucket } from '../../services/architectureOffice/officePortfolio';
import type { OfficeAgentId } from '../../services/architectureOffice/officeAgentPersonas';
import type {
  OfficeEngagementKind,
  OfficeEngagementStatus,
  OfficeFindingSeverity,
  OfficeTaskKind,
  OfficeTaskStatus,
} from '../../services/architectureOffice/OfficeTypes';
import type { OfficeQualityGateStatus } from '../../services/architectureOffice/officeQualityGates';

/** The three levels of the hierarchy, each with its own permanent glyph. */
export const HIERARCHY_ICONS = Object.freeze({
  program: Landmark,      // proyecto de negocio
  project: Boxes,         // proyecto de arquitectura
  engagement: Briefcase,  // entregable
  artifact: Layers,       // artefacto
  board: Workflow,        // tablero / canvas
}) as Readonly<Record<'program' | 'project' | 'engagement' | 'artifact' | 'board', LucideIcon>>;

export const HEALTH_ICONS: Readonly<Record<OfficeHealthBucket, LucideIcon>> = Object.freeze({
  blocked: AlertOctagon,
  running: PlayCircle,
  'awaiting-decision': Gavel,
  delivered: BadgeCheck,
  idle: CircleDashed,
});

export const ENGAGEMENT_STATUS_ICONS: Readonly<Record<OfficeEngagementStatus, LucideIcon>> = Object.freeze({
  intake: ClipboardList,
  planning: Sparkles,
  'awaiting-charter': ScrollText,
  'in-progress': PlayCircle,
  'awaiting-arb': Gavel,
  delivered: BadgeCheck,
  blocked: AlertOctagon,
  cancelled: MinusCircle,
});

export const TASK_STATUS_ICONS: Readonly<Record<OfficeTaskStatus, LucideIcon>> = Object.freeze({
  pending: Hourglass,
  ready: CircleDot,
  'in-progress': PlayCircle,
  'awaiting-review': FileSearch,
  'changes-requested': RefreshCw,
  completed: CheckCircle2,
  failed: XCircle,
  skipped: MinusCircle,
  cancelled: PauseCircle,
});

export const TASK_KIND_ICONS: Readonly<Record<OfficeTaskKind, LucideIcon>> = Object.freeze({
  'produce-artifact': Layers,
  'review-artifact': FileSearch,
  consolidate: Network,
  report: ScrollText,
});

export const ENGAGEMENT_KIND_ICONS: Readonly<Record<OfficeEngagementKind, LucideIcon>> = Object.freeze({
  'new-solution': Rocket,
  modernization: RefreshCw,
  integration: Network,
  assessment: Target,
  'compliance-review': ShieldCheck,
});

export const GATE_STATUS_ICONS: Readonly<Record<OfficeQualityGateStatus, LucideIcon>> = Object.freeze({
  pass: ShieldCheck,
  conditional: Shield,
  blocked: ShieldAlert,
});

export const SEVERITY_ICONS: Readonly<Record<OfficeFindingSeverity, LucideIcon>> = Object.freeze({
  critical: AlertOctagon,
  high: ShieldAlert,
  medium: Shield,
  low: CircleDot,
});

/**
 * A domain glyph per specialist, so the reader recognises who is on a task
 * before reading the name. Falls back to a generic architect mark.
 */
export const PERSONA_ICONS: Readonly<Partial<Record<OfficeAgentId, LucideIcon>>> = Object.freeze({
  arky: Sparkles,
  alejandro: Building2,
  felipe: Cloud,
  natalia: Cloud,
  mauricio: Network,
  ricardo: Cpu,
  gabriel: Boxes,
  elena: Layers,
  lucia: Workflow,
  tomas: ClipboardList,
  sofia: Landmark,
  daniel: Database,
  carmen: ShieldCheck,
});

export const personaIcon = (personaId: OfficeAgentId): LucideIcon =>
  PERSONA_ICONS[personaId] ?? Boxes;

/**
 * Renders a glyph purely as decoration beside text that already says the same
 * thing. Screen readers skip it — the label carries the meaning.
 */
export const StatusGlyph: React.FC<{ icon: LucideIcon; className?: string }> = ({
  icon: Icon,
  className,
}) => <Icon className={className} aria-hidden strokeWidth={2} />;

export type { LucideIcon };
