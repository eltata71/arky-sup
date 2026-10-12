import { useUiTranslation } from '../../lib/i18n/UiTranslationContext';
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

import React, { useCallback, useRef, useState } from 'react';
import { Badge, Button, Input } from '../ui';
import { Paperclip, Plus } from 'lucide-react';
import { EmptyRow, RemoveButton, SectionCard, selectClass } from './panelPrimitives';
import { DOCUMENT_KIND_LABELS, formatDate, INITIATIVE_SECTION_ICONS } from './initiativeUiLabels';
// Por el barril y no por la ruta profunda: este fichero es nuevo, y el
// presupuesto de imports profundos sólo puede bajar. La pantalla que lo monta
// es perezosa, así que la puerta correcta es la principal.
import {
  newDocumentId,
  type InitiativeDocument,
  type InitiativeDocumentFile,
  type InitiativeDocumentKind,
} from '../../services/businessInitiatives';
import { useDocumentFile } from '../../hooks/useDocumentFile';
import type { PanelProps } from './InitiativeDetailPanels';

const formatSize = (bytes: number): string => (bytes >= 1_048_576
  ? `${(bytes / 1_048_576).toFixed(1)} MB`
  : `${Math.max(1, Math.round(bytes / 1024))} KB`);

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export const DocumentsPanel: React.FC<PanelProps & { addedBy: string; ownerId?: string | null }> = ({
  initiative, onCommand, busy, addedBy, ownerId,
}) => {
  const translateConfig = useUiTranslation();
  const t = useUiTranslation();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<InitiativeDocumentKind>('business-case');
  const [url, setUrl] = useState('');
  const [content, setContent] = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const [attached, setAttached] = useState<InitiativeDocumentFile | null>(null);
  const [attachedName, setAttachedName] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const files = useDocumentFile(ownerId);

  const documentId = useRef(newDocumentId());

  const attach = useCallback(async (file: File) => {
    // El id se acuña **antes** de subir porque forma parte de la ruta: es lo
    // que ata el binario a la fila que lo va a referenciar, y la política del
    // cubo comprueba esa correspondencia.
    const stored = await files.upload(file, {
      aggregateId: initiative.id,
      entityId: documentId.current,
      version: 1,
    });
    if (!stored) return;
    setAttached(stored);
    setAttachedName(file.name);
    if (!name.trim()) setName(file.name);
  }, [files, initiative.id, name]);

  const addDocument = useCallback(() => {
    const trimmedName = name.trim();
    const trimmedUrl = url.trim();
    const trimmedContent = content.trim();
    if (!trimmedName || (!trimmedUrl && !trimmedContent && !attached)) return;
    const document: InitiativeDocument = {
      id: documentId.current,
      name: trimmedName,
      kind,
      url: trimmedUrl || undefined,
      content: trimmedContent || undefined,
      file: attached ?? undefined,
      addedAt: new Date().toISOString(),
      addedBy,
    };
    onCommand({ kind: 'attach-document', document });
    setName(''); setUrl(''); setContent(''); setShowPaste(false);
    setAttached(null); setAttachedName('');
    if (fileInput.current) fileInput.current.value = '';
    documentId.current = newDocumentId();
  }, [name, kind, url, content, attached, addedBy, onCommand]);

  return (
    <SectionCard
      id="documentos"
      icon={INITIATIVE_SECTION_ICONS.documents}
      title={t("ui.documentos-de-soporte.ee71de")}
      hint={t("Enlaza el documento donde ya vive, adjunta el archivo, o pega su contenido si no existe en otro sitio.")}
      count={initiative.documents.length}
    >
      {initiative.documents.length === 0 ? (
        <EmptyRow>{t("ui.sin-documentos-el-caso-de-ne.d8a964")}</EmptyRow>
      ) : (
        <ul className="space-y-1.5">
          {initiative.documents.map((document) => (
            <li key={document.id} className="flex items-start gap-2 rounded-lg border border-gray-200 px-2.5 py-2 dark:border-gray-800">
              <Badge tone="info" size="xs" outline>{translateConfig(DOCUMENT_KIND_LABELS[document.kind])}</Badge>
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
                ) : document.file ? (
                  <button
                    type="button"
                    onClick={() => { void files.open(document.file!); }}
                    className="block max-w-full truncate text-left text-sm font-medium text-primary-600 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-primary-400"
                  >
                    {document.name}
                  </button>
                ) : (
                  <p className="truncate text-sm font-medium text-gray-800 dark:text-gray-100">{document.name}</p>
                )}
                <p className="text-2xs text-gray-500 dark:text-gray-400">
                  {formatDate(document.addedAt)} · {document.addedBy}
                  {document.file && ` · archivo adjunto (${formatSize(document.file.sizeBytes)})`}
                  {!document.url && !document.file && document.content && ' · contenido pegado'}
                </p>
                {!document.url && document.content && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-2xs text-gray-500 hover:underline dark:text-gray-400">
                      {t("ui.ver-contenido.1429ee")}
                    </summary>
                    <p className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap rounded bg-gray-50 p-2 text-2xs text-gray-600 dark:bg-gray-900/60 dark:text-gray-300">
                      {document.content}
                    </p>
                  </details>
                )}
              </div>
              <RemoveButton
                label={t("uiTemplate.quitar-documento-p0.b3a6f2", { p0: String(document.name) })}
                disabled={busy}
                onClick={() => onCommand({ kind: 'remove-document', documentId: document.id })}
              />
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-2">
        <div className="grid gap-2 sm:grid-cols-[2fr_1fr]">
          <Input aria-label={t("ui.nombre-del-documento.16e673")} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("ui.nombre-del-documento.16e673")} />
          <select
            aria-label={t("ui.tipo-de-documento.ac7906")}
            value={kind}
            onChange={(event) => setKind(event.target.value as InitiativeDocumentKind)}
            className={selectClass}
          >
            {(Object.keys(DOCUMENT_KIND_LABELS) as InitiativeDocumentKind[]).map((value) => (
              <option key={value} value={value}>{translateConfig(DOCUMENT_KIND_LABELS[value])}</option>
            ))}
          </select>
        </div>
        <Input
          aria-label={t("ui.https-donde-ya-vive-el-docum.29197c")}
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder={t("ui.https-donde-ya-vive-el-docum.29197c")}
        />
        {showPaste && (
          <textarea
            aria-label={t("ui.pega-aqui-el-contenido-si-el.21c308")}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            rows={4}
            placeholder={t("ui.pega-aqui-el-contenido-si-el.21c308")}
            className="w-full resize-y rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs leading-relaxed text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
          />
        )}
        <input
          ref={fileInput}
          type="file"
          aria-label={t("ui.adjuntar-archivo.85bdff")}
          className="sr-only"
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            if (chosen) void attach(chosen);
          }}
        />
        {attached && (
          <p className="text-2xs text-gray-600 dark:text-gray-300">
            {t("ui.adjunto.c39c8e")} <span className="font-medium">{attachedName}</span> ({formatSize(attached.sizeBytes)})
          </p>
        )}
        {files.error && (
          <p role="alert" className="text-2xs text-red-600 dark:text-red-400">{files.error}</p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="xs" onClick={() => setShowPaste((open) => !open)}>
              {showPaste ? t("uiExpr.ocultar-el-contenido-pegado.436b0a") : t("uiExpr.pegar-contenido-en-vez-de-en.d249d6")}
            </Button>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => fileInput.current?.click()}
              disabled={busy || files.busy || !ownerId}
            >
              <Paperclip className="mr-1 h-3.5 w-3.5" aria-hidden />
              {files.busy ? t("uiExpr.subiendo.83681a") : attached ? t("uiExpr.cambiar-archivo.cd24fb") : t("ui.adjuntar-archivo.85bdff")}
            </Button>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={addDocument}
            disabled={busy || files.busy || !name.trim() || (!url.trim() && !content.trim() && !attached)}
          >
            <Plus className="mr-1 h-3.5 w-3.5" aria-hidden />
            {t("ui.anadir-documento.a272ed")}
          </Button>
        </div>
      </div>
    </SectionCard>
  );
};

export default DocumentsPanel;
