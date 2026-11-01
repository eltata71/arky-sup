# registrar-uso-modelos

## Para qué, y por qué pensado para tres criterios a la vez

Aprobado por José (2026-10-25): media jornada de medición de coste, pero no
solo para el tope de gasto. Un registro limpio por llamada real desbloquea
tres cosas que hoy comparten el mismo cuello de botella:

- **CA17** (tope de gasto): no se puede frenar nada sin saber cuánto cuesta.
- **CA26** (enrutamiento): el catálogo de precios no cubre `openai-codex`
  porque nadie había registrado que es el proveedor real en uso -- este
  registro lo deja escrito, modelo y proveedor, por cada llamada real.
- **CA28 / mitad FinOps de CA32**: la tabla nativa de Hermes
  (`session_model_usage`) está contaminada por la migración v20 sin
  marcador de origen fiable (ver `evidence/triage-2026-10-25.md` en
  `hermes-factory-webui`). Este registro es limpio desde cero, no un
  intento de arreglar esa tabla.

**Sin precios todavía, a propósito.** Solo conteo de tokens por tarea,
modelo y proveedor. El precio es una tabla estática que se aplica después,
sin tocar este registro ni lo que ya escribió.

## Qué hace

Shell hook observador en dos eventos: `post_api_request` (cada llamada
principal) y `post_auxiliary_call` (decompositor, titulado, compresión --
el gasto auxiliar que CA17/28 necesitan igual, y que se olvida fácilmente
si solo se mira la llamada principal). Por cada uno con `usage` real,
añade una línea a `~/.hermes/logs/uso-modelos.jsonl` con timestamp, perfil,
`task_id`/`aux_task`, modelo, proveedor, tokens de entrada/salida, duración
y motivo de cierre. No bloquea nada -- es puro observador, y un fallo al
escribir nunca debe impedir la llamada real.

## Probado

`hermes hooks test` (el mismo camino que usa producción, no una invocación
suelta del script) contra los dos eventos, con los dos perfiles que ya
tenían otros hooks -- confirma que escribe correctamente y que no escribe
nada cuando no hay `usage` reportado (p. ej. un fallo sin datos).

## Desplegado

En los 20 perfiles reales (los 18 del diseño + `rafael` + `arkysupabase`),
mismo patrón que el hook del motor y el registro de bloqueos repetidos:
`hooks:` en cada `config.yaml`, aprobado en cada `shell-hooks-allowlist.json`,
verificado con `hermes hooks doctor` -- 20 de 20 sanos.

## Lo que falta para cerrar CA17/26/28 de verdad, y no es este registro

Este registro da el conteo. Falta, por separado: una tabla de precio por
modelo/proveedor (estática, aplicable sobre lo ya registrado sin rehacer
nada), el tope en sí sobre CA17 (que límite, qué hace al superarlo), y para
CA26 específicamente, evaluaciones reales de calidad -- este registro dice
qué se usó y cuánto costó, no si la respuesta fue buena. No se construyó
nada de eso todavía; se avisa explícitamente para que no se asuma incluido.
