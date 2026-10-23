/**
 * El plan del equipo, antes de gastar (plan de agentes 20.2).
 *
 * Aparece cuando una solicitud convoca a varios especialistas: nombra al
 * equipo, dice cuántas llamadas al modelo como máximo supone y deja aprobar,
 * quitar a un especialista o cancelar. Mientras está abierto no se ha invocado
 * a nadie.
 */

import React, { useEffect, useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Button } from '../ui';
import { useUiTranslation } from '../../lib/i18n/UiTranslationContext';
import { useAgentDisplayName } from '../../hooks/useAgentDisplayName';
import type { PlanApprovalGate } from '../../hooks/usePlanApprovalGate';

export const PlanApprovalPanel: React.FC<{ gate: PlanApprovalGate }> = ({ gate }) => {
  const t = useUiTranslation();
  const nameOf = useAgentDisplayName();
  const { pending, decide } = gate;
  const [removed, setRemoved] = useState<string[]>([]);
  const approveRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setRemoved([]);
    if (pending) approveRef.current?.focus();
  }, [pending]);

  if (!pending) return null;
  const included = pending.specialists.filter((specialist) => !removed.includes(specialist.personaId));
  const toggle = (personaId: string): void => setRemoved((current) => (
    current.includes(personaId) ? current.filter((id) => id !== personaId) : [...current, personaId]
  ));

  return (
    <section
      role="group"
      aria-labelledby="plan-approval-title"
      className="space-y-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950/30"
    >
      <h3 id="plan-approval-title" className="flex items-center gap-2 text-sm font-bold text-gray-900 dark:text-gray-50">
        <ShieldCheck className="h-4 w-4 text-amber-600" aria-hidden />
        {t('planApproval.title')}
      </h3>
      <p className="text-xs leading-relaxed text-gray-700 dark:text-gray-200">
        {t('planApproval.description', { p0: String(pending.specialists.length), p1: String(pending.maxModelCalls) })}
      </p>
      <ul className="space-y-1.5">
        {pending.specialists.map((specialist) => {
          const id = `plan-approval-${specialist.personaId}`;
          return (
            <li key={specialist.personaId} className="flex items-start gap-2 rounded-lg bg-white/70 px-2.5 py-1.5 dark:bg-gray-900/50">
              <input
                id={id}
                type="checkbox"
                className="mt-1 h-4 w-4"
                checked={!removed.includes(specialist.personaId)}
                disabled={!removed.includes(specialist.personaId) && included.length === 1}
                onChange={() => toggle(specialist.personaId)}
              />
              <label htmlFor={id} className="min-w-0 flex-1 text-xs text-gray-800 dark:text-gray-100">
                <span className="font-semibold">{nameOf(specialist.personaId)}</span>
                <span className="block text-gray-600 dark:text-gray-300">{specialist.objective}</span>
              </label>
            </li>
          );
        })}
      </ul>
      <p className="text-2xs text-gray-600 dark:text-gray-300">{t('planApproval.minimum')}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          ref={approveRef}
          variant="primary"
          size="sm"
          onClick={() => decide({ decision: 'approve', removeSpecialists: removed as never[] })}
        >
          {t('planApproval.approve')}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => decide({ decision: 'cancel' })}>
          {t('planApproval.cancel')}
        </Button>
      </div>
    </section>
  );
};

export default PlanApprovalPanel;
