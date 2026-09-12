# F2 — Plataforma de prueba de concepto

## Alcance vigente

La autorización del usuario sustituye la separación desarrollo/staging/producción del plan original: un único proyecto Supabase administrado existente y hosting Vercel. Las bases efímeras para pruebas automatizadas no constituyen ambientes remotos persistentes. No crear proyectos, contratar planes ni cambiar región.

## F2.1: descubrimiento verificado

**Proyecto activo: ArkyDB-US (`btbhkmckrazoayaoorys`), región `us-east-1`, creado 2026-09-12 por decisión del usuario** para cumplir la residencia en Estados Unidos (opción B de la decisión de clasificación: la PoC albergará PII de terceros, sin datos de salud).

- Estado reportado por la API: `ACTIVE_HEALTHY`; PostgreSQL 17.
- CLI: `2.117.0`. Plan de organización: **Free** (confirmado por el error de la API al intentar `--size`, que el plan Free no admite).
- Contraseña de la base: generada localmente (48 caracteres hex) y guardada **fuera del repositorio** en `~/.arky/secrets/arky-us-db-password.txt` (permisos 0600, directorio 0700). No viaja en Git, ni en logs, ni en evidencias.

**Proyecto anterior: ArkyDB (`hgpemicaeriizllgaezj`), `ca-central-1`.** Creado por el usuario y elegido antes de resolver la residencia. Se conserva **intacto** hasta verificar el nuevo (decisión del usuario). Ya no es el destino de trabajo; queda como respaldo y como ejemplo de por qué la región debe decidirse antes de aprovisionar.

Se conserva el resto del alcance: un único proyecto activo, hosting Vercel, datos de PoC, sin multi-ambiente. No se crean más proyectos ni se autorizan gastos.

## Entrega y seguridad

Las migraciones de F2 son fundaciones, no la migración de los siete contextos ni la sustitución de Firebase (F3–F6). No cambiar el proveedor activo de la aplicación en esta fase. Separar claramente configuración local de configuración remota: `config.toml` no demuestra que Auth o la Data API remota tengan las mismas opciones.

Nunca incluir secret/service_role, tokens de administración ni contraseñas en VITE_*, registros, evidencias o Git. Las variables frontend solo pueden contener URL y clave publishable. Mantener las claves organizacionales de IA en el proxy de Vercel.

La validación remota debe consultar el catálogo después de aplicar cambios. Un workflow escrito no equivale a una ejecución de GitHub Actions ni a protección de ramas configurada. No informar respaldo/restauración integral hasta verificar tanto la base como los binarios Storage.

## Criterio de cierre adaptado

Migraciones reproducibles; pruebas positivas y negativas de grants/RLS; tipos generados desde una base real; pipeline validado; despliegue controlado al único proyecto PoC; logs sin secretos; recuperación de datos y archivos ensayada. Registrar por separado cualquier bloqueo local, remoto o de aprobación. No declarar toda F2 terminada solo por disponer de archivos.
