# ADR-103 — Criterio de admisión al núcleo compartido

**Fecha** 2026-09-20 · **Estado** aceptada · **Contexto** todos

## Problema

El repositorio ya aprendió una vez que un tipo usado por dos contextos tiende a
subir a `lib/`, y `lib/validation/` llegó a ser un reexportador que **ningún
fichero importaba**. Sin criterio escrito, el núcleo crece con cada tipo
compartido y se convierte en el acoplamiento que la modularidad quería evitar.

## Decisión

Entra al núcleo compartido (`types.ts`, `lib/*`) sólo lo que cumple **las tres**:

1. **Sin comportamiento.** Un tipo, una constante, una función total y pura sin
   dependencias de dominio.
2. **Tres o más contextos lo necesitan.** Dos contextos que comparten un tipo
   justifican un **puerto** en el que lo necesita, no un núcleo.
3. **Nadie es su dueño natural.** Si un contexto lo define mejor que los demás,
   vive ahí y se publica por su `index.ts`.

Una dependencia que debe apuntar en un solo sentido **se convierte en puerto**,
no en tipo compartido. Los tres ejemplos vigentes —`AgentPersonaBriefing`,
`InitiativeDeliveryPort`, `InitiativeSignalPort`— son el patrón.

## Consecuencia

`Settings` en la firma de `AIRequestExecutor` **no** cumple el criterio: es un
tipo de negocio en un contrato técnico. Se sustituye por una resolución previa
(el llamante resuelve modelo y clave, el ejecutor recibe lo ya resuelto) en
F5-01. No se toca antes: cambiarlo ahora, con 20 ficheros del módulo todavía
colgando de `geminiService`, mueve el problema sin reducirlo.
