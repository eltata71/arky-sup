# F5-01, corte 13 — la persona llega por un puerto

**Fecha:** 2026-09-23 · **Base:** corte 12 (PR #69).

La generación principal abría su prompt con la voz de una persona de la
Oficina —Arky, o el especialista que la solicitud nombra— y para saber cuál
la **buscaba**: el motor importaba `buildOfficePersonaInstruction` y
`resolveOfficeAgentMention` de `services/architectureOffice`, un contexto que
importa la capa de IA. Era la última dependencia del motor hacia la Oficina, y
la que impedía mover la generación principal a `services/ai` sin cerrar un
ciclo.

Es el mismo problema que el corte 8 resolvió para el agente, y la misma
solución: **el que no puede buscar declara lo que necesita, y se lo entregan.**

| Pieza | Dónde | Qué hace |
|---|---|---|
| `ArtifactPersonaComposer` y `ArtifactGenerationOptions` | `lib/artifacts/artifactPersona.ts` | el puerto: `(instrucciónBase, solicitud) => instrucción`. Un contrato sin comportamiento que leen la IA, el agente, los artefactos y las pantallas: va a una hoja |
| `composeArtifactPersonaInstruction` | `services/architectureOffice/officeAgentPersonas.ts` | la mitad de la Oficina: exactamente la composición que hacía el motor |
| `personaComposer` | `services/agent/agentPersonaComposer.ts` | la mitad del agente: el compositor derivado del `resolvePersona` que el ejecutor ya recibe, así que el agente sigue sin saber que la Oficina existe |
| `useArtifactPersona` | `hooks/useArtifactPersona.ts` | la puerta de las pantallas, para que no importen un tercer módulo de servicio |

Los cinco llamantes de `generateArtifactContent` entregan ahora el compositor:
el ejecutor del agente (regenerar y crear), `runArtifactGeneration` (lo recibe
de `Workspace`), `SDDProcessView` y `ProjectCreationStatus`. **Sin compositor,
el motor envía la instrucción base tal cual**; la prueba lo fija.

**El prompt no cambia.** `artifactPersonaPort.test.ts` comprueba que el
compositor de la Oficina produce la misma instrucción que el motor construía,
y que el que el agente deriva de su ficha dice lo mismo, con y sin mención a
un especialista.

## Fronteras

- `services (raíz) -> services/architectureOffice` **desaparece**: se retira de
  `modules.json` y del presupuesto de imports profundos. Pares con import
  profundo: **54 → 53**. El motor ya no importa `agent`, `chat` ni
  `architectureOffice`.
- El componente fuertemente conexo sigue en 3 + 14: lo cierra
  `services/ai -> services (raíz)`, que se va cuando el motor salga.

## Cuatro techos suben, a sabiendas

Pasar la persona cuesta una línea en cada llamante. `pages/Workspace.tsx`
(728 → 730 líneas, 36 196 → 36 374 bytes), `pages/SDDProcessView.tsx` (41 451 →
41 644 bytes), `services/agent/agentExecutor.ts` (982 → 983 líneas, 41 032 →
41 241 bytes) y `services/artifacts/artifactGenerationRun.ts` (21 266 → 21 495
bytes). La razón está al lado de cada número en `checkModuleSize.mjs`. La
alternativa —que el motor siguiera buscando la persona— es la dependencia que
este corte existe para quitar. El motor baja: **1 921 líneas / 101 835 bytes**.

## Verificación

- `npx vitest run __tests__/services/ai/artifactPersonaPort.test.ts` — 5 pruebas en verde.
- `npm run quality` — en verde: **478 ficheros y 4 661 pruebas**; cobertura
  67,19 % / 58,11 % / 60,14 % / 69,11 %; carga inicial 309,6 KB gz de 340.

## Lo que queda

La generación principal ya no depende de la Oficina. Sus otras dependencias
ascendentes —grafo de conocimiento, grafo de contexto, calidad, diagrama y
artefactos— se revisan antes de moverla: las que sean funciones puras pueden
entrar por la puerta pública de su módulo desde `services/ai` si no cierran un
ciclo; las que lo cierren, por un puerto como éste.
