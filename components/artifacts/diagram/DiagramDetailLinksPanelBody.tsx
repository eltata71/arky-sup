import React, { useId } from 'react';
import type { Artifact } from '../../../lib/artifacts';
import { useAppContext } from '../../../context/AppContext';
import { useToast } from '../../../context/ToastContext';
import { useDiagramDetailLinks, type DetailLinkRow } from '../../../hooks/artifacts/useDiagramDetailLinks';
import { Alert, Drawer } from '../../ui';
import { ArrowRightIcon, ExclamationTriangleIcon } from '../../Icons';

export interface DiagramDetailLinksPanelBodyProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  artifact: Artifact;
  /** Todos los artefactos del proyecto: sólo ellos se pueden enlazar. */
  projectArtifacts: readonly Artifact[];
  /** La versión nueva que creó el enlace: el lienzo pasa a mostrarla. */
  onVersionCreated: (versionId: string) => void;
  /** Abrir el diagrama de detalle (la última versión de su grupo). */
  onOpenArtifact: (artifactId: string) => void;
}

const NONE = '';

/**
 * «Niveles C4»: qué diagrama detalla cada nodo (plan de diagramas, 4.1).
 *
 * El selector sólo ofrece diagramas de este proyecto —con el nivel C4 que se
 * espera debajo primero— y cada cambio se guarda como versión nueva. Un enlace
 * cuyo diagrama ya no existe se muestra como roto y sigue ahí hasta que
 * alguien lo cambie o lo quite: descartarlo en silencio sería perder trabajo.
 *
 * Es el cuerpo diferido de `DiagramDetailLinksPanel`.
 */
const DiagramDetailLinksPanelBody: React.FC<DiagramDetailLinksPanelBodyProps> = ({
  isOpen,
  onClose,
  projectId,
  artifact,
  projectArtifacts,
  onVersionCreated,
  onOpenArtifact,
}) => {
  const { restoreArtifactVersion } = useAppContext();
  const { addToast } = useToast();
  const { hasDiagram, rows, candidates, expectedLabel, setLink } = useDiagramDetailLinks({
    projectId,
    artifact,
    projectArtifacts,
    restoreArtifactVersion,
  });
  const broken = rows.filter((row) => row.link?.status === 'broken').length;

  const handleChange = (row: DetailLinkRow, value: string) => {
    const result = setLink(row.nodeId, value === NONE ? null : value);
    if (!result.ok) {
      if (!result.unchanged) addToast(result.reason, 'warning');
      return;
    }
    addToast(`${result.summary} La versión anterior queda en el historial.`, 'success');
    onVersionCreated(result.versionId);
  };

  const description = expectedLabel
    ? `Enlaza cada nodo con el diagrama que lo detalla; lo esperado debajo es ${expectedLabel}. Doble clic en un nodo enlazado lo abre.`
    : 'Enlaza cada nodo con el diagrama que lo detalla. Doble clic en un nodo enlazado lo abre.';

  return (
    <Drawer isOpen={isOpen} onClose={onClose} title="Niveles C4" description={description} size="md">
      {!hasDiagram ? (
        <Alert tone="neutral" title="No hay diagrama que enlazar">
          Este artefacto no tiene un diagrama estructurado. Genera o corrige el diagrama y vuelve a intentarlo.
        </Alert>
      ) : (
        <div className="space-y-4">
          {candidates.length === 0 && (
            <Alert tone="info" title="Todavía no hay otro diagrama en el proyecto">
              Crea el diagrama del nivel siguiente{expectedLabel ? ` (${expectedLabel})` : ''} y vuelve aquí para enlazarlo.
            </Alert>
          )}
          {broken > 0 && (
            <Alert tone="warning" title={`${broken} enlace${broken === 1 ? '' : 's'} roto${broken === 1 ? '' : 's'}`}>
              El diagrama enlazado ya no está en el proyecto. El enlace se conserva hasta que lo cambies o lo quites.
            </Alert>
          )}
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {rows.map((row) => (
              <DetailLinkRowItem
                key={row.nodeId}
                row={row}
                candidates={candidates}
                onChange={(value) => handleChange(row, value)}
                onOpen={onOpenArtifact}
              />
            ))}
          </ul>
        </div>
      )}
    </Drawer>
  );
};

const DetailLinkRowItem: React.FC<{
  row: DetailLinkRow;
  candidates: ReturnType<typeof useDiagramDetailLinks>['candidates'];
  onChange: (value: string) => void;
  onOpen: (artifactId: string) => void;
}> = ({ row, candidates, onChange, onOpen }) => {
  const selectId = useId();
  const link = row.link;
  return (
    <li className="flex flex-col gap-1.5 py-3">
      <label htmlFor={selectId} className="text-sm font-medium text-gray-800 dark:text-gray-100">{row.label}</label>
      <div className="flex items-center gap-2">
        <select
          id={selectId}
          value={link?.groupId ?? NONE}
          onChange={(event) => onChange(event.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/40 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
        >
          <option value={NONE}>Sin diagrama de detalle</option>
          {link?.status === 'broken' && <option value={link.groupId}>Enlace roto (el diagrama ya no existe)</option>}
          {candidates.map((candidate) => (
            <option key={candidate.groupId} value={candidate.groupId}>
              {candidate.name}{candidate.levelLabel ? ` — ${candidate.levelLabel}` : ''}{candidate.recommended ? ' (nivel siguiente)' : ''}
            </option>
          ))}
        </select>
        {link?.status === 'resolved' && (
          <button
            type="button"
            onClick={() => onOpen(link.target.artifactId)}
            aria-label={`Abrir «${link.target.name}», el detalle de ${row.label}`}
            className="inline-flex flex-shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-primary-700 hover:bg-primary-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-primary-300 dark:hover:bg-primary-900/30"
          >
            Abrir <ArrowRightIcon className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
      {link?.status === 'broken' && (
        <p className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300">
          <ExclamationTriangleIcon className="h-3.5 w-3.5" aria-hidden="true" />
          Enlace roto: el diagrama de detalle ya no está en el proyecto.
        </p>
      )}
    </li>
  );
};

export default DiagramDetailLinksPanelBody;
