# Inventario de almacenamiento y documentos — evidencia de código

**Generado:** 2026-09-15T19:21:19.380Z
**Alcance:** 845 archivos de código/configuración versionados; no incluye contenido de usuarios, secretos ni variables de entorno.

## Resultado

Este informe es un inventario estático y PII-safe. «not-observed» significa que no se encontró el patrón en las fuentes escaneadas; no prueba que un proveedor remoto esté vacío. La consulta de Supabase Storage se documenta por separado con su salida CLI. La consulta de Firebase Storage, si se requiere, debe ejecutarse fuera de este inventario.

| Categoría | Descripción | Estado | Archivos | Coincidencias | Evidencia |
|---|---|---:|---:|---:|---|
| firebase-bucket-configured | Bucket Firebase configurado | observed | 1 | 1 | `firebase.ts:11` |
| firebase-storage-sdk | Firebase Storage usado por el SDK | not-observed | 0 | 0 | — |
| supabase-storage-sdk | Supabase Storage usado por el SDK | not-observed | 0 | 0 | — |
| supabase-storage-schema | Esquema/políticas de Supabase Storage | observed | 9 | 61 | `scripts/supabase/storage-private-objects-remote-probe.sql:17`, `scripts/supabase/storage-private-objects-remote-probe.sql:29`, `scripts/supabase/storage-private-objects-remote-probe.sql:46`, `scripts/supabase/storage-private-objects-remote-probe.sql:47`, `scripts/supabase/storage-private-objects-remote-probe.sql:49` |
| persistent-url | URL persistida en un documento de dominio | observed | 2 | 3 | `services/businessInitiatives/BusinessInitiativeTypes.ts:130`, `services/lucid/lucidService.ts:52`, `services/lucid/lucidService.ts:191` |
| inline-content | Contenido de documento persistido inline | observed | 49 | 120 | `api/ai.ts:54`, `api/ai.ts:157`, `api/ai.ts:268`, `api/ai.ts:326`, `components/ArtifactCanvas.tsx:67` |
| embedded-artifact-content | Incrustación dentro de contenido de artefacto | observed | 55 | 205 | `components/ArtifactCanvas.tsx:66`, `components/ArtifactCanvas.tsx:68`, `components/ArtifactCanvas.tsx:304`, `components/ArtifactCanvas.tsx:308`, `components/ArtifactCanvas.tsx:392` |
| browser-transient-blob | Blob/URL generado solo para descarga del navegador | observed | 19 | 26 | `components/ExcalidrawViewer.tsx:251`, `components/ExcalidrawViewer.tsx:252`, `hooks/artifacts/useExcalidrawRendering.ts:109`, `hooks/artifacts/useExcalidrawRendering.ts:110`, `lib/artifactPersistenceGuards.ts:102` |
| external-document-provider | Proveedor externo de documentos mencionado | observed | 27 | 89 | `components/ArtifactCanvas.tsx:33`, `components/ArtifactCanvas.tsx:111`, `components/ArtifactCanvas.tsx:955`, `components/ArtifactCanvas.tsx:956`, `components/ArtifactCanvas.tsx:970` |
| file-storage-port | Puerto abstracto de almacenamiento de archivos | observed | 3 | 6 | `services/ports/index.ts:11`, `services/ports/index.ts:18`, `services/ports/memory.ts:8`, `services/ports/memory.ts:32`, `services/ports/memory.ts:32` |

## Lectura de los hallazgos

- Las URLs y el contenido inline son contratos de documentos de iniciativa/artefactos; no son blobs gestionados por Storage.
- Los objetos `Blob` y `URL.createObjectURL` son descargas temporales del navegador; no constituyen persistencia.
- La existencia de `FileStoragePort` define una frontera preparada para F6, pero no demuestra que haya un adaptador de proveedor en producción.
- No se incluyen cuerpos, URLs concretas, identificadores de usuario, correos, claves ni valores de entorno.
