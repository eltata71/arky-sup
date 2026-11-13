# Corrección local t_0f7cb2a5 — PR #318

Objetivo: corregir M1, L1 y L2 del wrapper de cron sin ejecutar el vigilante real ni cambiar el cron instalado.

Base: `ba36f849a4694e7d2ceb5248f85cd161b8afd6b9`, rama `fix/vigilante-wrapper-cron`. Cambios locales sin commit ni publicación remota.

## Artefactos

- `scripts/agentes/estado-fabrica-watch.sh`: normaliza a exit 0 las publicaciones válidas con exit canónico 0/1; conserva ATENCION en stdout. Códigos inesperados fallan explícitamente. Prepara el directorio de estado y comprueba las escrituras tanto al incrementar como al reiniciar el contador. Detecta publicación mediante dispositivo/inodo y timestamps con nanosegundos, compatible con el os.replace del canónico.
- `scripts/agentes/tests/test_estado_fabrica_watch.py`: 11 pruebas con Bash real, HOME temporal e intérprete simulado. No son inferencia real ni una prueba del scheduler Hermes instalado. Cubren el contrato stdout/exit usado por no-agent, publicación con contenido y mtime idénticos, ausencia de publicación, códigos inesperados, creación de directorio, persistencia y aviso tras tres fallos.

## Evidencia de ejecución

- `bash scripts/agentes/estado.sh`: exit 0, sin avisos. Worktree inicialmente limpio.
- `npm ci --ignore-scripts --no-audit --no-fund`: exit 0; 503 paquetes instalados. Sin cambio de manifiesto/lockfile.
- `/usr/bin/python3 -m unittest discover -s scripts/agentes/tests -p 'test_estado_fabrica_watch.py' -v`: RED antes de corregir: exit 1, 11 pruebas, 7 fallos y 2 errores. GREEN después: exit 0, 11 pruebas OK.
- `bash -n scripts/agentes/estado-fabrica-watch.sh`: exit 0.
- `git diff --check`: exit 0.
- `npm run quality:gate`: primer intento exit 124 tras 240 s; typecheck, strict, ESLint y comprobaciones iniciales pasaron antes del timeout. Segundo intento: error de transporte del tool a los 420 s, sin exit code fiable. Inspección posterior no mostró proceso de ese gate. Un tercer intento en background fue terminado explícitamente al recibir el aviso de presupuesto de ejecución agotándose. No se afirma gate completo verde.
- `npm run test:coverage`: NO ejecutado; no se declara cobertura ni suite completa aprobada.

## Causa raíz y riesgos

M1 confundía veredicto de dominio con salud de ejecución. L1 ignoraba el resultado de escritura del estado y asumía que existía su directorio. L2 comparaba mtime truncado a segundos aunque el productor publica atómicamente.

Se conserva la dependencia GNU stat ya presente y su ruta de producción. No se cambia el canónico, ningún perfil Hermes, secretos, cron, migraciones ni despliegues. Concurrencia de invocaciones y estado previamente corrupto no se endurecen en este alcance. Consumo/coste del modelo desconocido.

## Pendiente obligatorio

No es entrega final aprobada: falta completar quality:gate y ejecutar test:coverage como invocación separada. Después se requiere revisión independiente del diff/SHA final (Alexis había pedido los cambios), más coordinación de José para commit/publicación autorizados y las etapas especializadas/QA aplicables. No se crea otra tarjeta ni se duplica el estado. Se solicita bloqueo transitorio por verificación incompleta/presupuesto de esta ejecución.
