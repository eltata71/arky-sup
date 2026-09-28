import React, { useId, useState } from 'react';
import type { Artifact } from '../../../lib/artifacts';
import type { DiagramScene } from '../../../lib/diagram';
import { useAppContext } from '../../../context/AppContext';
import { useToast } from '../../../context/ToastContext';
import { useDiagramStoryEditor, type StoryDraft } from '../../../hooks/artifacts/useDiagramStoryEditor';
import { Alert, Badge, Button, Drawer } from '../../ui';
import { ArrowLeftIcon, ArrowRightIcon, PlusIcon, TrashIcon } from '../../Icons';

export interface DiagramStoryEditorPanelBodyProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  artifact: Artifact;
  /** La versión nueva con la historia: el lienzo pasa a mostrarla. */
  onVersionCreated: (versionId: string) => void;
}

const FIELD = 'w-full rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/40 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100';
const SECTION = 'mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400';

type Editor = ReturnType<typeof useDiagramStoryEditor>;

const AUTHORSHIP: Record<StoryDraft['authorship'], { label: string; tone: 'success' | 'warning' | 'gray'; hint: string }> = {
  authored: { label: 'Historia escrita', tone: 'success', hint: 'El modo presentación recorre estas escenas en este orden.' },
  derived: { label: 'Historia derivada', tone: 'warning', hint: 'Nadie la ha escrito: el recorrido sale de la topología. Al editarla pasa a ser tuya.' },
  none: { label: 'Sin historia', tone: 'gray', hint: 'El modo presentación deriva un recorrido del grafo hasta que escribas uno.' },
};

/**
 * «Editar historia»: el mensaje, las escenas en su orden y las anotaciones que
 * recorre el modo presentación (plan de diagramas, 4.3).
 *
 * Cada gesto es una operación del motor de patches sobre un borrador; nada se
 * guarda hasta pulsar Guardar, y se guarda como una versión nueva. Ordenar es
 * con botones, no arrastrando: un orden que sólo se cambia arrastrando deja
 * fuera a quien usa teclado.
 */
const DiagramStoryEditorPanelBody: React.FC<DiagramStoryEditorPanelBodyProps> = ({
  isOpen,
  onClose,
  projectId,
  artifact,
  onVersionCreated,
}) => {
  const { restoreArtifactVersion } = useAppContext();
  const { addToast } = useToast();
  const editor = useDiagramStoryEditor({ projectId, artifact, restoreArtifactVersion });
  const { draft } = editor;

  const handleSave = () => {
    const result = editor.save();
    if (!result.ok) {
      addToast(result.reason, 'warning');
      return;
    }
    addToast(`Historia guardada: ${result.summary.length} cambio${result.summary.length === 1 ? '' : 's'}. La versión anterior queda en el historial.`, 'success');
    onVersionCreated(result.versionId);
    onClose();
  };

  const footer = editor.pending > 0 ? (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-gray-500 dark:text-gray-400">{editor.pending} cambio{editor.pending === 1 ? '' : 's'} sin guardar</span>
      <div className="flex gap-2">
        <Button variant="ghost" onClick={editor.discard}>Descartar</Button>
        <Button variant="primary" onClick={handleSave}>Guardar como versión nueva</Button>
      </div>
    </div>
  ) : undefined;

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title="Editar historia"
      description="Qué cuenta el diagrama y en qué orden lo recorre el modo presentación."
      size="md"
      footer={footer}
    >
      {!draft ? (
        <Alert tone="neutral" title="No hay diagrama">
          Este artefacto no tiene un diagrama estructurado sobre el que escribir una historia.
        </Alert>
      ) : (
        <div className="space-y-6">
          <div className="flex items-start gap-2">
            <Badge tone={AUTHORSHIP[draft.authorship].tone}>{AUTHORSHIP[draft.authorship].label}</Badge>
            <p className="text-xs text-gray-600 dark:text-gray-300">{AUTHORSHIP[draft.authorship].hint}</p>
          </div>
          <div role="status" aria-live="polite">
            {editor.lastRejection && <p className="text-xs text-amber-700 dark:text-amber-300">{editor.lastRejection}</p>}
          </div>
          <MessageField draft={draft} editor={editor} />
          <ScenesSection draft={draft} editor={editor} />
          <CalloutsSection draft={draft} editor={editor} />
        </div>
      )}
    </Drawer>
  );
};

const MessageField: React.FC<{ draft: StoryDraft; editor: Editor }> = ({ draft, editor }) => {
  const id = useId();
  return (
    <section>
      <label htmlFor={id} className={SECTION}>Mensaje principal</label>
      <textarea
        id={id}
        key={draft.message}
        defaultValue={draft.message}
        rows={2}
        maxLength={280}
        placeholder="La frase que el diagrama defiende. Ej.: «Toda reserva pasa por una única API que audita el acceso»."
        onBlur={(event) => { if (event.target.value.trim() !== draft.message) editor.setMessage(event.target.value); }}
        className={FIELD}
      />
    </section>
  );
};

const ScenesSection: React.FC<{ draft: StoryDraft; editor: Editor }> = ({ draft, editor }) => {
  const [title, setTitle] = useState('');
  const id = useId();
  const add = () => {
    if (editor.addScene(title.trim() || `Escena ${draft.scenes.length + 1}`)) setTitle('');
  };
  return (
    <section aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`} className={SECTION}>Escenas ({draft.scenes.length})</h3>
      {draft.scenes.length === 0 && (
        <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">Sin escenas escritas. Cada escena enfoca unos nodos y dice qué deben ver.</p>
      )}
      <ol className="space-y-3">
        {draft.scenes.map((scene, index) => (
          <SceneItem key={scene.id} scene={scene} index={index} total={draft.scenes.length} draft={draft} editor={editor} />
        ))}
      </ol>
      <div className="mt-3 flex gap-2">
        <label htmlFor={id} className="sr-only">Título de la nueva escena</label>
        <input
          id={id}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); add(); } }}
          placeholder="Título de la nueva escena"
          className={FIELD}
        />
        <Button variant="secondary" onClick={add} leftIcon={<PlusIcon className="h-4 w-4" />}>Añadir</Button>
      </div>
    </section>
  );
};

const SceneItem: React.FC<{ scene: DiagramScene; index: number; total: number; draft: StoryDraft; editor: Editor }> = ({
  scene, index, total, draft, editor,
}) => {
  const titleId = useId();
  const insightId = useId();
  const focus = new Set(scene.focusNodeIds ?? []);
  const toggle = (nodeId: string) => {
    const next = focus.has(nodeId) ? [...focus].filter((id) => id !== nodeId) : [...focus, nodeId];
    editor.setSceneFocus(scene.id, next);
  };
  return (
    <li className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400" aria-hidden="true">{index + 1}.</span>
        <label htmlFor={titleId} className="sr-only">Título de la escena {index + 1}</label>
        <input
          id={titleId}
          key={scene.title}
          defaultValue={scene.title}
          onBlur={(event) => { if (event.target.value.trim() && event.target.value.trim() !== scene.title) editor.renameScene(scene.id, event.target.value); }}
          className={FIELD}
        />
        <IconButton label={`Subir la escena ${index + 1}`} disabled={index === 0} onClick={() => editor.moveScene(scene.id, index - 1)}>
          <ArrowLeftIcon className="h-4 w-4 rotate-90" />
        </IconButton>
        <IconButton label={`Bajar la escena ${index + 1}`} disabled={index === total - 1} onClick={() => editor.moveScene(scene.id, index + 1)}>
          <ArrowRightIcon className="h-4 w-4 rotate-90" />
        </IconButton>
        <IconButton label={`Eliminar la escena ${index + 1}`} onClick={() => editor.removeScene(scene.id)}>
          <TrashIcon className="h-4 w-4" />
        </IconButton>
      </div>
      <label htmlFor={insightId} className="mt-2 block text-xs text-gray-600 dark:text-gray-300">Qué debe ver quien mira</label>
      <textarea
        id={insightId}
        key={scene.insight ?? ''}
        defaultValue={scene.insight ?? ''}
        rows={2}
        onBlur={(event) => { if (event.target.value.trim() !== (scene.insight ?? '')) editor.setSceneInsight(scene.id, event.target.value); }}
        className={`${FIELD} mt-1`}
      />
      <fieldset className="mt-2">
        <legend className="text-xs text-gray-600 dark:text-gray-300">Enfoca ({focus.size})</legend>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
          {draft.nodes.map((node) => (
            <label key={node.id} className="inline-flex items-center gap-1 text-xs text-gray-700 dark:text-gray-200">
              <input type="checkbox" checked={focus.has(node.id)} onChange={() => toggle(node.id)} />
              {node.label}
            </label>
          ))}
        </div>
      </fieldset>
    </li>
  );
};

const SEVERITIES = [
  { value: 'info', label: 'Información' },
  { value: 'warning', label: 'Advertencia' },
  { value: 'critical', label: 'Crítico' },
] as const;

const CalloutsSection: React.FC<{ draft: StoryDraft; editor: Editor }> = ({ draft, editor }) => {
  const id = useId();
  const targets = [...draft.nodes, ...draft.edges];
  const [targetId, setTargetId] = useState(targets[0]?.id ?? '');
  const [text, setText] = useState('');
  const [severity, setSeverity] = useState<(typeof SEVERITIES)[number]['value']>('info');
  const labelOf = new Map(targets.map((target) => [target.id, target.label] as const));
  const add = () => {
    if (editor.addCallout(targetId, text, severity)) setText('');
  };
  return (
    <section aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`} className={SECTION}>Anotaciones ({draft.callouts.length})</h3>
      <ul className="space-y-2">
        {draft.callouts.map((callout) => (
          <li key={callout.id} className="flex items-start justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm dark:bg-gray-800/60">
            <span>
              <span className="font-medium text-gray-800 dark:text-gray-100">{labelOf.get(callout.targetId) ?? callout.targetId}:</span>{' '}
              <span className="text-gray-700 dark:text-gray-200">{callout.text}</span>
            </span>
            <IconButton label={`Quitar la anotación sobre ${labelOf.get(callout.targetId) ?? callout.targetId}`} onClick={() => editor.removeCallout(callout.id)}>
              <TrashIcon className="h-4 w-4" />
            </IconButton>
          </li>
        ))}
      </ul>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="text-xs text-gray-600 dark:text-gray-300">
          Sobre
          <select value={targetId} onChange={(event) => setTargetId(event.target.value)} className={`${FIELD} mt-1`}>
            {targets.map((target) => <option key={target.id} value={target.id}>{target.label}</option>)}
          </select>
        </label>
        <label className="text-xs text-gray-600 dark:text-gray-300">
          Importancia
          <select value={severity} onChange={(event) => setSeverity(event.target.value as typeof severity)} className={`${FIELD} mt-1`}>
            {SEVERITIES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="text-xs text-gray-600 dark:text-gray-300 sm:col-span-2">
          Lo que no hay que perderse
          <input value={text} maxLength={160} onChange={(event) => setText(event.target.value)} className={`${FIELD} mt-1`} />
        </label>
      </div>
      <Button className="mt-2" variant="secondary" disabled={!text.trim() || !targetId} onClick={add} leftIcon={<PlusIcon className="h-4 w-4" />}>
        Añadir anotación
      </Button>
    </section>
  );
};

const IconButton: React.FC<{ label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }> = ({ label, onClick, disabled, children }) => (
  <button
    type="button"
    aria-label={label}
    disabled={disabled}
    onClick={onClick}
    className="flex-shrink-0 rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-40 dark:hover:bg-gray-800 dark:hover:text-white"
  >
    <span aria-hidden="true">{children}</span>
  </button>
);

export default DiagramStoryEditorPanelBody;
