#!/usr/bin/env python3
"""F5.3/F5.4: ETL reproducible del piloto `settings/user_{firebaseUid}`.

Entrada: JSON con documentos Firestore ya exportados y mapa explícito Firebase UID
→ UUID Supabase. No conecta a Firebase ni a Supabase, no conoce secretos y no
infiere UUIDs. Salida: NDJSON canónico y manifiesto para la carga RPC autorizada.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

VERSION = "settings-etl-v1"


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def remove_provider_keys(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: remove_provider_keys(item) for key, item in value.items() if key != "apiKey"}
    if isinstance(value, list):
        return [remove_provider_keys(item) for item in value]
    return value


def transform(source: list[dict[str, Any]], identity_map: dict[str, str]) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    records: list[dict[str, Any]] = []
    rejected: list[dict[str, str]] = []
    for document in source:
        path = document.get("path")
        data = document.get("data")
        if not isinstance(path, str) or not path.startswith("settings/user_") or not isinstance(data, dict):
            rejected.append({"path": str(path), "reason": "invalid-settings-document"})
            continue
        firebase_uid = path.removeprefix("settings/user_")
        supabase_id = identity_map.get(firebase_uid)
        if not supabase_id:
            rejected.append({"path": path, "reason": "missing-identity-map"})
            continue
        settings = remove_provider_keys(data)
        records.append({"id": supabase_id, "source_path": path, "settings": settings})
    records.sort(key=lambda record: record["id"])
    return records, rejected


def checksum(settings: dict[str, Any]) -> str:
    return hashlib.sha256(canonical_json(settings).encode("utf-8")).hexdigest()


def build_manifest(records: list[dict[str, Any]], source_label: str) -> dict[str, Any]:
    return {
        "version": VERSION,
        "source": source_label,
        "record_count": len(records),
        "records": [
            {"id": record["id"], "source_path": record["source_path"], "checksum": checksum(record["settings"])}
            for record in records
        ],
    }


def reconcile(records: list[dict[str, Any]], manifest: dict[str, Any]) -> list[str]:
    expected = {entry["id"]: entry for entry in manifest.get("records", []) if isinstance(entry, dict) and "id" in entry}
    actual = {record["id"]: record for record in records}
    findings: list[str] = []
    for identifier in sorted(set(expected) - set(actual)):
        findings.append(f"missing-record:{identifier}")
    for identifier in sorted(set(actual) - set(expected)):
        findings.append(f"unexpected-record:{identifier}")
    for identifier in sorted(set(actual) & set(expected)):
        if checksum(actual[identifier]["settings"]) != expected[identifier].get("checksum"):
            findings.append(f"checksum-mismatch:{identifier}")
    return findings


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True, help="JSON de documentos Firestore exportados")
    parser.add_argument("--identity-map", type=Path, required=True, help="JSON {firebaseUid: supabaseUuid}")
    parser.add_argument("--out", type=Path, required=True, help="NDJSON de carga, sin secretos")
    parser.add_argument("--manifest", type=Path, required=True, help="Manifiesto con checksums")
    arguments = parser.parse_args()

    source = load_json(arguments.source)
    identity_map = load_json(arguments.identity_map)
    if not isinstance(source, list) or not isinstance(identity_map, dict):
        raise SystemExit("La fuente debe ser lista y el mapa de identidad debe ser objeto JSON.")
    records, rejected = transform(source, identity_map)
    if rejected:
        raise SystemExit("ETL rechazada: " + canonical_json({"rejected": rejected}))
    manifest = build_manifest(records, arguments.source.name)
    arguments.out.parent.mkdir(parents=True, exist_ok=True)
    arguments.manifest.parent.mkdir(parents=True, exist_ok=True)
    arguments.out.write_text("".join(canonical_json(record) + "\n" for record in records), encoding="utf-8")
    arguments.manifest.write_text(canonical_json(manifest) + "\n", encoding="utf-8")
    print(canonical_json({"version": VERSION, "records": len(records), "manifest": str(arguments.manifest)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
