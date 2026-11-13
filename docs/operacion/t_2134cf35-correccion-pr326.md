Informe de avance — t_2134cf35 / PR #326

Estado: implementación local parcial verificada; NO lista para cierre ni publicación.
Base: 084eaf452e2d7537fbd82d49754cdd7707dbed68 (feat/pr-review-trigger).
No se creó commit ni se hizo push, merge o rebase.

Correcciones locales

- pr_review_trigger.py: límite numérico con regex en títulos, desempate a Rafael,
  exclusión de borradores, errores de diff y creación aislados por PR y salida 1
  al terminar si hubo fallos; conexiones SQLite de consulta mode=ro.
- estado-fabrica.py: mismo límite numérico, exclusión de borradores y conexiones
  de consulta mode=ro. Resultado pr_review_check distingue checked/not_checked,
  incluye motivo sin stderr y conserva unchecked_since en RESULT_FILE. Tras
  cuatro horas sin poder comprobar, añade razón crítica; recuperación reinicia
  reloj. Sin otras alertas: exit 2 para no comprobado, 1 para crítico, 0 para OK.
- install_pr_review_cron.py: instalador explícito --install y vista previa
  --print, cron cada cinco minutos con /usr/bin/python3 y flock -n, PATH de CLI
  explícito, preservación de entradas ajenas y lectura posterior de verificación.
- CI: job Python de regresiones, PyYAML 6.0.3 y Python 3.12.
- test_pr_review_regressions.py: pruebas aisladas de prefijos #3/#32/#326,
  borradores, desempate, errores, recuperación, main, SQLite RO e instalador.

Evidencia ejecutada

1. bash scripts/agentes/estado.sh: exit 0, sin avisos.
2. gh pr view 322 --json state,mergedAt,headRefOid: OPEN,
   mergedAt null, head 4cea6854e109e8a24d5c88bbd80bc219ce2c5a2d.
3. Primera ejecución de regresiones antes del parche: exit 1;
   8 tests, 3 fallos y 4 errores, reproduciendo los defectos.
4. npm ci --ignore-scripts --no-audit --no-fund: exit 0, 503 paquetes.
5. /usr/bin/python3 -m unittest discover -s scripts/agentes/tests
   -p 'test_pr_review_regressions.py': exit 0, 12 tests OK.
6. /usr/bin/python3 scripts/agentes/tests/test_pr_review_trigger.py:
   exit 0, 10 comprobaciones OK.
7. /usr/bin/python3 scripts/agentes/install_pr_review_cron.py --print:
   exit 0, línea con flock -n y /usr/bin/python3 generada. NO instala.
8. gh api repos/actions/setup-python/git/ref/tags/v6 --jq .ref:
   exit 0, refs/tags/v6 existe.
9. git diff --check: exit 0.
10. npm run quality:gate: la herramienta terminal agotó su espera a los 420s;
    no se recibió salida ni exit code final. Resultado DESCONOCIDO, no verde.
11. npm run test:coverage: NO ejecutado; no se debe solapar con el build de
    estado desconocido. Continuar solo tras comprobar que quality:gate terminó.

Límites y pendientes

- No se modificó el crontab real. Se entregó el instalador como alternativa
  explícita de H1, probado con crontab simulado; instalación real y readback
  siguen pendientes antes de declarar cumplida la aceptación "cron instalado".
- No se ejecutó el disparador contra tableros reales ni el vigilante completo
  contra la máquina; las pruebas de fallos son controladas, no incidentes reales.
- #322 sigue abierto: no rebasar hasta su merge, según la tarjeta.
- hotspot: scripts/agentes/estado-fabrica.py compartido con #322.
- No hay revisión independiente de este diff; Rafael debe revisar después de
  los gates y de fijar el SHA autorizado. No publicar sin aprobación humana.
- Riesgo operativo: perder RESULT_FILE pierde también el reloj de fallos;
  permisos/retención del resultado deben preservarse en operación.
- Consumo/coste de modelo desconocido, no equivale a cero.

Siguiente acción elegible

Retomar la tarea en este mismo worktree: comprobar el proceso de quality:gate,
recoger su resultado y ejecutar test:coverage en invocación separada. Completar
la instalación cron verificada en el checkout estable acordado, sin activar
código pendiente de revisión inadvertidamente. Resolver integración con #322 y
solicitar revisión independiente solo cuando exista evidencia final de gates.
