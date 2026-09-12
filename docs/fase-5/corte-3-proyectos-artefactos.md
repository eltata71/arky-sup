# Fase 5 — Corte vertical 3: proyectos/atenciones y artefactos

**Rama:** `feature/fase5-piloto-configuracion`
**Proyecto remoto:** ArkyDB-US (`btbhkmckrazoayaoorys`, `us-east-1`)
**Migraciones:** `20260912060530_projects_artifacts.sql`, `20260912154634_projects_artifacts_integrity.sql` y `20260912161044_projects_artifacts_domain_contract.sql` — aplicadas.
**Estado:** base de persistencia, autorización, prueba remota y ETL completos; **no activado** y sin carga de datos de la PoC.

## Unidad del corte

`projects/{projectId}` no se migró como documento independiente. El agregado
incluye su raíz, los artefactos de `projects/{projectId}/artifacts/{artifactId}`
y el índice/contador que consumen portafolio, oficina y navegación. Una escritura
compuesta actualiza los tres componentes en la misma transacción; por tanto no
puede haber un proyecto que anuncie un artefacto que no exista, ni un artefacto
confirmado que no esté indexado.

El corte conserva los IDs textuales de proyecto (`proj_*`), iniciativa (`init_*`)
y artefacto. `initiativeIds` es la relación canónica y se valida contra las
iniciativas que pertenecen al mismo `auth.uid()`. `linkedBusinessProjects` sigue
siendo el espejo de códigos heredado y no la fuente de la relación.

No incorpora todavía encargos, historial/chat, paquetes de publicación ni grafo
de conocimiento. Son contextos con ciclos e invariantes propios; la migración de
su forma inline se hará en sus cortes, sin borrar su representación Firebase.

## Esquema y superficie autorizada

| Componente | Responsabilidad |
| --- | --- |
| `api.architecture_projects` | raíz, propietario, nombre, `initiative_ids`, documento canónico JSON, revisión, `artifact_count` e `artifact_index` |
| `api.project_artifacts` | entidades artefacto con FK al proyecto y contenido completo JSON |
| `api.save_project_aggregate(project, artifacts, revision)` | valida sesión activa y `project:write`; valida iniciativas, revisa los artefactos y escribe padre, hijos, índice y contador atómicamente |
| `api.load_project_aggregate(id)` | exige `portfolio:read` y sesión activa; hidrata sólo un agregado del propietario actual |

Ambas tablas tienen RLS activa, sin privilegios directos para `authenticated`.
Las funciones son la única superficie cliente y rechazan identidad falsa, sesión
revocada, iniciativa inexistente/ajena, secreto `apiKey` incluso anidado,
artefacto que no cumple el contrato de dominio —incluidos tipo y vista
arquitectónica de las uniones canónicas y versión numérica `>= 1`—, IDs de
artefacto duplicados, conflicto de revisión o lectura entre usuarios.
`initiativeIds` se normaliza de forma determinista tanto en la columna
relacional como en el documento JSON que se hidrata. No existe fallback de una
falla Supabase a Firebase para confirmar una escritura.

## ETL y reconciliación

`scripts/migration/projects_artifacts_etl.py` recibe una exportación JSON y el
mapa explícito Firebase UID → UUID Supabase. No accede a proveedores ni admite
credenciales. Agrupa las rutas:

- raíz: `projects/{projectId}`;
- hijo: `projects/{projectId}/artifacts/{artifactId}`.

Si existe la subcolección de artefactos, es canónica. Sólo cuando no existe se
usa `data.artifacts[]` como *fallback* legado. La herramienta rechaza raíces o
hijos inválidos, huérfanos, ID/ruta discrepantes, iniciativa ausente, identidad
sin mapa, artefactos inválidos/duplicados y cualquier `apiKey` anidada. Emite
NDJSON por agregado y un manifiesto `projects-artifacts-etl-v1` con SHA-256
determinista de raíz más artefactos; `reconcile()` detecta faltantes, sobrantes,
propietario alterado y cambios de contenido.

No se ejecutó exportación ni carga real: faltan un corte consistente de Firestore
y un mapa de identidades provisionado. Por eso no se declara paridad de datos.

## Validación ejecutada

| Control | Resultado |
| --- | --- |
| Contratos SQL PG 16, dos reconstrucciones | proyectos/artefactos **23/23**; iniciativas **17/17**; identidad/autorización **51/51**; fundación **41/41**; preferencias **14/14** |
| Análisis `plpgsql_check` | sin hallazgos en ambas reconstrucciones |
| Prueba mutante RLS | detectada por el arnés en ambas reconstrucciones |
| ETL de proyectos, iniciativas y preferencias | **13/13** pruebas Python correctas |
| Sonda PostgreSQL 17 remota, transacción revertida | **10/10**: iniciativa padre, guardado/hidratación e índice, conflicto, acceso ajeno, secreto anidado, IDs duplicados, contrato incompleto, tipo y vista fuera de contrato y versión no positiva |
| Cobertura completa Vitest | **439** archivos correctos, **4263** pruebas correctas y **59** omitidas; líneas **66.98 %**, sentencias **65.16 %** (`docs/fase-5/coverage-projects-artifacts.log`) |
| Tipos de base | regenerados desde ArkyDB-US con las dos tablas y RPCs del corte |
| Asesores remotos | una advertencia de rendimiento preexistente: políticas `profiles_select_directory` y `profiles_select_own` ambas permisivas para `SELECT` de `authenticated` en `api.user_profiles`; no fue introducida por este corte y queda fuera de su alcance. |

## Activación y reversión

La bandera `VITE_BACKEND_ARCHITECTUREPROJECTS=supabase` **no se habilita** aún.
La aplicación todavía usa Firebase Auth por defecto y sus UIDs no satisfacen
`auth.uid()` de las RPCs. Habilitar sólo datos debe fallar cerradamente, pero no
es una experiencia piloto aceptable. Antes de la activación se requiere:

1. conectar el adaptador de identidad Supabase de F4 al `AuthContext` de la
   cohorte piloto;
2. provisionar perfiles y elaborar el mapa explícito Firebase UID → UUID;
3. ejecutar ETL, carga autorizada mediante la RPC, manifiesto y reconciliación;
4. conectar el repositorio de proyecto/artefactos a la RPC compuesta y cubrir
   creación, edición, borrado, versiones y carga diferida en UI;
5. comprobar que encargos, publicación y conocimiento siguen en Firebase hasta
   sus cortes propios.

La reversión de la ventana piloto es retirar la bandera de cohorte. No se borra
Firebase ni la tabla de Supabase. Una carga interrumpida se corrige y se repite
contra el mismo corte de exportación, validando el manifiesto antes de reintentar.

## Siguiente corte

**Encargos de Oficina y decisiones ARB**. Debe mantener su enlace a proyecto y
decisión sin asumir que el proyecto Supabase esté activado globalmente; por ello
se preparará con claves textuales compatibles y una fuente única por cohorte.
