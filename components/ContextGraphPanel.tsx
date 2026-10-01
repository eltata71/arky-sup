/** The recorded generation context. Opening this panel never rebuilds a prompt. */
import React, { useState } from 'react';
import { Badge, Button, EmptyState } from './ui';
import type { Artifact } from '../lib/artifacts';

interface ContextGraphPanelProps {
  projectId: string;
  artifact: Artifact;
}

export const ContextGraphPanel: React.FC<ContextGraphPanelProps> = ({ artifact }) => {
  const [copied, setCopied] = useState(false);
  const manifest = artifact.generationTrace?.contextManifest;
  if (!manifest || manifest.version !== 1 || !manifest.records.length) {
    return <EmptyState title="Sin registro histórico" description="Este artefacto no tiene un registro del contexto de su generación. Una nueva generación guardará ese contexto; el estado actual del proyecto no permite reconstruirlo con certeza." />;
  }
  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(manifest, null, 2));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Contexto registrado durante la generación original y sus revisiones automáticas. Los cambios posteriores del proyecto o del artefacto no modifican este registro.
      </p>
      <p className="text-xs text-gray-500 dark:text-gray-400">Registrado: <time dateTime={manifest.capturedAt}>{manifest.capturedAt}</time></p>
      {artifact.generationTrace?.status === 'fallback' && <p className="text-xs text-amber-700 dark:text-amber-400">La generación terminó con contenido de respaldo. Este registro describe el contexto preparado para los intentos de IA.</p>}
      {manifest.records.map((record, index) => (
        <section key={index} className="space-y-2 rounded-lg border border-gray-200 dark:border-gray-800 p-3">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{record.label} {record.profile && <Badge tone="gray" size="xs">{record.profile}</Badge>}</h3>
          <ul className="text-xs text-gray-500 dark:text-gray-400">
            {record.sources.map((source, sourceIndex) => <li key={`${source.id}-${sourceIndex}`}>{source.label} · {source.id} · {source.revision === undefined ? 'revisión no disponible' : `revisión ${source.revision}`}</li>)}
          </ul>
          {record.sections.map((section, sectionIndex) => (
            <details key={sectionIndex} className="text-sm text-gray-800 dark:text-gray-100">
              <summary className="cursor-pointer font-medium">{section.scope} ({section.items.length})</summary>
              <ul className="mt-2 space-y-2">
                {section.items.map((item, itemIndex) => <li key={itemIndex} className="whitespace-pre-wrap break-words text-xs">{item.text}{item.truncated && <span className="block text-amber-700 dark:text-amber-400">Fuente recortada para esta operación</span>}</li>)}
              </ul>
            </details>
          ))}
          {record.citations?.length ? <details className="text-sm text-gray-800 dark:text-gray-100">
            <summary className="cursor-pointer font-medium">Citas numeradas ({record.citations.length})</summary>
            <ul className="mt-2 space-y-1 text-xs">{record.citations.map((citation) => <li key={citation.tag}><code>{citation.tag}</code> {citation.label}{citation.sources.length > 0 && <span className="text-gray-500 dark:text-gray-400"> · {citation.sources.join(', ')}</span>}</li>)}</ul>
          </details> : null}
          {record.omitted.length > 0 && <div className="text-xs text-gray-500 dark:text-gray-400">
            <p className="font-medium">Contexto excluido</p>
            <ul>{record.omitted.map((item, omissionIndex) => <li key={omissionIndex}>{item.scope}: {item.count} · {item.reason}</li>)}</ul>
          </div>}
        </section>
      ))}
      <Button size="xs" variant="secondary" onClick={handleCopy} className="w-full">{copied ? 'Registro copiado ✓' : 'Copiar registro de contexto'}</Button>
    </div>
  );
};

export default ContextGraphPanel;
