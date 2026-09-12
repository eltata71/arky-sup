# F2 — Plataforma de prueba de concepto

## Alcance vigente

La autorización del usuario sustituye la separación desarrollo/staging/producción del plan original: un único proyecto Supabase administrado existente y hosting Vercel. Las bases efímeras para pruebas automatizadas no constituyen ambientes remotos persistentes. No crear proyectos, contratar planes ni cambiar región.

## F2.1: descubrimiento verificado

- Proyecto: ArkyDB (`hgpemicaeriizllgaezj`).
- Región existente: `ca-central-1`. Se conserva; no implica certificación de residencia o cumplimiento normativo.
- Estado reportado por Management API: `ACTIVE_HEALTHY`.
- PostgreSQL reportado: `17.6.1.166`.
- CLI disponible: `2.117.0`.
- `supabase projects list`: acceso autenticado confirmado.
- `supabase db query --linked --project-ref hgpemicaeriizllgaezj`: consulta de catálogo ejecutada; no hay tablas de negocio en esquemas ajenos a los administrados por Supabase.
- Plan, cuotas contratadas y destinatario de alertas: no verificados todavía. No se presuponen gratuitos ni se autorizan gastos.
- Responsable de aprobar gastos y cambios de alcance: usuario solicitante; no se asignan personas operativas ficticias.

## Entrega y seguridad

Las migraciones de F2 son fundaciones, no la migración de los siete contextos ni la sustitución de Firebase (F3–F6). No cambiar el proveedor activo de la aplicación en esta fase. Separar claramente configuración local de configuración remota: `config.toml` no demuestra que Auth o la Data API remota tengan las mismas opciones.

Nunca incluir secret/service_role, tokens de administración ni contraseñas en VITE_*, registros, evidencias o Git. Las variables frontend solo pueden contener URL y clave publishable. Mantener las claves organizacionales de IA en el proxy de Vercel.

La validación remota debe consultar el catálogo después de aplicar cambios. Un workflow escrito no equivale a una ejecución de GitHub Actions ni a protección de ramas configurada. No informar respaldo/restauración integral hasta verificar tanto la base como los binarios Storage.

## Criterio de cierre adaptado

Migraciones reproducibles; pruebas positivas y negativas de grants/RLS; tipos generados desde una base real; pipeline validado; despliegue controlado al único proyecto PoC; logs sin secretos; recuperación de datos y archivos ensayada. Registrar por separado cualquier bloqueo local, remoto o de aprobación. No declarar toda F2 terminada solo por disponer de archivos.
