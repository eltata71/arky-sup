# F6-03 · Corte 3 — La Oficina de Arquitectura con la forma del contexto piloto

**Fecha:** 2026-09-26 · **Rama:** `codex/f6-03-oficina-dominio`

## Cómo se clasificó

No a ojo. Para cada fichero de la raíz de `services/architectureOffice` se
calculó su **cierre de imports de valor**, que es la misma medida que usa
`contextDomainPurity.test.ts`, y se miró si alcanzaba algo que hiciera E/S.

De 36 ficheros, 23 eran puros. Entre los que no lo eran había **cinco reglas**:

| Regla | Por qué llegaba a la base |
|---|---|
| `officeEngagementFactory` | importaba `newEngagementId` y `withAuditEntry` |
| `officeEngagementTransitions` | importaba `withAuditEntry` |
| `OfficeArbService` | importaba `withAuditEntry` y `newArbDecisionId` |
| `OfficeEngagementPlanner` | importaba `newOfficeTaskId` |
| `officeRunResumption` (y con ella el runner) | importaba `withAuditEntry` |

Todas lo traían del mismo fichero: `OfficeEngagementRepository.ts`. Tenía
dentro, junto a la persistencia, los generadores de ids, la lectura defensiva
de lo almacenado (`normalizeEngagement`) y el rastro de auditoría
(`buildAuditEntry`, `withAuditEntry`). Son funciones puras, pero su vecino hace
E/S, así que cualquier regla que las usara cargaba la base de datos.

**Arreglo:** esas funciones pasan a `domain/officeEngagementRecord.ts`, y el
repositorio se queda sólo con la E/S. Medido después, las cinco son puras.

## El reparto

| Carpeta | Ficheros | Criterio |
|---|---|---|
| `domain/` | 20: el encargo y su lectura, la fábrica, las transiciones, el comité, el planificador, los agentes (contrato, registro, personas, fichas, enrutado), las puertas de calidad, los validadores, la revisión de la consolidación, el portafolio y el puente de publicación | reglas y formas, sin E/S |
| `application/` | 9 nuevos, junto a los que ya había: el runner y su estado, contratos, punto de control, reanudación y rastro; la coordinación del equipo y su invocador; la orquestación | orquestan puertos, no deciden reglas del agregado |
| `infrastructure/` | 5: el repositorio de encargos, el adaptador de Supabase, el repositorio de fichas, los adaptadores reales del runner y la telemetría | hablan con la base o con los servicios |

En la raíz quedan el barril y las dos puertas pequeñas de F6-05
(`portfolio.ts` y `agents.ts`). El barril entra por `domain/index.ts`, que
`modules.json` declara. 34 ficheros movidos, que git ve como renombrados, y
116 con la ruta de sus imports actualizada.

## El dominio, en `strict`

Al intentarlo salieron 5 errores, **ninguno en la Oficina**: cuatro miembros
sin usar en el motor de IA y un parámetro en `contextPackBuilder`. `tsc`
comprueba todo lo que el dominio alcanza, también por tipos. El camino era
éste:

```
domain/officeAgentPersonas.ts
  -> services/agent/index.ts              (import type { AgentPersonaBriefing })
  -> services/agent/intentClassifierLLM.ts
  -> services/ai/index.ts -> … -> artifactGenerationEngine.ts
```

Un **import de tipo** por el barril del agente bastaba para meter al agente
entero, la capa de IA y el motor en la comprobación de tipos del dominio de la
Oficina. El puerto `AgentPersonaBriefing` es una interfaz sin comportamiento y
vivía dentro de `agentContextComposer.ts`, que importa la capa de IA. Ahora
tiene su hoja, `services/agent/agentPersonaBriefing.ts`, que no importa nada y
está declarada como puerta en `modules.json`. Con eso, **todo el dominio de la
Oficina pasa `strict`** sin tocar el motor.

## Pruebas y coste

- La Oficina entra en `contextDomainPurity.test.ts`: su dominio no alcanza por
  ningún camino E/S, React ni una pantalla. La lista tiene ya tres contextos.
- Suite: **493 ficheros y 4 793 pruebas**, todas pasando.
- Tres guardas nombraban rutas, y dos de ellas de formas que el script de
  traslado no leía: un `join(OFFICE, 'fichero')` y un `vi.importActual` con la
  ruta en otra línea. Se corrigieron. `agentRegistrySingleDoor` y la guarda de
  transiciones recorren las subcarpetas, así que siguen viendo todo.
- **Carga inicial 310,7 → 310,9 KB gz** (de 340): el barril publica ahora
  también la fábrica y las transiciones.
- Dos techos de bytes suben 3 y 5 bytes por rutas de import más largas, con la
  razón en su línea.
