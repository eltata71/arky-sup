# Auditoría profunda del módulo de diagramas (Arky 10)

Fecha: 2026-04-25

Este documento consolida hallazgos técnicos y de UX/UI sobre el pipeline de diagramas para elevarlo a un estándar world class enterprise.

## Hallazgos clave

- El pipeline actual ya tiene una base sólida con **IR canónico determinístico** (`mermaidToIR` + `irToReactFlow` + `irToExcalidraw`) y feature flags para fallback AI, lo cual reduce drift semántico respecto al enfoque 100% LLM.
- Aún existe **riesgo de deriva** por coexistencia de rutas AI legacy (`parseMermaidToReactFlow`, `convertToExcalidrawJSON`) dentro de `ArtifactCanvas` cuando hay errores de parsing o modo `ai`.
- El sistema tiene buenas prácticas visuales (tokens semánticos, edge semantics, badges tech, layout con dagre y presets), pero falta **gobierno de storytelling** en exportación y empaquetado ejecutivo.
- Existen capacidades iniciales de narrativa (audience projector + scenes en ReactFlow), pero falta una **gramática narrativa formal** (foco principal, secuencia numerada, callouts persistentes y validables).
- La exportación es funcional (PNG/SVG, Excalidraw, Lucid), pero sin un **preflight profesional robusto** (overflow, clipping, densidad, cumplimiento de audiencia antes de exportar).

## Recomendaciones estratégicas resumidas

1. Cerrar definitivamente la brecha determinístico vs AI de transformación (dejar AI solo en generación inicial y autofix controlado).
2. Introducir un **modelo canónico enriquecido** (IR v2) con `story`, `callouts`, `viewports`, `presentationLayer`.
3. Incorporar un **quality gate multinivel** (Draft, Review, Executive Ready, Technical Ready) basado en la rúbrica 0-100.
4. Crear un **Presentation Composer** para láminas ejecutivas (diagrama + narrativa + highlights + imagen editorial opcional) sin contaminar el diagrama técnico base.
5. Implementar lint semántico + lint visual pre-exportación y guardarlo en historial/versionado.

## Cambios implementados

- Se agregó este informe técnico en `docs/diagram-world-class-audit.md` para trazabilidad de arquitectura y backlog priorizado.
