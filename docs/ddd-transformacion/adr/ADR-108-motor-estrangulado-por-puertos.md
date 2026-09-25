# ADR-108 — El motor de generación se estrangula por verticales, y lo que no puede buscar le llega por un puerto

**Fecha** 2026-09-24 (registrada en F6-06, 2026-09-25) · **Estado** aceptada ·
**Resuelve** H12 y el componente conexo de H03 · **Tareas** F5-01 (catorce
cortes), F6-01 corte 3 · **Evidencia** `evidencias/f5-01-corte-*.md`,
`11-cierre-fase-5.md`

## Problema

`services/geminiService.ts` tenía 5 405 líneas y dos trabajos: componer los
prompts de dominio y llevar cualquier prompt a un proveedor.

Para componer, subía a ocho contextos de dominio, y cuatro de ellos
(`agent`, `chat`, `artifacts` y `architectureOffice`) importaban
`services/ai` de vuelta. Ese nudo cerraba un componente de **nueve** contextos
mutuamente alcanzables.

En la ola 5 se intentó mover el fichero dentro de `services/ai` y se revirtió.
Mover un fichero no quita sus dependencias: el ciclo registrado contra la
raíz se convertía en **cuatro ciclos entre contextos reales**.

## Decisión

1. **Primero el transporte.** Proxy, reintentos, timeout y cadena de modelos
   salieron tal cual a `services/ai/generation/legacyTransport.ts`. Así, las
   fachadas que sólo envían su propio prompt ya no cargan el motor.
2. **Después, vertical a vertical.** Cada capacidad sale con su dependencia
   ascendente cortada antes de moverse. Se fueron el LMS, las
   recomendaciones, los documentos, los diagramas, el asistente, las
   sugerencias, la crítica, la revisión, el brief y las presentaciones.
   `engineImporters.test.ts` lista los importadores del motor, y la lista
   sólo puede encoger.
3. **Lo que el motor no puede buscar se lo entregan, por un puerto que él
   declara:**
   - `ArtifactPersonaComposer`, para la persona de la Oficina;
   - `ArtifactGenerationSupport`, para la selección de fuentes y los fallbacks
     deterministas de `services/artifacts`.
   El soporte es **obligatorio**: una generación sin sus fallbacks
   devolvería un lienzo vacío donde antes había un esqueleto.
4. **Sólo entonces el traslado**, a
   `services/ai/generation/artifacts/artifactGenerationEngine.ts`. No añadió
   ningún ciclo. F5-03 cortó después las tres aristas que aún contradecían el
   orden de capas, y el componente pasó de 13 a 0.

## Alternativas descartadas

- **Moverlo en bloque** (ola 5): multiplica los ciclos, como se midió.
- **Reescribirlo.** Pierde el comportamiento que las pruebas no fijan. Cada
  corte llevó su prueba de «el prompt no cambia».
- **Inyectar un contenedor de dependencias.** Un puerto nombrado, declarado
  por quien lo necesita, dice exactamente qué se pide. Un contenedor lo
  esconde.

## Consecuencias

- El motor quedó en 1 786 líneas, sin `any` y sin `@google/genai`. Su única
  superficie pública es `generateArtifactContent`.
- **Lo que queda es descomposición ordinaria, no migración:** el método
  interno de generación (~900 líneas).
- El patrón queda como regla: **una dependencia que debe apuntar en un solo
  sentido se convierte en puerto.** Es el mismo que ya usaban
  `AgentPersonaBriefing` e `initiativeDelivery`.
