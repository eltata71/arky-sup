# Top 10 de consolidación técnica — Arky 10

> **Fecha de corte:** 30 de agosto de 2026  
> **Alcance:** arquitectura, seguridad, calidad, datos, operación, rendimiento y experiencia de desarrollo.  
> **Tipo de revisión:** análisis estático del repositorio y sus contratos, más ejecución de la puerta de calidad disponible.
>
> **Plan de ejecución:** el desglose en tareas verificables, con el estado de
> cada punto y las guardas anti-regresión, está en
> [`plan-consolidacion-tecnica-2026-08-30.md`](./plan-consolidacion-tecnica-2026-08-30.md).
> Ese documento también registra, con evidencia, cinco afirmaciones de éste que
> no resistieron la verificación contra el código — en particular el punto 3,
> cuyo enunciado ya estaba cerrado, y §2/§7, donde el HTTP 403 resultó ser una
> limitación del entorno de revisión y no del repositorio.

## 1. Objetivo y conclusión ejecutiva

Arky 10 ya dispone de defensas valiosas: matriz de autorización compartida,
reglas de Firestore verificables, compilador de artefactos, pipeline de
publicación, separación parcial de proveedores de IA, CI y una capa local de
observabilidad. No obstante, su consolidación productiva está limitada por tres
riesgos sistémicos:

1. **La frontera de confianza todavía puede regresar al navegador** cuando el
   proxy de IA no está configurado o falla.
2. **La complejidad se concentra en pocos módulos monolíticos** y TypeScript no
   aplica todavía su contrato estricto completo.
3. **Las señales de calidad y operación no son exigibles de extremo a extremo**:
   no hay umbral de cobertura, E2E obligatorio, telemetría remota ni presupuesto
   de rendimiento en CI.

La recomendación es resolver primero la frontera de seguridad y la integridad de
datos, y después reducir el coste de cambio. Añadir más funcionalidad antes de
cerrar P0 y P1 aumentará el riesgo de regresión y el coste de soporte.

## 2. Método de priorización

Se inspeccionaron configuración, servicios, contextos, componentes, páginas,
reglas, pruebas y CI. Se usó una escala de **1 (bajo) a 5 (alto)** en:

- **Impacto (I):** seguridad, disponibilidad, integridad o valor de negocio.
- **Probabilidad (P):** posibilidad de materialización con el diseño actual.
- **Coste de demora (D):** cuánto encarece posponerlo.
- **Esfuerzo (E):** tamaño relativo; 1 es pequeño y 5 es programa transversal.

La prioridad es `I × P × D`; el esfuerzo no reduce artificialmente el riesgo,
sino que guía el tamaño de los incrementos. Las métricas son un instrumento de
ordenamiento técnico, no una estimación contractual.

### Evidencia cuantitativa de la revisión

- **571 archivos productivos TypeScript/TSX** y aproximadamente **128.387
  líneas** en `api/`, `components/`, `context/`, `hooks/`, `lib/`, `pages/`,
  `services/` y `utils/`.
- `services/geminiService.ts` tiene **6.750 líneas**;
  `components/ReactFlowCanvas.tsx`, **2.715**; y otros 12 módulos superan 840.
- Se detectaron **233 apariciones de `any`** en código productivo y **36
  marcadores** `TODO/FIXME/HACK/XXX`.
- Existen múltiples superficies que convierten Markdown o contenido de IA a
  HTML y lo insertan con `dangerouslySetInnerHTML`.
- La puerta `npm run quality` quedó bloqueada en typecheck porque la instalación
  local no contiene `@firebase/rules-unit-testing`; `npm ci` intentó restaurarla
  pero el registro respondió HTTP 403. Es una limitación del entorno de revisión,
  no evidencia de un defecto funcional de la aplicación.

## 3. Top 10 priorizado

| # | Oportunidad / deuda | I | P | D | Prioridad | E | Horizonte |
|---:|---|:---:|:---:|:---:|---:|:---:|---|
| 1 | Hacer obligatorio el proxy de IA y eliminar el fallback inseguro | 5 | 5 | 5 | **125** | 3 | P0 |
| 2 | Cerrar la superficie XSS con un renderer seguro único | 5 | 4 | 5 | **100** | 3 | P0 |
| 3 | Migrar artefactos y agregados crecientes a subcolecciones | 5 | 4 | 5 | **100** | 5 | P0–P1 |
| 4 | Descomponer `geminiService` y formalizar límites de dominio | 5 | 5 | 4 | **100** | 5 | P1 |
| 5 | Activar `strict: true` y erradicar `any` por presupuestos | 4 | 5 | 4 | **80** | 4 | P1 |
| 6 | Convertir cobertura y E2E en quality gates de CI | 4 | 4 | 4 | **64** | 3 | P1 |
| 7 | Incorporar observabilidad remota, SLO y alertas | 5 | 4 | 3 | **60** | 3 | P1 |
| 8 | Aplicar presupuestos de bundle y rendimiento | 4 | 4 | 3 | **48** | 3 | P2 |
| 9 | Reducir componentes/contextos monolíticos y aislar Firebase Auth | 4 | 4 | 3 | **48** | 4 | P2 |
| 10 | Fortalecer supply chain, reproducibilidad y limpieza operativa | 4 | 3 | 3 | **36** | 2 | P2 |

## 4. Hallazgos y acciones implementables

### 1. Hacer obligatorio el proxy de IA y eliminar el fallback inseguro — P0

**Evidencia.** El cliente declara el proxy opcional y, ante cualquier error,
retorna `null` para reintentar directamente contra el proveedor
(`services/ai/aiProxyClient.ts`). A la vez, `services/geminiService.ts` importa
el SDK de Gemini en código alcanzable por el navegador. Una caída o mala
configuración del proxy, por tanto, puede reabrir exposición de claves, eludir
controles centralizados de cuota y dividir la auditoría.

**Solución.** En producción, exigir `VITE_AI_PROXY_URL`, aplicar *fail closed* y
prohibir credenciales globales en variables `VITE_*`. Mantener BYOK directo sólo
como modo explícito, aislado y con consentimiento. Consolidar en el proxy:
validación Firebase, autorización, cuotas por usuario/tenant, límites de payload,
timeouts, trazas y redacción de datos sensibles. Añadir una prueba de build que
falle si una clave de proveedor aparece en `dist/`.

**Criterio de cierre.** Ninguna llamada productiva usa el SDK desde el navegador;
un proxy caído produce un error recuperable y observable, no fallback directo.

### 2. Cerrar la superficie XSS con un renderer seguro único — P0

**Evidencia.** Chats, LMS, documentos y reportes insertan el resultado de
`marked.parse(...)` con `dangerouslySetInnerHTML`; por ejemplo,
`components/copilot/ProjectCopilotChatModal.tsx` y
`pages/LMS/LessonModal.tsx`. El contenido puede proceder de usuarios, Firestore
o modelos, ninguno de los cuales es una frontera confiable.

**Solución.** Crear un único `SafeRichText`/servicio de render con allowlist
(DOMPurify o sanitizador equivalente), políticas separadas para Markdown y SVG,
bloqueo de URL `javascript:`/event handlers/HTML embebido y Trusted Types cuando
el navegador lo soporte. Sustituir todas las inserciones directas y añadir una
CSP estricta. Probar payloads OWASP, SVG hostil y contenido persistido.

**Criterio de cierre.** Cero `dangerouslySetInnerHTML` fuera del componente
aprobado; suite negativa XSS y CSP activa en producción.

### 3. Migrar artefactos y agregados crecientes a subcolecciones — P0–P1

**Evidencia.** `Project` mantiene `artifacts: Artifact[]` en el agregado raíz
(`types.ts`) y acumula además grafos, paquetes y metadatos. Esto acerca el
documento al límite de Firestore, amplifica bytes transferidos y convierte una
edición independiente en contención del proyecto completo.

**Solución.** Diseñar `projects/{projectId}/artifacts/{artifactId}` y
subcolecciones equivalentes para agregados de crecimiento no acotado. Introducir
repositorios/puertos paginados, índices conocidos, transacciones de metadatos y
un migrador idempotente con doble lectura temporal, verificación, rollback y
telemetría. Versionar el esquema y documentar retención/borrado en cascada.

**Criterio de cierre.** Lectura de proyecto O(1) respecto del número de
artefactos; paginación real; concurrencia por artefacto; migración reconciliada
sin pérdida y rules del nuevo esquema cubiertas por emulador.

### 4. Descomponer `geminiService` y formalizar límites de dominio — P1

**Evidencia.** `services/geminiService.ts` alcanza 6.750 líneas e integra
contratos, orquestación, SDK, prompts, LMS, generación, fallbacks y parsing. Ya
existen módulos modernos bajo `services/ai/`, pero el *facade* heredado continúa
siendo un punto de acoplamiento y una barrera para strictness y pruebas.

**Solución.** Aplicar una migración *strangler*: congelar nuevas funciones en el
monolito; extraer por capacidades (`artifact-generation`, `lms`, `chat`,
`diagram`, `media`); mantener un facade fino y deprecado; inyectar `AIProvider`,
reloj, retry y observabilidad. Los prompts deben ser datos versionados con
contratos de entrada/salida y pruebas doradas, no métodos incidentales.

**Criterio de cierre.** Ningún módulo de dominio supera el umbral acordado
(sugerido: 500 líneas), no importa SDK concreto y sus contratos se prueban sin
red.

### 5. Activar `strict: true` y erradicar `any` por presupuestos — P1

**Evidencia.** `tsconfig.json` explica que el modo estricto completo sigue
pendiente; mantiene `allowJs` y `skipLibCheck`, y no activa `strictNullChecks` ni
`noImplicitAny`. La revisión detectó 233 tokens `any`, concentrados en IA, chat,
LMS, Excalidraw y Workspace. Esto desplaza fallos de contrato a runtime.

**Solución.** Crear configs por frontera (`tsconfig.strict.json` o proyectos
referenciados), activar primero código nuevo y módulos extraídos, reemplazar
`any` por `unknown` + validadores, tipos de SDK y uniones discriminadas. Fijar un
presupuesto monotónico en CI: ninguna aparición nueva y reducción por sprint.
Eliminar `allowJs` al retirar scripts legacy; evaluar `skipLibCheck: false` en un
job periódico.

**Criterio de cierre.** `strict: true`, cero `any` no justificado en producción y
payloads externos validados antes de convertirse en tipos de dominio.

### 6. Convertir cobertura y E2E en quality gates de CI — P1

**Evidencia.** Existe `test:coverage`, pero `vite.config.ts` no fija umbrales y
el workflow ejecuta Vitest, no Playwright. Los E2E presentes no protegen cada PR;
tampoco se publica una tendencia de cobertura.

**Solución.** Definir un baseline real y umbrales crecientes, con mínimos más
altos para autorización, persistencia, migraciones y proxy. Añadir a CI un smoke
E2E determinista en Chromium, pruebas de rules cuando cambien reglas/servicios y
tests de contrato del proxy. Separar suites rápidas y extendidas sin reducir el
bloqueo de caminos críticos.

**Criterio de cierre.** Toda PR ejecuta unit/integration, rules condicionales,
smoke E2E y build; una regresión de cobertura o camino crítico bloquea merge.

### 7. Incorporar observabilidad remota, SLO y alertas — P1

**Evidencia.** `observabilityService` conserva como máximo 80 eventos en memoria,
persiste 30 en `sessionStorage` y escribe en consola. Es útil para diagnóstico
local, pero se pierde al cerrar sesión y no permite correlación, agregación,
alertas ni análisis de impacto en producción.

**Solución.** Añadir un adapter remoto desacoplado (OpenTelemetry/Sentry o
equivalente) con consentimiento, muestreo y redacción. Propagar `traceId` desde
UI a proxy y proveedor; medir disponibilidad, latencia p95, tasa de error,
fallbacks, conflictos y coste/tokens. Definir SLO por flujo crítico y alertas con
runbooks, no por cada excepción individual.

**Criterio de cierre.** Dashboard y alerta para login, carga/persistencia,
generación y publicación; trazas correlacionadas sin PII ni prompts sensibles.

### 8. Aplicar presupuestos de bundle y rendimiento — P2

**Evidencia.** Vite separa vendors, pero permite advertencias recién por encima
de 1.000 kB. La app integra Firebase, Mermaid, Excalidraw, ReactFlow, ELK y
exportadores; sin budgets verificables, el tamaño y la memoria pueden degradarse
silenciosamente, especialmente en equipos móviles.

**Solución.** Medir el build actual y fijar presupuestos por ruta/chunk, no sólo
un límite global. Automatizar análisis de bundles y Lighthouse CI sobre flujos
representativos. Cargar editores/renderers bajo demanda, ejecutar layout/export
intensivo en Web Workers y virtualizar listas grandes. Definir objetivos Web
Vitals y pruebas con proyectos de tamaño máximo soportado.

**Criterio de cierre.** CI bloquea regresiones sobre baseline; se cumplen LCP,
INP, memoria y tiempo de interacción acordados en móvil y escritorio.

### 9. Reducir componentes/contextos monolíticos y aislar Firebase Auth — P2

**Evidencia.** `ReactFlowCanvas` (2.715 líneas), `ArtifactCanvas` (1.227),
`Workspace` (1.214) y `AppContext` (867) mezclan coordinación, estado y UI.
Además, `context/AuthContext.tsx` importa Firebase Auth directamente, excepción
a la regla general de encapsular SDKs en servicios. Estas unidades elevan
rerenders, superficie de regresión y dificultad de pruebas.

**Solución.** Extraer controladores/hooks por caso de uso, stores/contextos con
selectores y componentes presentacionales. Mover Firebase Auth a un
`authService`/adapter inyectable; el contexto sólo traduce estado de aplicación.
Establecer límites de importación con ESLint (`pages/components -> services`
prohibido salvo facade) y pruebas de arquitectura.

**Criterio de cierre.** Módulos con una responsabilidad, tests aislados sin SDK,
rerenders medidos y cero imports Firebase/Gemini en `components/`, `pages/` o
`context/`.

### 10. Fortalecer supply chain, reproducibilidad y limpieza operativa — P2

**Evidencia.** El quality gate depende de una instalación que en esta revisión
no pudo reproducirse por una descarga HTTP 403. Hay 13 scripts `.cjs` en raíz
(incluidos scripts de actualización/refactor) fuera de la superficie TypeScript,
el paquete conserva el nombre histórico `arky-5` y CI no muestra auditoría de
dependencias, SBOM o escaneo de secretos.

**Solución.** Clasificar y retirar scripts de una sola vez; convertir los
operativos a herramientas tipadas, documentadas y probadas. Añadir Dependabot o
Renovate, CodeQL, secret scanning, auditoría/SBOM y política de actualización.
Validar `npm ci` en imagen fijada y mantener un mirror/cache confiable para CI.
Corregir identidad/versión del paquete y registrar ownership de módulos
críticos.

**Criterio de cierre.** Checkout limpio reproducible, cero scripts huérfanos,
alertas de dependencias con SLA, SBOM por release y secretos ausentes del repo y
del bundle.

## 5. Hoja de ruta recomendada

### Ola 0 — Contención (1–2 semanas)

1. Proxy obligatorio y prueba anti-secreto.
2. `SafeRichText` central, inventario y sustitución de los sinks XSS.
3. ADR y diseño de migración de subcolecciones; límites operativos temporales al
   tamaño y número de artefactos.

### Ola 1 — Fundaciones (3–6 semanas)

1. Primer vertical del *strangler* de `geminiService`.
2. Strictness para módulos nuevos y presupuesto decreciente de `any`.
3. Coverage baseline, E2E smoke y rules condicionales en CI.
4. Telemetría remota del proxy y los cuatro flujos críticos.

### Ola 2 — Escala y modificabilidad (6–12 semanas)

1. Migración gradual de artefactos a subcolecciones.
2. Modularización de Canvas/Workspace/AppContext y adapter de Auth.
3. Budgets de bundle/Web Vitals y traslado de cómputo pesado a workers.
4. Supply-chain gates, eliminación de scripts y disciplina de ownership.

## 6. Indicadores para gobernar la consolidación

| Indicador | Situación observada | Objetivo de consolidación |
|---|---:|---:|
| Llamadas IA directas en producción | Fallback permitido | **0** |
| Sinks HTML fuera del renderer seguro | Múltiples | **0** |
| Artefactos embebidos en proyecto | Sí | **0** para nuevos datos |
| Archivo productivo máximo | 6.750 líneas | **≤ 500** (excepciones justificadas) |
| `any` en código productivo | 233 tokens | **0 no justificados** |
| TypeScript | Strict parcial | **`strict: true`** |
| Umbral de cobertura | No configurado | Baseline + incremento sostenido |
| E2E en PR | No | Smoke crítico obligatorio |
| Telemetría remota/SLO | No evidenciada | 4 flujos críticos instrumentados |
| Budget de bundle/performance | Warning a 1.000 kB | Budget por ruta y Web Vitals |

## 7. Riesgos y supuestos

- Los conteos son una fotografía reproducible del árbol actual; comentarios y
  tipos legítimos pueden contener la palabra `any`, por lo que el backlog debe
  basarse en reglas AST antes de fijar el gate definitivo.
- No se realizó pentest dinámico ni prueba de carga. Los hallazgos de XSS y
  escalabilidad expresan superficies demostrables en código, no explotación en
  producción.
- La migración de datos requiere conocer volumen, índices, cuotas y distribución
  reales antes de estimar duración.
- El proxy serverless ya reduce parte del riesgo. La deuda priorizada es que su
  uso es opcional y su fallo degrada hacia una frontera menos segura.
- La indisponibilidad de una dependencia impidió certificar el estado verde del
  quality gate en este entorno; debe confirmarse en CI antes del merge.

## 8. Decisión recomendada

Tratar los elementos **1–3 como condición de seguridad e integridad para escalar
uso**, los elementos **4–7 como condición para aumentar velocidad de entrega sin
degradar confiabilidad**, y los elementos **8–10 como consolidación operativa**.
Cada iniciativa debe entregar incrementos verticales pequeños, métricas antes y
después, compatibilidad temporal y rollback; no se recomienda un refactor masivo
ni una migración de datos de corte único.
