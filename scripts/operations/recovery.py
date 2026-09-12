#!/usr/bin/env python3
"""PoC recovery tools. Credentials only via environment; no remote restore mode."""
from urllib.parse import urlsplit


class OperationError(Exception):
    """A failure whose details must never be logged."""


def endpoint(value, schemes):
    p = urlsplit(value)
    if p.scheme not in schemes or not p.hostname or p.query or p.fragment:
        raise OperationError('invalid endpoint')
    _ = p.port  # Reject malformed ports before opening anything.
    return p


def guard_local(database, storage, ack):
    db = endpoint(database, ('postgres', 'postgresql'))
    api = endpoint(storage, ('http', 'https'))
    if ack != 'RESTORE_DISPOSABLE_LOCAL' or any(
        p.hostname not in ('127.0.0.1', '::1') for p in (db, api)
    ) or api.username or api.password or api.path not in ('', '/'):
        raise OperationError('local target required')


import argparse
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
from urllib.parse import quote, unquote
from urllib.request import Request, build_opener, HTTPRedirectHandler, ProxyHandler


def sha256(path):
    h = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def safe_file(root, name):
    if not isinstance(name, str) or not re.fullmatch(r'(database\.dump|blobs/[0-9]{8}\.bin)', name):
        raise OperationError('invalid archive path')
    path = root / name
    if root.is_symlink() or any(p.is_symlink() for p in (path, path.parent)) or not path.is_file():
        raise OperationError('unsafe archive file')
    if root.resolve() not in path.resolve().parents:
        raise OperationError('archive escape')
    return path


def object_name(name):
    if not isinstance(name, str) or not name or any(c in name for c in ('\x00', '\r', '\n', '\\')) or any(p in ('', '.', '..') for p in name.split('/')):
        raise OperationError('unsafe object name')
    return name


def bucket_config(bucket):
    ident = object_name(bucket['id'])
    if '/' in ident or bucket.get('type', 'STANDARD') != 'STANDARD':
        raise OperationError('unsupported bucket')
    if type(bucket.get('public', False)) is not bool:
        raise OperationError('invalid bucket visibility')
    return {k: v for k, v in {
        'id': ident, 'name': bucket.get('name', ident),
        'public': bucket.get('public', False),
        'file_size_limit': bucket.get('file_size_limit'),
        'allowed_mime_types': bucket.get('allowed_mime_types'),
    }.items() if v is not None}


def verify(root, expected):
    root = Path(root)
    manifest_file = root / 'manifest.json'
    if root.is_symlink() or manifest_file.is_symlink() or not re.fullmatch('[0-9a-f]{64}', expected):
        raise OperationError('untrusted manifest')
    if sha256(manifest_file) != expected:
        raise OperationError('manifest checksum mismatch')
    manifest = json.loads(manifest_file.read_text())
    if manifest['version'] != 1 or manifest['consistency'] != 'operator-quiesced':
        raise OperationError('unsupported manifest')
    buckets = [bucket_config(b)['id'] for b in manifest['buckets']]
    if len(buckets) != len(set(buckets)):
        raise OperationError('duplicate bucket')
    if manifest['database']['file'] != 'database.dump':
        raise OperationError('invalid database archive')
    files, objects = set(), set()
    for entry in [manifest['database'], *manifest['objects']]:
        name = entry['file']
        path = safe_file(root, name)
        if name in files or type(entry['bytes']) is not int or entry['bytes'] < 0:
            raise OperationError('invalid archive entry')
        files.add(name)
        if path.stat().st_size != entry['bytes'] or sha256(path) != entry['sha256']:
            raise OperationError('payload checksum mismatch')
    for obj in manifest['objects']:
        identity = (obj['bucket'], object_name(obj['name']))
        if obj['bucket'] not in buckets or identity in objects or not obj['file'].startswith('blobs/'):
            raise OperationError('invalid object inventory')
        if not isinstance(obj['content_type'], str) or any(c in obj['content_type'] for c in ('\r', '\n')):
            raise OperationError('invalid content type')
        objects.add(identity)
    return manifest


def entry(root, path):
    return {'file': path.relative_to(root).as_posix(), 'bytes': path.stat().st_size, 'sha256': sha256(path)}


def inventory(storage):
    buckets = sorted((bucket_config(b) for b in storage.buckets()), key=lambda b: b['id'])
    objects = []
    for bucket in buckets:
        for obj in storage.objects(bucket['id']):
            objects.append({'bucket': bucket['id'], 'name': object_name(obj['name']),
                            'metadata': obj.get('metadata') or {},
                            'updated_at': obj.get('updated_at')})
    return buckets, sorted(objects, key=lambda o: (o['bucket'], o['name']))


def backup(root, database, storage, quiesced):
    if not quiesced:
        raise OperationError('quiescence acknowledgement required')
    root = Path(root)
    root.mkdir(mode=0o700, parents=False, exist_ok=False)
    (root / 'blobs').mkdir(mode=0o700)
    buckets, before = inventory(storage)
    database.dump(root / 'database.dump')
    manifest = {'version': 1, 'consistency': 'operator-quiesced',
                'created_at': datetime.now(timezone.utc).isoformat(),
                'database': entry(root, root / 'database.dump'), 'buckets': buckets, 'objects': []}
    if hasattr(database, 'inventory'):
        manifest['database_counts'] = database.inventory()
    for index, obj in enumerate(before):
        path = root / 'blobs' / f'{index:08d}.bin'
        storage.download(obj['bucket'], obj['name'], path)
        manifest['objects'].append({**entry(root, path), 'bucket': obj['bucket'], 'name': obj['name'],
                                    'content_type': obj['metadata'].get('mimetype', 'application/octet-stream')})
    if (buckets, before) != inventory(storage):
        raise OperationError('source changed during backup')
    manifest_path = root / 'manifest.json'
    manifest_path.write_text(json.dumps(manifest, sort_keys=True, ensure_ascii=True, indent=2) + '\n')
    digest = sha256(manifest_path)
    verify(root, digest)
    return digest


def restore(root, expected, database, storage):
    # Called only after CLI guard; injectable adapters permit offline contract tests.
    root = Path(root)
    manifest = verify(root, expected)
    if any(obj['bytes'] > 50 * 1024 * 1024 for obj in manifest['objects']):
        raise OperationError('standard upload limit exceeded')
    if storage.buckets():
        raise OperationError('storage target must be empty')
    database.restore(safe_file(root, manifest['database']['file']))
    if 'database_counts' in manifest and database.inventory() != manifest['database_counts']:
        raise OperationError('database reconciliation failed')
    for bucket in manifest['buckets']:
        storage.create_bucket(bucket_config(bucket))
    for obj in manifest['objects']:
        storage.upload(obj['bucket'], obj['name'], safe_file(root, obj['file']), obj['content_type'])
    # Never equate upload success with recovery: read back every byte and inventory.
    wanted = {(o['bucket'], o['name']) for o in manifest['objects']}
    actual_buckets, actual = inventory(storage)
    if actual_buckets != sorted(manifest['buckets'], key=lambda b: b['id']) or {(o['bucket'], o['name']) for o in actual} != wanted:
        raise OperationError('storage reconciliation failed')
    with tempfile.TemporaryDirectory() as temp:
        for obj in manifest['objects']:
            dest = Path(temp) / 'readback'
            storage.download(obj['bucket'], obj['name'], dest)
            if sha256(dest) != obj['sha256'] or dest.stat().st_size != obj['bytes']:
                raise OperationError('storage readback failed')


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise OperationError('redirect refused')


class Storage:
    def __init__(self, url, key):
        p = endpoint(url, ('https', 'http'))
        if p.username or p.password or p.path not in ('', '/') or (p.scheme == 'http' and p.hostname not in ('127.0.0.1', '::1')):
            raise OperationError('invalid storage endpoint')
        if not key or any(c in key for c in ('\r', '\n')):
            raise OperationError('invalid storage credential')
        if not key.startswith('sb_secret_'):
            # This is a misuse check, NOT signature verification (the server does that).
            import base64
            try:
                parts = key.split('.')
                claims = json.loads(base64.urlsafe_b64decode(parts[1] + '=' * (-len(parts[1]) % 4)))
                if len(parts) != 3 or claims.get('role') != 'service_role':
                    raise ValueError()
            except Exception:
                raise OperationError('privileged storage credential required') from None
        self.url, self.key = url.rstrip('/') + '/storage/v1', key
        self.opener = build_opener(ProxyHandler({}), NoRedirect())

    def headers(self):
        headers = {'apikey': self.key, 'x-upsert': 'false'}
        if not self.key.startswith('sb_secret_'):
            headers['Authorization'] = 'Bearer ' + self.key
        return headers

    def request(self, method, path, body=None, dest=None, mime='application/json'):
        data = json.dumps(body).encode() if isinstance(body, dict) else body
        req = Request(self.url + path, data=data, method=method,
                      headers={**self.headers(), 'Content-Type': mime})
        with self.opener.open(req, timeout=60) as response:
            if dest is not None:
                with dest.open('wb') as handle:
                    for chunk in iter(lambda: response.read(1024 * 1024), b''):
                        handle.write(chunk)
                return None
            return json.loads(response.read())

    def buckets(self):
        result, offset = [], 0
        while True:
            page = self.request('GET', f'/bucket?limit=100&offset={offset}&sortColumn=id&sortOrder=asc')
            if not isinstance(page, list):
                raise OperationError('invalid bucket listing')
            result.extend(page)
            if len(page) < 100:
                return result
            offset += len(page)
            if offset > 10000:
                raise OperationError('bucket inventory limit')

    def objects(self, bucket):
        pending, visited, result = [''], set(), []
        while pending:
            prefix = pending.pop()
            if prefix in visited or len(visited) > 100000:
                raise OperationError('invalid folder listing')
            visited.add(prefix)
            offset = 0
            while True:
                page = self.request('POST', '/object/list/' + quote(bucket, safe=''),
                                    {'prefix': prefix, 'limit': 100, 'offset': offset,
                                     'sortBy': {'column': 'name', 'order': 'asc'}})
                if not isinstance(page, list):
                    raise OperationError('invalid object listing')
                for item in page:
                    part = object_name(item['name'])
                    name = object_name(prefix + part)
                    if item.get('id') is None:
                        pending.append(name + '/')
                    else:
                        result.append({**item, 'name': name})
                if len(page) < 100:
                    break
                offset += len(page)
                if offset > 1000000:
                    raise OperationError('object inventory limit')
        return result

    def download(self, bucket, name, dest):
        self.request('GET', '/object/authenticated/' + quote(bucket, safe='') + '/' + quote(name, safe='/'), dest=dest)

    def create_bucket(self, config):
        self.request('POST', '/bucket', config)

    def upload(self, bucket, name, source, mime):
        # Standard uploads deliberately bounded for this small PoC, not multipart/S3.
        if source.stat().st_size > 50 * 1024 * 1024:
            raise OperationError('standard upload limit exceeded')
        self.request('POST', '/object/' + quote(bucket, safe='') + '/' + quote(name, safe='/'), source.read_bytes(), mime=mime)


class Database:
    def __init__(self, url):
        p = endpoint(url, ('postgres', 'postgresql'))
        if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_-]*', unquote(p.path[1:])) or not p.username:
            raise OperationError('simple database name and user required')
        self.env = {k: v for k, v in os.environ.items() if k in ('PATH', 'HOME', 'LANG', 'LC_ALL', 'SYSTEMROOT')}
        self.env.update(PGHOST=p.hostname, PGPORT=str(p.port or 5432), PGUSER=unquote(p.username),
                        PGDATABASE=unquote(p.path[1:]), PGPASSWORD=unquote(p.password or ''),
                        PGCONNECT_TIMEOUT='10', PGAPPNAME='arky_recovery',
                        PGSSLMODE='disable' if p.hostname in ('127.0.0.1', '::1') else 'verify-full')
        if os.environ.get('ARKY_PGSSLROOTCERT'):
            self.env['PGSSLROOTCERT'] = os.environ['ARKY_PGSSLROOTCERT']

    def run(self, args, sql=None, readonly=False):
        env = dict(self.env)
        if readonly:
            env['PGOPTIONS'] = '-c default_transaction_read_only=on'
        result = subprocess.run(args, input=sql, env=env, text=True, capture_output=True, timeout=1800, check=False)
        if result.returncode:
            raise OperationError('database operation failed')
        return result.stdout

    def dump(self, path):
        self.run(['pg_dump', '--format=custom', '--no-password', '--file', str(path)], readonly=True)
        self.run(['pg_restore', '--list', str(path)])

    def restore(self, path):
        # Managed Storage metadata must be recreated by Storage API, never SQL replay.
        # All other schemas are destructive: exclusively a disposable local database.
        self.run(['pg_restore', '--no-password', '--dbname', self.env['PGDATABASE'],
                  '--clean', '--if-exists', '--exit-on-error', '--single-transaction',
                  '--no-owner', '--exclude-schema=storage', str(path)])

    def inventory(self):
        names = json.loads(self.run(['psql', '-X', '-A', '-t', '--no-password', '-v', 'ON_ERROR_STOP=1'],
            "SELECT coalesce(json_agg(ARRAY[n.nspname,c.relname] ORDER BY n.nspname,c.relname),'[]'::json) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname NOT LIKE 'pg_%' AND n.nspname NOT IN ('information_schema','storage');", readonly=True))
        result = []
        for schema, table in names:
            ident = '.'.join('"' + s.replace('"', '""') + '"' for s in (schema, table))
            count = int(self.run(['psql', '-X', '-A', '-t', '--no-password', '-v', 'ON_ERROR_STOP=1'], 'SELECT count(*) FROM ' + ident, readonly=True))
            result.append({'schema': schema, 'table': table, 'rows': count})
        return result


def log_event(event, **fields):
    if event not in ('backup_verified', 'restore_verified', 'archive_verified', 'operation_failed'):
        raise OperationError('invalid log event')
    out = {'event': event}
    for key in ('duration_ms', 'objects', 'bytes'):
        value = fields.get(key)
        if type(value) in (int, float) and math.isfinite(value) and value >= 0:
            out[key] = value
    print(json.dumps(out, sort_keys=True), flush=True)


class SafeParser(argparse.ArgumentParser):
    def error(self, message):
        log_event('operation_failed')
        self.exit(2)


def main(argv=None):
    os.umask(0o077)
    parser = SafeParser(description=__doc__)
    parser.add_argument('operation', choices=('backup', 'verify', 'restore-local'))
    parser.add_argument('--directory', required=True)
    parser.add_argument('--manifest-sha256', default='')
    parser.add_argument('--ack-writes-paused', action='store_true')
    parser.add_argument('--confirm', default='')
    args = parser.parse_args(argv)
    start = time.monotonic()
    try:
        if args.operation == 'verify':
            manifest = verify(Path(args.directory), args.manifest_sha256)
            log_event('archive_verified', objects=len(manifest['objects']))
        elif args.operation == 'backup':
            digest = backup(Path(args.directory), Database(os.environ['ARKY_SOURCE_DB_URL']),
                            Storage(os.environ['ARKY_SOURCE_STORAGE_URL'], os.environ['ARKY_SOURCE_STORAGE_KEY']), args.ack_writes_paused)
            # Integrity receipt only, not a credential, filename or user-data log.
            receipt = Path(args.directory) / 'manifest.sha256'
            receipt.write_text(digest + '\n')
            log_event('backup_verified', duration_ms=round((time.monotonic() - start) * 1000))
        else:
            db_url, api_url = os.environ['ARKY_TARGET_DB_URL'], os.environ['ARKY_TARGET_STORAGE_URL']
            guard_local(db_url, api_url, args.confirm)
            restore(Path(args.directory), args.manifest_sha256, Database(db_url),
                    Storage(api_url, os.environ['ARKY_TARGET_STORAGE_KEY']))
            log_event('restore_verified', duration_ms=round((time.monotonic() - start) * 1000))
        return 0
    except Exception:
        # Do not print str(error), traceback, SQL, headers, URLs, paths or server bodies.
        log_event('operation_failed', duration_ms=round((time.monotonic() - start) * 1000))
        return 1


if __name__ == '__main__':
    sys.exit(main())
