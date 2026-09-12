"""Offline safety tests; these are NOT a PostgreSQL/Supabase recovery drill."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('recovery', Path(__file__).with_name('recovery.py'))


class GuardTests(unittest.TestCase):
    def test_restore_accepts_only_literal_loopback_and_explicit_ack(self):
        self.assertTrue(Path(SPEC.origin).exists(), 'recovery implementation missing')
        mod = importlib.util.module_from_spec(SPEC)
        SPEC.loader.exec_module(mod)
        mod.guard_local('postgresql://u:p@127.0.0.1:54322/postgres', 'http://127.0.0.1:54321', 'RESTORE_DISPOSABLE_LOCAL')
        for db, api, ack in [
            ('postgresql://u:p@db.example.com/postgres', 'http://127.0.0.1:54321', 'RESTORE_DISPOSABLE_LOCAL'),
            ('postgresql://u:p@127.0.0.1/postgres?host=remote', 'http://127.0.0.1:54321', 'RESTORE_DISPOSABLE_LOCAL'),
            ('postgresql://u:p@127.0.0.1/postgres', 'https://project.supabase.co', 'RESTORE_DISPOSABLE_LOCAL'),
            ('postgresql://u:p@localhost/postgres', 'http://127.0.0.1:54321', 'RESTORE_DISPOSABLE_LOCAL'),
            ('postgresql://u:p@127.0.0.1/postgres', 'http://127.0.0.1:54321', ''),
        ]:
            with self.subTest(db=db), self.assertRaises(mod.OperationError):
                mod.guard_local(db, api, ack)


class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.mod = importlib.util.module_from_spec(SPEC)
        SPEC.loader.exec_module(self.mod)

    def test_rejects_publishable_and_unprivileged_credentials(self):
        for key in ('sb_publishable_TEST_ONLY', 'not-a-jwt'):
            with self.assertRaises(self.mod.OperationError):
                self.mod.Storage('http://127.0.0.1:54321', key)

    def test_rejects_libpq_database_name_injection(self):
        with self.assertRaises(self.mod.OperationError):
            self.mod.Database('postgresql://u:p@127.0.0.1/host%3Dremote')

    def test_secret_key_is_not_sent_as_bearer(self):
        self.assertTrue(hasattr(self.mod.Storage, 'headers'), 'safe headers missing')
        storage = self.mod.Storage('http://127.0.0.1:54321', 'sb_secret_TEST_ONLY')
        self.assertNotIn('Authorization', storage.headers())
        self.assertEqual(storage.headers()['apikey'], 'sb_secret_TEST_ONLY')

    def test_log_allowlist_drops_sensitive_fields(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.mod.log_event('operation_failed', duration_ms=2, error='secret', url='secret', objects='secret', bytes=float('nan'))
        self.assertEqual(json.loads(output.getvalue()), {'event': 'operation_failed', 'duration_ms': 2})

    def test_backup_and_restore_offline_contract(self):
        self.assertTrue(hasattr(self.mod, 'backup'), 'backup workflow missing')
        mod = self.mod
        class Storage:
            def __init__(self):
                self.data = {('private', 'nested/a b.txt'): b'payload\x00'}
                self.config = [{'id': 'private', 'name': 'private', 'public': False}]
            def buckets(self):
                return self.config
            def objects(self, bucket):
                return [{'name': n, 'metadata': {'mimetype': 'application/octet-stream'}} for b, n in self.data if b == bucket]
            def download(self, bucket, name, dest):
                dest.write_bytes(self.data[(bucket, name)])
            def create_bucket(self, config):
                self.config.append(config)
            def upload(self, bucket, name, source, mime):
                self.data[(bucket, name)] = source.read_bytes()
        class Database:
            def dump(self, path):
                path.write_bytes(b'PGDMP-offline-fixture')
            def restore(self, path):
                self.restored = path.read_bytes()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / 'backup'
            db, source = Database(), Storage()
            digest = mod.backup(root, db, source, True)
            manifest = mod.verify(root, digest)
            self.assertEqual(len(manifest['objects']), 1)
            target = Storage()
            target.config, target.data = [], {}
            mod.restore(root, digest, db, target)
            self.assertEqual(target.data, source.data)
            self.assertEqual(db.restored, b'PGDMP-offline-fixture')
            with self.assertRaises(mod.OperationError):
                mod.restore(root, digest, db, target)
            blob = root / manifest['objects'][0]['file']
            blob.write_bytes(b'corrupted')
            with self.assertRaises(mod.OperationError):
                mod.verify(root, digest)


if __name__ == '__main__':
    unittest.main()
