# Plan de Mejora Integral — Arky 10 (Clase Mundial)

Este plan aborda 4 ejes estratégicos con ~25 tareas concretas, ordenadas por prioridad e impacto.

---

## EJE 1: Optimización de la Capa de Datos (Firestore)

### 1.1 Crear `services/userService.ts` — Centralizar operaciones de usuarios
- **Problema**: `AuthContext.tsx` y `UserManagementPage.tsx` llaman directamente al SDK de Firestore (violación arquitectónica documentada en CLAUDE.md).
- **Acción**: Crear un servicio dedicado con funciones: `getUserProfile()`, `createUserProfile()`, `updateUserRole()`, `deleteUser()`, `getAllUsers()`, `isFirstUser()`.
- **Eliminar** las importaciones directas de `firebase/firestore` en `AuthContext.tsx` (línea 14) y `UserManagementPage.tsx` (línea 2).

### 1.2 Implementar caché en memoria con invalidación
- **Problema**: No existe caché en memoria; cada acceso al contexto re-lee de localStorage. No hay estrategia de invalidación.
- **Acción**: Agregar un `Map<string, { data: T; timestamp: number }>` en `firestoreService.ts` con TTL configurable (ej. 5 minutos para proyectos, 30 min para settings).
- **Beneficio**: Reducción de lecturas Firestore en ~60%, menor latencia en navegación entre vistas.

### 1.3 Paginación de consultas y chat history
- **Problema**: `getAllProjects()` carga TODOS los proyectos del usuario sin límite. `getChatHistory()` carga el array completo de mensajes.
- **Acción**:
  - Agregar `limit()` y `startAfter()` a `getAllProjects()` con paginación de 20 elementos.
  - Implementar paginación en `getChatHistory()` con carga de últimos 50 mensajes y botón "Cargar anteriores".
  - Agregar `orderBy('updatedAt', 'desc')` para mostrar proyectos recientes primero.

### 1.4 Batch writes para operaciones de artefactos
- **Problema**: Cada modificación de artefacto dispara un `updateProjectArtifacts()` individual. Operaciones como la creación guiada generan múltiples escrituras secuenciales.
- **Acción**: Implementar `batchUpdateArtifacts()` que agrupe múltiples cambios en un solo `writeBatch()`.
- **Beneficio**: Consistencia atómica + reducción de escrituras Firestore (ahorro de costos).

### 1.5 Rollback en actualizaciones optimistas
- **Problema**: El UI actualiza el estado antes de confirmar con Firestore. Si la escritura falla, el estado local queda inconsistente.
- **Acción**: Implementar patrón de rollback: guardar estado previo, aplicar cambio, revertir si falla + mostrar toast de error.

### 1.6 Listeners en tiempo real para proyectos activos
- **Problema**: No existen `onSnapshot` listeners; los cambios en otra pestaña/dispositivo no se reflejan.
- **Acción**: Agregar `onSnapshot` en `Workspace.tsx` para el proyecto activo, permitiendo colaboración básica en tiempo real.
- **Scope limitado**: Solo para el proyecto abierto, no para listas completas (evitar exceso de lecturas).

---

## EJE 2: Estructura de Código y Preparación para Vercel

### 2.1 Code splitting con React.lazy()
- **Problema**: Todas las páginas se importan estáticamente en `App.tsx`. El bundle inicial estimado es ~1MB+.
- **Acción**: Convertir TODAS las importaciones de páginas a `React.lazy()` con `Suspense`:
  ```tsx
  const HomePage = React.lazy(() => import('./pages/HomePage'));
  const Workspace = React.lazy(() => import('./pages/Workspace'));
  // ... todas las demás páginas
  ```
- **Agregar**: Componente `<LoadingFallback />` con skeleton animado para usar en `<Suspense>`.
- **Impacto**: Reducción del bundle inicial en ~40-50%.

### 2.2 Crear `vercel.json` y migrar a BrowserRouter
- **Problema**: La app usa `HashRouter` (URLs con `/#/`), perjudicando SEO y apariencia profesional.
- **Acción**:
  1. Cambiar `HashRouter` → `BrowserRouter` en `index.tsx`.
  2. Crear `vercel.json` con rewrites SPA:
     ```json
     {
       "buildCommand": "npm run build",
       "outputDirectory": "dist",
       "rewrites": [{ "source": "/(.*)", "destination": "/" }]
     }
     ```
- **Resultado**: URLs limpias como `arky.app/workspace/123`.

### 2.3 Corregir metadatos HTML y SEO
- **Problema**: `index.html` dice "Arky 3" (debería ser "Arky 10"), no tiene meta description, OG tags, ni favicon apropiado. Referencia a `/index.css` inexistente (404).
- **Acción**:
  - Actualizar `<title>` a "Arky 10 — AI Architecture Assistant".
  - Agregar meta description, Open Graph tags, Twitter card tags.
  - Eliminar referencia a `/index.css` (línea 186).
  - Agregar `<link rel="canonical">`.

### 2.4 Carga diferida de traducciones
- **Problema**: `AppContext.tsx` contiene TODAS las traducciones embebidas (~50KB+ de strings i18n).
- **Acción**: Extraer traducciones a archivos JSON separados por idioma (`locales/es.json`, `locales/en.json`, etc.) y cargarlas dinámicamente con `import()`.
- **Beneficio**: Bundle más liviano + posibilidad de agregar idiomas sin recompilar.

### 2.5 Optimización de dependencias pesadas
- **Problema**: `Icons.tsx` (~33k líneas), `constants.ts` (646 líneas con templates), y `geminiService.ts` (1345 líneas) se cargan siempre.
- **Acción**:
  - Dividir `constants.ts` en `constants/projectTemplates.ts`, `constants/artifactTemplates.ts`, `constants/kanban.ts`.
  - Lazy-load prompts de `geminiService.ts` por tipo de artefacto.
  - Considerar tree-shaking de iconos (importar solo los usados, no todo Heroicons).

### 2.6 Variables de entorno seguras
- **Problema**: `GEMINI_API_KEY` se inyecta en build-time y queda visible en el bundle del cliente.
- **Acción**: Documentar claramente este modelo de seguridad en README. Para producción, considerar crear una Vercel Edge Function como proxy que almacene la API key en el servidor.
- **Nota**: Esto es aceptable actualmente porque los usuarios pueden usar su propia key.

---

## EJE 3: Experiencia de Usuario (UX)

### 3.1 Sistema de notificaciones Toast
- **Problema CRÍTICO**: No existe sistema de notificaciones. Éxitos y errores solo se registran en `console.log`. Los usuarios no saben si sus acciones tuvieron efecto.
- **Acción**: Implementar un `ToastContext` + componente `<Toast>` con soporte para tipos: success, error, warning, info.
- **Integrar en**: Guardado de settings, creación/eliminación de proyectos, errores de AI, subida de archivos, cambios de rol.
- **Diseño**: Toast flotante en esquina inferior derecha, auto-dismiss a 4 segundos, con animación de entrada/salida.

### 3.2 Error Boundaries por sección
- **Problema**: Si un componente hijo falla (ej. diagrama Mermaid con sintaxis inválida), la app entera puede crashear.
- **Acción**: Crear `components/ErrorBoundary.tsx` con UI de recuperación amigable y envolver secciones críticas:
  - `<ErrorBoundary>` alrededor de `ArtifactCanvas`
  - `<ErrorBoundary>` alrededor de `ChatInterface`
  - `<ErrorBoundary>` alrededor de `ReactFlowCanvas`
  - `<ErrorBoundary>` alrededor de cada ruta en `App.tsx`
- **UI de error**: Mensaje amigable + botón "Reintentar" + opción "Reportar error".

### 3.3 Validación de formularios con feedback visual
- **Problema**: Los inputs tienen `required` pero no muestran mensajes de error inline ni resaltan campos problemáticos.
- **Acción**:
  - Agregar estados de error a inputs (borde rojo + mensaje debajo).
  - Implementar validación en: AuthPage (email formato, contraseña longitud), Settings (API key formato), creación de proyectos.
  - Patrón: `border-red-500 dark:border-red-400` + `<p className="text-red-500 text-sm mt-1">`.

### 3.4 Mejoras en ChatInterface
- **Acción**:
  - Agregar indicador "Escribiendo..." (typing indicator) con animación de puntos durante la respuesta de IA.
  - Agregar timestamps a los mensajes.
  - Agregar botón "Copiar al portapapeles" en respuestas de IA.
  - Mejorar UI de archivos adjuntos (chips con nombre + ícono de tipo de archivo, no texto plano).
  - Agregar conteo de resultados en búsqueda de templates.

### 3.5 Skeleton loaders para páginas de datos
- **Problema**: Las páginas de datos (HomePage, ProjectsPage, LMS) no tienen skeleton loaders durante la carga inicial.
- **Acción**: Crear componentes skeleton para:
  - Grid de proyectos (tarjetas placeholder con animación pulse).
  - Dashboard stats (números placeholder).
  - Lista de cursos LMS.

### 3.6 Confirmación de acciones destructivas
- **Acción**: Agregar diálogos de confirmación para:
  - Eliminar artefactos.
  - Eliminar usuarios (UserManagementPage).
  - Salir del workspace con cambios no guardados.
  - Limpiar historial de chat.

---

## EJE 4: Interfaz Gráfica (UI) — Nivel Clase Mundial

### 4.1 Sistema de diseño con espaciado consistente
- **Problema**: Padding inconsistente (`p-5` vs `p-6`), gaps variables (`gap-4` vs `gap-6` vs `gap-8`).
- **Acción**: Establecer escala de espaciado estándar:
  - Spacing interno de tarjetas: `p-6`
  - Gaps entre tarjetas: `gap-6`
  - Margen de sección: `mb-8`
  - Padding de página: `px-4 sm:px-6 lg:px-8`
- Aplicar consistentemente en TODAS las páginas.

### 4.2 Micro-interacciones premium
- **Acción**: Agregar feedback visual de alta calidad:
  - `active:scale-[0.98]` en botones para efecto de presión.
  - `transition-all duration-150` en todos los elementos interactivos.
  - Hover effects en tarjetas de proyecto (sombra elevada + borde sutil).
  - Animación de "copiado" con checkmark temporal.
  - Transición suave entre tabs con `motion.div` y `layoutId`.
  - Ripple effect sutil en botones principales.

### 4.3 Accesibilidad (a11y) completa
- **Problema**: Rating actual 3/10. Sin `aria-label` en botones de ícono, sin indicadores de foco, sin soporte de teclado en modales.
- **Acción**:
  - Agregar `aria-label` a TODOS los botones que solo contienen iconos.
  - Implementar `focus-visible:ring-2 focus-visible:ring-primary-500` en elementos interactivos.
  - Agregar `aria-modal="true"` y trap de foco en modales.
  - Agregar `role="dialog"` y `aria-labelledby` en modales.
  - Implementar navegación por teclado: Escape cierra modales, Tab cicla botones.

### 4.4 Mejoras visuales en el Workspace
- **Acción**:
  - Agregar breadcrumbs contextuales: `Proyectos > Mi Proyecto > Diagrama C4`.
  - Mejorar la toolbar del canvas con tooltips descriptivos.
  - Agregar indicador visual de guardado automático ("Guardado" con checkmark verde / "Guardando..." con spinner).
  - Panel de artefactos con drag-and-drop para reordenar.

### 4.5 Onboarding y primera experiencia
- **Acción**:
  - Agregar pantalla de bienvenida para usuarios nuevos con 3-4 pasos guiados.
  - Tooltips de ayuda contextual en las primeras interacciones.
  - Template gallery visual con previews de diagramas de ejemplo.
  - "Quick start" card en el dashboard para guiar las primeras acciones.

---

## Orden de Implementación Propuesto

| Fase | Tareas | Impacto |
|------|--------|---------|
| **Fase 1** (Fundamentos) | 1.1, 2.1, 2.2, 2.3, 3.1, 3.2 | Arquitectura limpia + deployment + feedback básico |
| **Fase 2** (Performance) | 1.2, 1.3, 1.4, 2.4, 2.5 | Rendimiento optimizado + bundle reducido |
| **Fase 3** (UX) | 1.5, 3.3, 3.4, 3.5, 3.6 | Experiencia de usuario robusta |
| **Fase 4** (Clase Mundial) | 1.6, 4.1, 4.2, 4.3, 4.4, 4.5, 2.6 | Pulido profesional + accesibilidad |

---

## Archivos Principales a Modificar

| Archivo | Cambios |
|---------|---------|
| `services/firestoreService.ts` | Caché, paginación, batch writes |
| **`services/userService.ts`** (nuevo) | CRUD de usuarios centralizado |
| `context/AppContext.tsx` | Rollback optimista, traducciones externas |
| `context/AuthContext.tsx` | Eliminar imports directos de Firestore |
| `pages/UserManagementPage.tsx` | Usar userService en vez de SDK directo |
| `App.tsx` | React.lazy, Suspense, ErrorBoundary |
| `index.tsx` | HashRouter → BrowserRouter |
| `index.html` | Meta tags, SEO, eliminar CSS 404 |
| **`context/ToastContext.tsx`** (nuevo) | Sistema de notificaciones |
| **`components/Toast.tsx`** (nuevo) | Componente toast |
| **`components/ErrorBoundary.tsx`** (nuevo) | Boundary de errores |
| **`vercel.json`** (nuevo) | Config de deployment |
| `components/ChatInterface.tsx` | Typing indicator, timestamps, copy |
| `pages/HomePage.tsx` | Skeleton loaders, espaciado |
| `pages/Workspace.tsx` | Breadcrumbs, auto-save indicator |
| `vite.config.ts` | Optimización de chunks |
