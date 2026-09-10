# Accesibilidad de Publicación

> Validación de accesibilidad de los entregables. Módulo:
> `PublicationAccessibilityService.ts`. UI: `PublicationAccessibilityPanel.tsx`.

---

## 1. Objetivo

Un entregable de clase mundial debe ser **accesible**: legible por lectores de
pantalla, navegable, comprensible y correcto al exportarse a PDF/DOCX/HTML. El
servicio de accesibilidad califica el contenido de los artefactos y produce un
score, hallazgos, recomendaciones y un veredicto bloqueante.

---

## 2. Verificaciones

El servicio valida lo que se puede derivar de forma determinista del contenido
del artefacto:

| Código | Verificación |
|---|---|
| `heading-hierarchy` | Jerarquía de encabezados sin saltos de nivel. |
| `diagram-alt-text` | Diagramas con descripción textual equivalente (objetivo o narrativa). |
| `table-headers` | Tablas con celdas de encabezado completas. |
| `title-length` | Títulos legibles (3–120 caracteres). |
| `navigable-structure` | Documentos extensos divididos en secciones. |
| `readable-in-export` | Contenido no vacío y legible para exportar. |

Las preocupaciones WCAG de nivel UI — foco visible, `aria-label` en botones,
compatibilidad con modo oscuro, severidad que no depende solo del color, estados
de carga/error informativos — las satisfacen **por construcción** los componentes
del Centro de Publicación y los adaptadores de exportación (que embeben
metadatos). No se simulan como hallazgos del artefacto.

---

## 3. Niveles de accesibilidad

Cada perfil declara un `accessibilityLevel`:

| Nivel | Bloquea si… |
|---|---|
| `basic` | hay algún hallazgo crítico. |
| `standard` | hay un hallazgo crítico o alto. |
| `strict` | hay un hallazgo crítico, alto o medio. |

El veredicto puede ser `passed`, `warning` o `blocked`. El score parte de 100 y
descuenta por severidad (crítico −40, alto −18, medio −9, bajo −4).

---

## 4. Resultado

`evaluatePublicationAccessibility(artifacts, level, scope, targetId)` devuelve un
`PublicationAccessibilityReport`:

- `score` — 0–100.
- `verdict` — `passed` / `warning` / `blocked`.
- `issues` — hallazgos con severidad, mensaje y recomendación.
- `recommendations` — acciones priorizadas.
- `blocked` — `true` cuando no se cumple el mínimo del nivel.

El reporte se integra en el readiness del paquete y un veredicto bloqueado
inyecta un hallazgo `accessibility-issue` en el preflight.

---

## 5. Accesibilidad de la propia UI

El Centro de Publicación (`components/publication/`) se construyó accesible:

- overlay con `role="dialog"`, `aria-modal`, `aria-label` y trampa de foco
  (`useFocusTrap`), cierre con `Escape`;
- anillos de foco visibles (`focus-visible:ring`) en todos los controles;
- severidad siempre mostrada como **texto + color**, nunca solo color;
- soporte completo de modo oscuro (`dark:` en cada superficie);
- estados vacíos y de error útiles, sin pantallas en blanco;
- objetivo de uso cómodo en iPad (controles ≥ 42px, layout responsivo).
