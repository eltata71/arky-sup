#!/usr/bin/env python3
"""F5.3/F5.4: ETL reproducible de ``businessInitiatives/{id}``.

No accede a Firebase ni Supabase. Recibe una exportación JSON y un mapa explícito
Firebase UID → UUID Supabase; conserva el id textual y el agregado completo,
pero reemplaza ``initiative.userId`` por su propietario destino. La carga se
realiza después con una identidad/proceso autorizado y la RPC del agregado.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import re
import uuid
from pathlib import Path
from typing import Any

VERSION = "business-initiatives-etl-v1"
CODE = re.compile(r"^NEG-[0-9]{4}-[0-9]{3}$")


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def has_provider_key(value: Any) -> bool:
    if isinstance(value, dict):
        return "apiKey" in value or any(has_provider_key(item) for item in value.values())
    if isinstance(value, list):
        return any(has_provider_key(item) for item in value)
    return False


def source_id_from_path(path: str) -> str | None:
    parts = path.split("/")
    if len(parts) != 2 or parts[0] != "businessInitiatives" or not parts[1].strip():
        return None
    return parts[1]


def transform(source: list[dict[str, Any]], identity_map: dict[str, str]) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    records: list[dict[str, Any]] = []
    rejected: list[dict[str, str]] = []
    known_ids: set[str] = set()
    known_codes: set[str] = set()

    for document in source:
        path = document.get("path")
        data = document.get("data")
        if not isinstance(path, str) or not isinstance(data, dict):
            rejected.append({"path": str(path), "reason": "invalid-initiative-document"})
            continue
        initiative_id = source_id_from_path(path)
        if initiative_id is None:
            rejected.append({"path": path, "reason": "invalid-initiative-path"})
            continue
        stored_id = data.get("id")
        if stored_id is not None and stored_id != initiative_id:
            rejected.append({"path": path, "reason": "id-path-mismatch"})
            continue
        code = data.get("code")
        if not isinstance(code, str) or not CODE.fullmatch(code):
            rejected.append({"path": path, "reason": "invalid-initiative-code"})
            continue
        if not isinstance(data.get("title"), str) or not data["title"].strip() or not isinstance(data.get("need"), str) or not data["need"].strip():
            rejected.append({"path": path, "reason": "missing-title-or-need"})
            continue
        firebase_owner = data.get("userId")
        if not isinstance(firebase_owner, str) or not firebase_owner:
            rejected.append({"path": path, "reason": "missing-source-owner"})
            continue
        owner_id = identity_map.get(firebase_owner)
        if not isinstance(owner_id, str):
            rejected.append({"path": path, "reason": "missing-identity-map"})
            continue
        try:
            uuid.UUID(owner_id)
        except ValueError:
            rejected.append({"path": path, "reason": "invalid-destination-owner"})
            continue
        if has_provider_key(data):
            rejected.append({"path": path, "reason": "provider-key-present"})
            continue
        if initiative_id in known_ids:
            rejected.append({"path": path, "reason": "duplicate-initiative-id"})
            continue
        if code in known_codes:
            rejected.append({"path": path, "reason": "duplicate-initiative-code"})
            continue

        initiative = copy.deepcopy(data)
        initiative["id"] = initiative_id
        initiative["userId"] = owner_id
        records.append({
            "id": initiative_id,
            "owner_id": owner_id,
            "source_path": path,
            "initiative": initiative,
        })
        known_ids.add(initiative_id)
        known_codes.add(code)

    records.sort(key=lambda record: record["id"])
    return records, rejected


def checksum(initiative: dict[str, Any]) -> str:
    return hashlib.sha256(canonical_json(initiative).encode("utf-8")).hexdigest()


def build_manifest(records: list[dict[str, Any]], source_label: str) -> dict[str, Any]:
    return {
        "version": VERSION,
        "source": source_label,
        "record_count": len(records),
        "records": [
            {
                "id": record["id"],
                "owner_id": record["owner_id"],
                "source_path": record["source_path"],
                "checksum": checksum(record["initiative"]),
            }
            for record in records
        ],
    }


def reconcile(records: list[dict[str, Any]], manifest: dict[str, Any]) -> list[str]:
    expected = {entry["id"]: entry for entry in manifest.get("records", []) if isinstance(entry, dict) and isinstance(entry.get("id"), str)}
    actual = {record["id"]: record for record in records}
    findings: list[str] = []
    for identifier in sorted(set(expected) - set(actual)):
        findings.append(f"missing-record:{identifier}")
    for identifier in sorted(set(actual) - set(expected)):
        findings.append(f"unexpected-record:{identifier}")
    for identifier in sorted(set(actual) & set(expected)):
        entry = expected[identifier]
        record = actual[identifier]
        if entry.get("owner_id") != record.get("owner_id"):
            findings.append(f"owner-mismatch:{identifier}")
        if entry.get("checksum") != checksum(record["initiative"]):
            findings.append(f"checksum-mismatch:{identifier}")
    return findings


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True, help="JSON de documentos Firestore exportados")
    parser.add_argument("--identity-map", type=Path, required=True, help="JSON {firebaseUid: supabaseUuid}")
    parser.add_argument("--out", type=Path, required=True, help="NDJSON de carga por RPC autorizada")
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
