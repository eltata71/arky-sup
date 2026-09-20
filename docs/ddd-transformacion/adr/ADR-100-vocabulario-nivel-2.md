# ADR-100 — El nivel 2 se llama `Project` en el código; `Attention` queda congelado

**Fecha** 2026-09-20 · **Estado** aceptada · **Contexto** todos

## Problema

El segundo nivel de la jerarquía se llama de cuatro formas en el código:
`Project`, «Proyecto de Arquitectura», `Attention`/`Atención` y, en un caso,
`businessProject*` — que en realidad nombra al nivel **1**. `Attention` aparece
565 veces en 62 ficheros.

## Decisión

1. **`Project` es el nombre canónico en el código.** Es el tipo, la tabla
   (`api.architecture_projects`) y el módulo (`services/architectureProjects`).
2. **`Attention` se congela**: permitido donde ya está, prohibido en código
   nuevo, renombrado de paso cuando un símbolo cambie por otra razón.
3. **`businessProject*` se renombra a `initiativeCode*`** en F3-05, con
   migración, porque no es un sinónimo sino un nombre equivocado.
4. «Proyecto de Arquitectura» sigue siendo el nombre de usuario, servido por
   `lib/eaTerminology.ts`.

## Alternativas descartadas

- **Renombrar todo a `Attention`.** 565 ediciones que no cambian ninguna regla.
  El encargo prohíbe confundir mover ficheros con desacoplar responsabilidades;
  esto es su versión con `sed`.
- **Dejarlo como está.** El caso `businessProjectIds` → *iniciativas* no es
  sinonimia, es una trampa: se lee mal en la dirección equivocada.

## Consecuencia

Un lector nuevo aprende una equivalencia (`Attention` = `Project`) en lugar de
cuatro. El coste es que el código seguirá mostrando las dos palabras durante
toda la transformación.
