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
| D-01 | Node 20 EOL; CI y `.nvmrc` fijan runtime sin soporte | `entorno-y-entrega.md` ENV-01; `ci.yml:37,148,190` | Validar Node 24 LTS en rama con quality + E2E antes de F2 |
| D-02 | Workflow espejo destructivo presente (`rsync --delete`, push a main) | `entorno-y-entrega.md` ENV-02; `mirror-source.yml:21-43` | Retirar de forma controlada antes de trabajo en main |
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
| D-10 | `js-yaml` high + Vitest moderate en dev; bloquean el job de seguridad | `auditoria-seguridad.md` DEP-01/02 | Actualización dirigida + repetir audits y quality |
| D-11 | Despliegue desactiva el gate de configuración (`VITE_DISABLE_RUNTIME_CONFIG_GATE=true`) | `auditoria-seguridad.md` SEC-06 | Restaurar gate tras provisionar; escanear el artefacto publicado |
| D-12 | Cuota del proxy en memoria, sin topes de tokens/coste | `auditoria-seguridad.md` SEC-07 | Cuota distribuida por identidad + topes servidor |
| D-13 | Perfil propio permite tocar campos fuera del rol (incluido uid descriptivo) | `auditoria-seguridad.md` SEC-08 | Whitelist de campos por operación + uid canónico del snapshot |
| D-14 | Strict progresivo; persistencia e IA fuera del boundary | `auditoria-arquitectura.md` ARQ-05 | Enrolar módulos por corte; cero `any` no justificados al cierre |
| D-15 | SBOM que escribe `{}` ante un fallo | `entorno-y-entrega.md` ENV-05 | Fallo explícito o marcado no disponible |
| D-16 | BYOK en localStorage + CSP solo informativa | `auditoria-seguridad.md` SEC-09 | Sesión/memoria, borrado, CSP hacia enforcement gradual |

## P2 — Mejora planificada

| ID | Deuda / brecha | Evidencia |
| --- | --- | --- |
| D-17 | Pantallas/servicios grandes bajo techo individual (ReactFlowCanvas 1938, ArtifactCanvas 1067, ProjectHub 1061, agentExecutor 1000, ProjectsPage 923, mermaidToIR 850, pdfExporter 1118) | `auditoria-arquitectura.md` ARQ-06 |
| D-18 | Resolver permisivo `legacy-peer-deps=true` | `entorno-y-entrega.md` ENV-03 |
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
