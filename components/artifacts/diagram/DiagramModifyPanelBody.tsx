import React, { useEffect, useId, useState } from 'react';
import type { Artifact } from '../../../lib/artifacts';
import { useAppContext } from '../../../context/AppContext';
import { useToast } from '../../../context/ToastContext';
import { aiChangeStore } from '../../../services/artifacts/application/aiChangeSummary';
import { useAiUndo } from '../../../hooks/artifacts/useAiUndo';
import { useDiagramModification } from '../../../hooks/artifacts/useDiagramModification';
import { Alert, Button, Drawer } from '../../ui';
import { SparklesIcon } from '../../Icons';

export interface DiagramModifyPanelBodyProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  artifact: Artifact;
  /** La versión nueva que creó el cambio: el lienzo pasa a mostrarla. */
  onVersionCreated: (versionId: string) => void;
}

const MAX_INSTRUCTION = 500;

const EXAMPLES = [
  'Resalta el flujo de autenticación',
  'Añade una caché entre la API y la base de datos',
  'Agrupa los servicios de datos en una zona',
];

/**
 * «Modificar diagrama»: una frase, una propuesta, un clic.
 *
 * La vista previa es la del motor de patches —lo que el cambio haría de
 * verdad, con sus cascadas y lo que no se pudo aplicar— y nada se guarda
 * hasta pulsar Aplicar. Se guarda como versión nueva, así que la anterior
 * sigue en el historial.
 *
 * Es el cuerpo diferido de `DiagramModifyPanel`: sólo se descarga al abrirlo.
 */
const DiagramModifyPanelBody: React.FC<DiagramModifyPanelBodyProps> = ({
  isOpen,
  onClose,
  projectId,
  artifact,
  onVersionCreated,
}) => {
  const { settings, restoreArtifactVersion, getProject } = useAppContext();
  const { addToast } = useToast();
  const { offerUndo } = useAiUndo();
  const { state, canModify, propose, apply, discard } = useDiagramModification({
    projectId,
    artifact,
    settings,
    project: getProject(projectId),
    restoreArtifactVersion,
  });
  const [instruction, setInstruction] = useState('');
  const fieldId = useId();

  // Cerrar el panel cancela lo que esté en vuelo y olvida la propuesta.
  useEffect(() => {
    if (!isOpen) discard();
  }, [isOpen, discard]);

  const busy = state.status === 'proposing';
  const trimmed = instruction.trim();

  const submit = () => {
    if (!trimmed || busy) return;
    void propose(trimmed);
  };

  const handleApply = () => {
    const result = apply();
    if (!result.ok) {
      addToast(result.reason, 'warning');
      return;
    }
    const count = result.summary.length;
    offerUndo({
      projectId,
      label: 'modificación del diagrama',
      steps: [{ before: artifact, producedId: result.versionId }],
      onUndone: ([restored]) => onVersionCreated(restored.id),
    }, `Diagrama modificado: ${count} cambio${count === 1 ? '' : 's'}. La versión anterior queda en el historial.`);
    aiChangeStore.set(result.change);
    setInstruction('');
    onVersionCreated(result.versionId);
    onClose();
  };

  const footer = state.status === 'ready' ? (
    <div className="flex justify-end gap-2">
      <Button variant="ghost" onClick={discard}>Descartar</Button>
      <Button variant="primary" onClick={handleApply}>Aplicar como versión nueva</Button>
    </div>
  ) : undefined;

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title="Modificar diagrama"
      description="Describe el cambio. El asistente propone operaciones sobre el diagrama actual y no se guarda nada hasta que lo apliques."
      size="md"
      footer={footer}
    >
      {!canModify ? (
        <Alert tone="neutral" title="No hay diagrama que modificar">
          Este artefacto no tiene un diagrama estructurado. Genera o corrige el diagrama y vuelve a intentarlo.
        </Alert>
      ) : (
        <div className="space-y-5">
          <form
            className="space-y-3"
            onSubmit={(event) => { event.preventDefault(); submit(); }}
          >
            <label htmlFor={fieldId} className="block text-sm font-medium text-gray-800 dark:text-gray-100">
              ¿Qué quieres cambiar?
            </label>
            <textarea
              id={fieldId}
              value={instruction}
              maxLength={MAX_INSTRUCTION}
              rows={3}
              disabled={busy}
              onChange={(event) => setInstruction(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); submit(); }
              }}
              placeholder="Ej.: Renombra «API» a «API Gateway» y conéctala al servicio de auditoría"
              className="w-full resize-y rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/40 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
            />
            <div className="flex flex-wrap gap-1.5" aria-label="Ejemplos">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  disabled={busy}
                  onClick={() => setInstruction(example)}
                  className="rounded-full border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  {example}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Button type="submit" variant="ai" loading={busy} disabled={!trimmed} leftIcon={<SparklesIcon className="h-4 w-4" />}>
                Proponer cambio
              </Button>
              {busy && <Button type="button" variant="ghost" onClick={discard}>Cancelar</Button>}
            </div>
          </form>

          <div role="status" aria-live="polite">
            {busy && <p className="text-sm text-gray-600 dark:text-gray-300">Preparando la propuesta…</p>}

            {state.status === 'refused' && (
              <Alert tone="warning" title="No se propuso ningún cambio">
                <p>{state.reason}</p>
                <RejectionList rejected={state.rejected} />
              </Alert>
            )}

            {state.status === 'ready' && (
              <section aria-label="Vista previa del cambio" className="space-y-4">
                {state.proposal.patch.rationale && (
                  <p className="border-l-2 border-primary-400 pl-3 text-sm italic text-gray-700 dark:text-gray-200">
                    {state.proposal.patch.rationale}
                  </p>
                )}
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    Lo que hará ({state.proposal.applied.length})
                  </h3>
                  <ul className="space-y-2">
                    {state.proposal.applied.map((entry) => (
                      <li key={entry.index} className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 dark:border-gray-700 dark:text-gray-100">
                        {entry.description}
                        {entry.cascaded && entry.cascaded.length > 0 && (
                          <ul className="mt-1 list-disc pl-5 text-xs text-amber-700 dark:text-amber-300">
                            {entry.cascaded.map((line) => <li key={line}>También: {line}</li>)}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
                <RejectionList rejected={state.proposal.rejected} />
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Si ajustaste posiciones a mano, se conservan; los elementos nuevos aparecen bajo el diagrama para que los coloques.
                </p>
              </section>
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
};

const RejectionList: React.FC<{ rejected: ReadonlyArray<{ index: number; message: string }> }> = ({ rejected }) => {
  if (rejected.length === 0) return null;
  return (
    <div>
      <h3 className="mb-1 mt-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        No aplicable ({rejected.length})
      </h3>
      <ul className="list-disc space-y-1 pl-5 text-xs text-gray-600 dark:text-gray-300">
        {rejected.map((entry) => <li key={entry.index}>{entry.message}</li>)}
      </ul>
    </div>
  );
};

export default DiagramModifyPanelBody;
