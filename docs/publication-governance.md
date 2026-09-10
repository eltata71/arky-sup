# Gobierno de Publicación

> Flujo de aprobación, versionado y auditoría de los paquetes de publicación.
> Módulos: `PublicationApprovalService.ts`, `PublicationVersionService.ts`,
> `PublicationAuditTrailService.ts`.

---

## 1. Máquina de estados de aprobación

```
draft ──▶ ready-for-review ──▶ approved ──▶ published
  ▲              │     ▲                          │
  └─ changes-requested ┘                archived ◀┘
```

| Estado | Significado |
|---|---|
| `draft` | Recién creado o editado; no enviado a revisión. |
| `ready-for-review` | Enviado, esperando aprobación. |
| `changes-requested` | Un revisor pidió cambios (motivo obligatorio). |
| `approved` | Aprobado, listo para publicar. |
| `published` | Publicado con manifiesto congelado. |
| `archived` | Archivado; historial preservado. |
| `blocked` | Bloqueado por hallazgos críticos. |

Transiciones (`PublicationApprovalService.ts`), cada una devuelve un
`PublicationTransitionResult` (`{ ok, package, reason? }`) y un paquete **nuevo**
— nunca muta el de entrada:

- `submitForReview` — `draft`/`changes-requested`/`blocked` → `ready-for-review`.
- `requestChanges` — `ready-for-review` → `changes-requested` (motivo obligatorio).
- `approvePackage` — `ready-for-review` → `approved` (rechazado si hay bloqueadores).
- `publishPackage` — → `published` (ver reglas duras).
- `archivePackage` — cualquier estado → `archived`.
- `reopenPackage` — `archived`/`published` → `draft`.

Integra con el `reviewStatus` existente de los artefactos sin romperlo: el
preflight (`artifact-pending-approval`) advierte cuando un artefacto del paquete
no está `approved` y el perfil exige aprobación.

---

## 2. Reglas duras de publicación (Task 19)

Un paquete **no puede** pasar a `published` si:

1. Tiene bloqueadores críticos (`readiness.blockers.length > 0`).
2. Tiene artefactos corruptos o vacíos (los reporta el preflight).
3. Tiene trazabilidad crítica incompleta (inconsistencias críticas del grafo).
4. La evaluación de readiness lo marca como no publicable (`canPublish === false`).
5. El perfil exige aprobación y el paquete no está `approved`.

**Override**: cuando el paquete tiene advertencias **no críticas**, el usuario
puede publicar con `override: true`. El override:

- **nunca** puede saltarse un bloqueador crítico;
- queda registrado en la auditoría como `override-used` con su motivo;
- emite el evento de observabilidad `publication.override.used`.

---

## 3. Versionado (Task 9)

`PublicationVersionService.ts`:

- `buildArtifactRef` congela una referencia (id, versionGroupId, versión,
  tier/score del compilador).
- `computeVersionDiff` compara el paquete contra los artefactos vivos del
  proyecto y clasifica la **frescura**:
  - `current` — alineado;
  - `stale` — uno o más artefactos tienen una versión más reciente;
  - `outdated` — uno o más artefactos referenciados ya no existen.
- `refreshPackageFreshness` re-evalúa la frescura y audita la transición fuera
  de `current`.
- `createPackageVersion` acuña una nueva versión: refresca todas las referencias,
  incrementa `version`, vuelve el estado a `draft` (una versión nueva invalida
  una aprobación previa) y audita `version-created`.
- `isPublishedPackageOutdated` indica si un paquete publicado debe re-versionarse.

El versionado de paquetes **no toca** el versionado de artefactos: solo lo lee.

---

## 4. Auditoría (Task 8/19)

`PublicationAuditTrailService.ts` mantiene un rastro **append-only**. Cada acción
gobernante genera un `PublicationAuditEntry` inmutable: `package-created`,
`package-updated`, `artifacts-changed`, `preflight-run`, `readiness-evaluated`,
`accessibility-checked`, `submitted-for-review`, `changes-requested`,
`approved`, `published`, `archived`, `version-created`, `manifest-generated`,
`exported`, `marked-outdated`, `override-used`.

- `appendAuditEntry` / `appendAuditEntries` devuelven paquetes nuevos.
- La entrada inicial `package-created` siempre se preserva (procedencia).
- Hay un tope de 400 entradas para no inflar el documento Firestore; al
  superarlo se conserva la creación más las entradas recientes.
- `countOverrides` y `lastAuditEntry` alimentan el manifiesto.

El historial nunca se reescribe ni se trunca de forma destructiva — es la
evidencia en la que se apoya una auditoría.

---

## 5. Actores

Cada transición registra un `PublicationActor` (`{ id, name, role }`). Cuando no
hay sesión autenticada se usa `SYSTEM_PUBLICATION_ACTOR`. La UI deriva el actor
de `AuthContext` (uid + displayName + role).
