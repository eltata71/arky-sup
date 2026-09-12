#!/usr/bin/env python3
"""F5: ETL reproducible del agregado de encargos de Oficina.

No contacta Firebase ni Supabase. Reúne
``projects/{id}/engagements/{id}`` y
``projects/{id}/engagements/{id}/arbDecisions/{id}``, exige un mapa
explícito Firebase UID → UUID Supabase y rechaza estados fuera del ciclo
de vida, secretos y decisiones sin actor mapeado.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import uuid
from pathlib import Path
from typing import Any

VERSION = "office-engagements-etl-v1"

ENGAGEMENT_STATUSES = frozenset({
    "intake", "planning", "awaiting-charter", "in-progress",
    "awaiting-arb", "delivered", "blocked", "cancelled",
})
ARB_VERDICTS = frozenset({"approved", "changes-requested", "rejected"})


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def provider_key(value: Any) -> bool:
    if isinstance(value, dict):
        return "apiKey" in value or any(provider_key(item) for item in value.values())
    return isinstance(value, list) and any(provider_key(item) for item in value)


def engagement_path(path: str) -> str | None:
    parts = path.split("/")
    if len(parts) == 4 and parts[0] == "projects" and parts[1].strip() and parts[2] == "engagements" and parts[3].strip():
        return f"{parts[1]}/{parts[3]}"
    return None


def decision_path(path: str) -> tuple[str, str, str] | None:
    parts = path.split("/")
    if len(parts) == 6 and parts[0] == "projects" and parts[1].strip() \
            and parts[2] == "engagements" and parts[3].strip() \
            and parts[4] == "arbDecisions" and parts[5].strip():
        return parts[1], parts[3], parts[5]
    return None


def valid_engagement(data: dict[str, Any]) -> bool:
    budget = data.get("budget")
    return (
        data.get("id") and data.get("projectId")
        and isinstance(data.get("title"), str) and data["title"].strip()
        and isinstance(data.get("brief"), str) and data["brief"].strip()
        and data.get("status") in ENGAGEMENT_STATUSES
        and isinstance(data.get("charter"), dict)
        and isinstance(data.get("tasks"), list)
        and isinstance(data.get("auditTrail"), list)
        and isinstance(budget, dict)
        and isinstance(budget.get("maxAiCalls"), (int, float)) and budget["maxAiCalls"] >= 0
        and isinstance(budget.get("consumedAiCalls"), (int, float)) and budget["consumedAiCalls"] >= 0
        and not provider_key(data)
    )


def valid_decision(data: dict[str, Any], engagement_id: str, actor_owner: str | None) -> bool:
    return (
        data.get("id") and data.get("engagementId") == engagement_id
        and data.get("verdict") in ARB_VERDICTS
        and (data.get("verdict") not in {"changes-requested", "rejected"} or bool(str(data.get("rationale", "")).strip()))
        and isinstance(data.get("actor"), dict) and data["actor"].get("id") == actor_owner
        and not provider_key(data)
    )


def transform(source: list[dict[str, Any]], identity_map: dict[str, str]) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    engagements: dict[str, tuple[str, str, dict[str, Any]]] = {}
    decisions: dict[tuple[str, str], list[tuple[str, dict[str, Any]]]] = {}
    rejected: list[dict[str, str]] = []
    for document in source:
        path, data = document.get("path"), document.get("data")
        if not isinstance(path, str) or not isinstance(data, dict):
            rejected.append({"path": str(path), "reason": "invalid-document"}); continue
        key = engagement_path(path)
        decision = decision_path(path)
        if key:
            if key in engagements: rejected.append({"path": path, "reason": "duplicate-engagement"})
            else: engagements[key] = (path, data.get("projectId") or key.split("/")[0], data)
        elif decision:
            decisions.setdefault((decision[0], decision[1]), []).append((decision[2], data))
        elif path.startswith("projects/") and "engagements" in path:
            rejected.append({"path": path, "reason": "invalid-engagement-path"})

    records: list[dict[str, Any]] = []
    processed: set[tuple[str, str]] = set()
    for key, (path, project_id, data) in sorted(engagements.items()):
        engagement_id = key.split("/")[1]
        owner = data.get("createdBy", {}).get("id") if isinstance(data.get("createdBy"), dict) else None
        destination = identity_map.get(owner) if isinstance(owner, str) else None
        if not isinstance(destination, str):
            rejected.append({"path": path, "reason": "missing-identity-map"}); continue
        try: uuid.UUID(destination)
        except ValueError:
            rejected.append({"path": path, "reason": "invalid-destination-owner"}); continue
        if not valid_engagement(data) or data.get("id") != engagement_id or data.get("projectId") != project_id:
            rejected.append({"path": path, "reason": "invalid-engagement"}); continue
        engagement = copy.deepcopy(data)
        engagement_decisions: list[dict[str, Any]] = []
        decisions_valid = True
        for decision_id, decision_data in decisions.get((project_id, engagement_id), []):
            actor_owner = decision_data.get("actor", {}).get("id") if isinstance(decision_data.get("actor"), dict) else None
            actor_destination = identity_map.get(actor_owner) if isinstance(actor_owner, str) else None
            if not isinstance(actor_destination, str) or not valid_decision(decision_data, engagement_id, actor_owner):
                rejected.append({"path": f"{path}/arbDecisions/{decision_id}", "reason": "missing-identity-map"})
                decisions_valid = False; continue
            decision = copy.deepcopy(decision_data); decision["actor"]["id"] = actor_destination
            engagement_decisions.append(decision)
        if not decisions_valid:
            processed.add((project_id, engagement_id))
            continue
        engagement.pop("arbDecisions", None)
        records.append({
            "id": engagement_id, "project_id": project_id, "owner_id": destination,
            "source_path": path, "engagement": engagement, "arb_decisions": engagement_decisions,
        })
    records_keys = {(r["project_id"], r["id"]) for r in records} | processed
    for project_id, engagement_id in sorted(set(decisions) - records_keys):
        rejected.append({"path": f"projects/{project_id}/engagements/{engagement_id}/arbDecisions", "reason": "orphan-arb-decisions"})
    return records, rejected


def checksum(record: dict[str, Any]) -> str:
    return hashlib.sha256(canonical_json({"engagement": record["engagement"], "arb_decisions": record["arb_decisions"]}).encode()).hexdigest()


def build_manifest(records: list[dict[str, Any]], source_label: str) -> dict[str, Any]:
    return {"version": VERSION, "source": source_label, "record_count": len(records), "records": [
        {"id": r["id"], "project_id": r["project_id"], "owner_id": r["owner_id"], "source_path": r["source_path"], "checksum": checksum(r)} for r in records
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
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--identity-map", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    args = parser.parse_args()
    source = json.loads(args.source.read_text(encoding="utf-8"))
    identities = json.loads(args.identity_map.read_text(encoding="utf-8"))
    if not isinstance(source, list) or not isinstance(identities, dict):
        raise SystemExit("La fuente debe ser lista y el mapa de identidad debe ser objeto JSON.")
    records, rejected = transform(source, identities)
    if rejected: raise SystemExit("ETL rechazada: " + canonical_json({"rejected": rejected}))
    args.out.parent.mkdir(parents=True, exist_ok=True); args.manifest.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text("".join(canonical_json(r) + "\n" for r in records), encoding="utf-8")
    args.manifest.write_text(canonical_json(build_manifest(records, args.source.name)) + "\n", encoding="utf-8")
    print(canonical_json({"version": VERSION, "records": len(records), "manifest": str(args.manifest)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())