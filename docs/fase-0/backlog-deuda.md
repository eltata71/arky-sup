# F0.6 — Registro de deuda vigente y backlog priorizado

Base: `8731fcdd9af7a5ee57eaaf3049b162ef722e55d7`.
Consolida `inventario-funcional-datos.md`, `auditoria-seguridad.md`,
`auditoria-arquitectura.md`, `entorno-y-entrega.md` y `pruebas-integracion.md`.
Solo se registran hallazgos con evidencia local de esta fase; lo histórico ya
cerrado no se reabre.

## Cómo leer prioridades

P0: bloquea F1/F2 o migración. P1: riesgo alto, entra en los primeros cortes.
P2: mejora planificada. Esfuerzo en tamaños relativos (S/M/L/XL).

## P0 — Habilitar la transformación

| ID | Deuda / brecha | Evidencia | Tarea |
| --- | --- | --- | --- |
| D-01 | ~~Node 20 EOL; CI y `.nvmrc` fijan runtime sin soporte~~ **CERRADO 2026-09-17** (decisión 8A): `.nvmrc`=24, `engines.node`=24.x, workflows por `node-version-file` | `entorno-y-entrega.md` ENV-01; `docs/fase-8/evidencias/node24.md` | Cerrado |
| D-02 | ~~Workflow espejo destructivo presente (`rsync --delete`, push a main)~~ **CERRADO 2026-09-18**: `.github/workflows/mirror-source.yml` retirado; `__tests__/config/ciPipeline.test.ts` rechaza que vuelva un workflow que reemplace el árbol o empuje a `main` | `entorno-y-entrega.md` ENV-02 | Cerrado |
| D-03 | Sin puertos de persistencia/identidad/archivos; repositorios conocen el SDK directamente | `auditoria-arquitectura.md` ARQ-04; ~24 puntos `from 'firebase'` | Definir puertos y adaptadores (F3.1/F3.2) antes del piloto de datos |
| D-04 | Reglas con ramas sensibles sin prueba negativa (create `delivered`, delete/recreate superadmin, BOLA colaborativa) | `auditoria-seguridad.md` SEC-03/04/05 | Reproducir con emulador y cerrar reglas + tests antes de migrar permisos (F4) |
| D-05 | Proxy autoriza identidad sin membresía; lista de modelos evadible; bypass opt-in sin aviso | `auditoria-seguridad.md` SEC-01/02 | Controles servidor + pruebas negativas antes de exponer IA a la organización |
| D-06 | `geminiService.ts` 5413 líneas fuera de `services/ai`, con 16/23 `any` | `auditoria-arquitectura.md` ARQ-01/03 | Extraer por capacidades hacia el kernel canónico, sin cambio de comportamiento |
| D-07 | ~~Aceptación funcional con la oficina pendiente; inventario productivo pendiente~~ **RESUELTO 2026-09-12**: aceptación funcional e inventario productivo revisados, validados y aprobados | `inventario-funcional-datos.md`; plan F0.1/F0.5 | Cerrado; sin acción pendiente |

## P1 — Riesgo alto, primeros cortes

| ID | Deuda / brecha | Evidencia | Tarea |
| --- | --- | --- | --- |
| D-08 | Deep imports UI→internals bajo presupuesto (focos: office, artifacts, diagram, iniciativas, quality) | `auditoria-arquitectura.md` ARQ-02 | Consumir API pública o casos de aplicación por corte vertical |
| D-09 | Ciclo `services (raíz) <-> services/ai` y archivo suelto = el monolito de IA | `auditoria-arquitectura.md` ARQ-01 | Romper al mover el motor al módulo |
| D-10 | ~~`js-yaml` high + Vitest moderate en dev~~ **CERRADO 2026-09-18**: `npm audit --audit-level=high` reporta 0 vulnerabilidades | `auditoria-seguridad.md` DEP-01/02 | Cerrado |
| D-11 | ~~Despliegue desactiva el gate de configuración~~ **CERRADO**: `vercel.json` ya no lo desactiva y `__tests__/config/vercelRuntimeGate.test.ts` lo fija. El escaneo del artefacto publicado lo hace ahora el trabajo `deploy` de `ci.yml` sobre `.vercel/output/static` | `auditoria-seguridad.md` SEC-06 | Cerrado |
| D-12 | Cuota del proxy en memoria, sin topes de tokens/coste | `auditoria-seguridad.md` SEC-07 | Cuota distribuida por identidad + topes servidor |
| D-13 | Perfil propio permite tocar campos fuera del rol (incluido uid descriptivo) | `auditoria-seguridad.md` SEC-08 | Whitelist de campos por operación + uid canónico del snapshot |
| D-14 | Strict progresivo; persistencia e IA fuera del boundary | `auditoria-arquitectura.md` ARQ-05 | Enrolar módulos por corte; cero `any` no justificados al cierre |
| D-15 | ~~SBOM que escribe `{}` ante un fallo~~ **CERRADO 2026-09-18**: el paso falla si el SBOM no trae `bomFormat` o trae cero componentes, en vez de subir un inventario vacío con nombre de inventario | `entorno-y-entrega.md` ENV-05 | Cerrado |
| D-16 | BYOK en localStorage + CSP solo informativa | `auditoria-seguridad.md` SEC-09 | Sesión/memoria, borrado, CSP hacia enforcement gradual |

## P2 — Mejora planificada

| ID | Deuda / brecha | Evidencia |
| --- | --- | --- |
| D-17 | Pantallas/servicios grandes bajo techo individual (ReactFlowCanvas 1938, ArtifactCanvas 1067, ProjectHub 1061, agentExecutor 1000, ProjectsPage 923, mermaidToIR 850, pdfExporter 1118) | `auditoria-arquitectura.md` ARQ-06 |
| D-18 | ~~Resolver permisivo `legacy-peer-deps=true`~~ **CERRADO 2026-09-18**: retirado de `.npmrc`. `npm ci` y `npm install --package-lock-only` con resolutor estricto terminan en exit 0 y el lockfile resultante no cambia ninguna versión de ningún paquete | `entorno-y-entrega.md` ENV-03 |
| D-19 | Ciclos UI `components/context/hooks` aceptados | `auditoria-arquitectura.md` ARQ-08 |
| D-20 | Propietarios transaccionales por agregado sin declarar | `auditoria-arquitectura.md` ARQ-07; F1 del plan |

## Deuda histórica que NO se reabre

- Bypass superadmin, registro público con rol, `getAllProjects` sin auth,
  fallback localStorage, IDs `Date.now()`, Tailwind CDN: cerrados según
  `docs/technical-debt-audit.md`.
- Ciclos entre contextos reales y violaciones de capa: presupuesto actual en
  cero; el gate lo demuestra.
- Claves del proxy sin fallback a `VITE_*`, fail-closed de IA, trails
  inmutables, preservación de propietario: verificados como controles
  existentes en la auditoría de seguridad.

## Criterio de salida F0.6

Backlog con ID, evidencia, prioridad y tarea asociada: cumplido en este
documento. La estimación por tarea y la ruta crítica se fijan tras F0.1
pendiente (aceptación) y F1 (diseño), conforme al plan.


---

## Revisión 2026-09-18 (auditoría F0–F8)

Cerrados en esta revisión: **D-01, D-02, D-10, D-11, D-13, D-15, D-18** (ver arriba, con la
evidencia de cada uno). Cerrados en fases anteriores y confirmados aquí, aunque
sus filas conserven el texto original del diagnóstico: **D-03** (puertos y
adaptadores, F3.1/F3.2), **D-04** (`npm run test:rules` contra el emulador real,
59/59) y **D-05** (`verifySupabaseToken.ts` + `authenticateProxyCaller.ts`, F7). **D-13 queda cerrado en los dos proveedores.** En Supabase ya lo estaba: el
cliente solo edita su nombre, y rol y estado van por RPC auditada. En Firestore
—el proveedor activo— la regla protegía `role` y dejaba `uid`, `email` y
cualquier campo inventado al alcance del propio sujeto; ahora
`ownerEditsOnlyOwnName()` aplica lista blanca sobre `affectedKeys()` y solo
admite `displayName`, que es exactamente lo único que el producto escribe
(`updateOwnDisplayName`). Cuatro pruebas negativas nuevas contra el emulador
real: uid reescrito, email reescrito, campo no declarado, y un cambio de nombre
usado como vehículo de un cambio de rol. `npm run test:rules`: **64/64**.

Siguen vigentes, y cada uno con la razón por la que no se cierra aquí:

| ID | Por qué sigue abierto |
|---|---|
| D-06 `geminiService` | Refactor por verticales del patrón estrangulador; 16 de los 23 `any` presupuestados. Moverlo de sitio empeora el censo de ciclos, y eso ya se intentó y se revirtió (Ola 5) |
| D-08 deep imports UI→internals | Presupuesto decreciente; baja cuando una pantalla mueve su orquestación a un servicio de aplicación, no por edición masiva |
| D-09 ciclo `services (raíz) ↔ services/ai` | Es el mismo hecho que D-06 visto desde el grafo |
| D-12 cuota del proxy en memoria | Necesita un almacén compartido (Redis/KV) y un presupuesto: decisión de operación, no de código |
| D-14 strict progresivo | Avanza módulo a módulo; la lista de `tsconfig.strict.json` solo crece |
| D-16 BYOK en `localStorage` + CSP `Report-Only` | Pasar la CSP a *enforcement* sin haber leído reportes reales rompería producción a ciegas. Requiere recolectar informes primero, y para eso hace falta un endpoint que alguien debe aprovisionar |
| D-17, D-19, D-20 | P2: ficheros grandes bajo techo, ciclos de UI aceptados, propietarios transaccionales por declarar |

**Deuda nueva registrada por esta auditoría**, en `docs/auditoria-f0-f8-2026-09-18.md`:

| ID | Deuda | Prioridad | Dueño |
|---|---|---|---|
| D-21 | El proyecto de Vercel está enlazado a `arkypro-1.0`, no a este repositorio: ningún merge despliega, y producción sirve commits que no existen en Git | P0 | Titular de la cuenta |
| D-22 | GitHub Actions no asigna runner desde 2026-09-13; cuatro fases se han cerrado sin que CI ejecutara | P0 | Titular de la cuenta |
| D-23 | `main` sin protección de rama: acepta push directo y no exige ningún check | P0 | Titular de la cuenta |
