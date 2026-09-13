"""Real local HTTP/filesystem tests with a protocol fixture, NOT live Supabase."""
import contextlib
import http.server
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('recovery', Path(__file__).with_name('recovery.py'))
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)


class SafetyTests(unittest.TestCase):
    def archive(self, root):
        (root / 'blobs').mkdir()
        (root / 'database.dump').write_bytes(b'PGDMP-offline-fixture')
        (root / 'blobs/00000000.bin').write_bytes(b'hello')
        self.manifest = {'version': 1, 'consistency': 'operator-quiesced',
                         'database': r.entry(root, root / 'database.dump'),
                         'buckets': [{'id': 'b', 'name': 'b', 'public': False}],
                         'objects': [{**r.entry(root, root / 'blobs/00000000.bin'),
                                      'bucket': 'b', 'name': 'a', 'content_type': 'text/plain'}]}
        return self.save(root)

    def save(self, root):
        (root / 'manifest.json').write_text(json.dumps(self.manifest))
        return r.sha256(root / 'manifest.json')

    def test_oversized_restore_is_rejected_before_database_write(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.archive(root)
            blob = root / 'blobs/00000000.bin'
            with blob.open('wb') as handle:
                handle.truncate(50 * 1024 * 1024 + 1)
            self.manifest['objects'][0].update(r.entry(root, blob))
            digest = self.save(root)
            class Database:
                def restore(self, _):
                    raise AssertionError('database touched before preflight')
            class Storage:
                def buckets(self):
                    return []
            with self.assertRaises(r.OperationError):
                r.restore(root, digest, Database(), Storage())

    def test_manifest_digest_is_required_and_checked(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.archive(root)
            for digest in ('', '0' * 64):
                with self.assertRaises(r.OperationError):
                    r.verify(root, digest)

    def test_missing_blob_is_not_a_valid_archive(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            digest = self.archive(root)
            (root / 'blobs/00000000.bin').unlink()
            with self.assertRaises(r.OperationError):
                r.verify(root, digest)

    def test_traversal_absolute_symlink_and_duplicate_files_rejected(self):
        for name in ('../database.dump', '/etc/passwd', 'blobs/../database.dump', 'database.dump'):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                self.archive(root)
                self.manifest['objects'][0]['file'] = name
                with self.assertRaises(r.OperationError):
                    r.verify(root, self.save(root))
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            digest = self.archive(root)
            blob = root / 'blobs/00000000.bin'
            blob.unlink()
            blob.symlink_to(root / 'database.dump')
            with self.assertRaises(r.OperationError):
                r.verify(root, digest)

    def test_backup_requires_quiescence_and_new_directory(self):
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaises(r.OperationError):
                r.backup(Path(temp) / 'new', None, None, False)
            with self.assertRaises(FileExistsError):
                r.backup(Path(temp), None, None, True)

    def test_subprocess_credentials_never_in_arguments_and_pg_environment_scrubbed(self):
        class Result:
            returncode, stdout = 0, ''
        with patch.dict(os.environ, {'PGHOSTADDR': 'remote', 'PGSERVICE': 'remote', 'PGOPTIONS': 'evil', 'TOP_SECRET': 'hidden'}):
            database = r.Database('postgresql://u:password-marker@127.0.0.1:54322/postgres')
        with patch.object(r.subprocess, 'run', return_value=Result()) as run:
            database.dump(Path('/tmp/test.dump'))
        for call in run.call_args_list:
            self.assertNotIn('password-marker', str(call.args))
            self.assertNotIn('PGHOSTADDR', call.kwargs['env'])
            self.assertNotIn('PGSERVICE', call.kwargs['env'])
            self.assertNotIn('TOP_SECRET', call.kwargs['env'])
        self.assertIn('default_transaction_read_only=on', run.call_args_list[0].kwargs['env']['PGOPTIONS'])

    def test_invalid_cli_argument_never_echoes_value(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output), self.assertRaises(SystemExit):
            r.main(['secret-marker-invalid-operation', '--directory', '/tmp/test'])
        self.assertNotIn('secret-marker', output.getvalue())

    def test_cli_remote_guard_precedes_any_request_and_never_leaks(self):
        with patch.dict(os.environ, {'ARKY_TARGET_DB_URL': 'postgresql://u:do-not-echo@remote.invalid/postgres',
                                     'ARKY_TARGET_STORAGE_URL': 'http://127.0.0.1:54321'}):
            output = io.StringIO()
            with patch.object(r, 'Storage') as storage, contextlib.redirect_stdout(output):
                code = r.main(['restore-local', '--directory', '/does-not-exist', '--confirm', 'RESTORE_DISPOSABLE_LOCAL'])
            self.assertEqual(code, 1)
            storage.assert_not_called()
            self.assertEqual(json.loads(output.getvalue())['event'], 'operation_failed')
            self.assertNotIn('do-not-echo', output.getvalue())


class HTTPTests(unittest.TestCase):
    def setUp(self):
        self.requests = []
        requests = self.requests
        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass
            def do_GET(self):
                requests.append((self.command, self.path, None, dict(self.headers)))
                if self.path.endswith('/redirect'):
                    self.send_response(302)
                    self.send_header('Location', 'http://127.0.0.1:1/never')
                    self.end_headers()
                else:
                    self.send_response(200)
                    self.end_headers()
                    self.wfile.write(b'actual-binary\x00')
            def do_POST(self):
                body = self.rfile.read(int(self.headers['Content-Length']))
                requests.append((self.command, self.path, body, dict(self.headers)))
                self.send_response(200)
                self.end_headers()
                if '/object/list/' not in self.path:
                    self.wfile.write(b'{}')
                    return
                data = json.loads(body)
                if data['prefix'] == '':
                    items = [{'id': 'id', 'name': f'a{i:03}', 'metadata': {}} for i in range(100)] if data['offset'] == 0 else [{'id': None, 'name': 'nested', 'metadata': None}]
                else:
                    items = [{'id': 'id', 'name': 'space #.txt', 'metadata': {}}]
                self.wfile.write(json.dumps(items).encode())
        self.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever)
        self.thread.start()
        self.storage = r.Storage(f'http://127.0.0.1:{self.server.server_port}', 'sb_secret_TEST_ONLY')

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def test_real_http_pagination_and_nested_paths(self):
        objects = self.storage.objects('bucket')
        self.assertEqual(len(objects), 101)
        self.assertEqual(objects[-1]['name'], 'nested/space #.txt')
        self.assertEqual([json.loads(c[2])['offset'] for c in self.requests], [0, 100, 0])

    def test_real_http_download_upload_binary_and_escaped_paths(self):
        with tempfile.TemporaryDirectory() as temp:
            dest = Path(temp) / 'blob'
            self.storage.download('bucket', 'nested/space #.txt', dest)
            self.assertEqual(dest.read_bytes(), b'actual-binary\x00')
            self.storage.upload('bucket', 'nested/space #.txt', dest, 'application/octet-stream')
        self.assertTrue(self.requests[0][1].endswith('/nested/space%20%23.txt'))
        self.assertEqual(self.requests[1][2], b'actual-binary\x00')
        self.assertEqual({k.lower(): v for k, v in self.requests[1][3].items()}['x-upsert'], 'false')
        self.assertNotIn('Authorization', self.requests[1][3])

    def test_redirect_refused_without_following(self):
        with tempfile.TemporaryDirectory() as temp, self.assertRaises(r.OperationError):
            self.storage.download('bucket', 'redirect', Path(temp) / 'blob')
        self.assertEqual(len(self.requests), 1)


if __name__ == '__main__':
    unittest.main()
