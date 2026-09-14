import hashlib
import importlib.util
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('platform_settings_etl', ROOT / 'scripts' / 'migration' / 'platform_settings_etl.py')
assert SPEC and SPEC.loader
etl = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(etl)


class PlatformSettingsEtlTest(unittest.TestCase):
    def test_transforms_only_the_global_reference_parameters_and_removes_provider_keys(self) -> None:
        records, rejected = etl.transform([
            {'path': 'settings/global', 'data': {
                'globalContext': ['Use approved standards'],
                'aiConfig': {'model': 'gemini-2.5-flash', 'apiKey': 'never-send'},
            }},
            {'path': 'settings/user_legacy-owner', 'data': {'theme': 'dark'}},
        ])

        self.assertEqual(rejected, [])
        self.assertEqual(records, [{
            'key': 'global',
            'data': {
                'globalContext': ['Use approved standards'],
                'aiConfig': {'model': 'gemini-2.5-flash'},
            },
        }])

    def test_rejects_missing_or_non_object_global_parameters(self) -> None:
        self.assertEqual(etl.transform([]), ([], [{'path': 'settings/global', 'reason': 'missing-global-settings'}]))
        self.assertEqual(etl.transform([{'path': 'settings/global', 'data': []}]),
                         ([], [{'path': 'settings/global', 'reason': 'invalid-global-settings'}]))

    def test_removes_secret_named_fields_and_known_secret_values_at_any_depth(self) -> None:
        records, rejected = etl.transform([{
            'path': 'settings/global',
            'data': {
                'api_key': 'never-send',
                'nested': {'clientSecret': 'never-send', 'safe': 'kept'},
                'globalContext': ['Use approved standards', 'AIza' + 'A' * 35],
            },
        }])

        self.assertEqual(rejected, [])
        self.assertEqual(records, [{
            'key': 'global',
            'data': {
                'nested': {'safe': 'kept'},
                'globalContext': ['Use approved standards'],
            },
        }])

    def test_removes_secret_shapes_embedded_in_text_at_any_depth(self) -> None:
        records, rejected = etl.transform([{
            'path': 'settings/global',
            'data': {
                'globalContext': [
                    'Use approved standards',
                    'Prefix ' + 'AIza' + 'A' * 35 + ' suffix',
                    'Prefix sk-or-v1-' + 'a' * 64 + ' suffix',
                    'Prefix sk-ant-' + 'A' * 24 + ' suffix',
                    'Prefix sk-' + 'A' * 32 + ' suffix',
                ],
            },
        }])

        self.assertEqual(rejected, [])
        self.assertEqual(records, [{'key': 'global', 'data': {'globalContext': ['Use approved standards']}}])

    def test_rejects_pii_in_global_reference_parameters(self) -> None:
        records, rejected = etl.transform([{
            'path': 'settings/global',
            'data': {'globalContext': ['Contact person@example.invalid for approval']},
        }])

        self.assertEqual(records, [])
        self.assertEqual(rejected, [{'path': 'settings/global', 'reason': 'pii-in-global-settings'}])

    def test_manifest_reconciles_canonical_parameter_payload(self) -> None:
        records = [{'key': 'global', 'data': {'language': 'es'}}]
        manifest = etl.build_manifest(records, 'person@example.invalid-source.json')

        self.assertEqual(manifest['version'], 'platform-settings-etl-v1')
        self.assertEqual(manifest['source'], 'authorized-global-settings-export')
        self.assertNotIn('person@example.invalid', json.dumps(manifest))
        self.assertEqual(manifest['record_count'], 1)
        self.assertEqual(manifest['records'][0]['checksum'], hashlib.sha256(
            json.dumps({'language': 'es'}, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8'),
        ).hexdigest())
        self.assertEqual(etl.reconcile(records, manifest), [])
        self.assertEqual(etl.reconcile([], manifest), ['missing-record:global'])


if __name__ == '__main__':
    unittest.main()
