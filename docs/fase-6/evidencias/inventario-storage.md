# Inventario de almacenamiento y documentos — evidencia de código

**Generado:** 2026-09-19T14:37:14.929Z
**Alcance:** 846 archivos de código/configuración versionados; no incluye contenido de usuarios, secretos ni variables de entorno.

## Resultado

Este informe es un inventario estático y PII-safe. «not-observed» significa que no se encontró el patrón en las fuentes escaneadas; no prueba que un proveedor remoto esté vacío. La consulta de Supabase Storage se documenta por separado con su salida CLI. Firebase se retiró en F9: su categoría se conserva como sonda de regresión, y «not-observed» ahí es el resultado esperado.

| Categoría | Descripción | Estado | Archivos | Coincidencias | Evidencia |
|---|---|---:|---:|---:|---|
| firebase-storage-residual | Residuo de Firebase Storage | not-observed | 0 | 0 | — |
| supabase-storage-sdk | Supabase Storage usado por el SDK | observed | 1 | 3 | `services/adapters/supabaseFileStorage.ts:63`, `services/adapters/supabaseFileStorage.ts:125`, `services/adapters/supabaseFileStorage.ts:202` |
| supabase-storage-schema | Esquema/políticas de Supabase Storage | observed | 10 | 67 | `scripts/supabase/sql-contract-bootstrap.sql:33`, `scripts/supabase/sql-contract-bootstrap.sql:37`, `scripts/supabase/sql-contract-bootstrap.sql:44`, `scripts/supabase/sql-contract-bootstrap.sql:46`, `scripts/supabase/sql-contract-bootstrap.sql:55` |
| persistent-url | URL persistida en un documento de dominio | observed | 4 | 5 | `api/_shared/verifySupabaseToken.ts:36`, `services/adapters/supabaseDataBackend.ts:40`, `services/businessInitiatives/BusinessInitiativeTypes.ts:130`, `services/lucid/lucidService.ts:52`, `services/lucid/lucidService.ts:191` |
| inline-content | Contenido de documento persistido inline | observed | 49 | 120 | `api/ai.ts:54`, `api/ai.ts:157`, `api/ai.ts:268`, `api/ai.ts:326`, `components/ArtifactCanvas.tsx:67` |
| embedded-artifact-content | Incrustación dentro de contenido de artefacto | observed | 55 | 205 | `components/ArtifactCanvas.tsx:66`, `components/ArtifactCanvas.tsx:68`, `components/ArtifactCanvas.tsx:304`, `components/ArtifactCanvas.tsx:308`, `components/ArtifactCanvas.tsx:392` |
| browser-transient-blob | Blob/URL generado solo para descarga del navegador | observed | 19 | 27 | `components/ExcalidrawViewer.tsx:251`, `components/ExcalidrawViewer.tsx:252`, `hooks/artifacts/useExcalidrawRendering.ts:109`, `hooks/artifacts/useExcalidrawRendering.ts:110`, `pages/LMS/CourseView.tsx:51` |
| external-document-provider | Proveedor externo de documentos mencionado | observed | 27 | 89 | `components/ArtifactCanvas.tsx:33`, `components/ArtifactCanvas.tsx:111`, `components/ArtifactCanvas.tsx:955`, `components/ArtifactCanvas.tsx:956`, `components/ArtifactCanvas.tsx:970` |
| file-storage-port | Puerto abstracto de almacenamiento de archivos | observed | 4 | 9 | `services/adapters/supabaseFileStorage.ts:2`, `services/adapters/supabaseFileStorage.ts:34`, `services/adapters/supabaseFileStorage.ts:107`, `services/ports/index.ts:11`, `services/ports/index.ts:18` |

## Lectura de los hallazgos

- Las URLs y el contenido inline son contratos de documentos de iniciativa/artefactos; no son blobs gestionados por Storage.
- Los objetos `Blob` y `URL.createObjectURL` son descargas temporales del navegador; no constituyen persistencia.
- La existencia de `FileStoragePort` define una frontera preparada para F6, pero no demuestra que haya un adaptador de proveedor en producción.
- No se incluyen cuerpos, URLs concretas, identificadores de usuario, correos, claves ni valores de entorno.
