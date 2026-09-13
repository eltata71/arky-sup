# F0.4 — Auditoría de seguridad (diagnóstico)

## Dictamen y alcance

**No se acredita seguridad de producción.** El árbol revisado ya corrige varias exposiciones históricas, pero conserva brechas de autorización en reglas, autorización incompleta del proxy y dos evasiones de su lista de modelos. Los dos caminos de evasión se reprodujeron localmente sobre el código real con proveedor simulado. No se explotó ningún servicio desplegado.

Base: commit `8731fcdd9af7a5ee57eaaf3049b162ef722e55d7`, árbol de trabajo de `/home/tata/workspace/arky-sup`. Se leyeron `AGENTS.md`, la guía local de revisión y el skill Supabase. La implementación inspeccionada sigue usando **Firebase Auth/Firestore**, no Supabase: no se atribuyen controles RLS, service-role ni migraciones SQL inexistentes al producto actual.

- Diagnóstico únicamente: no `npm audit fix`, instalaciones, cambios de código, lockfile, reglas ni despliegues.
- Red utilizada: consulta de avisos npm y páginas públicas de GitHub; ninguna conexión a Firebase, Supabase, Gemini, OpenRouter o aplicación productiva.
- No se leyeron credenciales de perfiles/globales. Escaneo de secretos limitado al texto versionado del árbol actual; no incluye historial, archivos ignorados, entornos locales, dashboard, artefactos productivos ni credenciales de CI.
- No se ejecutaron suites completas, `npm quality` ni emulador Firestore; calidad queda a cargo del agente coordinador. Las reglas se analizaron estáticamente: sus brechas deben reproducirse con el motor local antes de declararlas explotaciones verificadas.
- **Confirmado local** = comportamiento observado con sondas y mocks explícitos. **Confirmado en código** = condición visible y trazable, no prueba del despliegue. **Potencial** = impacto condicionado a configuración/actor/entrada que no se comprobó.

## Evidencias y ejecución

Todos los archivos de esta auditoría tienen prefijo `f04-` en [`evidencias/`](./evidencias/).

| Comando / evidencia | Resultado |
| --- | --- |
| `PATH=/home/tata/.local/node/bin:$PATH npm audit --json` → `f04-npm-audit.json`, stderr separado | Exit 1; 3 paquetes afectados: 1 high, 2 moderate; **2 avisos distintos**, no 3 vulnerabilidades independientes. |
| `PATH=/home/tata/.local/node/bin:$PATH npm audit --omit=dev --json` → `f04-npm-audit-prod.json`, stderr separado | Exit 0; 0 vulnerabilidades informadas para dependencias de producción. |
| `PATH=/home/tata/.local/node/bin:$PATH npm explain js-yaml @vitest/mocker vitest --json` → `f04-npm-explain.json` | Exit 0; confirma versiones instaladas y cadenas de dependencia de desarrollo. |
| `python3 docs/fase-0/evidencias/f04-secret-scan.py` → `f04-secret-scan.json` | Exit 0; 1.334 archivos de texto versionados; 15 coincidencias candidatas, sin valores. |
| `PATH=/home/tata/.local/node/bin:$PATH node docs/fase-0/evidencias/f04-local-probes.cjs` → `f04-local-probes.txt` | Exit 0; JWT de laboratorio validado criptográficamente con JWKS simulado; autorización y lista de modelos ejercitadas sobre módulos TS reales. |

La sonda transpila en memoria, sustituye únicamente el SDK proveedor y la conversión de esquemas, ofrece un JWKS local generado y rechaza cualquier otra URL. No simula resultados de npm ni tráfico de producción. Los resultados de `200` significan que el handler alcanzó **un proveedor mock**, no que un proveedor real admitiera o facturara el modelo.

## Dependencias vigentes y uso real

### DEP-01 — `js-yaml@4.3.1`: agotamiento de CPU, high (P1 de mantenimiento/CI)

- Aviso: [GHSA-2883-xcg3-v3hh](https://github.com/advisories/GHSA-2883-xcg3-v3hh), CVE-2026-84375; rango reportado `>=4.0.0 <4.3.2`, corregido fuera de ese rango (rama 4: 4.3.2).
- Cadena real: `eslint@9.39.4 → @eslint/eslintrc@3.3.5 → js-yaml@4.3.1`, toda ella de desarrollo en este proyecto (`f04-npm-explain.json:3-48`; `package.json:68`).
- El aviso describe uso no limitado de CPU con fuentes de merge YAML vacías. Hace falta que el parser procese YAML malicioso. El proyecto usa `eslint.config.js`; no se identificó una importación de `js-yaml` en código aplicativo. La mención en `services/architectureOffice/yamlStructure.ts:23` explica precisamente que **no** se utiliza ese parser.
- **Instalación vulnerable confirmada; DoS del producto no confirmado.** Riesgo potencial en tooling que llegue a cargar YAML no confiable. Un PR que ejecuta código en CI ya tiene otras capacidades: no presentar este aviso como RCE de la SPA.
- La política de `.github/workflows/security.yml:119-120` audita high/critical sin omitir dev; este resultado bloquearía ese paso aunque producción reporte cero. Recomendar actualización dirigida y verificación de lockfile en una tarea posterior, no omitir dev para ocultar el aviso.

### DEP-02 — `vitest@4.1.5` y `@vitest/mocker@4.1.5`: lectura arbitraria/path traversal, moderate (P2)

- Aviso único compartido: [GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9), CVE-2026-84373; rango `>=2.1.0 <4.1.11`.
- Cadena: dependencia dev directa `vitest` (`package.json:77`) → `@vitest/mocker`; ambas versiones 4.1.5 (`f04-npm-explain.json:50-111`). Corregir coordinadamente Vitest y sus paquetes relacionados a versiones compatibles parcheadas, incluida cobertura.
- Uso real: runner de tests y configuración (`vite.config.ts:2,151-207`), Node/jsdom, sin proyecto browser configurado ni servidor API de pruebas explícito en esa configuración. `vite.config.ts:135` sí declara `host: '0.0.0.0'` para desarrollo; no equivale por sí solo a demostrar la exposición del endpoint vulnerable de mocks.
- **Paquetes vulnerables confirmados; lectura arbitraria no reproducida.** Tratar como riesgo de herramientas/servidor de tests accesible, no como endpoint de producción. Evitar exponer runners de tests y actualizar antes de habilitar modo browser/remoto.

`npm audit --omit=dev` con cero no demuestra ausencia de bugs de autorización, XSS propio, secretos ni vulnerabilidades aún no publicadas. No se repiten avisos antiguos de Mermaid, DOMPurify u otros paquetes que no aparecen en esta ejecución.

## Hallazgos de aplicación

### SEC-01 — El proxy acepta identidad Firebase, no pertenencia aprovisionada (P1)

**Evidencia:** `api/_shared/authenticateProxyCaller.ts:36-46`; `api/_shared/verifyIdToken.ts:203-221`; `services/identity/userProvisioningService.ts:100-103,130-147`; `services/identity/userService.ts:46-50`.

La firma, audiencia, emisor, caducidad y emisión del JWT sí se verifican. Después, cualquier `uid` válido queda autorizado: no se consulta perfil, permiso para IA, estado activo ni revocación. La sonda confirmó aceptación de un JWT firmado de laboratorio sin perfil y su llegada al handler. Esto **no** demuestra que un atacante pueda emitir un token firmado por Firebase: la obtención de identidad real depende de proveedores y configuración no inspeccionados.

La provisión usa el SDK público `createUserWithEmailAndPassword`; las reglas protegen la creación del **perfil**, no el alta en Firebase Auth. Si el alta pública del proveedor está habilitada, omitir la UI puede producir identidades válidas sin perfil; cerrar sesión en React no es una prohibición servidor. Además, `deleteUser` borra solo el documento Firestore, no la identidad Auth ni sus sesiones: el proxy no ve esa baja. Tampoco exige email verificado ni excluye identidades anónimas si el proyecto las habilita.

**Impacto potencial:** gasto de claves del operador por cuentas no admitidas o retiradas. **Recomendación:** endpoint administrativo de provisión y baja, autorización servidor contra membresía vigente, política de sesiones/revocación y cuota por cuenta/organización. Probar alta directa y baja con emuladores/entorno desechable. No basta con ocultar botones.

La excepción `AI_PROXY_ALLOW_UNAUTHENTICATED=true` (`verifyIdToken.ts:135-136`) elimina incluso el bearer: comportamiento confirmado localmente. No se afirma que esté activada en producción. El comentario que promete reportar cada uso (`verifyIdToken.ts:130-133`) no se materializa en un aviso específico de ese bypass en `authenticateProxyCaller`; la ausencia de configuración productiva obliga a dejarlo como riesgo condicionado.

### SEC-02 — Lista de modelos evadible por defecto y endpoint legacy (P1)

**Evidencia:** `api/ai.ts:411-422`; `api/gemini.ts:89-112`; `api/_shared/proxyRuntime.ts:97-102`.

**Confirmado local:** con una allowlist que no incluye el modelo predeterminado, `/api/ai` rechaza modelo explícito no permitido (403), pero omitir `model` produce 200 y envía `gemini-2.5-flash` al mock. `/api/gemini` acepta también un modelo explícito prohibido: no llama a `isModelAllowed`.

Esto rompe una restricción configurada, no solo una recomendación opcional. Impacto real condicionado a rutas desplegadas, cuenta admitida por SEC-01, claves válidas y modelos aceptados por el proveedor. Aplicar un validador compartido **después** de resolver proveedor/modelo final, en todos los endpoints; retirar legacy si no se necesita. Añadir pruebas negativas para modelo vacío/omitido, streaming y ambas rutas.

### SEC-03 — Se puede crear un engagement directamente como `delivered` (P1)

**Evidencia:** `firestore.rules:282-295`.

El permiso ARB se exige para **update** con destino `delivered`, pero **create** solo exige administrador o dueño con `deliverable:write`: no limita `status`. Un arquitecto dueño puede intentar un `setDoc` nuevo con estado entregado, sin pasar por la transición. La cláusula tampoco exige un registro ARB enlazado. Además, una actualización ARB permite modificar el documento completo, y un reviewer que también sea autor no queda excluido de aprobarse a sí mismo.

**Confirmado en código; explotación con motor pendiente.** El test de transición existente (`__tests__/rules/firestoreRules.test.ts:340-356`) verifica update de un documento existente, no este create. Recomendar estado inicial cerrado, whitelist de campos por operación, transición validada y política explícita de separación de personas; probar creación entregada, autor-revisor y modificación simultánea de contenido y decisión.

### SEC-04 — Admin puede borrar perfil superadmin y volver a crearlo degradado (P1)

**Evidencia:** `firestore.rules:379-382,392-403`.

La rama update impide que admin degrade un perfil privilegiado, pero delete solo exige `users:delete` y uid distinto al propio; no comprueba el rol del destinatario. Como el administrador también puede crear perfiles con roles no privilegiados, existe la secuencia **delete del perfil superadmin → create del mismo uid con rol inferior**, además del bloqueo por eliminación directa.

**Confirmado en código; secuencia no ejecutada en Firestore.** Con claims privilegiados ya existentes, borrar el perfil no elimina el claim: no generalizar a revocación efectiva de toda cuenta. El modelo por documento, documentado como camino habitual, sí queda afectado. Proteger delete con la misma jerarquía de privilegios; garantizar conservación de administradores de recuperación y realizar bajas mediante servidor con auditoría y ciclo de vida Auth.

### SEC-05 — Escritura colaborativa fuera del proyecto autorizado (P2)

**Evidencia:** `firestore.rules:215-234`.

Crear comentarios y `reviewDecisions` exige un rol con `portfolio:read` y `author.id` propio, pero **no** acceso al proyecto indicado ni existencia/autorización del artefacto. Un viewer con ids conocidos puede intentar insertar comentarios o decisiones en un proyecto ajeno que no puede leer. Inmutabilidad posterior no legitima la creación inicial.

**Confirmado en código; BOLA/integridad potencial, sin emulador.** No se afirma filtración de lectura ni aprobación final ARB mediante `reviewDecisions`. Reutilizar el predicado de alcance del proyecto y exigir el permiso de revisión que corresponda; probar cuenta propia/ajena, viewer/reviewer y padres inexistentes.

### SEC-06 — El despliegue desactiva el control de secretos/configuración (P1)

**Evidencia:** `vercel.json:3`; `vite.config.ts:115-127`; `lib/runtimeConfig.ts:118-135`.

El comando versionado de build fuerza `VITE_DISABLE_RUNTIME_CONFIG_GATE=true`. Por ello omite la comprobación de claves de proveedor `VITE_*`, configuración Firebase y URL de proxy; el mismo flag también omite el control de arranque. **Desactivación confirmada en código, no fuga de una clave real.** El escaneo de fuentes no detectó claves operativas confirmadas.

Restaurar el gate tras provisionar configuración; exigir escaneo del artefacto que realmente se publica. El build con placeholders de calidad demuestra el comportamiento con placeholders, no la ausencia de secretos del dashboard. No confundir esto con fallback directo automático: `services/ai/aiProxyPolicy.ts:157-181` mantiene fail-closed de producción para claves del operador, aun cuando el gate de configuración se omita.

### SEC-07 — Cuota local, sin presupuesto/tokens máximos efectivos (P2)

**Evidencia:** `api/_shared/proxyRuntime.ts:29-37,112-136`; `api/ai.ts:130,165,230,276`; `api/gemini.ts:104-112`.

La cuota está en un `Map` en memoria: reinicios e instancias serverless independientes no comparten consumo. Se limita número de peticiones, no costo, concurrencia o tokens. `maxOutputTokens` del cliente se reenvía sin techo servidor; legacy no fija techo de salida. La allowlist es permisiva cuando no se configura (`proxyRuntime.ts:98-101`).

**Confirmado en código; abuso económico potencial, sin carga real.** Usar contador distribuido por identidad autorizada y presupuesto, topes de entrada/salida y concurrencia y cancelación al desconectar. El límite de cuerpo de 2.000.000 bytes sí existe (`proxyRuntime.ts:31-49`); no reportar memoria de entrada ilimitada como hallazgo vigente.

### SEC-08 — Perfil propio permite modificar campos distintos del rol, incluido uid (P2)

**Evidencia:** `firestore.rules:392-399`; `services/identity/userService.ts:26-29,53-55`.

La rama de dueño solo compara `role`; no preserva `uid` ni restringe campos. Crear perfil valida uid, pero editarlo por el dueño deja de hacerlo. Lecturas de servicio confían mediante cast en el uid almacenado. Esto permite corrupción de identidad descriptiva y potencial confusión de operaciones administrativas; **no demuestra cambio de `request.auth.uid` ni escalada de rol**, que siguen protegidos.

Aplicar `diff().affectedKeys().hasOnly(...)` a campos editables y preservar uid/id. Validar documentos al leer y usar el id del snapshot como identidad canónica. Probar uid/email añadido o sustituido, campos desconocidos y nombres malformados.

### SEC-09 — BYOK persistente y CSP solo informativa (P2, defensa en profundidad)

**Evidencia:** `pages/SettingsPage.tsx:176-185`; `vercel.json:16-17`.

Las claves que el usuario aporta se guardan en localStorage sin cifrado ni aislamiento frente a JavaScript del mismo origen. La CSP es `Content-Security-Policy-Report-Only`: no impide una exfiltración. **No se encontró ni reprodujo aquí una XSS que las robe**, ni se presenta BYOK consentido como fuga de credencial del operador.

Preferir sesión/memoria cuando sea aceptable, explicar persistencia y facilitar borrado, separar secretos por cuenta y evaluar almacenamiento servidor para casos organizacionales. Pasar CSP a enforcement gradualmente tras medir compatibilidad. Hay `nosniff`, referrer policy y `X-Frame-Options: DENY`: no repetir el hallazgo histórico de ausencia total de cabeceras.

## Escaneo de secretos: resultados sin valores

`f04-secret-scan.json` contiene **solo ruta, línea, tipo y clasificación**, además de alcance/conteos. Las 15 coincidencias son 14 candidatas en tests/fixtures/E2E y una en `scripts/buildWithPlaceholders.mjs:26`, verificada como placeholder reconocido. No se confirmó un secreto operativo hardcodeado en ese alcance. Los marcadores de claves privadas en tests son fixtures de detección, no prueba de una clave privada desplegada.

El escáner cubre prefijos de claves Google/OpenRouter/Anthropic/OpenAI, GitHub, AWS, JWT, marcadores de claves privadas y asignaciones literales candidatas. No es un análisis de entropía ni de flujo de datos; puede omitir secretos sin prefijo, fragmentados, codificados o guardados fuera del conjunto versionado. Un valor de Firebase público no debe etiquetarse automáticamente como secreto de Gemini solo por compartir prefijo. No se validó ninguna credencial con su proveedor.

## Controles existentes que no deben reabrirse como deuda histórica

- Ambos proxies autentican por bearer verificado; el uid del rate limit procede del verificador, no de `x-arky-user-id` (`authenticateProxyCaller.ts:39-46`, `proxyRuntime.ts:76-80`). El bypass opt-in queda separado en SEC-01.
- Claves del proxy solo en `GEMINI_API_KEY` / `OPENROUTER_API_KEY`, sin fallback a `VITE_*` (`api/ai.ts:88-91`, `api/gemini.ts:79-85`). El riesgo actual de configuración está en SEC-06.
- Fail-closed de producción para fallback no-BYOK (`aiProxyPolicy.ts:157-181`); los comentarios antiguos de autenticación que prometen fallback directo ya no describen esta política.
- Reglas prohíben autoprovisión del rol, ascenso propio y concesión de privilegios por admin; los defectos actuales son las ramas de delete y campos/estados no cubiertos, no el antiguo bootstrap primer usuario.
- Proyectos/iniciativas preservan propietario en update (`firestore.rules:201-202,327-328`). Lectura transversal de reviewer es deliberada (`firestore.rules:177-185`), no se reporta automáticamente como IDOR.
- Trails `arbDecisions`, `reviewDecisions`, `agent_actions` impiden update, con borrado administrativo explícito. La inmutabilidad no es absoluta frente al administrador.

## Orden de actuación y aceptación recomendada

1. **P1 autorización/gobernanza:** reproducir SEC-03/04 con emulador y añadir controles servidor para membresía, baja y jerarquía. Añadir negativos de creación entregada y delete/recreate privilegiado; no basta comparar la matriz de permisos.
2. **P1 proxy/despliegue:** corregir la lista de modelos compartida y probar modelo omitido/legacy, retirar excepciones inseguras de despliegue tras configurar el entorno; cerrar consumo para identidad no aprovisionada y retirada.
3. **Dependencias:** actualización dirigida de js-yaml y familia Vitest; repetir ambos audits y quality. No modificar lockfile automáticamente por este informe.
4. **P2:** BOLA colaborativa, campos editables, cuota distribuida y endurecimiento de BYOK/CSP; tests de reglas por operación y alcance, no solo por rol.
5. **Verificación externa pendiente, requiere autorización separada:** configuración real de proveedores Auth/claims, flags del proxy, endpoints publicados, restricciones/cuotas de claves, reglas efectivamente desplegadas, headers y bundle productivo. No realizar esa verificación contra producción durante F0.4.
