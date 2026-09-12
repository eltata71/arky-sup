import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('settings_etl', ROOT / 'scripts' / 'migration' / 'settings_etl.py')
assert SPEC and SPEC.loader
etl = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(etl)


class SettingsEtlTest(unittest.TestCase):
    def test_transform_requires_explicit_uuid_mapping_and_strips_byok_key(self):
        source = [{
            'path': 'settings/user_firebase-owner',
            'data': {
                'theme': 'dark', 'language': 'es',
                'aiConfig': {'model': 'm', 'apiKey': 'never-export'},
            },
        }]
        records, rejected = etl.transform(source, {'firebase-owner': '00000000-0000-4000-8000-000000000001'})

        self.assertEqual(rejected, [])
        self.assertEqual(records[0]['id'], '00000000-0000-4000-8000-000000000001')
        self.assertNotIn('apiKey', records[0]['settings']['aiConfig'])
        self.assertNotIn('never-export', etl.canonical_json(records[0]))

    def test_transform_rejects_unknown_identity_without_derived_uuid(self):
        records, rejected = etl.transform(
            [{'path': 'settings/user_unknown', 'data': {'theme': 'dark'}}],
            {},
        )
        self.assertEqual(records, [])
        self.assertEqual(rejected, [{'path': 'settings/user_unknown', 'reason': 'missing-identity-map'}])

    def test_manifest_is_deterministic_and_reconciliation_checks_checksums(self):
        records, _ = etl.transform(
            [{'path': 'settings/user_a', 'data': {'theme': 'dark'}}],
            {'a': '00000000-0000-4000-8000-000000000001'},
        )
        manifest = etl.build_manifest(records, source_label='firebase-export.json')
        self.assertEqual(manifest['record_count'], 1)
        self.assertEqual(manifest['records'][0]['checksum'], hashlib.sha256(etl.canonical_json(records[0]['settings']).encode()).hexdigest())
        self.assertEqual(etl.reconcile(records, manifest), [])

        altered = {**manifest, 'records': [{**manifest['records'][0], 'checksum': '0' * 64}]}
        self.assertEqual(etl.reconcile(records, altered), ['checksum-mismatch:00000000-0000-4000-8000-000000000001'])


if __name__ == '__main__':
    unittest.main()
