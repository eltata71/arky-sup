"""Regresiones #326: sin red, sin escribir tableros ni crontab real."""
import importlib.util
import json
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
import pr_review_trigger as trigger
import install_pr_review_cron as installer

spec = importlib.util.spec_from_file_location("estado_fabrica", SCRIPTS / "estado-fabrica.py")
watch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(watch)


def pr(number, draft=False):
    return {"number": number, "title": "prueba", "createdAt": "2020-01-01T00:00:00Z", "isDraft": draft}


class ReviewRegressions(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.db = Path(self.tmp.name) / "board.db"
        with sqlite3.connect(self.db) as con:
            con.execute("CREATE TABLE tasks (id TEXT, title TEXT, assignee TEXT, status TEXT)")
            con.execute("INSERT INTO tasks VALUES ('t_326', 'Revisión PR #326: prueba', 'rafael', 'ready')")

    def test_numeric_boundary_both_readers(self):
        for number in (3, 32):
            self.assertIsNone(trigger.existing_review_task(number, db_path=self.db))
        self.assertEqual(trigger.existing_review_task(326, db_path=self.db), "t_326")
        with patch.object(watch.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, json.dumps([pr(3), pr(32), pr(326)]))):
            result = watch.prs_without_review_card(2000000000, {"test": self.db})
        self.assertEqual(result["status"], "checked")
        self.assertEqual([p["number"] for p in result["findings"]], [3, 32])

    def test_ties_always_rafael(self):
        with patch.object(trigger, "reviewer_load", return_value=0):
            for number in (3, 32, 326):
                self.assertEqual(trigger.pick_reviewer(number), "rafael")

    def test_open_prs_excludes_drafts(self):
        with patch.object(trigger, "gh_json", return_value=[pr(3, True), pr(32)]) as gh:
            self.assertEqual(trigger.open_prs(), [pr(32)])
            self.assertIn("isDraft", gh.call_args.args[0][-1])

    def test_watch_excludes_drafts(self):
        with patch.object(watch.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, json.dumps([pr(3, True)]))):
            self.assertEqual(watch.prs_without_review_card(2000000000, {"test": self.db})["findings"], [])

    def test_failure_age_and_recovery(self):
        with patch.object(watch.subprocess, "run", return_value=subprocess.CompletedProcess([], 1, "", "auth failed")):
            first = watch.prs_without_review_card(100, {"test": self.db})
            self.assertEqual(first["status"], "not_checked")
            self.assertTrue(first["reason"])
            self.assertFalse(first["critical"])
            later = watch.prs_without_review_card(14500, {"test": self.db}, previous=first)
            self.assertTrue(later["critical"])
        with patch.object(watch.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, "[]")):
            recovered = watch.prs_without_review_card(14501, {"test": self.db}, previous=later)
        self.assertEqual(recovered["status"], "checked")
        self.assertIsNone(recovered["unchecked_since"])

    def test_invalid_json_timeout_and_unreadable_board(self):
        for response in (subprocess.CompletedProcess([], 0, "invalid"), subprocess.CompletedProcess([], 0, "{}")):
            with patch.object(watch.subprocess, "run", return_value=response):
                self.assertEqual(watch.prs_without_review_card(100, {"test": self.db})["status"], "not_checked")
        with patch.object(watch.subprocess, "run", side_effect=subprocess.TimeoutExpired("gh", 30)):
            self.assertEqual(watch.prs_without_review_card(100, {"test": self.db})["status"], "not_checked")
        with patch.object(watch.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, "[]")):
            self.assertEqual(watch.prs_without_review_card(100, {"missing": self.db.parent / "missing"})["status"], "not_checked")

    def test_main_continues_after_bad_diff_and_bad_creation(self):
        def diff(n):
            if n == 3:
                raise subprocess.CalledProcessError(1, "gh")
            return ["file"]
        def create(p, files, overlaps):
            if p["number"] == 32:
                raise subprocess.CalledProcessError(1, "hermes")
            return trigger.CreatedCard(p["number"], "test_only", "rafael")
        with patch.object(trigger, "open_prs", return_value=[pr(3), pr(32), pr(326)]), patch.object(trigger, "pr_diff_names", side_effect=diff), patch.object(trigger, "existing_review_task", return_value=None), patch.object(trigger, "create_review_card", side_effect=create) as cards:
            self.assertEqual(trigger.main(), 1)
            self.assertEqual([c.args[0]["number"] for c in cards.call_args_list], [32, 326])

    def test_main_success_skips_existing(self):
        with patch.object(trigger, "open_prs", return_value=[pr(326)]), patch.object(trigger, "pr_diff_names", return_value=[]), patch.object(trigger, "existing_review_task", return_value="t_326"), patch.object(trigger, "create_review_card") as create:
            self.assertEqual(trigger.main(), 0)
            create.assert_not_called()

    def test_read_connections_are_read_only(self):
        real_connect = sqlite3.connect
        with patch.object(sqlite3, "connect", wraps=real_connect) as connect:
            trigger.existing_review_task(326, db_path=self.db)
            trigger.reviewer_load("rafael", db_path=self.db)
            with patch.object(watch.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, "[]")):
                watch.prs_without_review_card(100, {"test": self.db})
        self.assertEqual(connect.call_count, 3)
        for call in connect.call_args_list:
            self.assertTrue(call.args[0].endswith("?mode=ro"))
            self.assertTrue(call.kwargs["uri"])

    def test_installer_preserves_cron_and_is_idempotent(self):
        current = ["# otro trabajo\n0 1 * * * /bin/true\n"]
        writes = []
        def run(args, **kwargs):
            if args == ["crontab", "-l"]:
                return subprocess.CompletedProcess(args, 0, current[0])
            self.assertEqual(args, ["crontab", "-"])
            current[0] = kwargs["input"]
            writes.append(current[0])
            return subprocess.CompletedProcess(args, 0, "")
        with patch.object(installer.subprocess, "run", side_effect=run), patch.object(installer.shutil, "which", side_effect=lambda name: "/usr/bin/" + name):
            line = installer.install(SCRIPTS / "pr_review_trigger.py", Path(self.tmp.name))
            installer.install(SCRIPTS / "pr_review_trigger.py", Path(self.tmp.name))
        self.assertEqual(len(writes), 1)
        self.assertIn("/usr/bin/flock -n", line)
        self.assertIn("/usr/bin/python3", line)
        self.assertTrue(current[0].startswith("# otro trabajo\n0 1 * * * /bin/true\n"))
        self.assertEqual(current[0].count(installer.MARKER), 1)

    def test_installer_refuses_unreadable_crontab(self):
        with patch.object(installer.subprocess, "run", return_value=subprocess.CompletedProcess([], 1, "", "permission denied")):
            with self.assertRaises(RuntimeError):
                installer.read_crontab()

    def test_watch_main_persists_age_and_publishes_non_ok(self):
        result_file = Path(self.tmp.name) / "result.json"
        with ExitStack() as stack:
            defaults = {
                "discover_boards": {"test": self.db}, "discover_gateway_units": [],
                "gateways_alive": (True, {}), "watched_boards": set(),
                "unwatched_boards_with_work": [], "blocked_tasks": [],
                "motor_blocks_recent": [], "broken_canonical_skill_links": [],
                "policy_drift_findings": [], "auto_decompose_true_everywhere": [],
                "dispatcher_lock_status": {"critical": False},
                # Comprobación independiente integrada por #328. El fixture de
                # este test controla únicamente el historial de lectura de PR.
                "dirty_foreign_worktrees": {"items": [], "check_failed": None},
            }
            for name, value in defaults.items():
                stack.enter_context(patch.object(watch, name, return_value=value))
            stack.enter_context(patch.object(watch, "RESULT_FILE", result_file))
            stack.enter_context(patch.object(sys, "argv", ["estado-fabrica.py", "--json"]))
            stack.enter_context(patch.object(watch.subprocess, "run", return_value=subprocess.CompletedProcess([], 1, "")))
            with patch.object(watch.time, "time", return_value=100):
                self.assertEqual(watch.main(), 2)
            self.assertEqual(json.loads(result_file.read_text())["verdict"], "NO COMPROBADO")
            with patch.object(watch.time, "time", return_value=14500):
                self.assertEqual(watch.main(), 1)
            saved = json.loads(result_file.read_text())
            self.assertEqual(saved["verdict"], "ATENCION")
            self.assertEqual(saved["pr_review_check"]["unchecked_since"], 100)
            self.assertTrue(saved["pr_review_check"]["critical"])


if __name__ == "__main__":
    unittest.main()
