# Doble chequeo F0–F3 (2026-09-12)

Auditoría independiente de las cuatro fases ejecutadas: qué quedó pendiente de
mi parte, qué está bloqueado y qué es responsabilidad de la organización.
Cada afirmación se re-verificó ejecutando el comando, no leyendo el informe previo.

## Estado de integración (Git)

| Rama | Puntero | Contenido |
| --- | --- | --- |
| `main` | `e579da5` | F0 (`ahead 1` de `origin/main`, **sin push**) |
| `feature/fase1-diseno-dominio` | `6440366` | F1 completo |
| `feature/fase2-plataforma-supabase` | `9564ca1` | F2 completo |
| `feature/fase3-fundaciones-modulares` | `6c5bd82` | F3 completo (HEAD actual) |

Árbol de trabajo limpio, sin stashes ni worktrees adicionales.

**Hallazgo estructural:** las ramas están **apiladas** (F1 sobre F0, F2 sobre F1,
F3 sobre F2), no son independientes. Consecuencia práctica: F2 no se puede
revisar ni mergear sin arrastrar F1, y F3 sin F2. Los commits son lineales, así
que un único PR acumulativo es viable; si se quieren PR por fase, hay que
re-cortarlos. No es un defecto por sí mismo, pero contradice la expectativa
natural de "una rama por fase".

## Verificación re-ejecutada

| Comprobación | Resultado |
| --- | --- |
| `check:module-boundaries` | OK |
| `check:module-size` | OK |
| `check:any-budget` | OK — 23/23 |
| `check:no-orphan-scripts` | OK |
| `typecheck` / `typecheck:strict` / `lint` | exit 0 |
| Suite `npx vitest run` | 434 ficheros / 4233 pruebas (59 saltadas) |
| Build placeholders + bundle budget + bundle secrets | exit 0 (eager 432.8 KB) |
| `scripts/operations` (Python) | 18/18 OK |
| Migración Supabase en remoto | `20260912001855` aplicada (consultada al catálogo) |
| `supabase/database.types.ts` | presente, generado real, con `platform_probes` |
| Evidencias F0 | 28 artefactos; `quality.exit` = 0 |

## Pendiente de mi parte (accionable por mí)

1. **`CLAUDE.md` (F1.7) — único pendiente real.** La nota de transición F1 está
   en `AGENTS.md`, pero la escritura en `CLAUDE.md` sigue bloqueada: el aviso de
   aprobación del archivo protegido expiró dos veces por falta de respuesta.
   Requiere que aceptes el diálogo cuando aparezca. No hay ruta alternativa
   legítima (intentar `terminal` u otro camino sería eludir el control).

## Pendiente mío y bloqueado por el entorno (no por falta de trabajo)

2. **E2E webkit/iPad (F0.3/P-04):** el sandbox no tiene `sudo` para instalar las
   librerías de WebKit. Ruta de resolución: ejecutarlo en GitHub Actions con
   `playwright install-deps`, lo que requiere el push (tu decisión).
3. **Ensayo real de backup/restore (F2.6):** faltan `pg_dump`/`pg_restore`/`psql`,
   Docker y Storage local. Aquí quedaron contrato y pruebas offline (18/18), no
   recuperación integral probada.
4. **`supabase.yml` en GitHub Actions:** escrito y validado en sintaxis, sin
   ejecutar (paridad PG17, servicios Auth/REST/Storage y drift de tipos reales).

## Pendiente tuyo (organización)

Cerrados el **2026-09-12** por decisión del usuario:

- **P-01 Aceptación funcional**: revisada, validada y aprobada. Incluye la
  validación del lenguaje ubicuo derivado en F1.1.
- **P-02 Inventario productivo**: revisado, validado y aprobado.

Siguen abiertos:

- **P-03** CI/hosting: protección de ramas, secretos por mecanismo seguro.
- **P-05** Responsables, tenencia, presupuesto, SLO/RPO/RTO y capacidad; y las
  5 decisiones de `docs/fase-1/mapa-contextos.md` §7 (multitenencia, SSO/MFA,
  residencia, PHI/PII, integraciones) en lo que no cubra P-01.
- **Push/PR** de las cuatro ramas si quieres respaldo remoto y CI.
- Revisar Auth/Data API **remota** por dashboard antes de exponer clientes.

## Pendiente de registro

Los artefactos de P-01 y P-02 (acta de aceptación, exportación del inventario
productivo) no están en el repositorio: el registro aquí es la aprobación, no su
contenido. Si existen como documentos, conviene incorporarlos o referenciarlos
para que F5/F6 trabajen sobre cifras reales en vez de sobre la inferencia del
código.

## Correcciones aplicadas en este doble chequeo

- `docs/fase-0/cierre-fase-0.md`: título decía "dos pendientes externos" (son
  cinco); nota de rama/commit desactualizada (decía "sin commit", sí está en
  `e579da5`); typo "configuração".
- `docs/fase-1/cierre-fase-1.md`: dos secciones numeradas "4"; tabla F1.6 decía
  "ADR-006 propuesto" cuando ya está **aprobado (Vercel)**; F1.1 marcada como
  hecha sin reflejar que falta el taller con la oficina.

## Conclusión

No hay tareas de F0–F3 asignadas a mí que estén sin hacer por omisión. Lo único
pendiente por mi parte es un acto de escritura bloqueado por un control de
aprobación (F1.7 / `CLAUDE.md`); el resto de lo abierto es entorno (Docker,
`sudo`, CI remoto) o decisiones de la organización.
