/**
 * «Ver instrucción efectiva» y «Ensayar» de la ficha (16.6): dos lecturas del
 * borrador sin guardarlo, fuera del editor para que éste no crezca.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Badge, Button, Input } from '../../ui';
import { useUiTranslation } from '../../../lib/i18n/UiTranslationContext';
import { useAppContext } from '../../../context/AppContext';
import type {
  DraftAgentProfileState,
  DraftAgentRehearsalService,
  EffectiveInstructionPreview,
  RehearsalResult,
  RehearsalSampleQuestion,
} from '../../../services/architectureOffice/rehearsal';
import { sampleQuestionsFor } from '../../../services/architectureOffice/rehearsal';

const labelClass = 'text-2xs font-semibold uppercase tracking-widest-2 text-gray-500 dark:text-gray-400';

/**
 * El ensayo, cargado en diferido (16.6): el módulo llega a `projectConversation`
 * y, con él, a la capa de IA. Importarlo estático sumaba ~12 KB gz a la ruta
 * `/agents` —por encima de su techo—, y la ficha no necesita nada de eso hasta
 * que alguien pide ver el prompt o ensaya. `sampleQuestionsFor` es puro; se
 * importa estático y sin coste.
 */
let rehearsalService: Promise<DraftAgentRehearsalService> | null = null;
const rehearsalServicePromise = (): Promise<DraftAgentRehearsalService> => {
  rehearsalService ??= import('../../../services/architectureOffice/rehearsal')
    .then((module) => module.createDraftAgentRehearsal());
  return rehearsalService;
};

/** Las capas del prompt efectivo, con su nombre visible. */
const LAYER_LABELS: Record<EffectiveInstructionPreview['layers'][number]['id'], string> = {
  contexto: 'agent.capa-contexto.9ddb6e',
  contrato: '## Contrato del agente',
  organizacion: '## Contexto de tu organización',
  reglas: '## Reglas de la Oficina',
};

const formatUsd = (usd: number): string => `$${usd < 0.01 ? usd.toFixed(4) : usd.toFixed(2)}`;

/**
 * «Ver instrucción efectiva»: el texto exacto que una conversación real
 * enviaría como instrucción de sistema, partido en las capas del compositor
 * para poder marcarlas. Compartir la función con el ensayo garantiza que lo
 * que se lee es lo que se enviaría (16.6).
 */
const EffectiveInstructionPanel: React.FC<{ preview: EffectiveInstructionPreview | null; loading: boolean; error: string | null }> = ({
  preview,
  loading,
  error,
}) => {
  const t = useUiTranslation();
  if (loading) {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400" role="status">{t("agent.modelLoading")}</p>
    );
  }
  if (error) {
    return <Alert tone="danger" role="alert">{error}</Alert>;
  }
  if (!preview) return null;
  return (
    <div className="space-y-3">
      {preview.layers.map((layer) => (
        <div key={layer.id} className="rounded-xl border border-gray-200 p-3 dark:border-gray-800">
          <p className={labelClass}>{layer.header ? layer.header : t(LAYER_LABELS[layer.id])}</p>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-gray-700 dark:text-gray-200">{layer.text}</pre>
        </div>
      ))}
    </div>
  );
};

/**
 * «Ensayar»: una pregunta de prueba contra el borrador, sin guardar nada.
 * Una sola llamada, con tier y coste estimado visibles al lado de la respuesta.
 */
const RehearsalPanel: React.FC<{
  draft: DraftAgentProfileState;
  samples: RehearsalSampleQuestion[];
}> = ({ draft, samples }) => {
  const t = useUiTranslation();
  const { settings } = useAppContext();
  const [question, setQuestion] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RehearsalResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || running) return;
    setRunning(true);
    setError(null);
    try {
      const service = await rehearsalServicePromise();
      setResult(await service.rehearse({ question: trimmed, draft, settings }));
    } catch {
      setResult(null);
      setError(t('agent.ensayar-fallo.b8c209'));
    } finally {
      setRunning(false);
    }
  }, [draft, running, settings, t]);

  const kindLabel: Record<RehearsalSampleQuestion['kind'], string> = {
    'in-scope': t('agent.ejemplo-alcance.8951f7'),
    work: t('agent.ejemplo-trabajo.96d2f4'),
    'out-of-scope': t('agent.ejemplo-fuera.6fae8a'),
  };

  return (
    <div className="space-y-3 rounded-xl border border-gray-200 p-3 dark:border-gray-800">
      <label htmlFor="agent-rehearsal-question" className={labelClass}>{t('agent.pregunta-prueba.e476fb')}</label>
      <p className="text-2xs text-gray-500 dark:text-gray-400">{t('agent.ensayar-hint.975f23')}</p>
      <div className="flex gap-2">
        <Input
          id="agent-rehearsal-question"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void run(question); } }}
          placeholder={t('agent.pregunta-prueba.e476fb')}
          className="flex-1"
        />
        <Button variant="secondary" size="sm" onClick={() => { void run(question); }} loading={running} disabled={!question.trim()}>
          {t('agent.ensayar.5cf174')}
        </Button>
      </div>
      {samples.length > 0 && (
        <div className="space-y-1.5">
          <p className={labelClass}>{t('agent.preguntas-ejemplo.f72fab')}</p>
          <ul className="space-y-1">
            {samples.map((sample) => (
              <li key={sample.kind} className="flex items-start gap-2">
                <Badge tone={sample.kind === 'out-of-scope' ? 'warning' : 'gray'} size="xs" outline>{kindLabel[sample.kind]}</Badge>
                <button
                  type="button"
                  onClick={() => { setQuestion(sample.text); void run(sample.text); }}
                  disabled={running}
                  className="min-w-0 flex-1 text-left text-sm leading-relaxed text-gray-700 hover:text-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-gray-200 dark:hover:text-primary-300"
                >
                  {sample.text}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && <Alert tone="danger" role="alert">{error}</Alert>}
      {result && (
        <div className="space-y-2 rounded-lg bg-gray-50 p-3 dark:bg-gray-900/50" role="status">
          <p className={labelClass}>{t('agent.respuesta-ensayo.6db54e')}</p>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700 dark:text-gray-200">{result.answer}</p>
          <p className="text-2xs text-gray-500 dark:text-gray-400">
            {t('agent.nivel-modelo.ada9db')}: {result.tier}
            {result.model ? ` · ${result.model}` : ''}
            {' · '}{t('agent.latencia.4f0d37')}: {result.latencyMs} ms
            {result.estimatedCostUsd !== null ? ` · ${t('agent.coste-estimado.464251')}: ${formatUsd(result.estimatedCostUsd)}` : ''}
          </p>
        </div>
      )}
    </div>
  );
};

export interface AgentRehearsalSectionProps {
  agentId: string;
  draft: DraftAgentProfileState;
}

export const AgentRehearsalSection: React.FC<AgentRehearsalSectionProps> = ({ agentId, draft }) => {
  const t = useUiTranslation();
  const { settings } = useAppContext();
  /** Cargada bajo demanda, nunca al abrir la ficha. */
  const [preview, setPreview] = useState<EffectiveInstructionPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const samples = useMemo(() => sampleQuestionsFor(agentId as DraftAgentProfileState['agentId']), [agentId]);

  const showEffectiveInstruction = useCallback(() => {
    setPreviewLoading(true);
    setPreviewError(null);
    void rehearsalServicePromise()
      .then((service) => service.previewInstruction(draft, settings))
      .then(setPreview)
      .catch(() => setPreviewError(t('agent.ensayar-fallo.b8c209')))
      .finally(() => setPreviewLoading(false));
  }, [draft, settings, t]);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={showEffectiveInstruction} loading={previewLoading}>
          {t('agent.ver-instruccion-efectiva.ec98a9')}
        </Button>
      </div>
      <p className="text-2xs text-gray-500 dark:text-gray-400">
        {t('agent.probar-antes-de-guardar.732143')}
      </p>
      {(preview || previewLoading || previewError) && (
        <EffectiveInstructionPanel preview={preview} loading={previewLoading} error={previewError} />
      )}
      <RehearsalPanel draft={draft} samples={samples} />
    </>
  );
};
