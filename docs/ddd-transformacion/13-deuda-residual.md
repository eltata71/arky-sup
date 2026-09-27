# Deuda residual — con responsable, justificación y condición de revisión

**F6-08 · 2026-09-26.** Lo que la transformación deja sin hacer, **a propósito y
por escrito**. Cada entrada responde cuatro preguntas: qué es, quién responde de
ella, por qué se acepta hoy, y qué hecho obliga a revisarla. Una deuda sin esa
última columna no es deuda controlada: es un olvido con fecha.

**Responsable.** En esta prueba de concepto hay una sola persona que decide:
**el propietario** (`eltata71`). «Propietario» significa que la decisión es
suya. Si pasa a ser un equipo, esta columna se reparte.

Las decisiones que desbloquearon esta tarea son del propietario, del
2026-09-26, siguiendo las recomendaciones que se le presentaron.

---

## 1. Decisiones de negocio

| # | Qué | Decisión | Revisar cuando |
|---|---|---|---|
| **R-01** | **Archivado y retención (D-2).** Borrar es definitivo, no existe el estado «archivado», y cuatro tablas sólo crecen (acciones del agente, versiones de artefactos, decisiones del comité, auditoría) | **Opción A**: mientras sea PoC se conserva todo y el borrado sigue siendo manual. Las alternativas quedan descritas para entonces: **B**, archivado lógico reversible; **C**, retención con plazos; **D**, B ahora y C después | **Antes de cargar datos productivos**, o si una tabla supera un volumen que se note al leerla. Se elige entre B, C o D |
| **R-02** | **`charter:approve` no lo exige nadie.** El permiso existe en la matriz (reviewer, admin, superadmin) y en SQL, pero cualquier arquitecto aprueba el charter de su propio encargo. El diseño lo quería así («es el dueño del proyecto diciendo sí»), y entonces el permiso sobra | **Sin decidir**: encontrado al llevar E-02 al servidor. Es una regla de producto | Cuando haya más de un usuario con roles distintos. Opciones: exigir el permiso (el autor deja de aprobar lo suyo, como ya pasa en el comité) o retirarlo de la matriz |

## 2. Riesgos aceptados

| # | Qué | Por qué se acepta hoy | Revisar cuando |
|---|---|---|---|
| **R-03** | **El historial de chat puede perder mensajes (T-06).** `save_chat_history` reescribe la lista entera sin revisión: con dos pestañas en el mismo proyecto, la última que guarda borra los mensajes de la otra, sin aviso | Un solo usuario, y rara vez con dos pestañas en el mismo proyecto. **El propietario no ha elegido todavía** entre revisión optimista y un registro por mensaje (ver F6-05 §3) | El primer caso observado, o antes de tener varios usuarios. Arreglarlo exige una migración |
| **R-05** | **E-04: el rastro de auditoría de un cambio de estado lo garantiza TypeScript**, no el servidor | `transitionEngagement` y su prueba de forma lo sostienen. El registro inmutable del comité, que es lo auditado de verdad, sí es del servidor | Si la auditoría del encargo pasa a tener valor legal |
| **R-06** | **E-05: productor y revisor distintos, sólo en el planificador** | La separación que importa, autor contra aprobador del comité, ya es del servidor (E-08) | Si las tareas se asignan a personas y no a agentes |
| **R-07** | **E-14: el servidor valida la forma del presupuesto de IA, no su consumo** | El consumo lo cuenta el runner; el coste lo limita además el proxy (límite por cliente) | Si hay coste por usuario que facturar |

## 3. Deuda técnica con propuesta

| # | Qué | Cuánto cuesta hoy | Propuesta | Revisar cuando |
|---|---|---|---|---|
| **R-09** | **La IA se descarga al abrir ocho pantallas** (≈600 KB gz cada una) aunque nadie pulse el botón de captura asistida o del asistente | Medido y con techo por ruta (ADR-109), así que sólo puede bajar | Cargar la capa de IA con `import()` en el primer uso de la captura asistida y del asistente | Si la carga de esas pantallas se nota en los dispositivos reales (iPad), o al retomar rendimiento |
| **R-10** | **H04: barriles que publicaban infraestructura.** Reducido el 2026-09-26: `settings`, `learning`, la Oficina y `review` ya no publican sus implementaciones de Supabase ni sus repositorios concretos, y los tipos que otros módulos usaban por ruta se publican en la puerta. Queda **una** implementación publicada, a propósito: `createSupabaseKnowledgeGraphRepository`, que construye la infraestructura de Proyectos | Es infraestructura hablando con infraestructura, no una pantalla ni un dominio | Mover la construcción del repositorio del grafo a un puerto que Proyectos reciba | Al tocar la persistencia del grafo |
| **R-12** | **`_generateArtifactContentInternal`, unas 900 líneas dentro del motor** | Una sola función con el camino C4, documentos y Mermaid; sin `any` y con techo de tamaño | Descomposición ordinaria por tipo de salida; ya no es migración (ADR-108) | Al añadir el próximo tipo de artefacto |
| **R-15** | **Los módulos de apoyo no tienen la forma `domain/`/`infrastructure/`**: `learning`, `review`, `publicationPipeline`, `settings`, `chat` y el resto. F6-03 la aplicó a los cuatro agregados del producto —iniciativa, proyecto, encargo, artefacto—, que son los que CLAUDE.md enumera con fábrica e invariantes | Estos módulos o no tienen agregado con reglas propias (`settings`, `chat`), o sus reglas ya son funciones puras en su fichero (`reviewTransitions`, las transiciones de publicación). Partirlos por partirlos sería mover ficheros sin separar nada | Añadir un contexto a `CONTEXTS` en `contextDomainPurity.test.ts` el día que se parta; la prueba ya lo cubre sin más cambios | Cuando uno gane un agregado con invariantes, o cuando una de sus reglas necesite E/S para decidir |

## 4. Cerrado en esta tarea

| # | Qué | Cómo |
|---|---|---|
| **R-04 / E-01** | La RPC no exigía iniciativa en un encargo | Migración `20260927090000_engagement_initiative_guard`: un encargo nace con un vínculo a iniciativa (id o código `NEG-AAAA-NNN`) y no lo pierde; las dos reglas de la fábrica, ni más. Contrato `engagement_initiative_guard.test.sql`. **Aprobado por el propietario, 2026-09-27** |
| **R-13** | `api.record_arb_decision` seguía existiendo, revocada | La misma migración la elimina; `retiredRpcs.test.ts` impide que vuelva y `office_engagements.test.sql` afirma `hasnt_function`. **Aprobado por el propietario, 2026-09-27** |
| **R-11 / F6-10** | El despliegue no comprobaba el esquema de producción | Migración `20260926140000_deploy_migration_probe` y el paso *Production has every migration of this commit* de `ci.yml`, que falla cerrado. **Opción B del propietario, 2026-09-26** |
| **R-14** | 8 de las 13 migraciones de la transformación sin reversión escrita | Anexo en `docs/operacion/runbook-migraciones.md`: qué hizo cada una, su reversión como migración nueva y qué reabriría. Revisión de deuda técnica, 2026-09-26 |
| **R-08 / T-01** | Persistir una URL firmada lo impedía la convención, sin prueba | `__tests__/security/noPersistedSignedUrl.test.ts`. Revisión de deuda técnica, 2026-09-26 |
| **E-02 / H06** | Nadie ejecuta un charter sin aprobar: ahora lo sabe el servidor | Migración `20260926090000_charter_approval_guard`. Ejecutar exige un charter aprobado, la aprobación es inmutable y la firma la sesión que la escribe. Contrato `charter_approval_guard.test.sql` con un caso negativo por regla. **Decisión del propietario, 2026-09-26** |
