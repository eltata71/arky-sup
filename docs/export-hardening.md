# Export hardening — Arky Pro

## Causa raíz encontrada

El flujo anterior declaraba formatos Office/PDF que no siempre generaban archivos reales: DOCX se construía con HTML dentro de un Blob con extensión `.docx`, PDF abría HTML para impresión y XLSX se producía como HTML compatible con Excel. En iPad/Safari/Apple Files esto se manifiesta como `OfficeImportErrorDomain 912` porque Word/Files espera un paquete ZIP OOXML válido y recibe texto/HTML renombrado.

También existía acoplamiento entre validaciones de diagrama y exportaciones documentales. Un documento Markdown podía quedar condicionado por preflight visual, aunque DOCX/PDF/HTML/MD/TXT no requieren diagrama.

## Decisiones técnicas aplicadas

- Se creó una arquitectura modular en `services/export/` con registry de capacidades, validación contextual, adapters por formato, descarga centralizada y traza por intento.
- DOCX y XLSX se generan como paquetes ZIP OOXML mínimos y válidos en navegador, sin depender de backend.
- PDF se genera como PDF 1.4 real con cabecera `%PDF`, paginación textual básica y tablas serializadas de forma legible.
- La descarga se centraliza y valida Blob no vacío, MIME, extensión y nombre seguro corto para iOS/Safari.
- La validación de diagrama sólo aplica a PNG/SVG/Mermaid/diagram-json; los documentos no se bloquean por falta de diagrama.
- No se presenta Google Docs/Sheets como integración directa. La UI comunica compatibilidad mediante DOCX/XLSX/HTML.

## Formatos soportados

### Documento

- Markdown `.md`
- HTML completo `.html`
- Texto `.txt`
- PDF real `.pdf`
- Word / Google Docs compatible `.docx`
- JSON técnico `.json`

### Hoja de cálculo

Disponibles sólo cuando se detecta tabla/matriz Markdown:

- CSV UTF-8 con BOM `.csv`
- Excel / Google Sheets compatible `.xlsx`

### Diagrama

Disponibles sólo para artefactos con diagrama:

- PNG
- SVG
- Mermaid `.mmd`
- JSON de diagrama

## Limitaciones reales sobre Google Docs/Sheets

No se implementa integración directa con Google Drive API. Por lo tanto, la aplicación no promete “exportar a Google Docs” o “exportar a Google Sheets”; genera archivos compatibles que el usuario puede abrir/importar en Google Docs o Google Sheets.

## Validaciones agregadas

- DOCX/XLSX: Blob no vacío, MIME esperado y magic bytes `PK` de ZIP/OOXML.
- PDF: Blob no vacío, MIME `application/pdf` y cabecera `%PDF`.
- HTML: documento completo con `<!doctype html>` y `<html>`.
- CSV/Markdown/TXT: contenido no vacío y UTF-8.
- XLSX/CSV: requieren tabla Markdown detectada.
- Diagrama: las validaciones visuales sólo se ejecutan para formatos diagramáticos.

## Cómo probar manualmente

1. Abrir un artefacto documental Markdown.
2. Exportar a `.docx`, `.pdf`, `.html`, `.md` y `.txt`.
3. Abrir el DOCX en Microsoft Word, Apple Files/iPad preview y Google Docs.
4. Abrir el PDF en Safari/Files y verificar que no sea HTML renombrado.
5. Abrir una matriz Markdown y verificar que aparecen CSV y XLSX.
6. Abrir CSV en Excel/Numbers y verificar tildes/ñ.
7. Importar XLSX en Excel/Numbers/Google Sheets.
8. Abrir un artefacto de diagrama y verificar que los formatos diagramáticos aparecen sólo allí.
9. Verificar que un documento sin diagrama no muestra bloqueo por quality gate visual.
