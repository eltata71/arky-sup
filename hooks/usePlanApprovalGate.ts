/**
 * El puente entre `coordinateRequest` y la pantalla (plan de agentes 20.2):
 * `request` es el puerto que la coordinación espera, y mientras alguien no
 * decide, `pending` guarda la propuesta que el panel enseña.
 *
 * El hook no decide nada —ni el umbral ni qué se puede quitar: eso es
 * `planApproval`—; sólo convierte «espera una decisión» en estado de React.
 * Si el dock se cierra con una propuesta abierta, se cancela: una promesa que
 * nadie resolverá dejaría la operación colgada para siempre.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  PlanApprovalDecision,
  PlanApprovalPort,
  PlanApprovalProposal,
} from '../services/architectureOffice/planApproval'; // the plan-approval door (20.2)

export interface PlanApprovalGate {
  pending: PlanApprovalProposal | null;
  request: PlanApprovalPort;
  decide: (decision: PlanApprovalDecision) => void;
}

export const usePlanApprovalGate = (): PlanApprovalGate => {
  const [pending, setPending] = useState<PlanApprovalProposal | null>(null);
  const resolver = useRef<((decision: PlanApprovalDecision) => void) | null>(null);

  const decide = useCallback((decision: PlanApprovalDecision) => {
    resolver.current?.(decision);
    resolver.current = null;
    setPending(null);
  }, []);

  const request = useCallback<PlanApprovalPort>((proposal) => new Promise((resolve) => {
    resolver.current = resolve;
    setPending(proposal);
  }), []);

  useEffect(() => () => {
    resolver.current?.({ decision: 'cancel' });
    resolver.current = null;
  }, []);

  return { pending, request, decide };
};
