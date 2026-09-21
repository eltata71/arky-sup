# ADR-101 — La propiedad del encargo no puede seguir siendo a la vez autor y frontera de autorización

**Fecha** 2026-09-20 · **Estado** **aceptada — opción C para el PoC**
**Contexto** Encargos y Gobernanza

## Problema

El producto declara como regla fundacional que *productor y revisor son siempre
personas distintas* y que *nadie ejecuta un charter que no se ha aprobado*. El
servidor no puede sostener ninguna de las dos, y no por un `if` que falte:

- `api.office_engagements.owner_id` es **la frontera de autorización**: toda
  lectura y toda escritura se filtran por `owner_id = auth.uid()`.
- `owner_id` es también, de hecho, **el autor**: lo pone `auth.uid()` al crear.

De ahí se sigue que el único que puede mover un encargo a `delivered` es su
propio autor, y que un aprobador distinto **no puede ni verlo**.
`api.record_arb_decision` no filtra por `owner_id` y su comentario afirma que
«un comité firma sobre encargos ajenos» — pero ningún comité puede leer uno.

## Opciones

**A · Propiedad de equipo.** `office_engagements` gana `team_id`; la frontera
pasa a ser la pertenencia al equipo y `created_by` queda como autor. La
separación se vuelve expresable: `created_by <> auth.uid()` para firmar.
*Coste:* modelo de equipos, que hoy no existe.

**B · Lista de revisores por encargo.** El encargo lleva `reviewer_ids[]`; la
RLS admite dueño **o** revisor asignado. Sin modelo de equipos.
*Coste:* alguien tiene que asignar revisores, y hoy nadie lo hace.

**C · Visibilidad por rol.** Quien tiene `arb:decide` ve y firma cualquier
encargo. Es lo que el comentario del SQL ya supone.
*Coste:* un revisor ve todo el portafolio de la organización.

**D · No separar.** Declarar que en este producto el autor firma y quitar la
promesa de la documentación.

## Decisión adoptada

Se adopta **C para la prueba de concepto**:

- quien tenga `arb:decide` podrá descubrir, leer y decidir encargos ajenos;
- el propietario/autor no podrá decidir su propio encargo, aunque tenga `arb:decide`;
- la decisión sólo podrá modificar los campos controlados por el flujo ARB;
- las tablas seguirán cerradas al acceso directo y la autorización se aplicará en las RPC;
- B queda como evolución prevista cuando exista asignación formal de revisores.

## Recomendación histórica

**C para la prueba de concepto, con `created_by <> auth.uid()` exigido al
firmar**, y B como destino. C es el menor cambio que hace la regla
*expresable*, y sin expresarla las fases siguientes construyen sobre una
promesa. D es honesto pero retira la razón de ser de una Oficina de
Arquitectura.

## Resolución del bloqueo

La decisión de negocio fue tomada el 2026-09-20. F2-03 deja de estar bloqueada
y puede implementarse con la política anterior. **El resto de la fase 2 no
depende de esta implementación** y continúa en paralelo.
