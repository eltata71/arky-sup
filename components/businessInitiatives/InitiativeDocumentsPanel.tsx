/**
 * Los documentos que sostienen una iniciativa.
 *
 * Vive aparte de los otros paneles porque no es de la misma clase: los demás
 * capturan la estructura de la motivación —objetivos, resultados, indicadores,
 * riesgos— y éste adjunta evidencia externa. Tampoco tiene asistencia de
 * captura, y no por falta de tiempo: un asistente que «proponga» un documento
 * de soporte estaría inventando una fuente, que es exactamente lo que
 * `lib/capture` existe para impedir.
 */

import React, { useCallback, useState } from 'react';
import { Badge, Button, Input } from '../ui';
import { Plus } from 'lucide-react';
import { EmptyRow, RemoveButton, SectionCard, selectClass } from './panelPrimitives';
import { DOCUMENT_KIND_LABELS, formatDate, INITIATIVE_SECTION_ICONS } from './initiativeUiLabels';
// Por el barril y no por la ruta profunda: este fichero es nuevo, y el
// presupuesto de imports profundos sólo puede bajar. La pantalla que lo monta
// es perezosa, así que la puerta correcta es la principal.
import {
  newDocumentId,
  type InitiativeDocument,
  type InitiativeDocumentKind,
} from '../../services/businessInitiatives';
import type { PanelProps } from './InitiativeDetailPanels';

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export const DocumentsPanel: React.FC<PanelProps & { addedBy: string }> = ({
  initiative, onPatch, busy, addedBy,
}) => {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<InitiativeDocumentKind>('business-case');
  const [url, setUrl] = useState('');
  const [content, setContent] = useState('');
  const [showPaste, setShowPaste] = useState(false);

  const addDocument = useCallback(() => {
    const trimmedName = name.trim();
    const trimmedUrl = url.trim();
    const trimmedContent = content.trim();
    if (!trimmedName || (!trimmedUrl && !trimmedContent)) return;
    const document: InitiativeDocument = {
      id: newDocumentId(),
      name: trimmedName,
      kind,
      url: trimmedUrl || undefined,
      content: trimmedContent || undefined,
      addedAt: new Date().toISOString(),
      addedBy,
    };
    onPatch({ documents: [...initiative.documents, document] });
    setName(''); setUrl(''); setContent(''); setShowPaste(false);
  }, [name, kind, url, content, addedBy, initiative.documents, onPatch]);

  return (
    <SectionCard
      id="documentos"
      icon={INITIATIVE_SECTION_ICONS.documents}
      title="Documentos de soporte"
      hint="Enlaza el documento donde ya vive, o pega su contenido si no existe en otro sitio."
      count={initiative.documents.length}
    >
      {initiative.documents.length === 0 ? (
        <EmptyRow>Sin documentos. El caso de negocio y la normativa aplicable suelen ir aquí.</EmptyRow>
      ) : (
        <ul className="space-y-1.5">
          {initiative.documents.map((document) => (
            <li key={document.id} className="flex items-start gap-2 rounded-lg border border-gray-200 px-2.5 py-2 dark:border-gray-800">
              <Badge tone="info" size="xs" outline>{DOCUMENT_KIND_LABELS[document.kind]}</Badge>
              <div className="min-w-0 flex-1">
                {document.url ? (
                  <a
                    href={document.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="block truncate text-sm font-medium text-primary-600 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-primary-400"
                  >
                    {document.name}
                  </a>
                ) : (
                  <p className="truncate text-sm font-medium text-gray-800 dark:text-gray-100">{document.name}</p>
                )}
                <p className="text-2xs text-gray-500 dark:text-gray-400">
                  {formatDate(document.addedAt)} · {document.addedBy}
                  {!document.url && document.content && ' · contenido pegado'}
                </p>
                {!document.url && document.content && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-2xs text-gray-500 hover:underline dark:text-gray-400">
                      Ver contenido
                    </summary>
                    <p className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap rounded bg-gray-50 p-2 text-2xs text-gray-600 dark:bg-gray-900/60 dark:text-gray-300">
                      {document.content}
                    </p>
                  </details>
                )}
              </div>
              <RemoveButton
                label={`Quitar documento ${document.name}`}
                disabled={busy}
                onClick={() => onPatch({
                  documents: initiative.documents.filter((item) => item.id !== document.id),
                })}
              />
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-2">
        <div className="grid gap-2 sm:grid-cols-[2fr_1fr]">
          <Input aria-label="Nombre del documento" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre del documento" />
          <select
            aria-label="Tipo de documento"
            value={kind}
            onChange={(event) => setKind(event.target.value as InitiativeDocumentKind)}
            className={selectClass}
          >
            {(Object.keys(DOCUMENT_KIND_LABELS) as InitiativeDocumentKind[]).map((value) => (
              <option key={value} value={value}>{DOCUMENT_KIND_LABELS[value]}</option>
            ))}
          </select>
        </div>
        <Input
          aria-label="https://… (donde ya vive el documento)"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://… (donde ya vive el documento)"
        />
        {showPaste && (
          <textarea
            aria-label="Pega aquí el contenido si el documento no existe en ningún otro sitio."
            value={content}
            onChange={(event) => setContent(event.target.value)}
            rows={4}
            placeholder="Pega aquí el contenido si el documento no existe en ningún otro sitio."
            className="w-full resize-y rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs leading-relaxed text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
          />
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="ghost" size="xs" onClick={() => setShowPaste((open) => !open)}>
            {showPaste ? 'Ocultar el contenido pegado' : 'Pegar contenido en vez de enlazar'}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={addDocument}
            disabled={busy || !name.trim() || (!url.trim() && !content.trim())}
          >
            <Plus className="mr-1 h-3.5 w-3.5" aria-hidden />
            Añadir documento
          </Button>
        </div>
      </div>
    </SectionCard>
  );
};

export default DocumentsPanel;
