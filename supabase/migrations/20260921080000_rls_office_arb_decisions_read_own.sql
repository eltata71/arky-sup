-- F2 follow-up: policy RLS para que authenticated pueda leer sus propias decisiones ARB
-- La tabla tiene RLS enabled desde 20260912170000 pero cero policies → denegación total.
begin;

create policy office_arb_decisions_read_own on api.office_arb_decisions
  for select to authenticated
  using (owner_id = auth.uid());

notify pgrst, 'reload schema';
commit;