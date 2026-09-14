#!/usr/bin/env python3
"""F5: ETL reproducible de parámetros globales de referencia.

Entrada: exportación JSON de Firestore ya autorizada. Solo transforma
`settings/global`: parámetros reutilizables que asisten la creación. No migra
proyectos, artefactos, cursos ni preferencias por usuario. Elimina claves de
proveedor recursivamente y produce un manifiesto con checksum.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any

VERSION = 'platform-settings-etl-v1'
GLOBAL_PATH = 'settings/global'
DROP = object()
MANIFEST_SOURCE = 'authorized-global-settings-export'
SECRET_VALUE_PATTERNS = (
    re.compile(r'AIza[0-9A-Za-z_-]{35}'),
    re.compile(r'sk-or-v1-[0-9a-fA-F]{64}'),
    re.compile(r'sk-ant-[A-Za-z0-9_-]{24,}'),
    re.compile(r'sk-[A-Za-z0-9_-]{20,}'),
    re.compile(r'-----BEGIN [A-Z ]*PRIVATE KEY-----'),
)
PII_FIELD_NAMES = {'email', 'mail', 'phone', 'telephone', 'address', 'fullname', 'firstname', 'lastname'}
EMAIL_PATTERN = re.compile(r'(?<![\w.+-])[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}(?![\w.-])', re.IGNORECASE)
PHONE_PATTERN = re.compile(r'(?<!\w)(?:\+?\d[\s().-]*){7,}\d(?!\w)')


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def is_secret_field_name(key: str) -> bool:
    normalized = key.replace('_', '').replace('-', '').lower()
    return normalized in {'apikey', 'clientsecret', 'secret', 'token', 'credential', 'password'}


def is_known_secret_value(value: str) -> bool:
    return any(pattern.search(value) for pattern in SECRET_VALUE_PATTERNS)


def is_pii_field_name(key: str) -> bool:
    normalized = key.replace('_', '').replace('-', '').lower()
    return normalized in PII_FIELD_NAMES


def contains_pii(value: Any) -> bool:
    if isinstance(value, dict):
        return any(is_pii_field_name(key) or contains_pii(item) for key, item in value.items())
    if isinstance(value, list):
        return any(contains_pii(item) for item in value)
    return isinstance(value, str) and bool(EMAIL_PATTERN.search(value) or PHONE_PATTERN.search(value))


def remove_provider_keys(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: cleaned
            for key, item in value.items()
            if not is_secret_field_name(key)
            for cleaned in [remove_provider_keys(item)]
            if cleaned is not DROP
        }
    if isinstance(value, list):
        return [cleaned for item in value for cleaned in [remove_provider_keys(item)] if cleaned is not DROP]
    if isinstance(value, str) and is_known_secret_value(value):
        return DROP
    return value


def transform(source: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    global_documents = [document for document in source if document.get('path') == GLOBAL_PATH]
    if not global_documents:
        return [], [{'path': GLOBAL_PATH, 'reason': 'missing-global-settings'}]
    if len(global_documents) != 1 or not isinstance(global_documents[0].get('data'), dict):
        return [], [{'path': GLOBAL_PATH, 'reason': 'invalid-global-settings'}]
    if contains_pii(global_documents[0]['data']):
        return [], [{'path': GLOBAL_PATH, 'reason': 'pii-in-global-settings'}]
    return [{'key': 'global', 'data': remove_provider_keys(global_documents[0]['data'])}], []


def checksum(data: dict[str, Any]) -> str:
    return hashlib.sha256(canonical_json(data).encode('utf-8')).hexdigest()


def build_manifest(records: list[dict[str, Any]], source_label: str) -> dict[str, Any]:
    return {
        'version': VERSION,
        'source': MANIFEST_SOURCE,
        'record_count': len(records),
        'records': [
            {'key': record['key'], 'checksum': checksum(record['data'])}
            for record in records
        ],
    }


def reconcile(records: list[dict[str, Any]], manifest: dict[str, Any]) -> list[str]:
    expected = {entry['key']: entry for entry in manifest.get('records', []) if isinstance(entry, dict) and isinstance(entry.get('key'), str)}
    actual = {record['key']: record for record in records}
    findings: list[str] = []
    for key in sorted(set(expected) - set(actual)):
        findings.append(f'missing-record:{key}')
    for key in sorted(set(actual) - set(expected)):
        findings.append(f'unexpected-record:{key}')
    for key in sorted(set(actual) & set(expected)):
        if checksum(actual[key]['data']) != expected[key].get('checksum'):
            findings.append(f'checksum-mismatch:{key}')
    return findings


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding='utf-8'))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True, help='JSON de documentos Firestore exportados')
    parser.add_argument('--out', type=Path, required=True, help='NDJSON de parámetros canónicos sin secretos')
    parser.add_argument('--manifest', type=Path, required=True, help='Manifiesto con checksums')
    arguments = parser.parse_args()

    source = load_json(arguments.source)
    if not isinstance(source, list):
        raise SystemExit('La fuente debe ser una lista JSON.')
    records, rejected = transform(source)
    if rejected:
        raise SystemExit('ETL rechazada: ' + canonical_json({'rejected': rejected}))
    manifest = build_manifest(records, arguments.source.name)
    arguments.out.parent.mkdir(parents=True, exist_ok=True)
    arguments.manifest.parent.mkdir(parents=True, exist_ok=True)
    arguments.out.write_text(''.join(canonical_json(record) + '\n' for record in records), encoding='utf-8')
    arguments.manifest.write_text(canonical_json(manifest) + '\n', encoding='utf-8')
    print(canonical_json({'version': VERSION, 'records': len(records), 'manifest': str(arguments.manifest)}))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
