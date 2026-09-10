/**
 * `services/lucid` — la integración con Lucidchart.
 *
 * Un adaptador a una API REST de terceros: token (global o el que el usuario
 * pega en Ajustes), creación de documentos desde Mermaid, sesión de embebido,
 * enlaces de compartición y exportación a PNG. No decide nada del dominio, y
 * por eso es un módulo pequeño y aparte en vez de un rincón de
 * `services/diagram`: el día que Lucidchart cambie su API, esto es lo único
 * que se toca.
 */
export {
  LucidApiError,
  buildLucidImportDeeplink,
  createLucidDocumentFromMermaid,
  createLucidEmbedSession,
  createLucidShareLink,
  exportLucidDocumentAsPNG,
  getLucidConfig,
  setUserLucidToken,
  type LucidConfig,
  type LucidCreateOptions,
  type LucidDocumentSummary,
  type LucidEmbedSession,
  type LucidShareLink,
} from './lucidService';
