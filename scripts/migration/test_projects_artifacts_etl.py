import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('projects_artifacts_etl', ROOT / 'scripts' / 'migration' / 'projects_artifacts_etl.py')
assert SPEC and SPEC.loader
etl = importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(etl)
OWNER = '00000000-0000-4000-8000-000000000001'


def project(owner='firebase-owner'):
    return {'id': 'proj_legacy_001', 'name': 'Atención digital', 'userId': owner, 'initiativeIds': ['init_legacy_001'], 'artifacts': [artifact()]}


def artifact():
    return {'id': 'art_legacy_001', 'name': 'Diagrama', 'type': 'mermaid-graph', 'versionGroupId': 'vg_001', 'version': 1, 'createdAt': '2026-09-12T00:00:00.000Z', 'phase': 'design', 'architecturalView': 'Vista Lógica y de Diseño', 'content': 'graph TD; A-->B', 'objective': 'Explicar la relación', 'keyConcepts': [{'term': 'A', 'definition': 'Origen'}], 'representation': 'diagram'}


def knowledge_graph(project_id='proj_legacy_001'):
    return {'projectId': project_id, 'version': 1, 'buildId': 'build_001', 'lastBuiltAt': '2026-09-12T00:00:00.000Z', 'entities': [], 'relations': [], 'quality': {'score': 80}, 'statistics': {'entityCount': 0}}


class ProjectsArtifactsEtlTest(unittest.TestCase):
    def test_preserves_text_ids_and_uses_inline_artifacts_only_as_fallback(self):
        records, rejected = etl.transform([{'path': 'projects/proj_legacy_001', 'data': project()}], {'firebase-owner': OWNER})
        self.assertEqual(rejected, []); self.assertEqual(records[0]['id'], 'proj_legacy_001')
        self.assertEqual(records[0]['owner_id'], OWNER); self.assertEqual(records[0]['artifact_source'], 'inline-fallback')
        self.assertEqual(records[0]['artifacts'][0]['id'], 'art_legacy_001'); self.assertNotIn('artifacts', records[0]['project'])

    def test_prefers_subcollection_over_legacy_inline_and_rejects_orphans(self):
        child = {**artifact(), 'id': 'art_child_001', 'name': 'Subcolección'}
        records, rejected = etl.transform([
            {'path': 'projects/proj_legacy_001', 'data': project()},
            {'path': 'projects/proj_legacy_001/artifacts/art_child_001', 'data': child},
            {'path': 'projects/proj_orphan/artifacts/art_1', 'data': artifact()},
        ], {'firebase-owner': OWNER})
        self.assertEqual(records[0]['artifact_source'], 'subcollection'); self.assertEqual(records[0]['artifacts'], [child])
        self.assertEqual(rejected, [{'path': 'projects/proj_orphan/artifacts', 'reason': 'orphan-artifact-subcollection'}])

    def test_rejects_missing_identity_mapping_and_manifest_detects_change(self):
        missing, reasons = etl.transform([{'path': 'projects/proj_legacy_001', 'data': project()}], {})
        self.assertEqual(missing, []); self.assertEqual(reasons, [{'path': 'projects/proj_legacy_001', 'reason': 'missing-identity-map'}])
        records, _ = etl.transform([{'path': 'projects/proj_legacy_001', 'data': project()}], {'firebase-owner': OWNER})
        manifest = etl.build_manifest(records, 'export.json'); self.assertEqual(etl.reconcile(records, manifest), [])
        changed = [{**records[0], 'artifacts': [{**records[0]['artifacts'][0], 'name': 'Alterado'}]}]
        self.assertEqual(etl.reconcile(changed, manifest), ['checksum-mismatch:proj_legacy_001'])

    def test_rejects_child_without_embedded_id_instead_of_crashing(self):
        child = artifact(); child.pop('id')
        records, rejected = etl.transform([
            {'path': 'projects/proj_legacy_001', 'data': project()},
            {'path': 'projects/proj_legacy_001/artifacts/art_child_001', 'data': child},
        ], {'firebase-owner': OWNER})
        self.assertEqual(records, [])
        self.assertEqual(rejected, [{'path': 'projects/proj_legacy_001', 'reason': 'invalid-artifact'}])

    def test_rejects_artifact_that_omits_a_required_domain_field(self):
        invalid = artifact(); invalid.pop('representation')
        records, rejected = etl.transform([
            {'path': 'projects/proj_legacy_001', 'data': {**project(), 'artifacts': [invalid]}},
        ], {'firebase-owner': OWNER})
        self.assertEqual(records, [])
        self.assertEqual(rejected, [{'path': 'projects/proj_legacy_001', 'reason': 'invalid-artifact'}])

    def test_rejects_unknown_type_view_and_non_positive_version(self):
        for field, value in (
            ('type', 'unknown-artifact'),
            ('architecturalView', 'logical'),
            ('version', 0),
        ):
            with self.subTest(field=field):
                invalid = artifact(); invalid[field] = value
                records, rejected = etl.transform([
                    {'path': 'projects/proj_legacy_001', 'data': {**project(), 'artifacts': [invalid]}},
                ], {'firebase-owner': OWNER})
                self.assertEqual(records, [])
                self.assertEqual(rejected, [{'path': 'projects/proj_legacy_001', 'reason': 'invalid-artifact'}])

    def test_rejects_non_finite_versions(self):
        for value in (float('inf'), float('-inf'), float('nan')):
            with self.subTest(version=value):
                invalid = artifact(); invalid['version'] = value
                records, rejected = etl.transform([
                    {'path': 'projects/proj_legacy_001', 'data': {**project(), 'artifacts': [invalid]}},
                ], {'firebase-owner': OWNER})
                self.assertEqual(records, [])
                self.assertEqual(rejected, [{'path': 'projects/proj_legacy_001', 'reason': 'invalid-artifact'}])

    def test_separates_inline_knowledge_graph_from_project_document(self):
        records, rejected = etl.transform([
            {'path': 'projects/proj_legacy_001', 'data': {**project(), 'architectureKnowledgeGraph': knowledge_graph()}},
        ], {'firebase-owner': OWNER})
        self.assertEqual(rejected, [])
        self.assertNotIn('architectureKnowledgeGraph', records[0]['project'])
        self.assertEqual(records[0]['knowledge_graph']['buildId'], 'build_001')

    def test_rejects_inline_graph_of_another_project(self):
        records, rejected = etl.transform([
            {'path': 'projects/proj_legacy_001', 'data': {**project(), 'architectureKnowledgeGraph': knowledge_graph('proj_other')}},
        ], {'firebase-owner': OWNER})
        self.assertEqual(records, [])
        self.assertEqual(rejected, [{'path': 'projects/proj_legacy_001', 'reason': 'invalid-knowledge-graph'}])


if __name__ == '__main__': unittest.main()
