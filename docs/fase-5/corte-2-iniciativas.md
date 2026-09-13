# Fase 5 — Corte vertical 2: iniciativas de negocio

**Rama:** `feature/fase5-piloto-configuracion`  
**Proyecto remoto:** ArkyDB-US (`btbhkmckrazoayaoorys`, `us-east-1`)  
**Migración:** `20260912060520_business_initiatives.sql` — aplicada.  
**Estado:** implementación y contratos verificados; **no activado** y sin datos de la PoC migrados.

## Decisión del corte y dependencias

El siguiente agregado del grafo es `businessInitiatives/{initiativeId}`. Una
iniciativa antecede a los proyectos/atenciones, cuyos `initiativeIds` la
referencian; encargos y artefactos dependen de esos proyectos. Por ello este
corte no mueve proyectos, no reescribe sus referencias y conserva el `id`
textual existente, por ejemplo `init_legacy_001`.

El modelo F1 proponía UUIDs como destino conceptual. Para este corte, usar UUID
como PK de iniciativa sería incorrecto: convertir `init_*` antes del corte de
proyectos rompería relaciones. La tabla usa `id text`; el propietario sí es el
UUID de Supabase Auth. La ETL exige el mapa explícito Firebase UID → UUID. No
convierte IDs por algoritmo ni suposición.

## F5.2 — Esquema y autorización

`api.business_initiatives` almacena:

- encabezados consultables e indexados: propietario, código `NEG-YYYY-NNN`,
  título, necesidad, estado, prioridad, horizonte y riesgo;
- `data jsonb`, que conserva el agregado `BusinessInitiative` completo,
  incluyendo resultados, KPIs, riesgos, interesados, hitos, documentos inline,
  fechas, notas y proveniencia;
- revisión optimista y marcas de tiempo del destino.

Las restricciones aseguran código válido, campos esenciales no vacíos y que
`data.id`, `data.userId` y `data.code` coincidan con las columnas protegidas.
El cliente no tiene privilegios directos sobre la tabla, aunque RLS está activa.
La única superficie es:

| RPC | Requisito | Efecto |
| --- | --- | --- |
| `api.list_business_initiatives()` | `portfolio:read` y sesión activa | lista solo filas de `auth.uid()` |
| `api.save_business_initiative(data, revision)` | `initiative:write` y sesión activa | inserta/actualiza propiedad propia con revisión optimista |
| `api.delete_business_initiative(id, revision)` | `initiative:write` y sesión activa | borra solo propiedad propia y revisión vigente |

No hay dual-write. Con `VITE_BACKEND_BUSINESSINITIATIVES=supabase`, lecturas y
escrituras pasan a Supabase; el respaldo local tiene una clave separada de
Firebase y una caída no consulta otra fuente remota. La interfaz devuelve
`ok: false` para una escritura offline: un borrador local no se comunica como
confirmación.

## F5.3/F5.4 — ETL y reconciliación

`scripts/migration/initiatives_etl.py` toma una exportación JSON consistente
con rutas `businessInitiatives/{id}` y un mapa de identidad. Rechaza:

- rutas, IDs o códigos inválidos;
- ID del documento distinto del ID de ruta;
- título/necesidad ausentes;
- propietario Firebase sin correspondencia UUID o UUID destino inválido;
- claves `apiKey`, códigos o IDs duplicados.

La salida NDJSON lleva el agregado íntegro y su propietario de destino. El
manifiesto `business-initiatives-etl-v1` registra conteo, ruta fuente,
propietario y SHA-256 canónico por agregado. `reconcile()` detecta faltantes,
sobrantes, cambio de propietario o checksum. La herramienta no accede a
Firebase/Supabase ni incluye credenciales.

No se ejecutó una exportación ni carga de datos reales porque no se presentó
una exportación consistente de la PoC ni el mapa de identidades. No se declara
paridad de datos sin esa evidencia.

## Validación ejecutada

| Comprobación | Resultado |
| --- | --- |
| Contrato SQL PG 16, dos reconstrucciones | iniciativas **17/17**, identidad/autorización **51/51**, fundación **41/41**, preferencias **14/14**; `plpgsql_check` sin hallazgos |
| Prueba mutante RLS de fundación | detectada en ambas reconstrucciones |
| Adaptador, dominio y confirmación UI | **38** pruebas dirigidas correctas |
| ETL de iniciativas y preferencias | **6/6** pruebas Python correctas |
| Sonda PG 17 remota, transacción revertida | **29/29** casos correctos; incluye ID textual, acceso cruzado y revisión obsoleta |
| Tipos | regenerados desde ArkyDB-US; incluyen tabla y tres RPCs de iniciativas |

## Activación y reversión

No activar `VITE_BACKEND_BUSINESSINITIATIVES=supabase` todavía. La aplicación
sigue usando Firebase Auth por defecto; activar solo el backend de datos haría
que un Firebase UID no coincida con `auth.uid()` en las RPCs, y debe fallar
cerrado. Antes de la activación se requiere:

1. conectar el adaptador de identidad Supabase de F4 al `AuthContext` para la
   cohorte piloto;
2. provisionar los perfiles activos y elaborar el mapa Firebase UID → UUID;
3. ejecutar ETL, carga autorizada y reconciliación con un manifiesto real;
4. habilitar la bandera solo para la cohorte piloto y comprobar recorridos UI.

La reversión de la ventana piloto es quitar la bandera para la cohorte. No se
borra Firebase ni se elimina la tabla. Si una carga se interrumpe, se corrige
la causa, se vuelve a ejecutar ETL con el mismo corte de exportación y se
reconcilia contra el manifiesto antes de reintentar.

## Siguiente corte

**Proyectos/atenciones** es el siguiente. No se iniciará como tabla aislada:
es raíz física de encargos, artefactos, publicaciones y conocimiento; el diseño
debe definir primero las claves padre, la transición de campos inline históricos
y la consistencia con las iniciativas ya migradas.
