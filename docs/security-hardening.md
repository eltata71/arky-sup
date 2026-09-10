# Endurecimiento de seguridad — Arky 10

> **Audiencia:** ingenieros con acceso a la consola de Firebase y al
> repositorio. **Objetivo:** documentar el modelo de amenazas asumido,
> los cambios aplicados en este PR y los controles **server-side** que
> deben existir antes de exponer la app a producción.

---

## 1. Modelo de amenazas asumido

| Actor | Capacidad | Riesgo principal |
| ----- | --------- | ---------------- |
| Visitante sin cuenta | Puede abrir la SPA y autenticarse con Google. | **Ya no puede crear cuenta.** Una identidad válida sin perfil aprovisionado se cierra sesión. |
| Atacante con DevTools | Puede llamar manualmente al SDK de Firebase desde la consola. | Bypass de los filtros de UI. La escritura directa al campo `role` es lo que las reglas rechazan explícitamente (§2.0). |
| Insider con cuenta `admin` | Puede crear/editar usuarios. | Creación silenciosa de superadmin. |
| Operador con `.env` filtrado | Puede haber publicado `VITE_GEMINI_API_KEY` accidentalmente. | Abuso de la API key. |
| Otra pestaña / sesión concurrente | Mismo usuario abre dos workspaces. | Sobrescritura ciega de artefactos. |

---

## 2. Controles aplicados

### 2.0 Modelo de roles y permisos (2026-08-30)

Los roles son seis y viven en `lib/authz/permissions.ts`, que es **la**
definición: catálogo de permisos, lista de roles y una matriz que los une.
Ninguna pantalla compara cadenas de rol; se pregunta `can(profile, permission)`.

| Rol | Para qué existe |
| --- | --- |
| `viewer` | Consulta el portafolio y cursa formación. No escribe nada. |
| `architect` | El rol de trabajo: iniciativas, atenciones, entregables, artefactos. |
| `reviewer` | Arquitecto, y además aprueba charters, decide en el ARB y publica. |
| `trainer` | Crea y mantiene el currículo del Centro de Transformación. |
| `admin` | Todo lo anterior, y administra el directorio de cuentas. |
| `superadmin` | Todo, incluida la concesión de `admin` y `superadmin`. |

`student` y `teacher` son nombres heredados: se **migran en lectura** a
`architect` y `trainer` (`parseAuthRole`, y el mismo mapeo en `callerRole()`
dentro de `firestore.rules`), y se rechazan en escritura para que el vocabulario
viejo no se perpetúe.

Dos decisiones que conviene enunciar en lugar de deducir:

- **`admin` no puede conceder `admin`.** Un administrador que acuña
  administradores se multiplica, y a partir de ahí ninguna revocación es
  confiable. `users:grant-privileged` es solo de `superadmin`.
- **`admin` tampoco puede degradar a un `superadmin`**, porque si no la regla
  anterior se sortea eliminando a quienes la sostienen.

### 2.1 Una sola fuente de verdad para el rol

Este era el defecto D-4. `isAdmin()` en las reglas leía
`request.auth.token.role` —un custom claim— y **nada en el código llamaba nunca
a `setCustomUserClaims`**, así que 32 cláusulas eran permanentemente falsas
mientras la UI, que leía el documento `users/{uid}`, mostraba funciones
administrativas que el servidor rechazaba. Dos mitades coherentes con
conclusiones opuestas y nada que las comparara.

La resolución: **el documento `users/{uid}` es la fuente de verdad, y un claim
se honra cuando existe.** La regla se enuncia una vez, en
`resolveEffectiveRole` (`lib/authz`), y se refleja en `callerRole()`
(`firestore.rules`):

> Si hay claim, decide el claim. Si no, decide el documento.

El filo es deliberado: un claim **presente pero ilegible** resuelve a *ningún
rol*, no al documento. Caer al documento ahí dejaría que el cliente anulara en
silencio un claim rancio que las reglas siguen honrando — las dos mitades
discrepando otra vez, justo en el caso más difícil de notar.

Un despliegue que más adelante siembre claims server-side obtiene una
comprobación más barata; uno que nunca lo haga aplica hoy la misma política.

### 2.2 Las cuentas las crea un administrador

El registro público desapareció. `AuthContext` ya no expone `register`, no crea
perfiles automáticamente y no arranca ningún «primer usuario = superadmin».
Una identidad que autentica correctamente pero no tiene perfil aprovisionado
**se cierra sesión** con una explicación: autenticarse no es lo mismo que tener
cuenta.

`services/userProvisioningService.ts` da el alta:

- crea la cuenta en una **app de Firebase secundaria y con nombre**, para que
  `createUserWithEmailAndPassword` no sustituya la sesión del administrador;
- usa un secreto de un solo uso del CSPRNG que **nadie ve ni recibe**, y envía
  `sendPasswordResetEmail` como invitación. Un administrador que teclea la
  primera contraseña de un colega conoce una credencial que no es suya, y las
  contraseñas «temporales» son célebremente permanentes;
- escribe el perfil **desde la sesión del administrador**, que es la que las
  reglas evalúan. Escribirlo desde la sesión secundaria dejaría que la cuenta
  recién creada se asignara su propio rol;
- cierra sesión y destruye la app secundaria en `finally`, también al fallar.

### 2.3 Lo que sí es del dueño de la cuenta

`components/account/AccountPanel.tsx` (pestaña «Cuenta» en Ajustes) y la
pantalla de acceso cubren la otra mitad del principio: cambiar la contraseña
—reautenticando antes—, recuperarla y editar el nombre para mostrar. El rol se
muestra y no se ofrece: las reglas rechazan esa escritura de todos modos, y un
control que el servidor rechaza solo enseña a desconfiar de la pantalla.

La recuperación **no es un oráculo de existencia**: la confirmación es idéntica
exista o no la dirección, para que el formulario no sea un directorio de quién
trabaja en la organización.

### 2.4 Bypass de developer

`signInAsDeveloper` exige **ambas** condiciones:

1. `import.meta.env.DEV === true` — solo builds de Vite en modo dev.
2. `VITE_ENABLE_DEV_LOGIN === 'true'` — opt-in explícito.

En producción (`vite build`) la función lanza error y el botón se oculta. El rol
`superadmin` del bypass existe **solo en memoria React**: el documento
`users/{uid}` recibe el rol de menor alcance, así que una flag filtrada no
contamina datos productivos.

### 2.5 `getAllProjects` con guard

Sin `userId` ni admin: devuelve `[]` sin tocar Firestore. Con `userId`:
filtra por `where("userId", "==", userId)`. Sólo `isAdmin === true` puede
escanear la colección entera.

### 2.6 Errores de seguridad ya no enmascarados

Antes: cualquier fallo de Firestore (incluyendo `permission-denied`)
caía silenciosamente al fallback de localStorage.

Ahora: `services/firestoreService.handleFirestoreError`:

- `permission-denied`, `unauthenticated`, `failed-precondition` →
  `severity: 'critical'`, `recoverable: false`, **re-thrown** al caller
  para que pueda hacer rollback del optimistic update. El usuario ve el
  `RuntimeErrorOverlay` con copia de diagnóstico.
- `unavailable`, `deadline-exceeded` → `severity: 'warning'`, fallback
  local **y** evento observable.

### 2.7 Validación de payloads de Firestore

`validateProject`/`validateArtifact` (`lib/runtimeValidation.ts`)
descartan documentos corruptos en lugar de pasarlos al renderer
(causando pantallas en blanco). Las anomalías se reportan en
observability.

---

## 3. El límite de autorización, y lo que sigue siendo server-side

> El frontend es defensa en profundidad. `firestore.rules` es el único límite
> real: sin él, cualquiera con DevTools se salta todo lo de la sección 2.

### 3.1 Firestore Security Rules — las que se despliegan

`firestore.rules` en la raíz del repositorio **es** el esquema, no un ejemplo.
Se despliega con `npm run deploy:rules`, y las reglas son aditivas respecto de
la app: se despliegan **antes** del código que usa las rutas nuevas, nunca al
revés.

Estructura:

- `callerRole()` resuelve el rol (claim si existe, documento si no) — §2.1.
- `effectiveRole()` migra `student`/`teacher` en lectura.
- Un bloque de funciones marcadas con `// @permission x` **replica la matriz**
  de `lib/authz/permissions.ts`. Dos lenguajes no pueden compartir una
  definición; lo que sí pueden es no divergir:
  `__tests__/authz/rulesMatrix.test.ts` parsea el archivo y falla celda por
  celda si discrepan.

Invariantes que las reglas imponen y que conviene no perder al editarlas:

| Invariante | Por qué |
| --- | --- |
| `users/{uid}` solo lo crea quien tiene `users:create` | La versión anterior (`allow create: if request.auth.uid == uid`) entregaba el modelo de control de acceso completo al llamante, campo `role` incluido. |
| El `uid` del documento debe coincidir con su id | Si no, se puede escribir el perfil de otra persona. |
| El rol escrito debe existir en el modelo | Un rol desconocido no concede nada, pero deja basura que alguien migrará mal después. |
| Un rol privilegiado exige `users:grant-privileged` | El administrador no acuña administradores. |
| El dueño puede actualizar su perfil **con `role` inalterado** | Si no, toda cuenta se promociona sola: el mismo agujero con otro verbo. |
| Un administrador no edita ni borra su propia fila | Quien puede editarse a sí mismo se concede lo que quiera. |
| La transición a `delivered` exige `arb:decide` **y no exige propiedad** | Esa es la separación de funciones: el que aprueba no es el autor. |
| El comité puede **leer** todo el portafolio | Un comité que no puede leer lo que gobierna no lo gobierna. Es un ensanchamiento real y es el sentido del rol. |
| `arbDecisions`, `reviewDecisions` y `agent_actions` son inmutables | `allow update: if false`. Un rastro de auditoría reescribible no es un rastro. |
| Crear proyectos e iniciativas exige permiso de escritura | Estar autenticado no era un permiso; un `viewer` los creaba. |

### 3.2 Verificar las reglas antes de desplegarlas

Las reglas se ejecutan contra el emulador, no solo se leen:

```bash
npm run test:rules   # firebase emulators:exec --only firestore + vitest __tests__/rules
```

`__tests__/rules/firestoreRules.test.ts` corre 51 casos contra el motor real —
incluidas las formas de consulta que la app usa de verdad
(`getAllProjects` filtrando por `userId`, el listado de cursos de `LMSContext`)
— y se **omite solo** cuando no hay emulador, para que `npm run test:ci` no
requiera Java. Esa suite encontró un defecto que la lectura no vio: un
`reviewer` que no era dueño del proyecto no podía firmar la entrega, que es
justamente el caso para el que existe la separación de funciones.

### 3.2.1 Sembrar el primer administrador

Con el alta autoservicio eliminada, el primer administrador **no puede salir de
la app**. Se siembra una vez.

> **Si quien lo va a hacer no es técnico**, hay una guía paso a paso solo con
> clics en la consola de Firebase, sin línea de comandos ni claves de servicio:
> **[`docs/primer-administrador.md`](./primer-administrador.md)**. Es el camino
> recomendado, y es el que hay que dar a quien pone el sistema en marcha.

De un vistazo, lo que esa guía hace:

1. Firebase Console → Authentication → *Add user* (correo + contraseña).
2. Copiar la **UID** que aparece en la lista.
3. Firestore Database → colección `users` → documento cuyo **id es esa UID**,
   con los campos `uid`, `email`, `displayName` (strings) y `role` =
   `superadmin`.

Las escrituras desde la consola **no pasan por `firestore.rules`** —el acceso a
la consola ya es de propietario del proyecto—, que es justamente por lo que este
camino funciona cuando la aplicación no puede.

Alternativa con el Admin SDK, para automatizar el arranque de varios entornos.
Requiere una clave de cuenta de servicio (Firebase Console → Configuración del
proyecto → Cuentas de servicio → *Generar nueva clave privada*), y ese archivo
**no se commitea nunca**:

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/ruta/a/serviceAccountKey.json
node -e "
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
initializeApp({ credential: applicationDefault() });
const email = process.argv[1];
getAuth().getUserByEmail(email).then(async (u) => {
  await getFirestore().doc('users/' + u.uid).set({
    uid: u.uid, email: u.email, displayName: u.displayName || email, role: 'superadmin',
  });
  console.log('superadmin sembrado:', u.uid);
}).catch(e => { console.error(e.message); process.exit(1); });
" tu-correo@ejemplo.com
```

Desde ahí, todo lo demás se hace dentro del producto.

### 3.2.2 Custom Claims (opcional)

Las reglas honran `request.auth.token.role` **cuando existe**, así que sembrar
claims es una optimización —ahorra la lectura de `users/{uid}` en cada
evaluación—, no un requisito. Si se adopta, el claim es una **cadena** bajo la
clave `role` (`{ role: 'admin' }`), nunca un booleano (`{ admin: true }`), y se
asigna server-side con una función que valide al llamante:

```ts
// functions/src/setRole.ts
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getAuth } from 'firebase-admin/auth';

export const setRole = onCall(async (req) => {
  if (req.auth?.token.role !== 'superadmin') {
    throw new HttpsError('permission-denied', 'Solo superadmin puede asignar roles');
  }
  const { uid, role } = req.data as { uid: string; role: string };
  await getAuth().setCustomUserClaims(uid, { role });
  return { ok: true };
});
```

Dos advertencias si se siembran claims:

- El claim se incrusta en el ID token, así que **no aparece en la sesión
  abierta**: hay que cerrar sesión y volver a entrar, o forzar
  `getIdToken(true)`.
- A partir de ese momento el claim **manda sobre el documento**, en las reglas y
  en el cliente. Un claim rancio no se corrige editando `users/{uid}`; hay que
  reasignarlo o borrarlo.

### 3.3 Rotación de API key Gemini

Mientras la API key viva en `.env.local` cliente:

- Restringir la key en Google Cloud Console por `HTTP referrer` al
  dominio Vercel del producto (no a `*`).
- Establecer cuota mensual razonable + alarma.
- Rotar trimestralmente.
- En el momento que se requiera ocultar usage / costos por usuario,
  mover a backend proxy.

### 3.4 Backend proxy para Gemini (recomendación)

Patrón sugerido cuando se quiera ocultar la key:

```
[browser] --(JWT Firebase Auth)--> [/api/ai/generate (Vercel Edge / Cloud Function)] --(server-side key)--> [Gemini]
```

El frontend ya está preparado: `services/geminiService.getAIClient` es el
único punto de creación del cliente. Reemplazar esa creación por un
fetch al edge/function preserva la API pública del servicio.

### 3.5 Cabeceras de seguridad en Vercel

Recomendado añadir en `vercel.json`:

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=()" }
      ]
    }
  ]
}
```

CSP estricta queda pendiente hasta migrar Tailwind y otros CDN
(`cdnjs.cloudflare.com`, `cdn.jsdelivr.net`) a bundles locales.

### 3.6 Authorized Domains de Firebase

Después de cada deploy, añadir el dominio Vercel a:
`Firebase Console → Authentication → Settings → Authorized Domains`.

---

## 4. Variables de entorno relacionadas con seguridad

| Variable | Default | Efecto |
| -------- | ------- | ------ |
| `VITE_ENABLE_DEV_LOGIN` | unset | Habilita el bypass developer **sólo** en builds dev. Producción ignora esta flag. |
| ~~`VITE_ALLOW_FIRST_USER_SUPERADMIN`~~ | — | **Eliminada.** El bootstrap "primer usuario = superadmin" ya no existe: sin registro público no tiene camino de ejecución, y una vía de escalada latente sigue siendo una vía de escalada. El primer administrador se siembra según §3.2.1. |
| `VITE_GEMINI_API_KEY` | requerida | API key de Gemini cuando la app actúa como cliente directo. **Rotar regularmente.** |
| `VITE_FIREBASE_*` | requeridas | Configuración pública de Firebase. No es secreto pero debe estar correctamente apuntada al proyecto. |

---

## 5. Checklist mínimo antes de exponer a producción

- [ ] `npm run test:rules` en verde contra el emulador.
- [ ] `firestore.rules` desplegado (`npm run deploy:rules`), **antes** del código.
- [ ] Primer `superadmin` sembrado siguiendo `docs/primer-administrador.md`, y verificado entrando a `/users`.
- [ ] Un **segundo** `superadmin` creado desde la propia app: si solo hay uno y pierde el acceso, nadie puede nombrar administradores.
- [ ] Proveedor Correo/Contraseña habilitado en Firebase Console (el alta lo necesita).
- [ ] Plantilla de "restablecer contraseña" personalizada: es el correo de bienvenida real del producto.
- [ ] `VITE_ENABLE_DEV_LOGIN` ausente en Vercel.
- [ ] Perfiles heredados revisados: los `student`/`teacher` almacenados siguen funcionando, pero conviene reasignarlos al vocabulario actual.
- [ ] API key Gemini restringida por HTTP referrer.
- [ ] Authorized Domains de Firebase incluyen el dominio de producción.
- [ ] Cabeceras de seguridad añadidas en `vercel.json`.
- [ ] Plan de rotación de API key documentado.
- [ ] Alarmas de cuota Gemini activas.

## Actualización 2026-05-12 — Persistencia endurecida

El modelo operativo de persistencia queda alineado con `docs/persistence-hardening.md`:

- Los artefactos nuevos deben escribirse en `/projects/{projectId}/artifacts/{artifactId}` y no como un arreglo embebido completo en `/projects/{projectId}`.
- Las reglas de proyectos deben validar `request.resource.data.userId == request.auth.uid` en creación y ownership/custom claims en lectura/escritura.
- ~~Los roles privilegiados efectivos deben venir de custom claims.~~ **Superado el 2026-08-30** (§2.1): el documento `users/{uid}` es la fuente de verdad que las reglas leen, y un claim se honra cuando existe. La recomendación anterior describía un estado que nunca llegó a existir — nada sembraba claims — y por eso las reglas quedaron permanentemente cerradas.
- Los proyectos legacy sin `userId` requieren migración explícita antes de permitir actualizaciones seguras.

Ver el documento de endurecimiento de persistencia para reglas sugeridas, migración y checklist de producción.
