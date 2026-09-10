# UI/UX World-Class Upgrade Plan — Arky 10

## Objetivo
Elevar la experiencia visual e interacción de Arky 10 a un estándar de producto SaaS clase mundial, reforzando la narrativa del **Arquitecto de Soluciones** y mejorando claridad, confianza y eficiencia.

## Fase 1 — Diagnóstico integral (completada)
### Hallazgos principales
1. **Narrativa de marca dispersa**: la propuesta de valor existe, pero no está unificada entre login, dashboard y proyectos.
2. **Jerarquía visual mejorable**: faltaba una sección hero con contexto estratégico y KPIs accionables.
3. **Consistencia de microcopy**: coexistían textos en inglés/español en flujos primarios.
4. **Accesibilidad y orientación**: faltaban pistas explícitas de “qué hacer ahora” en estados vacíos y acciones rápidas.
5. **Percepción premium**: había buena base visual, pero con oportunidad de elevar composición, énfasis y cohesión narrativa.

## Fase 2 — Plan de intervención priorizado (completado)
### Frentes de mejora
- **F1. Identidad y storytelling**
  - Hero narrativo en autenticación y dashboard.
  - Mensajes centrados en el rol del arquitecto.
- **F2. Jerarquía y foco de acción**
  - KPI cards y CTA de alto impacto.
  - Segmentación clara “estrategia + ejecución”.
- **F3. UX de orientación y confianza**
  - Estados vacíos accionables.
  - Microcopy orientado a decisiones.
- **F4. Consistencia visual/idioma**
  - Homologación de idioma principal al español en accesos críticos.
  - Patrones visuales consistentes (bordes, fondos, sombras, badges).

## Fase 3 — Implementación ejecutada
- Renovación de `AuthPage` con layout de marca + panel de valor profesional.
- Enriquecimiento de `HomePage` con hero estratégico, métricas y acciones guiadas.
- Reestructuración de cabecera y sección operativa de `ProjectsPage` con narrativa de entrega arquitectónica.

## Fase 4 — Doble chequeo (completado)
- Validación técnica: type-check y test suite.
- Verificación funcional: checklist de implementación de cada frente de mejora.

## Checklist de cierre
- [x] Storytelling unificado en entrada, dashboard y proyectos.
- [x] Jerarquía visual reforzada con hero + métricas + CTA.
- [x] Microcopy más profesional y contextual para arquitectos.
- [x] Estados de uso más orientados a acción.
- [x] Validación técnica ejecutada.

## Evolución 2026-09-06 — Top 10 de experiencia de agentes

La revisión priorizó el área con mayor impacto perceptible y operativo: el inventario, la ficha y la coordinación de agentes. Se mantuvieron intactos el enrutamiento, los permisos y las invariantes de productor/revisor.

1. **Hero con narrativa de producto:** título orientado a valor y una superficie visual con profundidad.
2. **Resumen ejecutivo:** disponibilidad, tamaño del equipo y personalización se leen como indicadores, no como etiquetas sueltas.
3. **Mapa de coordinación:** representación navegable del flujo coordinación → especialistas → consolidación.
4. **Identidad visual consistente:** avatar reutilizable con glifo/emoji, color estable, estado y marca de personalización.
5. **Tarjetas con jerarquía:** nombre, rol, habilidades y cobertura gobernada se escanean en ese orden.
6. **Indicadores gráficos:** barras compactas comunican densidad de conocimiento y memoria sin reemplazar los datos accesibles.
7. **Filtros informativos:** cada lente incluye icono, contador y estado seleccionado accesible mediante `aria-pressed`.
8. **Movimiento responsable:** entrada y elevación sutil con respeto explícito por `prefers-reduced-motion`.
9. **Ficha profesional:** cabecera visual, secciones semánticas con iconografía y cierre visible de 44 px.
10. **Recuperación sin fricción:** el estado vacío explica el resultado y permite limpiar la búsqueda en un paso.

### Decisiones de arquitectura y riesgos

- Los elementos nuevos viven dentro del módulo visual de perfiles y consumen únicamente el contrato público de `architectureOffice`; no introducen servicios, persistencia ni reglas de dominio en la pantalla.
- El mapa deriva sus etapas de `orchestrationRole`: no duplica el planificador ni permite modificar gobierno desde UI.
- Los indicadores son una ayuda visual relativa, no métricas de rendimiento del agente. No se presentan como puntuaciones de calidad para evitar una interpretación falsa.
- Se reutilizan Tailwind, Lucide y Motion ya presentes; no se incorporan activos remotos ni peso de dependencia adicional.
