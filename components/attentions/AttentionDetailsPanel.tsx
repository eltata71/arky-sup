/**
 * La ficha del proyecto de arquitectura: lo que se mantiene de él después de
 * crearlo.
 *
 * Hasta ahora el segundo nivel se creaba conversando con el arquitecto IA y
 * después ya no había dónde arreglarlo: el nombre, la descripción y el contexto
 * quedaban como salieron de aquella conversación. Esta ficha cierra ese hueco y
 * lleva la misma ayuda por campo que la iniciativa y el entregable — el mismo
 * botón, el mismo agente, el mismo catálogo de reglas.
 *
 * Dos decisiones de comportamiento:
 *
 *  - **Se guarda al salir del campo**, no en cada tecla. Una escritura por
 *    pulsación contra Firestore es una factura y una carrera entre versiones.
 *  - **El contexto es una lista de hechos**, no un párrafo. Es lo que después
 *    viaja en cada prompt del proyecto, y una lista se puede quitar entrada a
 *    entrada cuando un hecho deja de ser cierto.
 *
 * La ficha son tres bloques, y este fichero los compone: **qué es** el proyecto
 * (aquí), **cómo va** (`AttentionTrackingPanel`) y **qué mueve** en la
 * iniciativa que lo justifica (`AttentionContributionPanel`). Se montan juntos
 * porque son la misma pregunta —«cuéntame de este proyecto»— hecha en tres
 * planos, y porque quien mantiene el nombre y la descripción es quien acaba de
 * enterarse de que el hito se ha movido.
 */

import React, { useCallback, useState } from 'react';
import { Badge, Button, Card, CardTitle, Input } from '../ui';
import { Plus, Trash2 } from 'lucide-react';
import { CaptureAssist, FormAssistBar } from '../capture';
import { useAttentionRecordCapture } from '../../hooks/useLevelCapture';
import { useAttentionInitiatives } from '../../hooks/useAttentionInitiatives';
import { AttentionTrackingPanel } from './AttentionTrackingPanel';
import { AttentionContributionPanel } from './AttentionContributionPanel';
import { EA_LEVELS } from '../../lib/eaTerminology';
import type { Project } from '../../types';
import type { ProjectAttentionTracking } from '../../services/architectureProjects';
import type { BusinessInitiative } from '../../services/businessInitiatives';

export interface AttentionDetailsPanelProps {
  project: Project;
  /** Las iniciativas registradas; la ficha usa las que este proyecto atiende. */
  initiatives: readonly BusinessInitiative[];
  onPatch: (patch: Partial<Pick<Project, 'name' | 'description' | 'projectContext'>>
    & { attention?: ProjectAttentionTracking }) => void;
  busy?: boolean;
}

const inputClass = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm leading-relaxed text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';

export const AttentionDetailsPanel: React.FC<AttentionDetailsPanelProps> = ({
  project,
  initiatives,
  onPatch,
  busy,
}) => {
  const capture = useAttentionRecordCapture(project, initiatives);
  // Las que este proyecto atiende de verdad, por la regla del portafolio: ids
  // primero, códigos sólo como migración.
  const servedInitiatives = useAttentionInitiatives(project, initiatives);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [descriptionDraft, setDescriptionDraft] = useState<string | null>(null);
  const [contextEntry, setContextEntry] = useState('');

  const addContext = useCallback((value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (project.projectContext.includes(trimmed)) return;
    onPatch({ projectContext: [...project.projectContext, trimmed] });
    setContextEntry('');
  }, [project.projectContext, onPatch]);

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle>Ficha del {EA_LEVELS.engagementProject.singular.toLowerCase()}</CardTitle>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              Lo que la Oficina sabe de este proyecto cada vez que trabaja en él.
            </p>
          </div>
          <Badge tone="gray" size="xs">{project.projectContext.length} hechos</Badge>
        </div>

        <FormAssistBar
          pendingCount={capture.pendingFields.length}
          onAsk={capture.askForm}
          loading={capture.formLoading}
          notice={capture.assistant.notice}
          openQuestions={capture.assistant.openQuestions}
          subject="la ficha de este proyecto"
        />

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="attention-name" className="text-2xs font-semibold uppercase tracking-widest-2 text-gray-500 dark:text-gray-400">
              Nombre
            </label>
            <CaptureAssist
              fieldId="attention.name"
              assistant={capture.assistant}
              context={capture.context}
              current={nameDraft ?? project.name}
              apply={(value) => { setNameDraft(null); onPatch({ name: value }); }}
            />
          </div>
          <Input
            id="attention-name"
            value={nameDraft ?? project.name}
            disabled={busy}
            onChange={(event) => setNameDraft(event.target.value)}
            onBlur={() => {
              if (nameDraft !== null && nameDraft.trim() && nameDraft !== project.name) {
                onPatch({ name: nameDraft.trim() });
              }
              setNameDraft(null);
            }}
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="attention-description" className="text-2xs font-semibold uppercase tracking-widest-2 text-gray-500 dark:text-gray-400">
              Descripción
            </label>
            <CaptureAssist
              fieldId="attention.description"
              assistant={capture.assistant}
              context={capture.context}
              current={descriptionDraft ?? project.description}
              apply={(value) => { setDescriptionDraft(null); onPatch({ description: value }); }}
            />
          </div>
          <textarea
            id="attention-description"
            rows={3}
            disabled={busy}
            value={descriptionDraft ?? project.description}
            onChange={(event) => setDescriptionDraft(event.target.value)}
            onBlur={() => {
              if (descriptionDraft !== null && descriptionDraft !== project.description) {
                onPatch({ description: descriptionDraft.trim() });
              }
              setDescriptionDraft(null);
            }}
            className={`${inputClass} resize-y`}
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-2xs font-semibold uppercase tracking-widest-2 text-gray-500 dark:text-gray-400">
              Contexto que condiciona el diseño
            </p>
            <CaptureAssist
              fieldId="attention.context"
              assistant={capture.assistant}
              context={capture.context}
              applied={project.projectContext}
              apply={setContextEntry}
            />
          </div>
          {project.projectContext.length === 0 ? (
            <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500 dark:bg-gray-900/50 dark:text-gray-400">
              Sin contexto capturado. Cada respuesta de la Oficina partirá sólo de la descripción.
            </p>
          ) : (
            <ul className="space-y-1">
              {project.projectContext.map((entry) => (
                <li key={entry} className="flex items-start gap-2 rounded-lg px-2 py-1 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary-400" aria-hidden />
                  <span className="min-w-0 flex-1 text-sm leading-relaxed text-gray-700 dark:text-gray-200">{entry}</span>
                  <button
                    type="button"
                    aria-label={`Quitar del contexto: ${entry}`}
                    disabled={busy}
                    onClick={() => onPatch({
                      projectContext: project.projectContext.filter((item) => item !== entry),
                    })}
                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-40 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <Input
              aria-label="Ej. El core de pólizas corre sobre AS/400 y no se sustituye en este alcance"
              value={contextEntry}
              onChange={(event) => setContextEntry(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') { event.preventDefault(); addContext(contextEntry); }
              }}
              placeholder="Ej. El core de pólizas corre sobre AS/400 y no se sustituye en este alcance"
              className="flex-1"
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={() => addContext(contextEntry)}
              disabled={busy || !contextEntry.trim()}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </div>
        </div>
      </Card>

      <AttentionTrackingPanel
        project={project}
        onPatch={onPatch}
        busy={busy}
      />

      <AttentionContributionPanel
        project={project}
        initiatives={servedInitiatives}
        onPatch={onPatch}
        busy={busy}
      />
    </div>
  );
};

export default AttentionDetailsPanel;
