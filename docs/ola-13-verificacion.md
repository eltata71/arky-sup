# Verificación de cierre de la ola 13

Contrato: `docs/plan-clase-mundial.md` § ola 13. El criterio conjunto exige
H18–H21 cerrados, cero hallazgos axe graves o críticos en diez rutas y
regresión visual en CI. Las PR originales #169 (13.0), #187 (13.3), #202
(13.4), #204 (13.5) y #212 (13.2) están fusionadas y cada una pasó su E2E.

## Inventario de estados de carga

| Medida | Antes (plan) | Revisión actual | Lectura |
|---|---:|---:|---|
| Ficheros de UI con `animate-spin` | 30 | 18 | Los restantes muestran progreso o una acción puntual: enviar, guardar, evaluar, descargar o generar. `DiagramSkeleton` incorpora un indicador de progreso dentro de su propio esqueleto. |
| Ficheros de UI que usan `PageSkeleton` | 6 | 11 | Las cinco pantallas principales conservan su forma mientras cargan. |

El inventario cuenta ficheros bajo `components/` y `pages/`, no apariciones ni
pantallas. En esta revisión también se convirtieron a esqueletos las cargas
de documento SDD, catálogo y diagnóstico LMS, lección y reto, revisión de
consistencia, Fable y la vista de Lucid. Cada grupo tiene `role="status"`,
`aria-busy` y una etiqueta localizada mediante `SkeletonGroup`.

## Controles

- **13.0:** `e2e/accessibility.spec.ts` recorre diez rutas protegidas y las
  vistas de artefactos. `e2e/visual-regression.spec.ts` compara seis diagramas
  y tres documentos contra imágenes versionadas, en Chromium y contra `dist/`.
  La línea base axe solo puede reducirse. El entorno local actual no tiene
  Docker, por lo que la verificación del nuevo commit debe ocurrir en CI.
- **13.1:** `MotionConfig reducedMotion="user"` cubre la raíz; el escaneo de
  `motion/react` incluye `components/`, `pages/`, `hooks/` y `context/` y
  rechaza duraciones y curvas literales y anulaciones de la preferencia. Los
  componentes de microinteracción se ejercitan con `matchMedia` simulado.
- **13.2:** los diccionarios tienen las mismas claves y el inglés carga en
  diferido. El escaneo AST de literales JSX cubre también `context/` y `hooks/`.
  Los avisos de notificaciones, agentes, cola, LMS y observabilidad ya usan el
  traductor seleccionado; las pruebas comprueban inglés en notificaciones y
  diagnósticos.
- **13.3:** el escaneo exige ruta de teclado en los `div` accionables; los
  fondos de diálogo solo cierran por puntero y conservan controles de cierre.
  La prueba de `Modal` cubre foco inicial, ciclo de Tab, Escape y retorno del
  foco al origen.
- **13.4:** `screenStates.test.tsx` cubre vacío, carga y error en cinco
  pantallas; cada error ofrece reintento y diagnóstico.
- **13.5:** `docs/microinteracciones.md` relaciona cada forma con su evento;
  las pruebas cubren celebración única, fin de generación y movimiento
  reducido. `StatusBars` desactiva también el reordenamiento al reducir
  movimiento.

## Evidencia del cierre complementario

En el checkout aislado, sobre `origin/main` actualizado, pasaron `quality:static`
(typecheck, strict, lint y presupuestos de arquitectura),
`check:i18n-sections`, `test:ci` (620 archivos, 5778 pruebas),
`build:placeholders`, `check:bundle-secrets` y `check:bundle-budget`
(340,5 KB gzip iniciales frente al límite de 345 KB; todas las rutas dentro
de su presupuesto).

La [ejecución E2E de la PR #233](https://github.com/eltata71/arky-sup/actions/runs/38342877675)
pasó contra el commit de cierre: 51 pruebas efectivas, incluidos los casos de
axe de las rutas protegidas y las nueve capturas canónicas en Chromium. Los
cuatro shards de Vitest, cobertura, CodeQL, auditoría de dependencias, gates
estáticos y preview también pasaron. Con esta evidencia quedan cumplidos los
criterios técnicos de cierre de la ola 13.
