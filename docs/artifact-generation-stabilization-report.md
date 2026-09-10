# Artifact Generation Stabilization Report — Arky 10

## Resumen ejecutivo

Se corrigió el punto más crítico del flujo observado: la UI podía mostrar **“Generación completada con notas”** aunque el renderizador especializado estuviera en estado degradado/repairable o el usuario necesitara un fallback textual. La solución introduce un contrato transversal de pipeline (`ArtifactEnvelope`), captura explícita de respuesta cruda, normalización por payload, validación independiente por vista, fallback automático a documento/Markdown cuando el render especializado no es confiable, sanitización de HTML generado por IA y un shell de arranque con acciones operacionales reales.

## Causa raíz identificada

La causa raíz era una inconsistencia entre estos estados:

- **Artefacto generado:** existía contenido persistido.
- **Artefacto válido:** la generación no falló técnicamente.
- **Artefacto renderizable:** el renderizador especializado podía o no convertir el contenido a nodos visibles.
- **Artefacto visible:** el usuario veía contenido real o fallback accionable.
- **Artefacto exportable:** el formato dependía de vista activa y tipo de payload.

El banner de observabilidad trataba la presencia de nodos placeholder o cualquier traza warning como éxito con notas, sin distinguir un render `repairable` de un render realmente `ready`.

## Causas contribuyentes

1. El pipeline no tenía un envelope explícito que separara intención, tipo, payload, vista, renderizador, exportación y validación.
2. Las respuestas IA podían ser Mermaid, Markdown, JSON parcial o texto y la trazabilidad no conservaba siempre el diagnóstico normalizado.
3. La vista de diagrama podía degradar a placeholder, pero el mensaje de éxito no lo diferenciaba.
4. El Markdown generado por IA se inyectaba vía `dangerouslySetInnerHTML` sin una sanitización centralizada.
5. El shell resiliente de arranque informaba recargar, pero no ofrecía limpiar estado, volver a estado estable, descargar reporte o modo texto seguro.

## Archivos modificados

- `services/artifactGenerationPipeline.ts`: nuevo pipeline de parsing, normalización, envelope, validación y trazabilidad técnica.
- `pages/Workspace.tsx`: integra el envelope, guarda `rawResponse`, persiste `artifactEnvelope` y agrega pasos estructurados a la traza.
- `components/ArtifactCanvas.tsx`: sanitiza Markdown, usa fallback automático a documento/Markdown cuando el render especializado queda `repairable`, y alimenta el banner con vista activa/contenido visible.
- `components/artifactCanvasObservability.ts`: evita éxito con notas si no hay contenido visible o si el render especializado está degradado.
- `lib/security.ts`: agrega sanitizador HTML para contenido generado por IA.
- `index.html`: mejora el shell de arranque con reintento, limpieza de estado, reporte técnico descargable y modo texto seguro.
- `types.ts`: amplía etapas de traza y añade `rawResponse`/`artifactEnvelope` al artefacto.
- `components/CustomArtifactRequestModal.tsx`: muestra nuevas etapas de parsing, normalización y exportación.
- `__tests__/services/artifactGenerationPipeline.test.ts`: cubre normalización, JSON parcial, respuesta vacía, fallback observability, sanitización y validación documental.
- `__tests__/components/artifactCanvasObservability.test.ts`: actualizado al nuevo contrato de alertas.

## Decisiones de arquitectura

### ArtifactEnvelope

Se introdujo el contrato:

```ts
ArtifactEnvelope {
  id,
  title,
  artifactType,
  intent,
  audience,
  viewModes,
  primaryViewMode,
  payloads,
  metadata,
  quality,
  diagnostics,
  createdAt,
  updatedAt
}
```

Este contrato desacopla la respuesta IA cruda del modelo interno renderizable y permite validar por vista sin asumir que todo artefacto es diagrama.

### Separación de responsabilidades

- `Parsing`: detecta JSON, Markdown, Mermaid o texto.
- `Normalization`: construye payloads y view modes.
- `Validation`: valida contenido útil y vista visible.
- `Rendering`: resuelve renderizador especializado o fallback textual.
- `Observability`: emite diagnóstico estructurado y reporte copiable.

## Nuevo pipeline implementado

1. Se genera contenido con Gemini mediante `services/`.
2. Se captura la respuesta cruda.
3. Se normaliza a `ArtifactEnvelope`.
4. Se valida que exista contenido útil y vista visible.
5. Se aplica la lógica existente de IR/quality gate para diagramas.
6. Se persiste contenido normalizado, raw response, trace y envelope.
7. El canvas decide si muestra render especializado o fallback textual según `renderable.status`.
8. El banner sólo muestra éxito con notas cuando el usuario realmente puede ver contenido.

## Contratos de datos definidos

- `ArtifactIntent`
- `ArtifactViewMode`
- `ArtifactPayloadKind`
- `ArtifactDiagnostic`
- `ArtifactPayload`
- `ArtifactEnvelope`
- `ArtifactValidationResult`

## Estrategia de renderizado y fallback

- Si el render especializado está `ready`, se mantiene la vista visual.
- Si está `repairable`/`invalid` y existe contenido, el canvas cambia a Markdown/documento.
- Si no hay contenido visible, se muestra alerta `rose` y no se presenta como éxito.
- Si hay fallback visible, se muestra alerta `amber`, no “completado con notas”.

## Estrategia de validación

- Documentos se validan por contenido textual/tabular.
- Diagramas se validan por payload Mermaid/IR/ReactFlow.
- La exportación documental no exige nodos/aristas.
- La ausencia total de contenido bloquea la generación como estado visible.

## Estrategia de exportación por tipo de artefacto

Se conserva `artifactValidationService` como autoridad de preflight de exportación:

- Documentos: PDF, DOCX compatible, Markdown, HTML, TXT, JSON; CSV/XLSX si hay tablas.
- Diagramas: PNG/SVG desde canvas, Mermaid, JSON de diagrama, PDF/HTML/DOCX como documento técnico.
- Formatos incompatibles quedan deshabilitados con explicación.

## Estrategia de observabilidad

El reporte técnico ahora diferencia:

- parser detectado,
- render status,
- vista activa,
- nodos base/proyectados/renderizados,
- fallback local,
- raw response y envelope persistidos,
- trace decisions/errors/warnings.

Eventos cubiertos por las etapas disponibles: generación IA, parsing, normalización, validación, quality gate, render, fallback, persistencia y exportación.

## Pruebas agregadas

- Markdown recibido cuando se esperaba diagrama.
- JSON parcial recuperable como texto.
- Respuesta vacía bloqueada.
- Render especializado `repairable` no muestra éxito con notas.
- Sanitización anti-XSS de HTML generado.
- Exportación documental sin exigir diagrama.

## Riesgos remanentes

1. El pipeline de Gemini sigue concentrado en `services/geminiService.ts`; conviene dividirlo en clientes/prompt builders/gates en un refactor posterior.
2. El modo texto seguro se expone como URL de recuperación; falta una pantalla React dedicada que consuma `safeMode=text` con experiencia completa.
3. El sanitizador HTML es conservador y sin dependencia externa; si se habilita HTML complejo, conviene adoptar una librería auditada.

## Recomendaciones futuras

1. Migrar generación a un servicio `artifactGenerationOrchestrator` con AbortController, timeout explícito por etapa e idempotencia por `generationId`.
2. Versionar `ArtifactEnvelope` para migraciones controladas.
3. Persistir eventos técnicos como timeline estructurado en Firestore o telemetría privada.
4. Agregar pruebas E2E de Safari/iPad con WebKit cuando el entorno CI lo permita.
5. Implementar una pantalla real para `safeMode=text` que liste últimos artefactos y permita copiar/exportar contenido sin montar renderizadores pesados.
