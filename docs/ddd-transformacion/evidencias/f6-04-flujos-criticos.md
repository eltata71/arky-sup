# F6-04 — pruebas integrales de los flujos críticos

**Fecha:** 2026-09-25 · **Base:** F6-01 cerrada (#79). **Migración a aplicar en `ArkyDB-US`:** `20260925090000_initiative_code_allocation`.

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

## Lo que encontró: el código de iniciativa, calculado en el cliente

En su primera ejecución en CI, el recorrido de iniciativa falló con una alerta
en pantalla: *«duplicate key value violates unique constraint
"business_initiatives_code_key"»*. Dos recorridos en paralelo crearon a la vez
una iniciativa con la misma cuenta, y los dos calcularon `NEG-2026-002`.

La causa es más ancha que la concurrencia, y el caso grave es otro:

- `code` es único en **toda** la base (`code text not null unique`);
- el cliente calcula el siguiente `NEG-AAAA-NNN` a partir de
  `list_business_initiatives`, que sólo devuelve **las del propio usuario**;
- el servidor sólo validaba el código, no lo asignaba.

Así, **un segundo usuario de la organización calculaba siempre `NEG-AAAA-001`**,
chocaba con el del primero y, como su lista seguía vacía, volvía a calcular lo
mismo: no podía crear ninguna iniciativa. Y en los dos casos la persona veía el
mensaje de PostgreSQL, en inglés.

**Arreglo** (`20260925090000_initiative_code_allocation.sql`): el servidor, que
ve todas las filas, es la autoridad al crear. Si el código propuesto está libre,
lo respeta; es el caso normal y el que el asistente anuncia. Si no, asigna el
siguiente libre del mismo año, bajo un candado de transacción. El documento
guardado lleva el código asignado, y el cliente, que ya adoptaba lo que el
servidor confirma, lo muestra sin cambios. Una actualización no reasigna nada.
Su contrato `initiative_code_allocation.test.sql` prueba el caso entre usuarios,
el simultáneo, que la actualización conserva el código y que cada año lleva su
propia secuencia.

Es exactamente el tipo de defecto que una prueba integral existe para
encontrar: ninguna prueba unitaria podía verlo, porque cada mitad —el cálculo
en el cliente y la unicidad en la base— era correcta por separado.

## Lo que encontró después: «cargando» dicho como «no existe»

Con más recorridos en paralelo, el E2E del comité, que ya existía, falló: la
autora veía su encargo todavía «En comité». La revisora no había firmado. Su
sala había mostrado un instante **«Entregable no encontrado — no existe o
todavía no se ha cargado»**, y el recorrido, que acepta esa salida para el caso
de un reintento ya firmado, la tomó por «ya firmado» y no firmó.

La causa es de la interfaz. Para una revisora, el encargo llega por la bandeja
del comité, que sólo se pide cuando se conoce su perfil; hasta entonces la sala
no tenía forma de distinguir «todavía no lo sé» de «no existe», y lo decía en
una sola frase. **Arreglo:** `OfficeContext.isResolving` es verdadero mientras
carga la sesión, hay una lectura en curso, falta la bandeja del comité o hay
proyectos cuyos encargos no se han leído. La sala (`EngagementRoomFallback`)
muestra la carga hasta entonces, y «no encontrado» sólo cuando se ha resuelto,
ya sin la coletilla. Lo prueba `engagementRoomResolving.test.tsx`.

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
