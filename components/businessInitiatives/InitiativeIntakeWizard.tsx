/**
 * Initiative intake — how a business need enters the platform.
 *
 * The business arrives with a paragraph, not with a motivation model. So the
 * wizard asks for the paragraph first, then offers to structure it: the
 * assistant proposes a driver, objectives, measurable outcomes, KPIs, risks
 * and the capabilities affected, and the architect edits that draft.
 *
 * Two rules the UI enforces on the assistant:
 *
 *  - **The need is never rewritten.** What the business said is the record.
 *  - **Nothing is accepted silently.** The draft is shown for review, each
 *    block can be dropped, and what the assistant could not deduce is listed
 *    as open questions instead of being quietly invented.
 *
 * The whole flow works with the assistant unavailable — that path is a skip
 * button, not an error screen.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Button, Card, Input, Spinner, cn } from '../ui';
import { WandSparkles } from 'lucide-react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { EA_LEVELS, nextInitiativeCode } from '../../lib/eaTerminology';
import { INITIATIVE_SECTION_ICONS, PRIORITY_LABELS, HORIZON_LABELS, HORIZON_HINTS } from './initiativeUiLabels';
import { InitiativeDraftReview } from './InitiativeDraftReview';
import { CaptureAssist } from '../capture';
import { useInitiativeCapture } from '../../hooks/useLevelCapture';
import type { InitiativeDraft } from '../../services/ai/generation/initiativeAssistantService';
import type {
  InitiativeHorizon,
  InitiativePriority,
} from '../../services/businessInitiatives/BusinessInitiativeTypes';

export interface InitiativeIntakeSubmit {
  title: string;
  need: string;
  driver: string;
  objectives: string[];
  priority: InitiativePriority;
  horizon: InitiativeHorizon;
  startDate?: string;
  targetEndDate?: string;
  /** Everything else the assistant proposed and the architect kept. */
  draft?: InitiativeDraft;
}

interface InitiativeIntakeWizardProps {
  open: boolean;
  /** Codes already taken, so the wizard can show the one it will assign. */
  usedCodes: string[];
  /** Asks the assistant to structure the need. Resolves `null` when unavailable. */
  onDraft: (input: { title: string; need: string }) => Promise<
    { draft?: InitiativeDraft; reason?: string }
  >;
  onSubmit: (input: InitiativeIntakeSubmit) => Promise<{ ok: boolean; reason?: string }>;
  onClose: () => void;
}

type Step = 'need' | 'drafting' | 'review';

const fieldLabel = 'block text-sm font-medium text-gray-700 dark:text-gray-300';
const selectClass = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';

export const InitiativeIntakeWizard: React.FC<InitiativeIntakeWizardProps> = ({
  open,
  usedCodes,
  onDraft,
  onSubmit,
  onClose,
}) => {
  const [step, setStep] = useState<Step>('need');
  const [title, setTitle] = useState('');
  const [need, setNeed] = useState('');
  const [priority, setPriority] = useState<InitiativePriority>('medium');
  const [horizon, setHorizon] = useState<InitiativeHorizon>('next');
  const [startDate, setStartDate] = useState('');
  const [targetEndDate, setTargetEndDate] = useState('');
  const [draft, setDraft] = useState<InitiativeDraft | null>(null);
  const [assistantNote, setAssistantNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const dialogRef = useFocusTrap<HTMLDivElement>(open);
  /*
   * La ayuda por campo, disponible desde la primera línea que se escribe.
   * El botón grande de abajo estructura la necesidad entera; éstos ayudan a
   * redactar el campo que se tiene delante, que es lo que hace falta cuando
   * uno se queda mirando un formulario en blanco.
   */
  const captureSubject = useMemo(
    () => ({ title, need, priority, horizon }),
    [title, need, priority, horizon],
  );
  const capture = useInitiativeCapture(captureSubject);
  const assistant = capture.assistant;

  const plannedCode = useMemo(
    () => nextInitiativeCode(usedCodes, new Date().getFullYear()),
    [usedCodes],
  );

  const reset = useCallback(() => {
    setStep('need');
    setTitle('');
    setNeed('');
    setPriority('medium');
    setHorizon('next');
    setStartDate('');
    setTargetEndDate('');
    setDraft(null);
    setAssistantNote(null);
    setError(null);
    setSaving(false);
  }, []);

  const close = useCallback(() => {
    reset();
    // Una propuesta pendiente pertenece al registro que se estaba creando: si
    // sobreviviera al cierre reaparecería sobre la siguiente iniciativa.
    assistant.reset();
    onClose();
  }, [reset, assistant, onClose]);

  const runAssistant = useCallback(async () => {
    setError(null);
    setAssistantNote(null);
    setStep('drafting');
    const result = await onDraft({ title: title.trim(), need: need.trim() });
    if (result.draft) {
      setDraft(result.draft);
      // The assistant only names the initiative when the architect did not.
      if (!title.trim() && result.draft.suggestedTitle) setTitle(result.draft.suggestedTitle);
      if (result.draft.suggestedPriority) setPriority(result.draft.suggestedPriority);
    } else {
      setAssistantNote(result.reason ?? 'El asistente no está disponible. Continúa manualmente.');
    }
    setStep('review');
  }, [onDraft, title, need]);

  const skipAssistant = useCallback(() => {
    setDraft(null);
    setAssistantNote(null);
    setStep('review');
  }, []);

  const submit = useCallback(async () => {
    setSaving(true);
    setError(null);
    const result = await onSubmit({
      title: title.trim(),
      need: need.trim(),
      driver: draft?.driver ?? '',
      objectives: draft?.objectives ?? [],
      priority,
      horizon,
      startDate: startDate || undefined,
      targetEndDate: targetEndDate || undefined,
      draft: draft ?? undefined,
    });
    if (!result.ok) {
      setError(result.reason ?? 'No se pudo crear la iniciativa.');
      setSaving(false);
      return;
    }
    close();
  }, [onSubmit, title, need, draft, priority, horizon, startDate, targetEndDate, close]);

  if (!open) return null;

  const canDraft = title.trim().length > 0 && need.trim().length >= 20;
  const MotivationIcon = INITIATIVE_SECTION_ICONS.motivation;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="initiative-intake-title"
    >
      <div
        ref={dialogRef}
        className="max-h-[90dvh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-pop dark:bg-gray-900"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-gray-200 bg-white px-6 py-4 dark:border-gray-800 dark:bg-gray-900">
          <div className="flex gap-3">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ai-soft text-ai-700 dark:text-ai-300">
              <MotivationIcon className="h-5 w-5" aria-hidden strokeWidth={2} />
            </span>
            <div>
              <p className="text-2xs font-semibold uppercase tracking-widest-2 text-primary-600 dark:text-primary-400">
                {EA_LEVELS.initiative.plural}
              </p>
              <h2 id="initiative-intake-title" className="text-xl font-bold text-gray-900 dark:text-gray-100">
                Nueva {EA_LEVELS.initiative.singular.toLowerCase()}
              </h2>
              <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
                Se registrará como <span className="font-mono font-semibold">{plannedCode}</span>
              </p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={close}>Cerrar</Button>
        </div>

        <div className="space-y-5 px-6 py-5">
          {error && <Alert tone="danger">{error}</Alert>}

          {step === 'need' && (
            <div className="space-y-4">
              <Alert tone="info">
                {EA_LEVELS.initiative.definition}
              </Alert>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="initiative-title" className={fieldLabel}>
                    Título de la iniciativa
                  </label>
                  <CaptureAssist
                    fieldId="initiative.title"
                    assistant={assistant}
                    context={capture.context}
                    current={title}
                    apply={setTitle}
                  />
                </div>
                <Input
                  id="initiative-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Ej. Automatizar las pre-autorizaciones de baja complejidad"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="initiative-need" className={fieldLabel}>
                    ¿Qué necesita el negocio?
                  </label>
                  <CaptureAssist
                    fieldId="initiative.need"
                    assistant={assistant}
                    context={capture.context ?? {
                      // La necesidad es el punto de partida: aquí el contexto se
                      // ofrece siempre, y es el guardarraíl de `lib/capture` el
                      // que decide si hay bastante de lo que tirar.
                      level: 'initiative' as const,
                      subject: title,
                      known: [],
                      ancestry: [],
                    }}
                    current={need}
                    apply={setNeed}
                  />
                </div>
                <textarea
                  id="initiative-need"
                  value={need}
                  onChange={(event) => setNeed(event.target.value)}
                  rows={6}
                  placeholder="Describe la necesidad con las palabras del negocio. No hace falta que sea técnico."
                  className={cn(selectClass, 'resize-y leading-relaxed')}
                />
                <p className="text-2xs text-gray-500 dark:text-gray-400">
                  Este texto se conserva tal cual. El asistente propone la estructura alrededor,
                  nunca reescribe lo que dijo el negocio.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label htmlFor="initiative-priority" className={fieldLabel}>Prioridad</label>
                  <select
                    id="initiative-priority"
                    value={priority}
                    onChange={(event) => setPriority(event.target.value as InitiativePriority)}
                    className={selectClass}
                  >
                    {(Object.keys(PRIORITY_LABELS) as InitiativePriority[]).map((value) => (
                      <option key={value} value={value}>{PRIORITY_LABELS[value]}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="initiative-horizon" className={fieldLabel}>Horizonte</label>
                  <select
                    id="initiative-horizon"
                    value={horizon}
                    onChange={(event) => setHorizon(event.target.value as InitiativeHorizon)}
                    className={selectClass}
                  >
                    {(Object.keys(HORIZON_LABELS) as InitiativeHorizon[]).map((value) => (
                      <option key={value} value={value}>{HORIZON_LABELS[value]}</option>
                    ))}
                  </select>
                  <p className="text-2xs text-gray-500 dark:text-gray-400">{HORIZON_HINTS[horizon]}</p>
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="initiative-start" className={fieldLabel}>Inicio previsto</label>
                  <Input
                    id="initiative-start"
                    type="date"
                    value={startDate}
                    onChange={(event) => setStartDate(event.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="initiative-end" className={fieldLabel}>Fecha objetivo</label>
                  <Input
                    id="initiative-end"
                    type="date"
                    value={targetEndDate}
                    onChange={(event) => setTargetEndDate(event.target.value)}
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-gray-100 pt-4 dark:border-gray-800">
                <Button variant="secondary" onClick={skipAssistant} disabled={!title.trim() || !need.trim()}>
                  Continuar sin asistente
                </Button>
                <Button variant="primary" onClick={runAssistant} disabled={!canDraft}>
                  <WandSparkles className="mr-1.5 h-4 w-4" aria-hidden />
                  Estructurar con el asistente
                </Button>
              </div>
              {!canDraft && need.trim().length > 0 && need.trim().length < 20 && (
                <p className="text-right text-2xs text-gray-500 dark:text-gray-400">
                  Describe la necesidad con algo más de detalle para usar el asistente.
                </p>
              )}
            </div>
          )}

          {step === 'drafting' && (
            <div className="flex flex-col items-center gap-3 py-12" role="status">
              <Spinner />
              <p className="text-sm text-gray-600 dark:text-gray-300">
                El asistente está estructurando la necesidad…
              </p>
            </div>
          )}

          {step === 'review' && (
            <div className="space-y-4">
              {assistantNote && <Alert tone="warning">{assistantNote}</Alert>}

              <Card tone="muted" className="space-y-1.5">
                <p className="text-2xs font-semibold uppercase tracking-widest-2 text-gray-500 dark:text-gray-400">
                  Necesidad del negocio · registrada sin cambios
                </p>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700 dark:text-gray-200">
                  {need.trim()}
                </p>
              </Card>

              <InitiativeDraftReview draft={draft} />

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-4 dark:border-gray-800">
                <Button variant="ghost" onClick={() => setStep('need')}>Volver</Button>
                <div className="flex gap-2">
                  {draft && (
                    <Button variant="secondary" onClick={() => setDraft(null)}>
                      Descartar la propuesta
                    </Button>
                  )}
                  <Button variant="primary" onClick={submit} loading={saving}>
                    Crear iniciativa
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default InitiativeIntakeWizard;
