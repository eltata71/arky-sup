# Persistence Hardening — Firestore, Auth y artefactos

## Diagnóstico técnico

La auditoría identificó varias causas raíz probables para el síntoma “se ve en UI pero desaparece al recargar”:

1. **Optimistic updates sin confirmación remota obligatoria.** `AppContext` agregaba proyectos y artefactos al estado React antes de saber si Firestore había aceptado la escritura.
2. **Fallback silencioso a `localStorage`.** `firestoreService` y `userService` usaban `localStorage` como si fuera persistencia real ante errores remotos. Eso ocultaba `permission-denied`, `unauthenticated`, configuración incompleta y errores de reglas.
3. **Artefactos embebidos en `/projects/{projectId}`.** `updateProjectArtifacts()` sobrescribía el arreglo completo `artifacts[]`, exponiendo la app a pérdida de datos por concurrencia y al límite de 1 MiB por documento Firestore.
4. **Roles frontend no equivalentes a seguridad Firestore.** Un perfil `users/{uid}.role` o el bypass developer podía hacer que la UI se creyera admin aunque las reglas Firestore sólo acepten `request.auth.token.role`.
5. **Modo degradado ambiguo.** Si faltaban variables `VITE_FIREBASE_*`, la app seguía operando como si hubiera persistencia real.
6. **Caché invalidada antes o pese al fallo.** Algunas rutas podían dejar `MemoryCache` o estado local con datos que nunca fueron confirmados por Firestore.

## Cambios implementados

### Capa centralizada de persistencia

Se agregó `services/persistence.ts` como contrato único de escrituras remotas:

- Estados explícitos: `success`, `failed`, `permission-denied`, `offline`, `conflict`, `validation-error`.
- `executeRemoteWrite()` mide duración, clasifica errores Firebase, registra eventos estructurados y nunca transforma un fallo remoto en éxito local.
- `assertFirebaseAvailable()` bloquea operaciones críticas cuando Firebase no está configurado.
- `PersistenceError` permite elevar fallos confirmados a capas que todavía usan excepciones.

### Modelo de datos recomendado

Los proyectos ya no deben almacenar artefactos completos embebidos. El modelo objetivo es:

```text
/projects/{projectId}
  id
  name
  description
  userId
  projectContext[]
  createdAt
  updatedAt
  artifactCount
  lastArtifactUpdatedAt
  artifactStorage = "subcollection-v1"

/projects/{projectId}/artifacts/{artifactId}
  id
  versionGroupId
  version
  name
  type
  phase
  architecturalView
  content
  objective
  keyConcepts[]
  representation
  generationTrace.persistence
  createdAt
  updatedAt
  storageMode = "firestore" | "external-required"

/projects/{projectId}/history/chat
  messages[]
  updatedAt

/settings/{user_uid | global}
```

`firestoreService.getProject()` y `getAllProjects()` mantienen compatibilidad hacia atrás: si la subcolección `/artifacts` está vacía, leen `artifacts[]` embebido de documentos legacy.

### Estrategia para contenido pesado

Se define un umbral conservador (`MAX_INLINE_ARTIFACT_BYTES = 650_000`). Si el artefacto supera ese tamaño, queda marcado con `storageMode: "external-required"`. La siguiente evolución recomendada es almacenar el contenido pesado en Firebase Storage y dejar en Firestore sólo metadatos más una URL firmada/GS path gobernada por reglas.

### Operaciones corregidas

- `createProject()` exige `userId`; persiste metadatos del proyecto y artefactos iniciales en subcolección mediante `writeBatch`.
- `updateProject()` usa transacción, valida ownership cuando recibe `userId` y soporta `expectedUpdatedAt` para detectar conflicto.
- `deleteProject()` elimina el documento de proyecto, historial de chat y documentos de la subcolección de artefactos en batch.
- `createArtifact()`, `updateArtifact()` y `deleteArtifact()` escriben sólo el documento afectado en `/projects/{projectId}/artifacts/{artifactId}` y actualizan metadatos del proyecto.
- `updateProjectArtifacts()` queda como ruta de compatibilidad/batch, pero escribe subcolección y no vuelve a embebir el arreglo completo en el proyecto.
- `saveGlobalSettings()` y `saveChatHistory()` devuelven resultado explícito y sólo actualizan caché tras éxito remoto.

### UI y observabilidad

- `AppContext` mantiene `persistenceStatus` y `persistenceMessage`.
- `components/PersistenceStatusBanner.tsx` muestra “Guardando…”, “Pendiente de sincronizar” o “Error al guardar”.
- Los artefactos con `generationTrace.persistence` son marcados como `remote: pending | success | failed | conflict`.
- En fallos de creación de proyecto se hace rollback; en artefactos generados se permite ver el contenido local, pero marcado como no persistido remotamente.
- Cada escritura registra `operationId`, `userId`, `projectId`, `artifactId`, `operationName`, `persistenceTarget`, `remoteStatus`, `errorCode` y `durationMs`.

## Reglas Firestore requeridas

Las reglas deben confiar en Firebase Auth y custom claims, no en roles editables desde frontend. Ejemplo base:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() {
      return request.auth != null;
    }

    function isAdmin() {
      return signedIn() && request.auth.token.role in ['admin', 'superadmin'];
    }

    function isOwner(userId) {
      return signedIn() && request.auth.uid == userId;
    }

    match /projects/{projectId} {
      allow create: if signedIn()
        && request.resource.data.userId == request.auth.uid;

      allow read: if isAdmin() || isOwner(resource.data.userId);

      allow update, delete: if isAdmin() || isOwner(resource.data.userId);

      match /artifacts/{artifactId} {
        allow read: if isAdmin() || isOwner(get(/databases/$(database)/documents/projects/$(projectId)).data.userId);
        allow create, update, delete: if isAdmin() || isOwner(get(/databases/$(database)/documents/projects/$(projectId)).data.userId);
      }

      match /history/{docId} {
        allow read, write: if isAdmin() || isOwner(get(/databases/$(database)/documents/projects/$(projectId)).data.userId);
      }
    }

    match /settings/{settingsId} {
      allow read, write: if signedIn()
        && (settingsId == ('user_' + request.auth.uid) || isAdmin());
    }

    match /users/{uid} {
      allow read: if signedIn() && (request.auth.uid == uid || isAdmin());
      allow create: if signedIn() && request.auth.uid == uid;
      allow update, delete: if isAdmin();
    }
  }
}
```

## Custom claims

Roles críticos (`admin`, `superadmin`) deben asignarse server-side con Firebase Admin SDK:

```js
await admin.auth().setCustomUserClaims(uid, { role: 'admin' });
```

La app ahora degrada perfiles privilegiados sin custom claim a `student` para evitar que el frontend prometa permisos que Firestore no reconocerá.

## Migración de datos legacy

1. Exportar respaldo Firestore.
2. Para cada `/projects/{projectId}` con `artifacts[]`:
   - crear `/projects/{projectId}/artifacts/{artifact.id}` por cada artefacto;
   - actualizar `artifactCount`, `lastArtifactUpdatedAt`, `artifactStorage`;
   - remover `artifacts[]` sólo después de validar lectura desde subcolección.
3. Para proyectos sin `userId`:
   - asignar owner real si existe trazabilidad;
   - si no existe, moverlos a una cuenta admin/migración y documentar ownership;
   - evitar reglas que permitan escritura a documentos sin owner.
4. Revisar documentos mayores a 650 KB y mover contenido pesado a Storage.

## Checklist de producción

- [ ] Todas las variables `VITE_FIREBASE_*` están definidas en Vercel/hosting.
- [ ] Authentication providers requeridos están habilitados.
- [ ] Firestore Rules desplegadas y probadas con Rules Simulator.
- [ ] Custom claims de admin/superadmin asignados con Admin SDK.
- [ ] Migración de artefactos embebidos ejecutada y validada.
- [ ] Índices requeridos por consultas (`projects.userId`) creados si Firestore los solicita.
- [ ] Monitoreo de errores `permission-denied`, `unauthenticated`, `failed-precondition`, `resource-exhausted` revisado.
- [ ] Pruebas `npm run quality` pasan antes del despliegue.
