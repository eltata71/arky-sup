# Cómo contener una tarea de verdad (y cómo NO)

## El error que cometimos

El 2026-10-25, al contener el incidente de `t_9cecb0b9`, archivamos la
implementación y la documentación (dos de cuatro hijas del defecto) dando
por hecho que sus hermanas (`t_05b7956b`, `t_b12e9004`) quedarían
"congeladas en `todo` indefinidamente" por depender de una tarea que nunca
llegaría a `done`. Esa suposición era incorrecta, y tardó horas en
descubrirse: `t_05b7956b` se promovió y despachó de verdad.

## Por qué pasó — no es un fallo de Hermes, es un significado distinto de "archivar"

Confirmado leyendo `unsatisfied_parents()` en `hermes_cli/kanban_db.py`, con
su propio docstring: **`done` / `archived` liberan al hijo** — las dos
cuentan como "el padre ya no está pendiente". Es intencional y documentado:
para el uso general de Hermes, archivar significa "esto ya no importa,
sigue adelante" — un diseño razonable para limpiar tableros. Pero para
**contener** un incidente, lo que necesitamos decir es lo contrario: "esto
quedó mal, nada que dependa de ello debe avanzar". `archive` no significa
eso, aunque lo pareciera.

## La forma correcta

**No existe un comando de cascada.** `archive`, `unlink`, `block` actúan
sobre una sola tarea cada vez; ninguno recorre el árbol de dependencias por
ti. El procedimiento correcto es manual y explícito:

1. Antes de archivar/bloquear el nodo que se contiene, listar sus hijos
   (`hermes kanban show <id>` los muestra) y los hijos de esos hijos,
   recursivamente, hasta el final del árbol.
2. Decidir, para cada uno, si su propósito sigue siendo válido sin el nodo
   contenido. Si no (como en este caso: nada que verificar/revisar sin la
   implementación), archivarlo también — explícitamente, uno por uno.
3. Si algún hijo *sí* conserva un propósito independiente, no archivarlo:
   dejarlo con sus padres existentes (aceptando que ya no estará bloqueado
   por el padre contenido) o reasignarlo a un padre válido con `unlink` +
   `link`.
4. Repetir la comprobación con `estado-fabrica.py` o `kanban list --status
   todo,ready,blocked` después, para confirmar que nada del árbol quedó
   vivo sin que se decidiera a propósito.

## El hueco de gobernanza que esto deja

No hay una vía de un solo comando para "contener este nodo y todo lo que
depende de él". Hoy depende de que quien contiene se acuerde de recorrer el
árbol a mano — que es exactamente lo que falló aquí. Registrado como
hallazgo de gobernanza para que Jose decida si vale la pena un comando
propio (`archive --cascade`, o un script delgado que lo haga por fuera, sin
tocar Hermes) o si el procedimiento manual, documentado aquí, es
suficiente para el tamaño actual de la fábrica.
