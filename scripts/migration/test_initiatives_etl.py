import hashlib
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('initiatives_etl', ROOT / 'scripts' / 'migration' / 'initiatives_etl.py')
assert SPEC and SPEC.loader
etl = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(etl)

OWNER = '00000000-0000-4000-8000-000000000001'


def source_data(owner: str = 'firebase-owner'):
    return {
        'id': 'init_legacy_001', 'schemaVersion': 1, 'code': 'NEG-2026-001',
        'title': 'Alta digital', 'need': 'El alta tarda doce días', 'driver': 'regulación',
        'objectives': ['Reducir tiempos'],
        'expectedOutcomes': [{'id': 'out_1', 'statement': 'Alta en un día'}],
        'affectedCapabilities': [], 'businessUnits': [], 'status': 'draft',
        'priority': 'medium', 'horizon': 'next', 'riskLevel': 'medium', 'risks': [],
        'regulatoryDrivers': [], 'kpis': [{'id': 'kpi_1', 'name': 'Tiempo', 'unit': 'días'}],
        'milestones': [], 'stakeholders': [],
        'documents': [{'id': 'doc_1', 'name': 'Caso', 'kind': 'business-case', 'content': 'Texto', 'addedAt': '2026-09-01T00:00:00.000Z', 'addedBy': 'Ana'}],
        'dependsOnCodes': [], 'notes': [], 'provenance': 'manual', 'userId': owner,
        'createdAt': '2026-09-01T00:00:00.000Z', 'updatedAt': '2026-09-12T00:00:00.000Z',
    }


class InitiativesEtlTest(unittest.TestCase):
    def test_preserves_textual_id_dates_and_embedded_collections_but_maps_owner_explicitly(self):
        records, rejected = etl.transform(
            [{'path': 'businessInitiatives/init_legacy_001', 'data': source_data()}],
            {'firebase-owner': OWNER},
        )

        self.assertEqual(rejected, [])
        self.assertEqual(records[0]['id'], 'init_legacy_001')
        self.assertEqual(records[0]['owner_id'], OWNER)
        self.assertEqual(records[0]['initiative']['userId'], OWNER)
        self.assertEqual(records[0]['initiative']['createdAt'], '2026-09-01T00:00:00.000Z')
        self.assertEqual(records[0]['initiative']['documents'][0]['content'], 'Texto')
        self.assertEqual(records[0]['initiative']['kpis'][0]['id'], 'kpi_1')

    def test_rejects_missing_owner_mapping_and_path_data_identity_disagreement(self):
        missing, missing_rejected = etl.transform(
            [{'path': 'businessInitiatives/init_legacy_001', 'data': source_data()}], {},
        )
        mismatched, mismatched_rejected = etl.transform(
            [{'path': 'businessInitiatives/init_from_path', 'data': source_data()}],
            {'firebase-owner': OWNER},
        )

        self.assertEqual(missing, [])
        self.assertEqual(missing_rejected, [{'path': 'businessInitiatives/init_legacy_001', 'reason': 'missing-identity-map'}])
        self.assertEqual(mismatched, [])
        self.assertEqual(mismatched_rejected, [{'path': 'businessInitiatives/init_from_path', 'reason': 'id-path-mismatch'}])

    def test_manifest_is_deterministic_and_reconciliation_detects_modified_aggregate(self):
        records, _ = etl.transform(
            [{'path': 'businessInitiatives/init_legacy_001', 'data': source_data()}],
            {'firebase-owner': OWNER},
        )
        manifest = etl.build_manifest(records, 'firestore-export.json')
        self.assertEqual(manifest['record_count'], 1)
        self.assertEqual(manifest['records'][0]['checksum'], hashlib.sha256(etl.canonical_json(records[0]['initiative']).encode()).hexdigest())
        self.assertEqual(etl.reconcile(records, manifest), [])

        changed = [{**records[0], 'initiative': {**records[0]['initiative'], 'title': 'Título alterado'}}]
        self.assertEqual(etl.reconcile(changed, manifest), ['checksum-mismatch:init_legacy_001'])


if __name__ == '__main__':
    unittest.main()
