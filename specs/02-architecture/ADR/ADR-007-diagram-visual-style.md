---
artifact_id: 02-ARCH-ADR-007
version: 1.0.0
status: Accepted
created: 2026-09-28
project: Arky 10 (arkypro-1.0)
standard: Architecture Decision Record
---

# ADR-007: Estilo visual de los diagramas — elevación sutil y tipografía actual

**Status:** Accepted
**Date:** 2026-09-28
**Decide:** el propietario del producto (tarea 3.2 de `docs/plan-mejora-diagramas.md`)

---

## Context and Problem Statement

El plan de mejora de diagramas dejó abierta una decisión que no es técnica:
qué aspecto tienen los diagramas. El plan anterior proponía un estilo
«editorial» estricto —sin sombras, línea de un píxel y tres fuentes nuevas—
tomado de un repositorio externo, y se retiró precisamente porque imponía esa
decisión en vez de pedirla.

Hasta ahora los nodos tenían una sombra de tarjeta flotante al pasar el cursor
(24–28 px de difuminado y hasta 55 % de opacidad en oscuro), y el nodo en foco
narrativo añadía un halo de color de 24 px. En diagramas densos, esa
profundidad compite con lo que el diagrama dice: el ojo va a la caja que
«flota», no a la que importa.

## Decision

1. **Elevación sutil.** Una sombra casi imperceptible en reposo y un realce
   contenido al pasar el cursor. Es una regla medible, no un gusto: **como mucho
   12 px de difuminado y 4 px de desplazamiento, con opacidad máxima de 0,08
   en tema claro y 0,40 en oscuro**, y el reposo siempre más discreto que el
   realce.
2. **El foco narrativo es un anillo, no un halo.** Un anillo de 3 px del color
   del nodo ya lo distingue; el resplandor se retira.
3. **Tipografía actual.** No se añaden fuentes: ni coste de carga ni una
   dependencia de red más, que además rompería la exportación autocontenida
   (tarea 2.2).
4. **Rejilla de 8 px al arrastrar a mano**, para que los ajustes manuales
   queden alineados.

## Consequences

- Todo vive en `lib/diagramTokens.ts` (`ELEVATION_TOKENS`, `focusElevation`,
  `DIAGRAM_SNAP_GRID`). La tarea 3.1 sacó antes los colores de los componentes,
  así que un cambio de estilo toca un fichero y no dos componentes.
- `__tests__/diagram/diagramElevation.test.ts` hace cumplir la regla del punto 1
  midiendo cada capa de sombra, no copiando las cadenas: un ajuste dentro de la
  decisión pasa, uno que la contradiga falla. Se comprobó que los valores
  anteriores la habrían incumplido.
- `popover` (paneles flotantes, no nodos) queda fuera de la regla: un panel
  sobre el lienzo sí tiene que parecer encima.
- El aspecto cambia a propósito: los diagramas se ven más planos y el hover
  menos pronunciado. Las posiciones guardadas no se tocan; la rejilla sólo
  actúa al arrastrar.

## Alternatives considered

- **Plano, sin sombras y línea de 1 px.** Descartado por el propietario: en un
  lienzo con zonas de agrupación, un nodo sin ninguna elevación se confunde con
  el fondo de su zona.
- **Fuentes nuevas (Instrument Serif, Geist).** Descartado: peso de carga y una
  dependencia externa a cambio de un matiz.
