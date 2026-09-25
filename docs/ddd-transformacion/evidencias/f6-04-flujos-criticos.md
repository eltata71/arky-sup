# F6-04 — pruebas integrales de los flujos críticos

**Fecha:** 2026-09-25 · **Base:** F6-01 cerrada (#79).

## Lo que ya estaba cubierto

Los E2E corren en CI contra un stack local de Supabase reconstruido desde las
migraciones y sembrado por `scripts/seedE2E.mjs`. Antes de esta tarea cubrían:

- la protección de rutas y la carga sin excepciones (`smoke`, `office-engagement`);
- el alta de un entregable hasta proponer el charter;
- la firma del comité por una cuenta ajena a la autora (separación de funciones);
- el foco de diagramas y el acceso por personas de la Oficina.

## Lo que faltaba

Lo que hay por encima y por debajo de la Oficina, y en particular **escribir,
recargar y volver a leer**: una escritura que sólo vive en el estado de React
de la pestaña que la hizo no es una escritura.

`e2e/critical-flows.spec.ts` añade tres recorridos:

| Recorrido | Qué defiende |
|---|---|
| Una iniciativa creada **sin IA** existe tras recargar | el nivel superior de la jerarquía se puede crear sin proveedor de IA, y se persiste |
| Un proyecto abierto **desde** la iniciativa (`?iniciativa=…&crear=plantilla`) queda enlazado a ella tras recargar, y se ve en la sala de la iniciativa | la regla de que el nivel padre es obligatorio, y que el vínculo es un id que guarda el servidor |
| Tres cambios de preferencias seguidos se guardan todos, y el último sobrevive a la recarga | la regresión de F6-03: cada escritura compara contra la revisión que confirmó la anterior. Sin eso, la segunda chocaba y la pantalla volvía atrás |

**Nada llama a un modelo.** El stack de CI no tiene proveedor de IA, y un flujo
crítico que sólo funciona con uno no es crítico, sino frágil. Cada paso elegido
tiene en el producto su camino sin IA: el alta de iniciativa «sin asistente»,
la plantilla de proyecto con su lista fija de artefactos y las preferencias.

## Una cuenta más

El recorrido de preferencias cambia el idioma de la interfaz, y las pruebas
corren en paralelo (`fullyParallel`). Con una cuenta compartida, las demás
verían la aplicación en inglés a mitad de su recorrido. `seedE2E.mjs` siembra
una tercera cuenta, `preferences@arky.e2e`, con rol **`viewer`**. Como
`settings:manage` es universal, el recorrido prueba además que las preferencias
funcionan con el rol mínimo. La aserción usa el idioma porque el valor por
defecto es español: ver inglés tras recargar sólo puede venir de la base.

## Lo que queda fuera, y por qué

- **Generar un artefacto** necesita un proveedor de IA. Su lógica está cubierta
  por pruebas unitarias con el transporte doblado, y por el fallback
  determinista cuando el proveedor falla.
- **La recuperación de la proyección del grafo** (F5-05) necesita artefactos, y
  los artefactos necesitan generarse. El servidor está cubierto por
  `projection_outbox.test.sql` contra una base real y el cliente por pruebas
  unitarias.
