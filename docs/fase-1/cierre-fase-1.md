# Fase 1 — Cierre: diseño de dominio y arquitectura de transición

Base: rama `feature/fase1-diseno-dominio` sobre `e579da5` (cierre F0).
Fecha de cierre técnico: 2026-09-12. Sin cambios de código productivo; solo `docs/fase-1/` + nota de transición en `AGENTS.md`.

## 1. Estado por tarea

| Tarea | Estado | Evidencia |
| --- | --- | --- |
| F1.1 lenguaje ubicuo | Hecha | `docs/fase-1/lenguaje-ubicuo.md` (jerarquía 4 niveles, roles, reglas de uso) |
| F1.2 bounded contexts + context map | Hecha | `docs/fase-1/mapa-contextos.md` (7 contextos, capacidades de soporte, contratos, propiedad de datos, eventos, 5 decisiones pendientes) |
| F1.3 agregados, invariantes, eventos | Hecha | `docs/fase-1/agregados-invariantes-eventos.md` (7 agregados, invariantes testeables, outbox, CQRS ligero, puertos) |
| F1.4 autorización por permiso y alcance | Hecha | `docs/fase-1/modelo-autorizacion.md` (catálogo, matriz rol→permiso, scopes, RLS, RPC, pruebas negativas, mapeo Firebase→Supabase) |
| F1.5 modelo PostgreSQL | Hecha | `docs/fase-1/modelo-postgresql.md` (esquemas public/office/artifacts/knowledge/learning, tablas, índices, triggers, lock optimista, estrategia de migración por colección) |
| F1.6 ADRs | Hecha | `docs/fase-1/adrs.md` (ADR-001 backend confiable, ADR-002 contratos de módulo, ADR-003 Data API/RLS, ADR-004 identidad, ADR-005 migración por cortes, ADR-006 hosting propuesto, ADR-007 kernel IA) |
| F1.7 actualizar AGENTS.md y CLAUDE.md | Parcial | `AGENTS.md` regla 1 con nota de transición F1: hecha. `CLAUDE.md` (§ frontend-first): **pendiente — escritura bloqueada por protección del archivo, requiere aprobación explícita del usuario; NO reintentada** |

## 2. Decisiones de diseño (resumen)

- 7 contextos de negocio; IA/diagramación/exportación/calidad/observabilidad como capacidades de soporte consumidas vía puertos.
- Un contexto no escribe en la colección de otro; lecturas transversales solo por contrato/proyección.
- Eventos internos con outbox + idempotencia; sin event sourcing ni CQRS completo.
- Autorización por permiso + alcance; matriz única; RLS/RPC en servidor; `user_metadata` nunca como autoridad.
- PostgreSQL por esquemas (`office`, `artifacts`, `knowledge`, `learning`, `public`); RLS en todo lo expuesto; lock optimista en artefactos.
- Migración por cortes verticales con una sola fuente de escritura por conjunto de datos; sin dual-write ingenuo.
- Identidad: Supabase Auth proveedor único; sin convivencia en producción; sin promesa de continuidad de contraseñas/sesiones sin prueba.

## 3. Pendientes externos (no bloquean F2/F3 documental)

1. **P-01–P-05 del cierre F0** siguen vigentes: aceptación funcional, inventario productivo, CI/hosting, decisiones de tenencia/SSO-MFA/residencia/presupuesto (`docs/fase-1/mapa-contextos.md` §7 los detalla para F1).
2. **CLAUDE.md § frontend-first**: añadir la misma nota de transición que `AGENTS.md` cuando el usuario lo apruebe.
3. **ADR-006 hosting**: confirmar con operaciones (Vercel sigue vs alternativa).

## 4. Cambios en el árbol

- `docs/fase-1/` (6 documentos nuevos).
- `AGENTS.md` regla 1: nota de transición F1 (1 línea añadida).
- Sin cambios de código, dependencias, reglas ni configuración.

## 5. Siguiente paso recomendado

F2 (plataforma Supabase: proyecto, ambientes, CLI, migraciones, RLS base, CI) en paralelo documental con F3 (puertos + adaptadores). El primer corte de datos (F5.1 piloto) requiere F2 + F3 + F4 previos sobre ese contexto.
