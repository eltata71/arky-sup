import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
    ExternalLink,
    Copy,
    Check,
    AlertTriangle,
    Info,
    Loader2,
    GitBranch,
    BarChart2,
    RefreshCw,
    Share2,
    Download,
    KeyRound,
} from 'lucide-react';
import { Node, Edge } from 'reactflow';
import ReactFlowCanvas from './ReactFlowCanvas';
import { extractMermaidCode, detectMermaidKind } from '../utils/diagram/extractMermaid';
import {
    createLucidDocumentFromMermaid,
    createLucidEmbedSession,
    createLucidShareLink,
    exportLucidDocumentAsPNG,
    buildLucidImportDeeplink,
    getLucidConfig,
    setUserLucidToken,
    LucidApiError,
    type LucidDocumentSummary,
    type LucidEmbedSession,
} from '../services/lucid';

interface LucidchartViewerProps {
    artifactContent: string;
    artifactRepresentation: 'diagram' | 'document' | 'hybrid';
    artifactTitle: string;
    flowData: { nodes: Node[]; edges: Edge[] } | null;
    isFlowLoading: boolean;
    flowError: string | null;
    onRetry: () => void;
    /** Invoked for the fallback flow (open Lucidchart in a new tab). */
    onOpenExternal: () => void;
    /**
     * Optional callback so the parent (Workspace/ArtifactCanvas) can persist
     * the created Lucid document id against the artifact, enabling reuse.
     */
    onLucidDocumentReady?: (summary: LucidDocumentSummary) => void;
    /** Pre-existing Lucid document id persisted on the artifact. */
    existingLucidDocumentId?: string;
}

function getDiagramStats(mermaidCode: string | null, flowData: { nodes: Node[]; edges: Edge[] } | null) {
    const nodeCount = flowData ? flowData.nodes.length : 0;
    const edgeCount = flowData ? flowData.edges.length : 0;
    return { type: detectMermaidKind(mermaidCode), nodeCount, edgeCount };
}

const LucidchartViewer: React.FC<LucidchartViewerProps> = ({
    artifactContent,
    artifactRepresentation,
    artifactTitle,
    flowData,
    isFlowLoading,
    flowError,
    onRetry,
    onOpenExternal,
    onLucidDocumentReady,
    existingLucidDocumentId,
}) => {
    const [copied, setCopied] = useState(false);
    const [config, setConfig] = useState(() => getLucidConfig());
    const [tokenInput, setTokenInput] = useState('');
    const [showTokenPanel, setShowTokenPanel] = useState(false);

    const [documentSummary, setDocumentSummary] = useState<LucidDocumentSummary | null>(
        existingLucidDocumentId
            ? {
                  documentId: existingLucidDocumentId,
                  editUrl: `https://lucid.app/lucidchart/${existingLucidDocumentId}/edit`,
              }
            : null,
    );
    const [embedSession, setEmbedSession] = useState<LucidEmbedSession | null>(null);
    const [lucidLoading, setLucidLoading] = useState(false);
    const [lucidError, setLucidError] = useState<string | null>(null);
    const [shareBusy, setShareBusy] = useState(false);
    const [shareUrl, setShareUrl] = useState<string | null>(null);
    const [exportBusy, setExportBusy] = useState(false);

    const mermaidCode = useMemo(() => extractMermaidCode(artifactContent, artifactRepresentation), [artifactContent, artifactRepresentation]);
    const stats = useMemo(() => getDiagramStats(mermaidCode, flowData), [mermaidCode, flowData]);

    const handleCopyMermaid = useCallback(async () => {
        if (!mermaidCode) return;
        try {
            await navigator.clipboard.writeText(mermaidCode);
        } catch {
            const ta = document.createElement('textarea');
            ta.value = mermaidCode;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
    }, [mermaidCode]);

    const createDocAndEmbed = useCallback(async () => {
        if (!mermaidCode) {
            setLucidError('No hay diagrama Mermaid para enviar a Lucidchart.');
            return;
        }
        setLucidLoading(true);
        setLucidError(null);
        try {
            const summary = documentSummary ?? await createLucidDocumentFromMermaid({
                title: artifactTitle || 'Arky Diagram',
                mermaid: mermaidCode,
            });
            setDocumentSummary(summary);
            onLucidDocumentReady?.(summary);

            const session = await createLucidEmbedSession(summary.documentId);
            setEmbedSession(session);
        } catch (err) {
            const msg = err instanceof LucidApiError
                ? `${err.message}${err.code ? ` (${err.code})` : ''}`
                : err instanceof Error ? err.message : 'Error creando el documento en Lucidchart.';
            setLucidError(msg);
        } finally {
            setLucidLoading(false);
        }
    }, [mermaidCode, documentSummary, artifactTitle, onLucidDocumentReady]);

    const handleShare = useCallback(async () => {
        if (!documentSummary) return;
        setShareBusy(true);
        try {
            const link = await createLucidShareLink(documentSummary.documentId, 'viewer');
            setShareUrl(link.url);
            await navigator.clipboard.writeText(link.url).catch(() => { /* ignore */ });
        } catch (err) {
            setLucidError(err instanceof Error ? err.message : 'No se pudo crear el enlace de compartición.');
        } finally {
            setShareBusy(false);
        }
    }, [documentSummary]);

    const handleExportPNG = useCallback(async () => {
        if (!documentSummary) return;
        setExportBusy(true);
        try {
            const url = await exportLucidDocumentAsPNG(documentSummary.documentId);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${artifactTitle || 'lucid-diagram'}.png`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (err) {
            setLucidError(err instanceof Error ? err.message : 'No se pudo exportar el PNG desde Lucidchart.');
        } finally {
            setExportBusy(false);
        }
    }, [documentSummary, artifactTitle]);

    const handleOpenAuthenticatedExternal = useCallback(() => {
        if (documentSummary?.editUrl) {
            window.open(documentSummary.editUrl, '_blank', 'noopener,noreferrer');
            return;
        }
        window.open(buildLucidImportDeeplink(), '_blank', 'noopener,noreferrer');
    }, [documentSummary]);

    const handleSaveToken = useCallback(() => {
        setUserLucidToken(tokenInput);
        setConfig(getLucidConfig());
        setShowTokenPanel(false);
        setTokenInput('');
    }, [tokenInput]);

    // Auto-create the Lucid document the first time the user opens the viewer when:
    //  - we already have a token,
    //  - we don't have a pre-existing document id,
    //  - Mermaid code is available.
    useEffect(() => {
        if (!config.hasToken) return;
        if (documentSummary) return;
        if (!mermaidCode) return;
        createDocAndEmbed();
    }, [config.hasToken, documentSummary, mermaidCode, createDocAndEmbed]);

    const integrationReady = config.hasToken;

    return (
        <motion.div
            className="flex-1 flex flex-col min-h-0 h-full bg-white dark:bg-gray-950"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}
        >
            {/* ── Branded header ── */}
            <div className="flex-shrink-0 flex items-center justify-between px-4 py-2.5 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
                <div className="flex items-center gap-2 min-w-0">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="flex-shrink-0">
                        <rect width="24" height="24" rx="5" fill="#E8440A"/>
                        <path d="M7 5v14h10v-3H10V5H7z" fill="white"/>
                    </svg>
                    <span className="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate">Lucidchart</span>
                    <span className="text-xs text-gray-400 dark:text-gray-500 hidden lg:inline flex-shrink-0">
                        — {integrationReady ? 'integración autenticada' : 'vista previa local'}
                    </span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                    {integrationReady && documentSummary && (
                        <>
                            <motion.button
                                onClick={handleExportPNG}
                                disabled={exportBusy}
                                title="Descargar PNG exportado desde Lucid"
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
                                whileTap={{ scale: 0.96 }}
                            >
                                {exportBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                                <span className="hidden sm:inline">PNG</span>
                            </motion.button>
                            <motion.button
                                onClick={handleShare}
                                disabled={shareBusy}
                                title="Generar enlace para compartir (solo lectura)"
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
                                whileTap={{ scale: 0.96 }}
                            >
                                {shareBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Share2 className="w-3.5 h-3.5" />}
                                <span className="hidden sm:inline">Compartir</span>
                            </motion.button>
                        </>
                    )}
                    <motion.button
                        onClick={handleCopyMermaid}
                        disabled={!mermaidCode}
                        title="Copiar código Mermaid"
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border disabled:opacity-40 disabled:cursor-not-allowed overflow-hidden"
                        style={{
                            borderColor: copied ? '#86efac' : '#d1d5db',
                            color: copied ? '#16a34a' : undefined,
                        }}
                        whileTap={{ scale: 0.96 }}
                    >
                        <AnimatePresence mode="wait" initial={false}>
                            {copied ? (
                                <motion.span key="ok" className="flex items-center gap-1.5 text-green-700"
                                    initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}>
                                    <Check className="w-3.5 h-3.5" /><span className="hidden sm:inline">¡Copiado!</span>
                                </motion.span>
                            ) : (
                                <motion.span key="cp" className="flex items-center gap-1.5 text-gray-600 dark:text-gray-300"
                                    initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}>
                                    <Copy className="w-3.5 h-3.5" /><span className="hidden sm:inline">Copiar Mermaid</span>
                                </motion.span>
                            )}
                        </AnimatePresence>
                    </motion.button>
                    <motion.button
                        onClick={integrationReady ? handleOpenAuthenticatedExternal : onOpenExternal}
                        title={integrationReady ? 'Abrir el documento real en Lucidchart' : 'Abrir Lucidchart para importar'}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#E8440A] rounded-lg"
                        whileHover={{ backgroundColor: '#c93a09' }} whileTap={{ scale: 0.96 }}
                    >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">{integrationReady ? 'Abrir en Lucidchart' : 'Importar en Lucidchart'}</span>
                    </motion.button>
                    <motion.button
                        onClick={() => setShowTokenPanel(v => !v)}
                        title={integrationReady ? 'Administrar token de Lucid' : 'Configurar token de Lucid'}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 border border-dashed border-gray-300 dark:border-gray-600 rounded-lg"
                        whileTap={{ scale: 0.96 }}
                    >
                        <KeyRound className="w-3.5 h-3.5" />
                    </motion.button>
                </div>
            </div>

            {/* ── Instructions / status banner ── */}
            {!integrationReady ? (
                <div className="flex-shrink-0 flex items-start gap-2 px-4 py-2 bg-orange-50 dark:bg-orange-950/30 border-b border-orange-100 dark:border-orange-900/40">
                    <Info className="w-4 h-4 text-orange-500 dark:text-orange-400 flex-shrink-0 mt-px" />
                    <p className="text-xs text-orange-800 dark:text-orange-200">
                        Sin token configurado. Puedes <strong>Copiar Mermaid</strong> e importarlo manualmente, o pulsa el ícono <KeyRound className="inline w-3 h-3" /> para conectar Lucid y generar documentos reales automáticamente.
                    </p>
                </div>
            ) : documentSummary ? (
                <div className="flex-shrink-0 flex items-start gap-2 px-4 py-2 bg-emerald-50 dark:bg-emerald-950/30 border-b border-emerald-100 dark:border-emerald-900/40">
                    <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-px" />
                    <p className="text-xs text-emerald-800 dark:text-emerald-200 truncate">
                        Documento en Lucid:&nbsp;
                        <a href={documentSummary.editUrl} target="_blank" rel="noopener noreferrer" className="underline font-medium">
                            {documentSummary.documentId}
                        </a>
                        {shareUrl && (
                            <>&nbsp;·&nbsp;Enlace copiado:&nbsp;<span className="font-mono truncate">{shareUrl}</span></>
                        )}
                    </p>
                </div>
            ) : (
                <div className="flex-shrink-0 flex items-start gap-2 px-4 py-2 bg-blue-50 dark:bg-blue-950/30 border-b border-blue-100 dark:border-blue-900/40">
                    <Info className="w-4 h-4 text-blue-500 dark:text-blue-400 flex-shrink-0 mt-px" />
                    <p className="text-xs text-blue-800 dark:text-blue-200">
                        Token detectado ({config.source === 'user' ? 'personal' : 'global'}). Preparando el documento en Lucidchart…
                    </p>
                </div>
            )}

            {/* ── Optional token panel ── */}
            {showTokenPanel && (
                <div className="flex-shrink-0 flex flex-col gap-2 px-4 py-3 bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800">
                    <p className="text-xs text-gray-600 dark:text-gray-300">
                        Pega tu <strong>Lucid API token</strong> (Settings → Developer en lucid.app). Se guarda sólo en este navegador (<code>localStorage</code>).
                    </p>
                    <div className="flex items-center gap-2">
                        <input
                            type="password"
                            value={tokenInput}
                            onChange={e => setTokenInput(e.target.value)}
                            placeholder="eyJhbGciOi..."
                            className="flex-1 px-3 py-1.5 text-xs font-mono bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg"
                        />
                        <button
                            onClick={handleSaveToken}
                            disabled={tokenInput.trim().length === 0}
                            className="px-3 py-1.5 text-xs font-medium text-white bg-[#E8440A] rounded-lg disabled:opacity-40"
                        >
                            Guardar
                        </button>
                        {config.source === 'user' && (
                            <button
                                onClick={() => { setUserLucidToken(null); setConfig(getLucidConfig()); }}
                                className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg"
                            >
                                Revocar
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* ── Diagram stats bar ── */}
            {(flowData || stats.type !== 'Diagrama') && (
                <div className="flex-shrink-0 flex items-center gap-4 px-4 py-2 bg-gray-50 dark:bg-gray-900/50 border-b border-gray-100 dark:border-gray-800">
                    <div className="flex items-center gap-1.5 text-xs">
                        <GitBranch className="w-3.5 h-3.5 text-[#E8440A]" />
                        <span className="font-medium text-gray-700 dark:text-gray-300">{stats.type}</span>
                    </div>
                    {flowData && (
                        <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                            <BarChart2 className="w-3.5 h-3.5" />
                            <span>{stats.nodeCount} nodos · {stats.edgeCount} relaciones</span>
                        </div>
                    )}
                    <span className="ml-auto text-xs text-gray-400 dark:text-gray-600 truncate max-w-xs hidden md:block">{artifactTitle}</span>
                </div>
            )}

            {/* ── Main preview area ── */}
            <div className="flex-1 min-h-0 w-full relative">
                <AnimatePresence mode="wait">
                    {lucidError ? (
                        <motion.div key="lucid-error"
                            className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-8 bg-white dark:bg-gray-950"
                            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                        >
                            <div className="w-14 h-14 rounded-2xl bg-amber-50 dark:bg-amber-900/30 flex items-center justify-center">
                                <AlertTriangle className="w-7 h-7 text-amber-500" />
                            </div>
                            <div className="text-center max-w-sm">
                                <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-1">Error con Lucidchart</p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">{lucidError}</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <motion.button onClick={() => { setLucidError(null); createDocAndEmbed(); }}
                                    className="flex items-center gap-2 px-4 py-2 bg-[#E8440A] text-white text-sm font-medium rounded-xl"
                                    whileHover={{ backgroundColor: '#c93a09' }} whileTap={{ scale: 0.96 }}>
                                    <RefreshCw className="w-4 h-4" /> Reintentar
                                </motion.button>
                                <motion.button onClick={() => { setLucidError(null); }}
                                    className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-xl"
                                    whileTap={{ scale: 0.96 }}>
                                    Usar vista previa local
                                </motion.button>
                            </div>
                        </motion.div>
                    ) : lucidLoading ? (
                        <motion.div key="lucid-loading"
                            className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-white dark:bg-gray-950"
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        >
                            <div className="relative w-16 h-16 rounded-2xl bg-orange-50 dark:bg-orange-900/30 flex items-center justify-center">
                                <Loader2 className="w-8 h-8 text-[#E8440A] animate-spin" />
                            </div>
                            <div className="text-center">
                                <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">Enviando a Lucidchart…</p>
                                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Creando documento y sesión embebida.</p>
                            </div>
                        </motion.div>
                    ) : embedSession ? (
                        <motion.div key="lucid-embed" className="absolute inset-0 bg-white dark:bg-gray-950"
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}
                        >
                            <iframe
                                title={`Lucidchart · ${artifactTitle}`}
                                src={embedSession.embedUrl}
                                allow="fullscreen"
                                className="w-full h-full border-0"
                            />
                        </motion.div>
                    ) : isFlowLoading ? (
                        <motion.div key="loading"
                            className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-white dark:bg-gray-950"
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        >
                            <div className="relative">
                                <div className="absolute inset-0 bg-[#E8440A]/10 rounded-full blur-2xl animate-pulse" />
                                <div className="relative w-16 h-16 rounded-2xl bg-orange-50 dark:bg-orange-900/30 flex items-center justify-center">
                                    <Loader2 className="w-8 h-8 text-[#E8440A] animate-spin" />
                                </div>
                            </div>
                            <div className="text-center">
                                <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">Generando vista previa</p>
                                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Convirtiendo el diagrama de arquitectura…</p>
                            </div>
                        </motion.div>
                    ) : flowError ? (
                        <motion.div key="error"
                            className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-8 bg-white dark:bg-gray-950"
                            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                        >
                            <div className="w-14 h-14 rounded-2xl bg-amber-50 dark:bg-amber-900/30 flex items-center justify-center">
                                <AlertTriangle className="w-7 h-7 text-amber-500" />
                            </div>
                            <div className="text-center max-w-sm">
                                <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-1">Error al generar la vista previa</p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">{flowError}</p>
                            </div>
                            <motion.button onClick={onRetry}
                                className="flex items-center gap-2 px-4 py-2 bg-[#E8440A] text-white text-sm font-medium rounded-xl"
                                whileHover={{ backgroundColor: '#c93a09' }} whileTap={{ scale: 0.96 }}>
                                <RefreshCw className="w-4 h-4" /> Reintentar
                            </motion.button>
                        </motion.div>
                    ) : flowData ? (
                        <motion.div key="diagram" className="absolute inset-0"
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}>
                            <ReactFlowCanvas nodes={flowData.nodes} edges={flowData.edges} />
                        </motion.div>
                    ) : (
                        <motion.div key="empty"
                            className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-8 bg-white dark:bg-gray-950"
                            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                        >
                            <div className="w-16 h-16 rounded-2xl bg-orange-50 dark:bg-orange-900/30 flex items-center justify-center">
                                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" className="flex-shrink-0">
                                    <rect width="24" height="24" rx="5" fill="#E8440A" opacity={0.15}/>
                                    <path d="M7 5v14h10v-3H10V5H7z" fill="#E8440A"/>
                                </svg>
                            </div>
                            <div className="text-center max-w-xs">
                                <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Sin vista previa disponible</p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                    Primero visita la vista <strong>Diagrama</strong> para generar el diagrama. Después vuelve aquí para verlo con branding de Lucidchart.
                                </p>
                            </div>
                            {mermaidCode && (
                                <motion.button onClick={handleCopyMermaid}
                                    className="flex items-center gap-2 px-4 py-2 bg-[#E8440A] text-white text-sm font-medium rounded-xl"
                                    whileHover={{ backgroundColor: '#c93a09' }} whileTap={{ scale: 0.96 }}>
                                    {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                                    {copied ? '¡Copiado!' : 'Copiar código Mermaid'}
                                </motion.button>
                            )}
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </motion.div>
    );
};

export default LucidchartViewer;
