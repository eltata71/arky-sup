-- F2 follow-up: grant SELECT on office_arb_decisions for pgTAP/contracts
-- The table was created with deny-by-default (revoke all), but pgTAP contracts
-- running as authenticated need to read it for assertions.
begin;

grant select on api.office_arb_decisions to authenticated;

notify pgrst, 'reload schema';
commit;