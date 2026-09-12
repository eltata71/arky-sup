#!/usr/bin/env python3
"""F5.5: ETL reproducible del agregado Firestore ``projects/{id}``.

No contacta Firebase ni Supabase. Reúne raíz y ``projects/{id}/artifacts/{id}``,
usa artefactos inline sólo cuando no existe subcolección y exige un mapa explícito
Firebase UID → UUID Supabase. La carga posterior debe usar la RPC compuesta.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
import uuid
from pathlib import Path
from typing import Any

VERSION = "projects-artifacts-etl-v1"


ARTIFACT_TYPES = frozenset({
    "markdown", "yaml", "hybrid-text-diagram", "mermaid-c4-context",
    "mermaid-c4-container", "mermaid-c4-component", "mermaid-c4-deployment",
    "mermaid-erd", "mermaid-sequence", "mermaid-graph", "mermaid-state",
    "mermaid-gantt", "react-flow-graph", "presentation-executive",
    "presentation-technical", "presentation-overview", "presentation-summary",
    "sdd-brd", "sdd-use-case", "sdd-user-story", "sdd-domain-model",
    "sdd-event-storming", "sdd-glossary", "sdd-nfr", "sdd-bdd", "sdd-traceability",
})
ARCHITECTURAL_VIEWS = frozenset({
    "Vista de Contexto y Negocio", "Vista Lógica y de Diseño", "Vista de Datos",
    "Vista de Proceso e Interacción", "Vista Física y de Despliegue",
    "Vista de Gestión y Soporte", "Vista de Calidad y Validación", "Vista SDD",
})


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def provider_key(value: Any) -> bool:
    if isinstance(value, dict):
        return "apiKey" in value or any(provider_key(item) for item in value.values())
    return isinstance(value, list) and any(provider_key(item) for item in value)


def root_path(path: str) -> str | None:
    parts = path.split("/")
    return parts[1] if len(parts) == 2 and parts[0] == "projects" and parts[1].strip() else None


def child_path(path: str) -> tuple[str, str] | None:
    parts = path.split("/")
    if len(parts) == 4 and parts[0] == "projects" and parts[1].strip() and parts[2] == "artifacts" and parts[3].strip():
        return parts[1], parts[3]
    return None


def valid_artifact(value: Any, artifact_id: str) -> bool:
    if not isinstance(value, dict) or value.get("id") != artifact_id:
        return False
    required_text = ("name", "type", "versionGroupId", "createdAt", "phase", "architecturalView", "content", "objective")
    concepts = value.get("keyConcepts")
    return all(isinstance(value.get(key), str) and value[key].strip() for key in required_text) \
        and value.get("type") in ARTIFACT_TYPES \
        and isinstance(value.get("version"), (int, float)) and not isinstance(value.get("version"), bool) \
        and math.isfinite(value["version"]) and value["version"] >= 1 \
        and value.get("architecturalView") in ARCHITECTURAL_VIEWS \
        and value.get("representation") in {"diagram", "document", "hybrid"} \
        and isinstance(concepts, list) and all(
            isinstance(concept, dict)
            and isinstance(concept.get("term"), str) and concept["term"].strip()
            and isinstance(concept.get("definition"), str) and concept["definition"].strip()
            for concept in concepts
        )


def transform(source: list[dict[str, Any]], identity_map: dict[str, str]) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    roots: dict[str, tuple[str, dict[str, Any]]] = {}
    children: dict[str, list[tuple[str, dict[str, Any]]]] = {}
    rejected: list[dict[str, str]] = []
    for document in source:
        path, data = document.get("path"), document.get("data")
        if not isinstance(path, str) or not isinstance(data, dict):
            rejected.append({"path": str(path), "reason": "invalid-project-document"}); continue
        root = root_path(path)
        child = child_path(path)
        if root:
            if root in roots: rejected.append({"path": path, "reason": "duplicate-project-root"})
            else: roots[root] = (path, data)
        elif child:
            children.setdefault(child[0], []).append((child[1], data))
        elif path.startswith("projects/"):
            rejected.append({"path": path, "reason": "invalid-project-path"})
    records: list[dict[str, Any]] = []
    for project_id, (path, data) in roots.items():
        if data.get("id") not in (None, project_id): rejected.append({"path": path, "reason": "id-path-mismatch"}); continue
        owner = data.get("userId"); destination = identity_map.get(owner) if isinstance(owner, str) else None
        if not isinstance(destination, str): rejected.append({"path": path, "reason": "missing-identity-map"}); continue
        try: uuid.UUID(destination)
        except ValueError: rejected.append({"path": path, "reason": "invalid-destination-owner"}); continue
        if not isinstance(data.get("name"), str) or not data["name"].strip(): rejected.append({"path": path, "reason": "missing-project-name"}); continue
        initiatives = data.get("initiativeIds")
        if not isinstance(initiatives, list) or not initiatives or not all(isinstance(item, str) and item.strip() for item in initiatives):
            rejected.append({"path": path, "reason": "missing-initiative-links"}); continue
        candidate_children = children.get(project_id)
        raw_artifacts = [item for _, item in candidate_children] if candidate_children is not None else data.get("artifacts", [])
        expected_ids = [item_id for item_id, _ in candidate_children] if candidate_children is not None else [item.get("id") if isinstance(item, dict) else None for item in raw_artifacts]
        if not isinstance(raw_artifacts, list) or any(not isinstance(item_id, str) or not valid_artifact(item, item_id) or provider_key(item) for item, item_id in zip(raw_artifacts, expected_ids)):
            rejected.append({"path": path, "reason": "invalid-artifact"}); continue
        artifacts = copy.deepcopy(raw_artifacts)
        if len({item["id"] for item in artifacts}) != len(artifacts): rejected.append({"path": path, "reason": "duplicate-artifact-id"}); continue
        if provider_key(data): rejected.append({"path": path, "reason": "provider-key-present"}); continue
        project = copy.deepcopy(data); project["id"] = project_id; project["userId"] = destination; project.pop("artifacts", None)
        records.append({"id": project_id, "owner_id": destination, "source_path": path, "artifact_source": "subcollection" if candidate_children is not None else "inline-fallback", "project": project, "artifacts": artifacts})
    for project_id in sorted(set(children) - set(roots)):
        rejected.append({"path": f"projects/{project_id}/artifacts", "reason": "orphan-artifact-subcollection"})
    records.sort(key=lambda record: record["id"])
    return records, rejected


def checksum(record: dict[str, Any]) -> str:
    return hashlib.sha256(canonical_json({"project": record["project"], "artifacts": record["artifacts"]}).encode()).hexdigest()


def build_manifest(records: list[dict[str, Any]], source_label: str) -> dict[str, Any]:
    return {"version": VERSION, "source": source_label, "record_count": len(records), "records": [
        {"id": r["id"], "owner_id": r["owner_id"], "source_path": r["source_path"], "artifact_source": r["artifact_source"], "checksum": checksum(r)} for r in records
    ]}


def reconcile(records: list[dict[str, Any]], manifest: dict[str, Any]) -> list[str]:
    expected = {item["id"]: item for item in manifest.get("records", []) if isinstance(item, dict) and isinstance(item.get("id"), str)}
    actual = {item["id"]: item for item in records}; findings: list[str] = []
    for item in sorted(set(expected) - set(actual)): findings.append(f"missing-record:{item}")
    for item in sorted(set(actual) - set(expected)): findings.append(f"unexpected-record:{item}")
    for item in sorted(set(actual) & set(expected)):
        if expected[item].get("owner_id") != actual[item].get("owner_id"): findings.append(f"owner-mismatch:{item}")
        if expected[item].get("checksum") != checksum(actual[item]): findings.append(f"checksum-mismatch:{item}")
    return findings


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True); parser.add_argument("--identity-map", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True); parser.add_argument("--manifest", type=Path, required=True)
    args = parser.parse_args(); source = json.loads(args.source.read_text(encoding="utf-8")); identities = json.loads(args.identity_map.read_text(encoding="utf-8"))
    if not isinstance(source, list) or not isinstance(identities, dict): raise SystemExit("La fuente debe ser lista y el mapa de identidad debe ser objeto JSON.")
    records, rejected = transform(source, identities)
    if rejected: raise SystemExit("ETL rechazada: " + canonical_json({"rejected": rejected}))
    args.out.parent.mkdir(parents=True, exist_ok=True); args.manifest.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text("".join(canonical_json(r) + "\n" for r in records), encoding="utf-8")
    args.manifest.write_text(canonical_json(build_manifest(records, args.source.name)) + "\n", encoding="utf-8")
    print(canonical_json({"version": VERSION, "records": len(records), "manifest": str(args.manifest)})); return 0

if __name__ == "__main__": raise SystemExit(main())
