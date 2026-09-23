# Verificación de hallazgos — 2026-09-20 sobre `fd590e7`

Los doce hallazgos del encargo se contrastan aquí uno a uno contra el
repositorio. Cada uno lleva **clasificación** y **tipo de evidencia**:

- `estática` — leído en el código/SQL, con fichero y línea.
- `reproducida` — ejecutada una prueba que falla antes del arreglo.
- `hipótesis` — coherente con el código pero no comprobada.

Clasificación: **confirmado** · **corregido previamente** · **descartado** ·
**parcial** (la mitad estructural se arregló, la sustancia sigue) ·
**pendiente de reproducción**.

---

## H01 · `OfficeContext.decideEngagement` guarda en dos escrituras y no mira ningún resultado

**Confirmado · evidencia estática.**
`context/OfficeContext.tsx:378-397`.

```ts
await persistAndTrack(result.engagement);
if (result.decision) {
  await officeEngagementRepository.recordArbDecision(result.engagement, result.decision);
}
return { ok: true, engagement: result.engagement };
```

Tres defectos en nueve líneas:

1. **Dos escrituras sin transacción.** La transición del encargo va a
   `api.save_engagement`; la decisión va a `api.record_arb_decision`. Un fallo
   entre ambas deja un encargo *entregado* sin decisión registrada — o, en el
   orden inverso, una decisión firmada sobre un encargo que nunca transicionó.
2. **Ningún `PersistenceResult` se evalúa.** `persistAndTrack`
   (`OfficeContext.tsx:210-213`) hace `await officeEngagementRepository.save(...)`
   y **descarta el valor devuelto**, que es exactamente el envoltorio
   `success | failed | conflict | permission-denied | offline` que
   `services/persistence` existe para producir.
3. **`return { ok: true }` es incondicional.** Un conflicto de revisión
   (`P0001`) o un `42501` se le comunican al usuario como decisión firmada.

El comentario en el código llama a la segunda escritura «best-effort» y dice que
un rechazo «just means the decision was never authoritative, which is the
correct outcome». No lo es: el espejo `arbDecisions` ya quedó guardado dentro del
documento del encargo por la primera escritura, así que la pantalla muestra una
decisión que el registro inmutable no tiene.

## H02 · `api.save_engagement` no aplica las reglas de transición, evidencia ni separación autor/aprobador

**Confirmado · evidencia estática.**
`supabase/migrations/20260912181347_office_engagements_guards.sql:12-88`,
`supabase/migrations/20260912170000_office_engagements.sql:165-208`.

Lo que **sí** valida `save_engagement`: sesión, `project:write`, forma del
documento, enum de estado, forma del presupuesto, ausencia de `apiKey`, revisión
optimista, y `arb:decide` para llegar a `delivered`.

Lo que **no** valida, y el dominio sí declara:

| Regla del dominio | Dónde vive hoy | Servidor |
|---|---|---|
| No se ejecuta un charter sin aprobar | `officeEngagementTransitions.canRunEngagement` (TS puro) | ❌ ninguna |
| Transiciones legales de estado (`intake → planning → …`) | implícita en el runner | ❌ acepta cualquier salto entre los 8 enums |
| La decisión ARB se ata a la versión evaluada | no existe | ❌ |
| Autor ≠ aprobador | comentario en el SQL | ❌ |

Sobre la última, el hallazgo es más profundo que «falta un `if`».
`api.record_arb_decision` **no compara** `actor` con `e.owner_id`; y
`api.save_engagement` sólo escribe donde `target.owner_id = actor`. Es decir: el
único que puede mover el encargo a `delivered` es su propio dueño. **La
separación de funciones no está relajada: es estructuralmente imposible**, porque
la propiedad del encargo es a la vez la frontera de autorización y la identidad
del autor. Corregirlo es una decisión de modelo (ADR-101), no un parche.

Además, el veredicto llega como texto del cliente (`p_decision ->> 'verdict'`) y
sólo se comprueba que esté en el enum: nada lo ata al `gateAssessment` que la
pantalla enseñó al revisor.

## H03 · El verificador de módulos ve ciclos directos y no transitivos

**Confirmado · evidencia reproducida.**
`scripts/checkModuleBoundaries.mjs:335-339`:

```js
const has = (a, b) => edges.has(`${a} -> ${b}`);
for (const edge of edges.keys()) {
  const [a, b] = edge.split(' -> ');
  if (has(b, a)) cycles.add([a, b].sort().join(' <-> '));
}
```

Sólo longitud 2. Tarjan sobre el mismo grafo encuentra **un componente
fuertemente conexo de nueve módulos de dominio** y otro de tres de UI
(`evidencias/scc-linea-base.md`). El gate está verde mientras nueve contextos son
mutuamente alcanzables.

## H04 · APIs públicas que exponen repositorios, adaptadores, cachés y motores

**Confirmado · evidencia estática.**
Ejemplos en `services/architectureOffice/index.ts` y en la superficie que el
censo registra: 264 imports profundos en 59 pares, y `components ->
services/architectureOffice` es 44 por sí solo. Un `index.ts` que exporta
`officeEngagementRepository` (una instancia concreta con caché de revisiones en
un `Map` de módulo) publica infraestructura, no un contrato.

## H05 · Modificar un artefacto persiste el proyecto y su colección completa

**Confirmado · evidencia estática. Corregido en la fase 4** (F4-03 comandos por
artefacto, F4-06 retirada de la RPC compuesta; `10-cierre-fase-4.md`).
`supabase/migrations/20260912060530_projects_artifacts.sql:46-158`.

`api.save_project_aggregate(p_project, p_artifacts, p_expected_revision)` es la
**única** ruta de escritura. Escribe la raíz, reescribe **todos** los artefactos
en un bucle y, al final:

```sql
delete from api.project_artifacts existing
where existing.project_id = project_key and existing.owner_id = actor
  and not exists (select 1 from jsonb_array_elements(p_artifacts) as current
                  where current ->> 'id' = existing.id);
```

Consecuencias: (a) editar un párrafo reescribe N filas; (b) la revisión
optimista es **del proyecto**, así que dos ediciones de artefactos *distintos* en
paralelo son un conflicto; (c) un cliente que envíe una lista incompleta borra
el resto — contenido por la guarda de revisión, y sólo por ella.

## H06 · La validación del charter aprobado se hace desde React; el runner es invocable directo

**Parcial · evidencia estática.**
*Corregido previamente*: la regla ya **no** vive en React —
`services/architectureOffice/officeEngagementTransitions.ts:37-56`
(`canRunEngagement`) es una función pura y probada sin montar nada.

*Sigue confirmado*: `runEngagement`
(`services/architectureOffice/OfficeEngagementRunner.ts:129-170`) **no la
llama**. Arranca con `transitionEngagement({...initial, currentRunId}, 'in-progress', …)`
sin comprobar `charter.approvedAt`. La única llamada a `canRunEngagement` está en
`context/OfficeContext.tsx:310`. No hay entrada pública única: la regla se aplica
por convención del llamante.

## H07 · El runner continúa tras fallar la persistencia de un punto de recuperación

**Confirmado · evidencia estática.**
`services/architectureOffice/OfficeEngagementRunner.ts:155-168`:

```ts
const save = async (): Promise<void> => {
  try { await ports.persist(engagement); }
  catch { /* … el run continúa sobre el estado en memoria … */ }
  …
};
```

Dos capas de ceguera, no una. El `catch` vacío traga la excepción, y el puerto
está tipado `persist(engagement): Promise<void>` — **no puede** devolver un
`PersistenceResult`, así que un fallo *sin excepción* (que es la forma normal:
`{ status: 'conflict', success: false }`) es indistinguible del éxito. El runner
sigue gastando llamadas de IA contra un estado que nadie guardó, y el encargo que
«se reanuda en vez de reiniciarse» se reanuda desde el último punto que sí llegó.

## H08 · Borrar una iniciativa deja proyectos con referencias inválidas

**Confirmado · evidencia estática.**
`supabase/migrations/20260912060520_business_initiatives.sql:127-146`.
`api.delete_business_initiative` borra la fila sin mirar quién la cita.

Y la consecuencia es peor que una referencia colgante, porque
`api.save_project_aggregate` sí valida al escribir
(`20260912060530_projects_artifacts.sql:84-92`):

```sql
raise exception 'El proyecto referencia una iniciativa inexistente o ajena' using errcode = '42501';
```

Borrar una iniciativa deja **cada proyecto que la citaba permanentemente
imposible de guardar**, con un `42501` que la UI traduce como «permiso
insuficiente». Es un fallo de integridad referencial que se presenta como un
fallo de autorización.

## H09 · Sobrecarga antigua de `delete_engagement` sin revisión

**Confirmado · evidencia estática y, después, comprobado en el servidor real.**

> **Comprobación contra `ArkyDB-US`, 2026-09-20** (lectura del catálogo, sin
> escribir nada):
>
> ```
> delete_engagement | 2 | p_project_id text, p_engagement_id text                             | authenticated: true
> delete_engagement | 3 | p_project_id text, p_engagement_id text, p_expected_revision bigint | authenticated: true
> ```
>
> Las **dos** firmas vivas en producción y ambas ejecutables por
> `authenticated`. El hallazgo deja de ser una lectura del SQL: la guarda
> optimista era opcional en la base real. Tras aplicar la migración queda una
> sola firma, la de tres argumentos.
`20260912170000_office_engagements.sql:142` crea
`api.delete_engagement(text, text)` y la línea 218 la concede a `authenticated`.
`20260912181347_office_engagements_guards.sql:90` crea
`api.delete_engagement(text, text, bigint)` — **una sobrecarga nueva**, no un
reemplazo. `grep -rn "drop function" supabase/migrations/` no devuelve **nada**
en todo el repositorio.

La sobrecarga de dos argumentos sigue existiendo y sigue concedida: un cliente
puede llamarla por PostgREST y borrar un encargo **sin comparación de revisión**,
que es exactamente la guarda que la migración posterior añadió.

## H10 · Las revisiones viven en un mapa global, separadas de su snapshot

**Confirmado · evidencia estática.**
`services/architectureOffice/SupabaseOfficeEngagementRepository.ts:78,91,105`:

```ts
const revisions = new Map<string, number>();
…
async save(engagement, expectedRevision = revisions.get(engagement.id) ?? 0) {
```

La revisión no viaja con el agregado leído: se busca por id en un `Map` del
cierre del repositorio, que es un **singleton de módulo**
(`officeEngagementRepository`). Cualquier `list()` posterior refresca ese mapa
para todos los encargos. Una pantalla que retiene un snapshot anterior y guarda
lo hace con la revisión **más nueva**, y la guarda optimista del servidor —que
existe precisamente para detener eso— la deja pasar. La actualización perdida no
se detecta: se confirma.

**Auditado el 2026-09-20: está en los tres contextos, no en uno.**

| Repositorio | Forma | Estado |
|---|---|---|
| `SupabaseOfficeEngagementRepository` | `const revisions = new Map<string, number>()` en el cierre | **corregido** |
| `SupabaseBusinessInitiativeRepository` | idéntico, línea por línea | **corregido** |
| `SupabaseProjectRepository` | `const revisions` a nivel de módulo, además **exportado** como `knownProjectRevision` | **corregido — F4-07** |

El de proyectos es el peor de los tres y por eso va aparte. El mapa no sólo
decide la revisión: se publica por el `index.ts` del contexto
(`export { forgetProjectRevisions, knownProjectRevision }`), de modo que la
caché de concurrencia **es parte del contrato público del módulo** — que es el
hallazgo H04 y éste a la vez. Corregirlo toca la ruta de escritura del agregado
Proyecto–Artefacto, que es la fase 4, así que se hace con ella y no antes.

**Y una segunda copia que el arreglo destapó.** Los repositorios de encargos e
iniciativas llevaban cada uno su propia tabla de códigos de PostgreSQL —
`statusFor` + `failed`— en vez de usar `services/persistence/supabaseErrors.ts`,
que existe exactamente para no tener cinco. No era desorden: **ninguna de las
dos copias conocía `23503`**, el código con el que el servidor rechaza ahora
borrar una iniciativa que un proyecto cita (F2-08). Ese rechazo se habría
clasificado como `failed` genérico, y el mensaje útil —el que nombra los
proyectos a desvincular— se habría perdido por el camino.

## H11 · La actualización del grafo derivado depende del navegador y no tiene recuperación durable

**Confirmado · evidencia estática.**
`context/app/useArchitectureGraphSync.ts` — la reconstrucción automática es un
`setTimeout` de 2 500 ms dentro de un `useEffect`. Cerrar la pestaña dentro de la
ventana de silencio pierde la reconstrucción, **nada registra que quedó
pendiente**, y no existe ninguna ruta que la recupere al volver. El grafo es una
proyección derivada sin bitácora de pendientes.

## H12 · El núcleo de IA conserva dependencias hacia negocio

**Parcial · evidencia estática.**

*El núcleo estricto está casi limpio*: `services/ai/{core,routing,providers,capabilities,retry,errors,tracing,guardrails}`
sólo alcanza `types.ts` (por `Settings`), `lib/ai/modelCatalog`, `lib/secretShapes`
y `services/observability`. No hay concepto de encargo, iniciativa ni artefacto.

*La capa sí depende de negocio, y fuerte*: **20 ficheros bajo `services/ai/`
importan `services/geminiService`**, y `geminiService.ts` alcanza `services/agent`,
`services/architectureKnowledgeGraph`, `services/architectureOffice`,
`services/artifacts` y `services/chat`. Ésa es la arista
`services/ai -> services (raíz)` (12) que cierra el componente conexo de nueve
módulos de H03. El núcleo no depende de negocio; **el módulo que lo contiene sí**,
a través del motor legado que todavía vive en la raíz de `services/`.

Además `Settings` en la firma del ejecutor es un tipo de negocio en el contrato
técnico (ADR-102 lo decide).

---

## Resumen

| # | Hallazgo | Clasificación | Evidencia |
|---|---|---|---|
| H01 | Decisión ARB en dos escrituras, resultados ignorados | confirmado | estática |
| H02 | `save_engagement` sin transiciones, evidencia ni separación | confirmado | estática |
| H03 | Ciclos transitivos invisibles al gate | confirmado | reproducida |
| H04 | APIs públicas exponen infraestructura | confirmado | estática |
| H05 | Escritura de artefacto reescribe el agregado entero | confirmado | estática |
| H06 | Charter validado fuera del runner | **parcial** | estática |
| H07 | El runner ignora fallos de persistencia | confirmado | estática |
| H08 | Borrado de iniciativa rompe proyectos | confirmado | estática |
| H09 | Sobrecarga `delete_engagement(text,text)` viva | confirmado | estática |
| H10 | Revisiones en mapa global | confirmado | estática |
| H11 | Proyección sin recuperación durable | confirmado | estática |
| H12 | Núcleo IA limpio, módulo IA no | **parcial** | estática |

**Ninguno está reproducido con una prueba todavía**, salvo H03. La estrategia del
encargo lo exige antes de corregir: cada tarea de la fase 2 abre con su prueba
en rojo.
