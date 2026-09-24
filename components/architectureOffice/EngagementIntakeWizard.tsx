/**
 * Engagement intake — how work enters the Architecture Office.
 *
 * A deliverable is the third level of the hierarchy, and this dialog refuses to
 * let it exist without the two above it: it must answer a business initiative,
 * and it must live inside an architecture attention. Both are chosen here by
 * key, never typed, and when one does not exist yet the dialog sends the user
 * to the screen that creates it rather than quietly inventing a placeholder.
 *
 * That is a deliberate reversal of the earlier design, where the office would
 * open a project from the brief. Opening work with no declared business reason
 * is exactly the gap the portfolio graph reports as a finding — the intake
 * should not be the thing that manufactures it.
 *
 * Once both parents are set, the architect reviews the charter the office
 * proposes (artifacts, who produces each one and who reviews it) and approves.
 * Approving releases the runner; the architect is a client of the office here,
 * not the operator of a generation button.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Button, Input, Spinner } from '../ui';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { InitiativePicker } from '../businessInitiatives/InitiativePicker';
import { codesForInitiativeIds } from '../../services/portfolioGraph';
import type { BusinessInitiative } from '../../context/InitiativeContext';
import type { OfficeEngagement } from '../../context/OfficeContext';
import { EngagementCharterReview } from './EngagementCharterReview';
import { CaptureAssist, FormAssistBar } from '../capture';
import { useDeliverableCapture } from '../../hooks/useLevelCapture';
import { EA_LEVELS } from '../../lib/eaTerminology';

export interface EngagementIntakeSubmit {
  projectId: string;
  title: string;
  brief: string;
  /** Canonical link to the initiatives served. */
  initiativeIds: string[];
  /** Code mirror, derived from `initiativeIds`. Never captured by hand. */
  businessProjectIds: string[];
}

export interface IntakeProjectOption {
  id: string;
  name: string;
  /** Initiatives the attention already answers — inherited by the deliverable. */
  initiativeIds?: string[];
}

interface EngagementIntakeWizardProps {
  open: boolean;
  /** Attentions the deliverable can be attached to. May be empty. */
  projects: IntakeProjectOption[];
  /** Registered initiatives the deliverable may answer. */
  initiatives: BusinessInitiative[];
  /** Preselected attention, when the dialog was opened from one. */
  initialProjectId?: string;
  /** Takes the user to create the missing attention. */
  onCreateAttention?: () => void;
  /** Takes the user to register the missing business initiative. */
  onCreateInitiative?: () => void;
  /** Proposes the charter. Resolves with the created engagement. */
  onPropose: (input: EngagementIntakeSubmit) => Promise<OfficeEngagement | null>;
  /** Approves the charter and starts execution. */
  onApproveAndRun: (engagementId: string) => Promise<void>;
  onClose: () => void;
}

type Step = 'brief' | 'proposing' | 'charter';

export const EngagementIntakeWizard: React.FC<EngagementIntakeWizardProps> = ({
  open,
  projects,
  initiatives,
  initialProjectId,
  onCreateAttention,
  onCreateInitiative,
  onPropose,
  onApproveAndRun,
  onClose,
}) => {
  const [step, setStep] = useState<Step>('brief');
  const [projectChoice, setProjectChoice] = useState<string>(initialProjectId ?? '');
  const [title, setTitle] = useState('');
  const [brief, setBrief] = useState('');
  const [initiativeIds, setInitiativeIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [engagement, setEngagement] = useState<OfficeEngagement | null>(null);
  const [destinationName, setDestinationName] = useState('');
  const [starting, setStarting] = useState(false);

  const dialogRef = useFocusTrap<HTMLDivElement>(open);

  /*
   * La ayuda de captura del tercer nivel.
   *
   * Lo que ve el asistente no es sólo lo tecleado: son las iniciativas elegidas
   * y el proyecto de destino, que es exactamente el contexto que convierte
   * «título del entregable» en una pregunta contestable. Por eso los dos padres
   * se piden antes que el texto — y por eso el botón está deshabilitado hasta
   * que hay alguno.
   */
  const captureSubject = useMemo(() => ({ title, brief }), [title, brief]);
  const captureParents = useMemo(
    () => initiatives.filter((candidate) => initiativeIds.includes(candidate.id)),
    [initiatives, initiativeIds],
  );
  const captureAttention = useMemo(() => {
    const destination = projects.find((project) => project.id === projectChoice);
    return destination ? { name: destination.name } : undefined;
  }, [projects, projectChoice]);
  const capture = useDeliverableCapture(captureSubject, captureAttention, captureParents);

  const reset = useCallback(() => {
    setStep('brief');
    setProjectChoice(initialProjectId ?? '');
    setTitle('');
    setBrief('');
    setInitiativeIds([]);
    setError(null);
    setEngagement(null);
    setDestinationName('');
    setStarting(false);
  }, [initialProjectId]);

  const close = useCallback(() => {
    reset();
    // Una propuesta pendiente pertenece a la solicitud que se estaba
    // redactando; sobrevivir al cierre la dejaría sobre la siguiente.
    capture.assistant.reset();
    onClose();
  }, [reset, capture.assistant, onClose]);

  const propose = useCallback(async () => {
    const trimmedTitle = title.trim();
    const trimmedBrief = brief.trim();
    // The hierarchy is checked before the text, and each gap is named on its
    // own: "faltan campos" would leave the user hunting for which one.
    if (initiativeIds.length === 0) {
      setError('Elige la iniciativa de negocio que este entregable atiende. Es el primer nivel de la jerarquía y es obligatorio.');
      return;
    }
    if (projectChoice.length === 0) {
      setError('Elige el proyecto de arquitectura donde vivirá el entregable. Es el segundo nivel de la jerarquía y es obligatorio.');
      return;
    }
    if (trimmedTitle.length === 0 || trimmedBrief.length < 20) {
      setError('Describe el entregable con al menos una frase completa para que la Oficina pueda planificarlo.');
      return;
    }
    setError(null);
    setStep('proposing');
    try {
      const destination = projects.find((project) => project.id === projectChoice);
      if (!destination) {
        setError('El proyecto de destino ya no está disponible. Elige otro.');
        setStep('brief');
        return;
      }
      setDestinationName(destination.name);
      const created = await onPropose({
        projectId: destination.id,
        title: trimmedTitle,
        brief: trimmedBrief,
        initiativeIds,
        businessProjectIds: codesForInitiativeIds(initiativeIds, initiatives),
      });
      if (!created) {
        setError('La Oficina no pudo proponer un charter para este entregable.');
        setStep('brief');
        return;
      }
      setEngagement(created);
      setStep('charter');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setStep('brief');
    }
  }, [title, brief, initiativeIds, initiatives, projectChoice, projects, onPropose]);

  const approve = useCallback(async () => {
    if (!engagement) return;
    setStarting(true);
    try {
      await onApproveAndRun(engagement.id);
      close();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setStarting(false);
    }
  }, [engagement, onApproveAndRun, close]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="engagement-intake-title"
    >
      <div
        ref={dialogRef}
        className="w-full max-w-3xl max-h-[90dvh] overflow-y-auto rounded-2xl bg-white dark:bg-gray-900 shadow-pop"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-6 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary-600 dark:text-primary-400">
              Oficina de Arquitectura
            </p>
            <h2 id="engagement-intake-title" className="text-xl font-bold text-gray-900 dark:text-gray-100">
              Nuevo entregable
            </h2>
            <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
              {destinationName ? `Proyecto: ${destinationName}` : 'La Oficina recibe el entregable y arma el equipo'}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={close}>Cerrar</Button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {error && <Alert tone="danger">{error}</Alert>}

          {step === 'brief' && (
            <div className="space-y-4">
              {/* The hierarchy, stated before anything is asked, so the two
                  mandatory parents read as structure rather than as fields. */}
              <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-xl bg-gray-50 px-3 py-2 text-2xs font-medium text-gray-500 dark:bg-gray-800/60 dark:text-gray-400">
                <li className={initiativeIds.length > 0 ? 'text-primary-600 dark:text-primary-400' : undefined}>
                  1 · {EA_LEVELS.initiative.singular}
                </li>
                <li aria-hidden>›</li>
                <li className={projectChoice.length > 0 ? 'text-primary-600 dark:text-primary-400' : undefined}>
                  2 · {EA_LEVELS.engagementProject.singular}
                </li>
                <li aria-hidden>›</li>
                <li className="text-gray-900 dark:text-gray-100">3 · {EA_LEVELS.deliverable.singular}</li>
              </ol>

              {initiatives.length === 0 ? (
                <Alert tone="warning">
                  <p className="font-medium">Todavía no hay iniciativas de negocio registradas.</p>
                  <p className="mt-1 text-xs leading-relaxed">
                    Un entregable existe para atender una necesidad del negocio. Registra primero la
                    iniciativa y vuelve a abrir este entregable.
                  </p>
                  {onCreateInitiative && (
                    <Button className="mt-2" size="sm" variant="primary" onClick={onCreateInitiative}>
                      Registrar iniciativa de negocio
                    </Button>
                  )}
                </Alert>
              ) : (
                <InitiativePicker
                  initiatives={initiatives}
                  value={initiativeIds}
                  onChange={setInitiativeIds}
                  label="Iniciativa de negocio que atiende (obligatorio)"
                  hint="Primer nivel de la jerarquía. Se guarda por llave, nunca por el código escrito a mano."
                />
              )}

              {projects.length === 0 ? (
                <Alert tone="warning">
                  <p className="font-medium">Todavía no hay proyectos de arquitectura.</p>
                  <p className="mt-1 text-xs leading-relaxed">
                    El entregable vive dentro de un proyecto. Crea primero el proyecto desde su propia
                    pantalla y vuelve aquí.
                  </p>
                  {onCreateAttention && (
                    <Button className="mt-2" size="sm" variant="primary" onClick={onCreateAttention}>
                      Crear proyecto de arquitectura
                    </Button>
                  )}
                </Alert>
              ) : (
                <div className="space-y-1.5">
                  <label htmlFor="engagement-project" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Proyecto de arquitectura de destino (obligatorio)
                  </label>
                  <select
                    id="engagement-project"
                    value={projectChoice}
                    onChange={(event) => {
                      const next = event.target.value;
                      setProjectChoice(next);
                      // The attention already declares what it answers; inheriting
                      // it keeps the two levels from disagreeing by accident.
                      const inherited = projects.find((project) => project.id === next)?.initiativeIds ?? [];
                      if (initiativeIds.length === 0 && inherited.length > 0) setInitiativeIds(inherited);
                    }}
                    className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                  >
                    <option value="">Selecciona el proyecto…</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>{project.name}</option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {projectChoice.length === 0
                      ? 'Segundo nivel de la jerarquía. Si el proyecto que necesitas no existe, créalo primero.'
                      : 'El entregable se sumará a los artefactos que ya tiene ese proyecto.'}
                  </p>
                  {onCreateAttention && (
                    <button
                      type="button"
                      onClick={onCreateAttention}
                      className="text-xs font-medium text-primary-600 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-primary-400"
                    >
                      Crear un proyecto nuevo
                    </button>
                  )}
                </div>
              )}

              <FormAssistBar
                pendingCount={capture.pendingFields.length}
                onAsk={capture.askForm}
                loading={capture.formLoading}
                notice={capture.assistant.notice}
                openQuestions={capture.assistant.openQuestions}
                subject="la solicitud de entregable"
              />

              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="engagement-title" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Título del entregable
                  </label>
                  <CaptureAssist
                    fieldId="deliverable.title"
                    assistant={capture.assistant}
                    context={capture.context}
                    current={title}
                    apply={setTitle}
                  />
                </div>
                <Input
                  id="engagement-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Modernización del motor de siniestros"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="engagement-brief" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    ¿Qué necesita el negocio?
                  </label>
                  <CaptureAssist
                    fieldId="deliverable.brief"
                    assistant={capture.assistant}
                    context={capture.context}
                    current={brief}
                    apply={setBrief}
                  />
                </div>
                <textarea
                  id="engagement-brief"
                  value={brief}
                  onChange={(event) => setBrief(event.target.value)}
                  rows={6}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                  placeholder="Modernizar el motor de siniestros AS/400 exponiendo APIs a Salesforce Health Cloud, cumpliendo HIPAA y con trazabilidad regulatoria."
                />
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Cuanto más concreto sea el entregable, mejor reparte la Oficina el trabajo entre sus especialistas.
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="ghost" onClick={close}>Cancelar</Button>
                <Button
                  variant="primary"
                  onClick={propose}
                  disabled={initiatives.length === 0 || projects.length === 0}
                >
                  Proponer plan de trabajo
                </Button>
              </div>
            </div>
          )}

          {step === 'proposing' && (
            <div className="flex flex-col items-center gap-3 py-10" role="status">
              <Spinner />
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Lucía está descomponiendo el entregable y asignando especialistas…
              </p>
            </div>
          )}

          {step === 'charter' && engagement && (
            <div className="space-y-5">
              <EngagementCharterReview engagement={engagement} />

              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={close} disabled={starting}>
                  Guardar sin ejecutar
                </Button>
                <Button variant="primary" onClick={approve} loading={starting}>
                  Aprobar charter y ejecutar
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
