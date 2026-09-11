# F0.2 — Entorno reproducible y entrega

Base: 8731fcdd9af7a5ee57eaaf3049b162ef722e55d7. Diagnóstico local, no certificación productiva.

## Verificaciones

- Host inspeccionado: Linux, 7941 MiB RAM, sin swap; disco de trabajo 86 GiB disponibles en el momento de inspección.
- Runtime medido: Node v20.19.5 y npm 10.8.2, `/home/tata/.local/node/bin`.
- `npm ci --prefix /tmp/arky-f0-install-kEqflp --ignore-scripts --no-audit`: salida 0. Después se ejecutó `npm ci --prefix /tmp/arky-f0-install-kEqflp --no-audit` con lifecycle habilitado: salida 0. No se sustituyó node_modules que usan pruebas concurrentes.
- Instalación aislada con package.json, package-lock.json y .npmrc del repositorio. Lockfiles origen y copia tienen el mismo SHA256, registrado en `evidencias/entorno.json`. Esta prueba reproduce dependencias, no una integración productiva.
- `.env.local` existe; claves/configuración Firebase e IA están vacías. Solo se registraron nombres y presencia, nunca valores. La compilación con placeholders no demuestra conectividad ni autorización real.
- Descubrimiento inicial: gh instalado; java y docker no disponibles en PATH al iniciar. El frente de integración documenta las alternativas que llegue a preparar.

## Hallazgos de entorno y CI

### ENV-01 — Node 20 fuera de soporte (alta)
`.nvmrc` selecciona 20 y `.github/workflows/ci.yml:37,148,190` la reutiliza. El runtime instalado coincide, pero no es adecuado como objetivo mantenido: Node lo lista EOL. Fuentes oficiales consultadas: https://nodejs.org/en/about/previous-releases y https://github.com/nodejs/Release (fin de vida de 20: 2026-04-30). Planificar validación Node 24 LTS en rama, con calidad/E2E y compatibilidad de CLI, sin sustituir el baseline durante su medición.

### ENV-02 — Workflow de espejo destructivo aún presente (alta)
`.github/workflows/mirror-source.yml:3-7` se activa al modificar ese workflow en main. Líneas 21-43 recuperan una versión congelada del repositorio origen, hacen rsync --delete y publican a main con contents:write. No se activó. Es un riesgo latente para la transformación: retirar de forma controlada antes de modificarlo/publicar; revisar el mecanismo de desactivación para no ejecutar precisamente el trigger que se elimina.

### ENV-03 — Resolver de peers permisivo (media)
`.npmrc:14` fija legacy-peer-deps=true. La instalación reproducible pasa bajo esa política; no se ha demostrado compatibilidad estricta de peers. Resolver incompatibilidades con pruebas antes de retirar el ajuste.

### ENV-04 — Evidencia remota de CI no inspeccionada (pendiente)
Se revisaron definiciones locales, no ejecuciones actuales ni protección de ramas/entornos en GitHub. `ci.yml` declara gates estáticos, shards de Vitest, merge de cobertura y pruebas de reglas. Hay workflows separados de E2E y seguridad. El éxito local no prueba estado de CI remoto o despliegue.

### ENV-05 — SBOM puede ocultar un fallo (media)
`.github/workflows/security.yml:127` sustituye un error de generación por `{}` y permite que el paso termine correctamente. Debe fallar de forma explícita o marcar el artefacto como no disponible; un JSON vacío no constituye un SBOM válido.

## Evidencias

- `evidencias/npm-ci.log`: instalación sin scripts.
- `evidencias/npm-ci-full.log`: instalación con scripts.
- `evidencias/entorno.json`: hashes y presencia de configuración.
- `evidencias/quality.log` y `.exit`: ejecución del gate integral, a consolidar con resultado final.

## Límites y acciones

No se cambió Node, dependencias, pipeline, secretos ni infraestructura. El requisito de reproducibilidad de instalación quedó verificado; soporte del runtime y configuración integrada real requieren trabajo posterior. Solicitar acceso de solo lectura al CI/hosting y configuración de entorno seguro por mecanismos de secretos, no por chat. No se solicitaron credenciales productivas ni se accedió a datos de asegurados.
