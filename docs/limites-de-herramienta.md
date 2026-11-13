# Límites de herramienta confirmados

Registro operativo de la fábrica de mantenimiento Hermes, no del comportamiento
funcional de los agentes de Arky. Se consulta antes de repetir una comprobación
que las herramientas disponibles ya no pudieron acreditar.

Una entrada describe un límite confirmado **en un entorno y una fecha**, no una
imposibilidad universal. Una sospecha, un fallo aislado o la ausencia de acceso
no bastan para añadirla. Este registro no es exhaustivo y no concede permisos
para eludir restricciones de herramientas, navegador o seguridad.

## LH-001 — No se pudo acreditar zoom de página real al 200 %

- **Estado:** límite operativo confirmado según la evidencia histórica citada;
  la equivalencia con zoom real continúa sin acreditar en esa evidencia.
- **Fecha del caso:** 2026-10-24. Registro documental: 2026-11-11,
  tarea `t_fa6039c3`, a partir de `t_1a67d1ff`.
- **Entorno afectado:** prueba de release LOCAL de LATAM Factory E2E,
  `/home/tata/workspace/latam-factory-e2e`; vistas pública y privada autenticada;
  Chromium/Playwright, CDP y navegador integrado del operador disponibles entonces.
  La fuente no identifica versiones exactas de navegador ni herramientas.
- **Objetivo que no se pudo verificar:** zoom de página 200 % equivalente a
  que una persona pulse Ctrl/Cmd+Plus en un navegador real, sin desbordamiento
  ni texto recortado. No se trata de ampliar un lienzo ni de cambiar su escala.

### Evidencia y métodos descartados

El [fingerprint versionado de LATAM Factory E2E](../scripts/agentes/task-fingerprints/latam-factory-e2e-20261024T204458Z.json),
objeto `tasks.t_cf543578`, conserva el seguimiento con estos resultados:

| Método registrado | Qué permite observar | Por qué no acredita el requisito |
|---|---|---|
| Viewport de 640 px en lugar de 1280 px | Reflow a otro ancho | Es un proxy de viewport, no zoom de página |
| `Page.setDeviceMetricsOverride(scale:2)` mediante CDP de Chromium/Playwright | Escalado emulado | No se demostró equivalencia empírica con el zoom real |
| API de Playwright disponible en aquel entorno | Emulación de viewport/CDP | El seguimiento registra que no expone una API de zoom de navegador |
| Navegador integrado del operador | Automatización permitida por su especificación | El seguimiento registra que excluye explícitamente atajos de zoom de página |

La notación `Page.setDeviceMetricsOverride(scale:2)` se conserva tal como aparece
en la fuente: **no es un comando reproducible completo**, ni prueba de que sea
intercambiable con otras operaciones CDP. No se recuperaron de ese fingerprint
scripts íntegros, salidas, capturas originales o exit codes de esos intentos.

En el mismo archivo, `tasks.t_b065b9c4` conserva la decisión humana explícita de
José del 2026-10-24: declarar la brecha y no forzar PASS; mantiene válido el
NO-GO de `elena-release` (run18 y anteriores) respecto de este punto. La decisión
registra coincidencia independiente del operador y de Elena, tras cinco bloqueos.
El [fingerprint de Arky Maintenance](../scripts/agentes/task-fingerprints/arky-maintenance-20261025T200710Z.json),
objeto `tasks.t_1a67d1ff`, conserva el incidente de redescubrimiento por ambos.

**Nivel de evidencia:** registros históricos versionados de las tareas y su
decisión, no una nueva ejecución ni inspección de los logs originales. Esta
entrada no certifica que ninguna automatización futura pueda hacerlo, ni que
se hayan vuelto a probar las herramientas el 2026-11-11. El límite confirmado
es que las disponibles en aquel caso no permitieron **acreditar** el requisito;
la ausencia de equivalencia demostrada no prueba una imposibilidad técnica general.

### Qué hacer al encontrarlo

1. Consultar esta entrada y la evidencia de la tarea; no repetir los mismos
   proxies como si fueran métodos nuevos ni convertirlos en PASS.
2. Mantener el zoom real como brecha visible. Las comprobaciones de reflow o
   escalado pueden informarse por separado, sin sustituir el criterio original.
3. Solicitar una comprobación humana en navegador real: capturas al 100 % y al
   200 % mediante Ctrl/Cmd+Plus, identificando navegador/versión, vista pública y
   privada autenticada, y resultado sobre desbordamiento y texto recortado.
   Las capturas deben evitar credenciales y datos personales.
4. Alternativamente, aceptar una nueva automatización solo después de demostrar
   su equivalencia con la entrada real del usuario y registrar el método y la
   evidencia. Un rechazo explícito de herramienta no autoriza evadirlo.
5. Incorporar el resultado real a `docs/release-readiness.md` **del proyecto
   LATAM Factory E2E**, y al seguimiento `t_cf543578` mediante su coordinación.
   Este documento en Arky no cambia el estado de aquel release ni autoriza editar
   ese otro repositorio. El estado actual de ese seguimiento no se verifica aquí.

La decisión histórica permitía continuar el release LOCAL con la brecha declarada;
no es una dispensa para producción ni para otro criterio de aceptación.

## Cómo ampliar y revisar el registro

Cada agente que encuentre un límite nuevo lo registra en su tarea Kanban y
propone aquí una entrada, sujeta a revisión independiente. Este documento es
el registro central; no se mantienen copias divergentes en cada SOUL o skill.
Enlazarlo desde catálogos, SOUL o skills queda fuera de la tarea `t_fa6039c3`:
su creación no implica que todos los perfiles lo carguen o consulten.

Cada entrada nueva debe contener:

- ID estable y un único límite; fecha, responsable y tarea de procedencia.
- Entorno, herramientas y versiones conocidas; lo desconocido se declara.
- Requisito exacto no acreditado, pasos/comandos realmente usados y resultados
  observados, con exit codes cuando existan. Nunca reconstruir salidas ausentes.
- Evidencia verificable y su nivel: prueba primaria o reporte histórico;
  intentos descartados y motivo concreto, no «no funciona» sin contexto.
- Alcance de la conclusión, alternativa elegible y condición para revalidar;
  revisión independiente y enlace a la tarea donde quede su dictamen.

Si cambia la herramienta, su especificación o el entorno, revalidar antes de
extender la conclusión. Registrar la evidencia nueva y conservar la historia;
no borrar el límite silenciosamente ni marcarlo superado por una mera hipótesis.
Si falta evidencia para confirmarlo, mantenerlo como investigación en Kanban,
no como nueva entrada confirmada.

**No probados por este registro:** lectores de pantalla, IME/composición,
grabación de audio/vídeo y otras diferencias entre navegador headless e
interactivo. Son ejemplos de cobertura no establecida, no límites confirmados.
