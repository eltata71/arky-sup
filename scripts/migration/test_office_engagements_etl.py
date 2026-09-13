import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('office_engagements_etl', ROOT / 'scripts' / 'migration' / 'office_engagements_etl.py')
assert SPEC and SPEC.loader
etl = importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(etl)
OWNER = '00000000-0000-4000-8000-000000000001'
ADMIN = '00000000-0000-4000-8000-000000000002'


def engagement(owner='firebase-owner', project='proj_legacy_001'):
    return {
        'id': 'eng_legacy_001', 'projectId': project, 'schemaVersion': 1,
        'title': 'Encargo de prueba', 'brief': 'Brief original',
        'initiativeIds': ['init_legacy_001'], 'businessProjectIds': [],
        'status': 'in-progress', 'priority': 'medium',
        'charter': {'kind': 'new-solution', 'objectives': [], 'scope': [], 'outOfScope': [], 'constraints': [],
            'regulatoryDrivers': [], 'deliverables': [], 'participantIds': [], 'coordinatorId': 'lucia',
            'consolidatorId': 'alejandro', 'provenance': 'deterministic', 'proposedAt': '2026-09-12T00:00:00.000Z'},
        'tasks': [], 'arbDecisions': [], 'budget': {'maxAiCalls': 40, 'consumedAiCalls': 0},
        'auditTrail': [], 'createdBy': {'id': owner, 'name': 'Arquitecto', 'role': 'architect'},
        'createdAt': '2026-09-12T00:00:00.000Z', 'updatedAt': '2026-09-12T00:00:00.000Z',
    }


def decision():
    return {
        'id': 'arb_legacy_001', 'engagementId': 'eng_legacy_001',
        'verdict': 'approved', 'rationale': 'Aprobado por el comité',
        'actor': {'id': 'firebase-admin', 'name': 'Admin', 'role': 'admin'},
        'gateStatusAtDecision': 'pass', 'previousStatus': 'awaiting-arb',
        'decidedAt': '2026-09-12T00:00:00.000Z',
    }


class OfficeEngagementsEtlTest(unittest.TestCase):
    def test_preserves_ids_and_maps_owner(self):
        records, rejected = etl.transform([
            {'path': 'projects/proj_legacy_001/engagements/eng_legacy_001', 'data': engagement()},
        ], {'firebase-owner': OWNER})
        self.assertEqual(rejected, [])
        self.assertEqual(records[0]['id'], 'eng_legacy_001')
        self.assertEqual(records[0]['project_id'], 'proj_legacy_001')
        self.assertEqual(records[0]['owner_id'], OWNER)
        self.assertNotIn('arbDecisions', records[0]['engagement'])

    def test_rejects_missing_identity_mapping(self):
        records, rejected = etl.transform([
            {'path': 'projects/proj_legacy_001/engagements/eng_legacy_001', 'data': engagement()},
        ], {})
        self.assertEqual(records, [])
        self.assertEqual(rejected, [{'path': 'projects/proj_legacy_001/engagements/eng_legacy_001', 'reason': 'missing-identity-map'}])

    def test_attaches_arb_decisions_and_maps_actor(self):
        records, rejected = etl.transform([
            {'path': 'projects/proj_legacy_001/engagements/eng_legacy_001', 'data': engagement()},
            {'path': 'projects/proj_legacy_001/engagements/eng_legacy_001/arbDecisions/arb_legacy_001', 'data': decision()},
        ], {'firebase-owner': OWNER, 'firebase-admin': ADMIN})
        self.assertEqual(rejected, [])
        self.assertEqual(records[0]['arb_decisions'][0]['id'], 'arb_legacy_001')

    def test_rejects_decision_signed_by_unmapped_actor(self):
        records, rejected = etl.transform([
            {'path': 'projects/proj_legacy_001/engagements/eng_legacy_001', 'data': engagement()},
            {'path': 'projects/proj_legacy_001/engagements/eng_legacy_001/arbDecisions/arb_legacy_001', 'data': decision()},
        ], {'firebase-owner': OWNER})
        self.assertEqual(records, [])
        self.assertEqual(rejected, [{'path': 'projects/proj_legacy_001/engagements/eng_legacy_001/arbDecisions/arb_legacy_001', 'reason': 'missing-identity-map'}])

    def test_rejects_invalid_status_and_nested_secret(self):
        for mutation in ({'status': 'running'}, {'nested': {'apiKey': 'x'}}):
            with self.subTest(mutation=mutation):
                data = {**engagement(), **mutation}
                records, rejected = etl.transform([
                    {'path': 'projects/proj_legacy_001/engagements/eng_legacy_001', 'data': data},
                ], {'firebase-owner': OWNER})
                self.assertEqual(records, [])
                self.assertEqual(rejected[0]['reason'], 'invalid-engagement')


if __name__ == '__main__': unittest.main()