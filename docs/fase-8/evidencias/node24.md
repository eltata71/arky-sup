# Evidencia de validación Node 24

Fecha: 2026-09-17

Runtime seleccionado:

- Node: `v24.21.0`
- npm: `11.19.0`
- Fuente: distribución oficial `r2.nodejs.org`, `latest-v24.x`

Cambios de compatibilidad:

- `.nvmrc`: `24`
- `package.json`: `engines.node = 24.x`, `engines.npm >=10`
- `package-lock.json`: engines sincronizados
- CI/E2E/seguridad: usan `node-version-file: .nvmrc`

Comandos de validación:

- `npm install --package-lock-only --ignore-scripts --no-audit`: exit 0
- `npm run quality:static`: exit 0
- `npm run build:placeholders`: exit 0; 4,880 módulos transformados
- `npm run check:bundle-secrets`: exit 0; sin credenciales de proveedores en `dist/`
- `npm run check:bundle-budget`: exit 0; eager `438.8 KB gzip` de `450.0 KB`
- `npm run test:ci`: exit 0; 454 archivos, 4,321 pruebas correctas y 59 omitidas (4,380 totales)

Nota: la instalación inicial de Node 24 se hizo en `/home/tata/.local` y no modificó el runtime global del host.
