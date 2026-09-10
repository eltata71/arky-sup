# Informe gerencial de salud técnica y plan de mejora — Arky 10

> **Fecha de corte:** 3 de septiembre de 2026  
> **Versión revisada:** `c228708` (`work`)  
> **Alcance:** arquitectura, diseño, seguridad, datos, calidad, pruebas, entrega,
> rendimiento, resiliencia, observabilidad, accesibilidad y operabilidad.  
> **Método:** lectura del código y de sus contratos arquitectónicos, inventario
> estático, revisión de los controles automatizados y ejecución de la puerta de
> calidad. Este informe evalúa el estado actual; los informes históricos se
> usaron como contexto, pero sus cifras no se asumieron como vigentes.

## 1. Resumen ejecutivo

Arky 10 es un producto técnicamente ambicioso y, en términos generales, tiene
una **base de ingeniería superior a la habitual para una aplicación
frontend-first**. La solución dispone de dominio explícito, autorización por
permisos sincronizada con Firestore Rules, persistencia detrás de servicios,
generación de IA con proxy, quality gates mecánicos, pruebas abundantes y un
pipeline de entrega que incluye SAST, auditoría de dependencias, SBOM y E2E en
dos perfiles de dispositivo. La puerta local completa queda como la evidencia
principal de salud, no el número de archivos de prueba por sí solo.

Sin embargo, la aplicación aún no debe considerarse cerrada desde el punto de
vista de riesgo productivo. Las principales exposiciones son:

1. **Seguridad de IA opt-in:** el proxy estricto está apagado por defecto y la
   configuración documenta claves `VITE_*`; una configuración incorrecta puede
   publicar credenciales del operador en el navegador y permitir fallback
   directo.
2. **Observabilidad sólo local:** los eventos se conservan en el navegador y se
   imprimen a consola. No existe un colector remoto que permita conocer tasas de
   error, degradación, latencia o impacto por versión en una flota real.
3. **Modificabilidad desigual:** persiste un motor legacy de IA de 5.498 líneas,
   junto con componentes de 1.000–1.946 líneas. Los presupuestos impiden crecer,
   pero no eliminan el coste de comprender, probar y modificar estos hotspots.
4. **TypeScript strict parcial:** la calidad no permite nuevos `any`, pero aún
   acepta 23 y el `strict: true` completo cubre sólo un subconjunto declarado.
5. **Validación funcional incompleta en CI sin secretos:** las rutas
   autenticadas de E2E son condicionales. Un repositorio sin los secretos
   configurados obtiene una puerta verde sin verificar los journeys de mayor
   valor y riesgo.
6. **Controles de navegador aún en modo observación:** la CSP es
   `Report-Only` y admite `'unsafe-inline'`; aporta diagnóstico, no bloqueo.
7. **Margen de rendimiento mínimo:** el payload eager mide 661,5 KB gzip frente
   a un presupuesto de 675 KB y varios chunks lazy superan 1 MB raw.

### Dictamen gerencial

**Estado: ámbar controlado.** No se identificó un defecto crítico demostrado
que obligue a detener el producto, y los controles preventivos son sólidos.
Sí existen riesgos altos de seguridad operacional, diagnóstico productivo y
coste de cambio. La recomendación no es una reescritura: es ejecutar un plan
incremental de 12 a 16 semanas, con entregas pequeñas, flags y criterios de
salida medibles.

## 2. Evidencia y línea base

| Indicador | Resultado a la fecha de corte | Lectura gerencial |
|---|---:|---|
| Archivos rastreados | 1.172 | Producto grande; requiere controles mecánicos, no convenciones informales. |
| Archivos TypeScript/TSX | 1.080 | TypeScript domina la base y hace valiosa la migración a strict. |
| Código inventariado (`ts/tsx/js/jsx/mjs/cjs`, sin dependencias/build) | 1.089 archivos / 188.006 líneas | La escala justifica modularidad y ownership explícito. |
| Pruebas inventariadas | 393 archivos: 322 Node, 63 TSX y 4 E2E | Buena amplitud; el número no sustituye cobertura de journeys reales. |
| `any` en posición de tipo | 23 (16 en `geminiService`, 6 en Excalidraw, 1 en lazy routing) | Deuda acotada y concentrada. |
| Importaciones directas de Firebase desde UI/context/hooks | 0 | La frontera de servicios está siendo respetada. |
| `@ts-ignore` / `@ts-nocheck` | 0 | No se observan silenciamientos generales del compilador. |
| Archivos productivos más grandes | 5.498, 1.946, 1.140, 1.118 y 1.067 líneas | Hotspots claros de mantenibilidad y revisión. |
| Bundle eager | 661,5 KB gzip / presupuesto 675 KB | Sólo 13,5 KB (2 %) de holgura; riesgo inmediato de frenar features o arranque. |
| Cobertura global medida | 63,79 % statements / 55,28 % branches / 55,96 % functions / 65,60 % lines | Base útil con umbrales; branches y functions aún dejan zonas relevantes sin ejercitar. |
| Auditoría de dependencias local | No certificable: endpoint npm respondió HTTP 403 | Limitación del entorno; CI semanal sigue siendo la evidencia autoritativa. |

La línea base es reproducible con los comandos de §8. Las cifras son un corte,
no objetivos permanentes: cada PR debe mantenerlas o mejorarlas.

## 3. Fortalezas

### F1. Arquitectura gobernada por reglas ejecutables — **alta**

- `modules.json` declara capas, módulos y APIs públicas; el gate comprueba
  ciclos nuevos, importaciones ascendentes, accesos profundos y fan-out de UI.
- Los presupuestos de tamaño y `any` son monotónicos: permiten reducir deuda y
  prohíben normalizar un retroceso.
- `AppContext` quedó reducido a composición y los repositorios se separaron por
  contexto. Esto reduce propietarios múltiples del mismo estado.

**Valor de negocio:** menos regresiones estructurales y menor probabilidad de
que el crecimiento funcional convierta el monolito en una reescritura futura.

### F2. Modelo de dominio y gobierno explícitos — **alta**

- La jerarquía iniciativa → proyecto → solicitud → artefacto usa identificadores
  y fábricas, no texto libre ni construcción ad hoc desde React.
- La Oficina de Arquitectura separa productor, revisor y decisión ARB, valida
  el DAG y trata los validadores deterministas como autoridad bloqueante.
- El compilador de artefactos, quality gates, trazabilidad, revisión y
  publicación modelan el ciclo de vida completo, no sólo la generación de un
  documento.

**Valor de negocio:** trazabilidad de decisiones, reducción de entregables
inconsistentes y mejor encaje con procesos reales de arquitectura empresarial.

### F3. Fronteras de confianza maduras — **alta**

- No se detectaron llamadas Firebase desde componentes, páginas, contextos o
  hooks; las integraciones pasan por servicios y repositorios.
- La autorización se expresa como permisos y existe una comparación automática
  entre la matriz cliente y las reglas de Firestore.
- El HTML rico tiene un renderer/saneador central y un test que impide sumar
  sumideros arbitrarios; las claves de proveedor se escanean en el bundle.
- Los proxies verifican identidad, limitan tasa y permiten restringir modelos.

**Valor de negocio:** reduce escalamiento de privilegios, XSS, exposición de
secretos y consumo de IA no autorizado.

### F4. Ingeniería de calidad y CI/CD — **alta**

- La puerta `quality` compone typecheck normal y strict, ESLint sin avisos,
  presupuestos, tests con cobertura, build y análisis del bundle.
- Vitest separa Node de jsdom y CI divide la suite en cuatro shards, evitando
  que la disciplina de testing penalice de forma innecesaria el feedback.
- Firestore Rules se ejecuta en emulador; Playwright valida desktop Chromium y
  iPad/WebKit.
- CodeQL, `npm audit`, Dependabot y SBOM cubren código y cadena de suministro.

**Valor de negocio:** cambios más frecuentes con una probabilidad menor de
regresión y evidencia auditable de cada release.

### F5. Resiliencia y degradación diseñadas — **media-alta**

- Existen fallbacks deterministas y estados explícitos de degradación para IA,
  diagramas, persistencia y carga de chunks.
- Los updates optimistas tienen rollback y la persistencia distingue errores de
  seguridad de indisponibilidad.
- El bundle inicial se mide en lugar de usar únicamente el tamaño total de la
  distribución.

**Valor de negocio:** la aplicación evita pantallas vacías y pérdida silenciosa
de trabajo ante fallos parciales.

### F6. Accesibilidad e internacionalización tratadas como contratos — **media**

- Hay pruebas específicas para nombres accesibles, anuncios duplicados,
  navegación y paridad de claves `es`/`en`.
- El shell contempla navegación móvil, skip-link, foco y preferencias de
  movimiento reducido.

**Valor de negocio:** mayor alcance, menor fricción operativa y menos defectos
que sólo aparecen con teclado, lectores de pantalla o tablet.

## 4. Debilidades y riesgos priorizados

La prioridad usa impacto (I), probabilidad (P) y urgencia/coste de demora (D),
de 1 a 5. **Puntaje = I × P × D**. El esfuerzo es orientativo en semanas-persona
y no reduce el riesgo.

| ID | Debilidad | I | P | D | Puntaje | Esfuerzo | Prioridad |
|---|---|:-:|:-:|:-:|---:|---:|---|
| D1 | Proxy de IA fail-closed apagado por defecto y claves globales `VITE_*` documentadas | 5 | 4 | 5 | **100** | 1–2 | P0 |
| D2 | Sin telemetría remota ni SLO operacional | 5 | 4 | 5 | **100** | 2–3 | P0 |
| D3 | E2E autenticado opcional según secretos | 5 | 3 | 5 | **75** | 1–2 | P0 |
| D4 | Motor legacy de IA de 5.498 líneas | 4 | 5 | 4 | **80** | 6–10 | P1 |
| D5 | Componentes y adaptadores de exportación sobredimensionados | 4 | 4 | 4 | **64** | 6–8 | P1 |
| D6 | `strict: true` parcial y 23 `any` permitidos | 4 | 4 | 4 | **64** | 4–8 | P1 |
| D7 | CSP no bloqueante y con inline permitido | 5 | 3 | 4 | **60** | 2–3 | P1 |
| D8 | Configuración/documentación con señales obsoletas o contradictorias | 3 | 4 | 4 | **48** | 1 | P1 |
| D9 | Bundle eager casi agota su presupuesto y chunks lazy muy pesados | 4 | 4 | 4 | **64** | 2–4 | P1 |
| D10 | Firestore como dependencia de disponibilidad y capacidad sin SLO visible | 4 | 3 | 3 | **36** | 2–4 | P2 |
| D11 | Portabilidad limitada por Vercel/Firebase y tokens guardados en navegador | 3 | 3 | 3 | **27** | 2–4 | P2 |

### D1. La postura segura de IA depende de configuración — **P0**

`VITE_AI_STRICT_PROXY` está apagado por defecto. Sin él, un proxy ausente o
fallido autoriza la llamada directa. `.env.example` también ofrece
`VITE_GEMINI_API_KEY`, `VITE_OPENROUTER_API_KEY` y `VITE_ANTHROPIC_API_KEY`:
Vite incorpora esos valores al bundle. Aunque el escáner reduce el riesgo, la
configuración segura no debería depender de que cada operador interprete bien
la guía.

**Impacto:** fuga de credenciales, consumo no controlado y pérdida de una
frontera central de auditoría. **Decisión recomendada:** producción fail-closed
por defecto; BYOK sólo con consentimiento explícito y advertencia de almacenamiento.

### D2. No hay observabilidad de flota — **P0**

El servicio de observabilidad persiste estado local y registra por
`console.info/warn/error`. Esto ayuda a una sesión asistida, pero no permite
responder: “¿qué porcentaje de usuarios falla?”, “¿desde qué release?”, “¿qué
proveedor/modelo?” o “¿se cumple el SLO?”. Tampoco se observan alertas, retención,
muestreo ni redacción central de PII.

**Impacto:** mayor MTTR, incidentes descubiertos por usuarios y decisiones sin
datos productivos. **Decisión recomendada:** puerto de telemetría inyectable,
exportador remoto y dashboards con SLO, manteniendo el modo local.

### D3. La ruta crítica autenticada puede no ejecutarse — **P0**

El workflow activa `PLAYWRIGHT_AUTH_E2E` únicamente si existen secretos. Es una
degradación honesta, pero convierte la ausencia de configuración en un verde
parcial. Los flujos de identidad, permisos, persistencia, Oficina y ARB son los
que más necesitan integración real.

**Impacto:** una rotura de autorización o persistencia puede llegar a producción
con unit tests verdes. **Decisión recomendada:** proyecto Firebase de pruebas
aislado, usuarios sembrados y job obligatorio protegido por environment.

### D4. El strangler de IA no terminó — **P1**

`services/geminiService.ts` conserva 5.498 líneas y 16 de los 23 `any`. Mezcla
prompts, compatibilidad, fallbacks y operaciones de múltiples dominios. Ya
existe una arquitectura objetivo en `services/ai`, pero el singleton legacy
sigue siendo un centro de gravedad y bloquea el cierre de strict transitivo.

**Impacto:** alto radio de regresión, revisión lenta, mocks frágiles y dificultad
para cambiar de proveedor. **Decisión recomendada:** extracción vertical por
capacidad, nunca un “big bang”, conservando fachada y contract tests.

### D5. Hotspots de UI y exportación — **P1**

`ReactFlowCanvas.tsx` (1.946), `ArtifactCanvas.tsx` (1.067),
`MemoryCenterModal.tsx` (1.057), `ProjectHub.tsx` (1.051) y `pdfExporter.ts`
(1.118) concentran coordinación, estado y representación. Un presupuesto que
impide crecer contiene la deuda, pero no mejora cohesión ni testabilidad.

**Impacto:** cambios pequeños requieren entender superficies grandes; aumenta
la probabilidad de renderizaciones innecesarias y regresiones cruzadas.

### D6. Seguridad de tipos incompleta — **P1**

El repositorio completo compila, pero sin el conjunto total de garantías de
`strict`. `tsconfig.strict.json` enumera explícitamente las islas migradas. Los
23 `any` están presupuestados, no resueltos, y una frontera transitiva todavía
puede arrastrar el legacy de IA.

**Impacto:** nulos y formas externas inválidas pueden convertirse en fallos de
runtime en zonas no migradas. **Decisión recomendada:** migrar por módulos de
dominio y bordes I/O, con validación runtime donde entra dato externo.

### D7. CSP diagnóstica, no preventiva — **P1**

Vercel entrega `Content-Security-Policy-Report-Only`; además `script-src` y
`style-src` admiten `'unsafe-inline'`. El saneador sigue siendo una defensa
valiosa, pero una segunda barrera del navegador no bloquea todavía una
inyección que lo evada.

**Impacto:** menor defensa en profundidad frente a XSS o supply-chain. La
migración debe medirse con reportes antes de activar enforcement para no romper
Firebase, fuentes, workers o diagramas.

### D8. Configuración operativa no es completamente confiable — **P1**

`.env.example` conserva un comentario sobre el bootstrap del primer
`superadmin`, aunque el flujo fue eliminado, y describe fallback directo como
comportamiento normal. La documentación histórica también contiene cifras y
estados superados. Un runbook contradictorio es un riesgo operativo aunque el
código sea correcto.

**Impacto:** despliegues inseguros o soporte lento. **Decisión recomendada:**
documentación versionada como gate y tabla única de variables con entorno,
secreto, default y owner.

### D9. Rendimiento del cliente sin holgura suficiente — **P1**

La puerta pasa, pero el bundle eager consume 661,5 de 675 KB gzip: queda apenas
2 % de margen. Los chunks lazy de Excalidraw (~2,37 MB raw), `agentExecutor`
(~1,48 MB), ELK (~1,42 MB) y Workspace (~1,05 MB) desplazan el coste en vez de
eliminarlo. El build además reporta una advertencia de sintaxis CSS generada.

**Impacto:** arranque lento en móvil/red limitada, pausas al abrir capacidades
pesadas y presupuesto que puede bloquear el siguiente incremento funcional.
**Decisión recomendada:** perfil real con Web Vitals, separar ejecución de
agentes del UI y cargar editores/engines bajo demanda con prefetch intencional.

### D10. Disponibilidad y escala de datos no tienen objetivos operables — **P2**

La persistencia posee caché, índices de artefactos, subcolecciones y fallbacks,
pero no hay evidencia visible de SLO, pruebas de carga, presupuesto de lecturas,
RPO/RTO ni restauración ejercitada. El frontend no puede compensar por sí solo
cuotas, índices faltantes o un incidente regional.

**Impacto:** costes y degradación aparecen tarde, especialmente al crecer
proyectos, artefactos y graph data.

### D11. Portabilidad y custodia de tokens — **P2**

La aplicación acopla despliegue a Vercel y datos/identidad a Firebase. Además,
algunos modos BYOK e integración Lucid conservan tokens en `localStorage`,
superficie accesible a cualquier XSS ejecutado en el origen.

**Impacto:** migración costosa y exposición persistente de credenciales de
usuario. **Decisión recomendada:** adaptadores, sesiones efímeras cuando sea
posible y documentación clara del threat model.

## 5. Plan de trabajo

### Principios de ejecución

1. **Sin reescritura.** Strangler vertical, una capacidad y sus tests por PR.
2. **Toda mejora deja una guarda.** Test, regla lint, presupuesto o monitor.
3. **Cambios reversibles.** Flags sólo como transición, con fecha y condición
   de retiro.
4. **Primero exposición y detección; después estética interna.** D1–D3 preceden
   a los refactors.
5. **Definition of Done común:** `npm run quality`, rules cuando corresponda,
   E2E relevante, ADR/runbook, telemetría y rollback ensayado.

### Ola 0 — Contención productiva (semanas 1–2)

| Entrega | Acciones | Criterio de salida | Responsable sugerido |
|---|---|---|---|
| IA segura (D1) | Hacer obligatorio el proxy en builds production; eliminar claves globales `VITE_*` del camino recomendado; validar configuración al boot; mantener BYOK explícito. | Build productivo falla si falta proxy/Firebase project; escáner verde; prueba negativa demuestra que una caída no llama directo. | Security + AI |
| E2E autenticado obligatorio (D3) | Crear proyecto Firebase de test, cuentas/claims sembrados, secretos en environment protegido y limpieza idempotente. | Los journeys login → proyecto → artefacto y solicitud → revisión → ARB corren en cada PR; ausencia de secreto falla, no salta. | QA + Platform |
| Higiene operativa (D8) | Corregir `.env.example`, retirar instrucciones obsoletas, crear matriz de configuración y runbook de rollback. | Revisión automatizada de variables conocidas; documentación y código usan los mismos nombres/defaults. | Tech Lead |

### Ola 1 — Observabilidad y seguridad del navegador (semanas 3–5)

| Entrega | Acciones | Criterio de salida | Responsable sugerido |
|---|---|---|---|
| Telemetría remota (D2) | Definir `TelemetryPort`; exportador OTLP/Sentry equivalente; redacción de prompts, tokens y PII; sampling; release/trace/user pseudónimo. | Dashboard de errores, latencia p95, degradación IA y persistencia; alerta con owner; simulacro detectado y correlacionado extremo a extremo. | Platform/SRE |
| SLO inicial (D2/D10) | Definir disponibilidad de shell y persistencia, éxito y latencia de generación, error budget y severidades. | SLO aprobados; alertas basadas en burn rate; runbooks enlazados. | Product + SRE |
| CSP enforcement (D7) | Recoger reportes, eliminar scripts inline mediante nonce/hash o archivos, reducir allowlist y promover gradualmente. | `Content-Security-Policy` bloqueante en producción; sin `unsafe-inline` en scripts; smoke desktop/iPad verde; cero violaciones legítimas por 7 días. | Security + Frontend |

### Ola 2 — Strangler y tipos (semanas 6–11)

| Entrega | Acciones | Criterio de salida | Responsable sugerido |
|---|---|---|---|
| Extraer motor IA (D4) | Orden sugerido: generación documental, crítica/refinado, diagramas legacy y funciones restantes. Cada vertical recibe contrato neutral, prompt builder, adapter y contract tests. | `geminiService.ts` <1.000 líneas o eliminado; ninguna UI lo importa; `services/ai/index.ts` no expone legacy; paridad de resultados/fallos demostrada. | AI + Architecture |
| Strict por frontera (D6) | Empezar por adaptadores I/O y módulos extraídos; sustituir `any` por `unknown` + narrowing; enrolar rutas completas en strict. | Presupuesto `any` 23→10→0; `strict: true` global; sin subida de casts inseguros ni non-null assertions como evasión. | Tech Lead |
| Descomponer hotspots (D5) | Separar view-model/hooks, toolbar, viewport/interaction, renderer y adapters puros. Perfilar antes/después. | Ningún componente productivo >800 líneas; complejidad y renders medidos bajan; tests de interacción y accesibilidad preservan conducta. | Frontend |
| Presupuesto de rendimiento (D9) | Medir Web Vitals y waterfall por journey; lazy-load real de agentes/editores; revisar imports del entry; resolver warning CSS; prefetch sólo tras intención. | Eager ≤550 KB gzip; LCP/INP p75 en objetivo móvil; ningún engine pesado llega antes de usarse; build sin warnings. | Frontend + Performance |

### Ola 3 — Escala, recuperación y portabilidad (semanas 12–16)

| Entrega | Acciones | Criterio de salida | Responsable sugerido |
|---|---|---|---|
| Capacidad de datos (D10) | Escenarios de 100/1.000 proyectos y artefactos; medir lecturas, latencia, tamaño y costes; paginación/índices; prueba de restore. | Presupuestos p95 y coste/usuario; cero documento cerca del límite; RPO/RTO demostrados en ejercicio. | Data + Platform |
| Tokens y BYOK (D11) | Threat model; preferir memoria/session storage o vault server-side; expiración/revocación; UX que explique custodia. | Ningún token de integración persistente sin necesidad y consentimiento; test de logout/borrado; runbook de revocación. | Security + UX |
| Portabilidad (D11) | Formalizar adapters de hosting, telemetría, identidad y persistencia; documentar exportación/restore. | ADR y prueba de adapter fake; restore verificable; ninguna regla de dominio depende del SDK proveedor. | Architecture |

## 6. Backlog ejecutable por debilidad

| ID | Épicas/tareas mínimas | Dependencias | KPI de cierre |
|---|---|---|---|
| D1 | Config validator; production default; retirar claves operatorias del cliente; pruebas fail-closed; guía de rotación. | Proxy desplegado. | 0 claves de proveedor en bundle; 100 % llamadas operatorias por proxy. |
| D2 | Puerto + adapter; esquema de evento; privacy filter; dashboards; alertas; on-call runbook. | Aprobación privacidad. | MTTD <10 min; MTTR medible; ≥99 % eventos con release y trace. |
| D3 | Tenant de prueba; fixture/cleanup; claims; dos journeys críticos; gate obligatorio. | Credenciales CI. | 0 skips de journeys críticos en PR. |
| D4 | Mapa de métodos/callers; contract tests; 4–6 verticales; retirar singleton. | D2 para comparar errores/latencia. | Hotspot <1.000 líneas; 0 imports legacy desde consumidores. |
| D5 | Perfil de renders; extraer controladores y vistas; test visual/interacción. | Ninguna. | Máximo 800 líneas/componente; p95 de interacción no empeora. |
| D6 | Dashboard strict por módulo; eliminar `any`; activar flags globales. | Avanza junto a D4. | 0 `any`; strict global verde. |
| D7 | Endpoint/report collector; inventario de violaciones; nonces/hashes; enforcement gradual. | D2. | CSP bloqueante y violaciones legítimas = 0. |
| D8 | Matriz env; lint de configuración; archivar informes históricos; runbooks. | D1. | 0 variables obsoletas/contradictorias. |
| D9 | RUM/Web Vitals; bundle explorer; lazy boundaries; CSS warning; budgets por journey. | D2 aporta medición real. | Eager ≤550 KB gzip y p75 móvil en objetivo. |
| D10 | Modelo de carga; benchmark; índices/paginación; backup/restore drill. | D2/SLO. | SLO y RPO/RTO cumplidos en prueba. |
| D11 | Threat model tokens; storage policy; adapters; ADR de salida. | D1/D2. | Revocación probada y restore portable documentado. |

## 7. Gobierno, métricas y riesgos de ejecución

### Cuadro de mando quincenal

- **Seguridad:** secretos detectados, llamadas IA directas, violaciones CSP,
  vulnerabilidades high/critical y tiempo de remediación.
- **Confiabilidad:** disponibilidad, p95/p99, error budget, tasa de degradación,
  conflictos/rollback de persistencia y MTTR.
- **Entrega:** lead time, duración p95 de CI, flaky-test rate y frecuencia de
  rollback.
- **Modificabilidad:** tamaño de hotspots, dependencias/ciclos permitidos,
  porcentaje strict y presupuesto `any`.
- **Experiencia:** éxito por journey, errores accesibles, Web Vitals por
  dispositivo y tasa de abandono en generación/revisión/ARB.
- **Coste:** llamadas IA y lecturas/escrituras Firestore por usuario/proyecto.

### Riesgos del plan y mitigación

| Riesgo | Mitigación |
|---|---|
| Activar proxy estricto interrumpe IA | Canary, health check y rollback de despliegue; no fallback inseguro. |
| Telemetría filtra contenido sensible | Allowlist de campos, redacción antes del transporte, sampling y revisión de privacidad. |
| Refactor de IA cambia prompts/resultados | Golden/contract tests, captura de métricas antes/después y verticales pequeñas. |
| Strict genera PR masivo | Enrolamiento módulo por módulo y presupuesto descendente. |
| E2E real es inestable/costoso | Tenant aislado, fixtures deterministas, cleanup, retries sólo de infraestructura y quarantine con SLA. |
| CSP rompe librerías de diagramas/workers | Report-only medido, matriz desktop/iPad y rollout gradual por rutas. |

### Supuestos

- Se mantiene la estrategia frontend-first con proxies serverless sin dominio.
- Firebase y Vercel continúan como plataformas de corto plazo.
- El equipo puede asignar al menos dos líneas paralelas: riesgo productivo y
  modificabilidad. Con una sola línea, priorizar estrictamente Ola 0 → Ola 1 →
  D4/D6; el horizonte aumentará.
- Los datos productivos y métricas de Vercel/Firebase no estuvieron disponibles
  durante la revisión; por ello disponibilidad, coste y rendimiento real se
  califican como **no demostrados**, no como fallos confirmados.

## 8. Evidencia reproducible

```bash
# Inventario de repositorio y pruebas
git ls-files | wc -l
git ls-files '*.ts' '*.tsx' | wc -l
git ls-files '*test.ts' '*test.tsx' '*.spec.ts' | wc -l

# Quality gate local equivalente al job principal de CI
npm run quality

# Guardas arquitectónicas y de tipos
npm run check:any-budget
npm run check:module-size
npm run check:module-boundaries

# Dependencias (en este entorno respondió HTTP 403; verificar en CI)
npm audit --audit-level=high
```

## 9. Recomendación final

Aprobar el plan como **programa de reducción de riesgo**, no como refactor
cosmético. Las primeras cinco semanas deben comprar seguridad y capacidad de
diagnóstico; las siguientes deben reducir el coste de cambio que concentra el
legacy. El éxito no es “terminar tareas”, sino demostrar: cero credenciales del
operador en cliente, journeys autenticados obligatorios, incidentes visibles
con SLO, CSP bloqueante, `strict` global y eliminación del hotspot de IA.
