-- LOCAL ONLY: no passwords, sessions, identities, real people or remote imports.
-- These rows are SQL fixtures, not usable Auth accounts. Never deploy seeds.
begin;
insert into auth.users (id, email) values
  ('10000000-0000-4000-8000-000000000001', 'probe-a@example.invalid'),
  ('10000000-0000-4000-8000-000000000002', 'probe-b@example.invalid')
on conflict (id) do nothing;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into api.platform_probes (id, owner_id, label) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'synthetic-a')
on conflict (id) do nothing;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
insert into api.platform_probes (id, owner_id, label) values
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'synthetic-b')
on conflict (id) do nothing;
commit;

-- ---------------------------------------------------------------- E2E only
--
-- LOCAL ONLY. Esta función existe para que `scripts/seedE2E.mjs` pueda crear el
-- perfil de la cuenta de pruebas sin conceder privilegios sobre
-- `api.user_profiles` a `service_role` —que es la postura deny-by-default de
-- ADR-003 y no se toca—. Vive en el seed y no en una migración **a propósito**:
-- un seed no se despliega nunca, así que esta puerta no puede existir en un
-- proyecto remoto ni por descuido.
--
-- Y vive en `public`, no en `api`, por una razón concreta: los tipos generados
-- se sacan con `--schema api`, así que `supabase/database.types.ts` es el
-- contrato de lo que el producto puede llamar **en un despliegue**. Un ayudante
-- de pruebas declarado ahí sería una función que el código cree tener y que el
-- proyecto remoto no tiene; el gate de tipos lo detectó, que es su trabajo.
-- `platform_foundation` revoca USAGE sobre los tres esquemas a todos los roles,
-- `service_role` incluido: nadie entra en `public` salvo que se le conceda. Que
-- la función viva aquí no basta, entonces, y la concesión tiene que ser
-- explícita. Es local y sólo local —un seed no se despliega—, así que no toca la
-- postura deny-by-default de ningún proyecto real.
grant usage on schema public to service_role;

create or replace function public.seed_e2e_profile(p_uid uuid, p_display_name text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into api.user_profiles (id, role, status, display_name)
  values (p_uid, 'superadmin', 'active', p_display_name)
  on conflict (id) do update
    set role = 'superadmin', status = 'active', display_name = excluded.display_name;
end;
$$;
revoke all on function public.seed_e2e_profile(uuid, text) from public, anon, authenticated;
grant execute on function public.seed_e2e_profile(uuid, text) to service_role;
notify pgrst, 'reload schema';

-- ---------------------------------------------------------- fixtures E2E
--
-- LOCAL ONLY, y por la misma razón que la función de arriba: el seed no se
-- despliega. Estos tres registros los sembraba `scripts/seedE2E.mjs` contra
-- Firestore y se perdieron al portar el script a Supabase en F9.1 — se portó
-- la cuenta y no los datos, así que los dos recorridos profundos buscaban un
-- proyecto y un encargo que ya no creaba nadie.
--
-- Se siembra **estado de dominio completo**, no un decorado de UI: el encargo
-- llega en `awaiting-arb` con su charter aprobado y su evaluación de gates, de
-- modo que el recorrido ejerce las mismas reglas, el mismo repositorio y la
-- misma tabla inmutable de decisiones que una aprobación real. Un fixture que
-- sólo pinta la pantalla haría pasar el test sin probar la gobernanza.
--
-- El uid no se puede fijar aquí: lo acuña Auth al crear la cuenta, y cambia en
-- cada ejecución. Por eso es una función que lo recibe.
create or replace function public.seed_e2e_fixtures(p_uid uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  stamp timestamptz := now();
  moment text := to_char(stamp at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
begin
  insert into api.business_initiatives
    (id, owner_id, code, title, need, status, priority, horizon, risk_level, data)
  values ('e2e-initiative', p_uid, 'NEG-2026-001', 'Modernización E2E',
    'Verificar de extremo a extremo los journeys críticos de Arky.',
    'approved', 'high', 'now', 'medium',
    jsonb_build_object(
      'id', 'e2e-initiative', 'schemaVersion', 1, 'code', 'NEG-2026-001',
      'title', 'Modernización E2E',
      'need', 'Verificar de extremo a extremo los journeys críticos de Arky.',
      'driver', 'Puerta de calidad autenticada',
      'objectives', jsonb_build_array('Validar identidad, persistencia y gobierno'),
      'expectedOutcomes', '[]'::jsonb, 'affectedCapabilities', '[]'::jsonb,
      'businessUnits', '[]'::jsonb, 'status', 'approved', 'priority', 'high',
      'horizon', 'now', 'riskLevel', 'medium', 'risks', '[]'::jsonb,
      'regulatoryDrivers', '[]'::jsonb, 'kpis', '[]'::jsonb,
      'milestones', '[]'::jsonb, 'stakeholders', '[]'::jsonb,
      'documents', '[]'::jsonb, 'dependsOnCodes', '[]'::jsonb, 'notes', '[]'::jsonb,
      'provenance', 'manual', 'userId', p_uid::text,
      'createdAt', moment, 'updatedAt', moment))
  on conflict (id) do update set owner_id = excluded.owner_id, data = excluded.data;

  insert into api.architecture_projects
    (id, owner_id, name, initiative_ids, data, artifact_count, artifact_index)
  values ('e2e-project', p_uid, 'Proyecto E2E gobernado', array['e2e-initiative'],
    jsonb_build_object(
      'id', 'e2e-project', 'name', 'Proyecto E2E gobernado',
      'description', 'Fixture aislado para validar los journeys autenticados.',
      'projectContext', jsonb_build_array('Ejecución contra el stack local, sin datos productivos.'),
      'initiativeIds', jsonb_build_array('e2e-initiative'),
      'linkedBusinessProjects', jsonb_build_array('NEG-2026-001'),
      'artifacts', '[]'::jsonb, 'artifactCount', 0,
      'userId', p_uid::text, 'createdAt', moment, 'updatedAt', moment),
    0, '[]'::jsonb)
  on conflict (id) do update set owner_id = excluded.owner_id, data = excluded.data;

  insert into api.office_engagements (id, project_id, owner_id, data)
  values ('e2e-engagement-arb', 'e2e-project', p_uid,
    jsonb_build_object(
      'id', 'e2e-engagement-arb', 'projectId', 'e2e-project', 'schemaVersion', 1,
      'title', 'Decisión ARB E2E',
      'brief', 'Fixture determinista para validar la decisión del comité de arquitectura.',
      'initiativeIds', jsonb_build_array('e2e-initiative'),
      'businessProjectIds', jsonb_build_array('NEG-2026-001'),
      'status', 'awaiting-arb', 'priority', 'high',
      'charter', jsonb_build_object(
        'kind', 'modernization',
        'objectives', jsonb_build_array('Validar el registro de una decisión ARB.'),
        'scope', jsonb_build_array('Aprobación del encargo de prueba.'),
        'outOfScope', '[]'::jsonb, 'constraints', '[]'::jsonb,
        'regulatoryDrivers', '[]'::jsonb, 'deliverables', '[]'::jsonb,
        'participantIds', '[]'::jsonb, 'coordinatorId', 'lucia',
        'consolidatorId', 'alejandro', 'provenance', 'deterministic',
        'proposedAt', moment, 'approvedAt', moment,
        'approvedBy', jsonb_build_object('id', p_uid::text, 'name', 'Arquitecto E2E', 'role', 'superadmin')),
      'tasks', '[]'::jsonb,
      'gateAssessment', jsonb_build_object(
        'overallStatus', 'conditional', 'evaluatedAt', moment,
        'gates', jsonb_build_array(jsonb_build_object(
          'id', 'security-review', 'status', 'conditional',
          'evidenceArtifactIds', '[]'::jsonb, 'blockers', '[]'::jsonb,
          'conditions', jsonb_build_array('Completar evidencia de seguridad antes del siguiente ciclo.')))),
      'arbDecisions', '[]'::jsonb,
      'budget', jsonb_build_object('maxAiCalls', 12, 'consumedAiCalls', 0),
      'auditTrail', '[]'::jsonb,
      'createdBy', jsonb_build_object('id', p_uid::text, 'name', 'Arquitecto E2E', 'role', 'superadmin'),
      'createdAt', moment, 'updatedAt', moment))
  on conflict (id) do update set owner_id = excluded.owner_id, data = excluded.data;
end;
$$;
revoke all on function public.seed_e2e_fixtures(uuid) from public, anon, authenticated;
grant execute on function public.seed_e2e_fixtures(uuid) to service_role;
notify pgrst, 'reload schema';
