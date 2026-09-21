-- F2-02: the server owns the complete lifecycle matrix.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

with states(value) as (values
  ('intake'), ('planning'), ('awaiting-charter'), ('in-progress'),
  ('awaiting-arb'), ('delivered'), ('blocked'), ('cancelled')
), allowed(previous, next) as (values
  ('intake','intake'), ('intake','planning'), ('intake','cancelled'),
  ('planning','planning'), ('planning','awaiting-charter'), ('planning','in-progress'), ('planning','cancelled'),
  ('awaiting-charter','awaiting-charter'), ('awaiting-charter','in-progress'), ('awaiting-charter','cancelled'),
  ('in-progress','in-progress'), ('in-progress','blocked'), ('in-progress','awaiting-arb'), ('in-progress','cancelled'),
  ('blocked','blocked'), ('blocked','in-progress'), ('blocked','cancelled'),
  ('awaiting-arb','awaiting-arb')
), mismatches as (
  select source.value as previous, target.value as next
  from states source cross join states target
  where private.office_engagement_transition_allowed(source.value, target.value)
    is distinct from exists (
      select 1 from allowed
      where allowed.previous = source.value and allowed.next = target.value
    )
)
select is((select count(*)::int from mismatches), 0,
  'Los 64 pares coinciden exactamente con la matriz cerrada');

select is((
  select count(*)::int
  from (values
    ('intake'), ('planning'), ('awaiting-charter'), ('in-progress'),
    ('awaiting-arb'), ('delivered'), ('blocked'), ('cancelled')
  ) source(value)
  cross join (values
    ('intake'), ('planning'), ('awaiting-charter'), ('in-progress'),
    ('awaiting-arb'), ('delivered'), ('blocked'), ('cancelled')
  ) target(value)
  where private.office_engagement_transition_allowed(source.value, target.value)
), 18, 'La matriz permite exactamente 18 de 64 pares');

select ok(not private.office_engagement_transition_allowed('awaiting-arb', 'delivered'),
  'save_engagement no puede entregar: la decisión transaccional es la única puerta');
select ok(not private.office_engagement_transition_allowed('delivered', 'delivered'),
  'delivered es terminal incluso ante una escritura idéntica');
select ok(not private.office_engagement_transition_allowed('cancelled', 'cancelled'),
  'cancelled es terminal incluso ante una escritura idéntica');
select ok(not has_function_privilege('authenticated',
  'private.office_engagement_transition_allowed(text,text)', 'EXECUTE'),
  'La matriz interna no amplía la superficie cliente');

select * from finish();
rollback;
