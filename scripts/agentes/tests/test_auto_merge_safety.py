"""Regresiones H1–H5/M1/M2. E/S local real; GitHub sustituido, nunca merge real.

python3 -B scripts/agentes/tests/test_auto_merge_safety.py
"""
import copy
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import auto_merge_watch as amw

HEAD = "a" * 40
BASE = "b" * 40
MERGED = "c" * 40
IDENTITY = {"repo": amw.REPO, "pr": 324, "sha": HEAD, "review_type": "independent"}


def checks(sha=HEAD, main=False):
    names = amw.REQUIRED_CHECKS | {amw.DEPLOY_CHECK}
    return [{"name": n, "app": {"slug": "github-actions"}, "head_sha": sha,
             "status": "completed", "conclusion": "skipped" if n == amw.DEPLOY_CHECK and not main else "success"}
            for n in sorted(names)]


class SafetyTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        for name, leaf in {"LOG_DIR": ".", "JSONL_LOG": "merges.jsonl", "DECISIONS_LOG": "decisions.log",
                           "KILL_SWITCH": "DISABLED", "WRITE_ENABLED_MARKER": "ENABLED",
                           "PENDING_BREAKER_CHECK": "pending.json", "EXECUTION_LOCK": "merge.lock",
                           "BOARD_DB": "board.db"}.items():
            p = patch.object(amw, name, self.root / leaf)
            p.start()
            self.addCleanup(p.stop)
        # Guard rail: ninguna prueba puede accidentalmente invocar gh/hermes reales.
        p = patch.object(amw.subprocess, "run", side_effect=AssertionError("red no sustituida"))
        self.shell = p.start()
        self.addCleanup(p.stop)
        amw.WRITE_ENABLED_MARKER.write_text("solo fixture\n")
        amw.DECISIONS_LOG.write_text('DECISION 2026-11-12T00:00:00+01:00 jose AUTORIZA clase=A1 motivo="fixture"\n')
        self.decision = amw.Decision(324, "docs: typo", "FUSIONAR", "A1", "fixture",
                                    amw.Verdict("APROBADO", HEAD, "alexis", "t_review"), HEAD)

    def merge_ports(self):
        for name, value in {"evaluate_pr": self.decision, "gh_main_head": BASE,
                            "check_current_approval": amw.ApprovalCheck(True, "fixture", self.decision.verdict),
                            "gh_commit_ci_status": "green", "gh_pr_view": {
                                "state": "MERGED", "headRefOid": HEAD, "mergeCommit": {"oid": MERGED}},
                            "gh_pr_merge": None, "gh_pr_comment": None, "kanban_comment": None}.items():
            p = patch.object(amw, name, return_value=value)
            mock = p.start()
            self.addCleanup(p.stop)
            setattr(self, name, mock)

    def ci(self, runs, statuses=None, main=False):
        status = [{"state": "success", "context": "Vercel"}] if statuses is None else statuses
        # Dos páginas en ambas APIs, incluido un gate en la última.
        with patch.object(amw, "gh_api", side_effect=[
                [{"statuses": status[:1]}, {"statuses": status[1:]}],
                [{"check_runs": runs[:2]}, {"check_runs": runs[2:]}]]) as api:
            result = amw.gh_commit_ci_status(HEAD, main=main)
            self.assertTrue(all(c.kwargs["paginate"] for c in api.call_args_list))
            return result

    def test_complete_paginated_ci(self):
        self.assertEqual(self.ci(checks()), "green")
        self.assertEqual(self.ci(checks(main=True), main=True), "green")
        self.assertEqual(self.ci(checks(), main=True), "pending")

    def test_main_contract_matches_push_workflow_without_pr_only_checks(self):
        # Foto fiel de ci.yml en push: e2e.yml/security.yml sólo corren en PR.
        names = {"Static gates (typecheck + lint + budgets + build)",
                 "Merged coverage (thresholds)", "Deploy to Vercel (production)",
                 *(f"Vitest (shard {n}/4)" for n in range(1, 5))}
        runs = [{"name": n, "app": {"slug": "github-actions"}, "head_sha": HEAD,
                 "status": "completed", "conclusion": "success"} for n in sorted(names)]
        self.assertEqual(self.ci(runs, statuses=[], main=True), "green")
        self.assertEqual(self.ci(runs, statuses=[]), "pending")
        for index in range(len(runs)):
            self.assertEqual(self.ci(runs[:index] + runs[index + 1:], statuses=[], main=True), "pending")
        bad = copy.deepcopy(runs)
        bad[0]["conclusion"] = "failure"
        self.assertEqual(self.ci(bad, statuses=[], main=True), "red")

    def test_vercel_success_does_not_hide_actions_pending_or_red(self):
        for state, conclusion, expected in [("in_progress", None, "pending"),
                                             ("completed", "failure", "red"),
                                             ("completed", "neutral", "pending"),
                                             ("completed", "mystery", "pending"),
                                             ("completed", "cancelled", "red")]:
            with self.subTest(state=state, conclusion=conclusion):
                runs = checks()
                runs[-1].update(status=state, conclusion=conclusion)
                self.assertEqual(self.ci(runs), expected)

    def test_ci_absence_status_failure_wrong_app_or_sha(self):
        self.assertEqual(self.ci([]), "pending")
        self.assertEqual(self.ci(checks(), statuses=[]), "pending")
        self.assertEqual(self.ci(checks(), statuses=[{"state": "pending"}]), "pending")
        self.assertEqual(self.ci(checks(), statuses=[{"state": "failure"}]), "red")
        for key, value in [("app", {"slug": "impostor"}), ("head_sha", BASE), ("conclusion", "skipped")]:
            runs = checks()
            runs[-1][key] = value
            self.assertEqual(self.ci(runs), "pending")
        with patch.object(amw, "gh_api", side_effect=subprocess.TimeoutExpired("gh", 60)):
            self.assertEqual(amw.gh_commit_ci_status(HEAD), "pending")
        self.assertEqual(amw.gh_commit_ci_status("abcdefg"), "pending")

    def test_api_wrapper_really_requests_pagination(self):
        self.shell.side_effect = None
        self.shell.return_value = Mock(stdout='{"statuses": [{"state":"success"}]}\n{"statuses": []}\n')
        pages = amw.gh_api("repos/test/status?per_page=100", paginate=True)
        self.assertEqual(pages, [{"statuses": [{"state": "success"}]}, {"statuses": []}])
        self.assertIn("--paginate", self.shell.call_args.args[0])
        self.assertNotIn("--slurp", self.shell.call_args.args[0])

    def test_merge_command_pins_sha(self):
        self.shell.side_effect = None
        amw.gh_pr_merge(324, HEAD)
        cmd = self.shell.call_args.args[0]
        self.assertEqual(cmd[cmd.index("--match-head-commit") + 1], HEAD)
        self.assertIn("--merge", cmd)
        self.assertNotIn("--delete-branch", cmd)

    def test_diff_push_and_unstable_rejected(self):
        meta = {"title": "docs", "body": "", "headRefOid": HEAD, "isDraft": False,
                "baseRefName": "main", "mergeStateStatus": "CLEAN", "mergeable": "MERGEABLE", "state": "OPEN"}
        with patch.object(amw, "check_current_approval", return_value=amw.ApprovalCheck(True, "ok", self.decision.verdict)), \
             patch.object(amw, "gh_pr_diff_names", return_value=["docs/a.md"]), \
             patch.object(amw, "gh_pr_diff_text", return_value="+typo"), \
             patch.object(amw, "gh_commit_ci_status", return_value="green"):
            for updated in [dict(meta, headRefOid=BASE), dict(meta, body="changed")]:
                with patch.object(amw, "gh_pr_view", side_effect=[meta, updated]):
                    self.assertEqual(amw.evaluate_pr(324, enabled_classes={"A1"}).action, "RETENER")
            unstable = dict(meta, mergeStateStatus="UNSTABLE")
            with patch.object(amw, "gh_pr_view", return_value=unstable):
                self.assertEqual(amw.evaluate_pr(324, enabled_classes={"A1"}).action, "RETENER")
            with patch.object(amw, "gh_pr_view", return_value=meta):
                self.assertEqual(amw.evaluate_pr(324, enabled_classes={"A1"}).action, "FUSIONAR")

    def test_no_approval_is_first(self):
        with patch.object(amw, "gh_pr_view", return_value={"headRefOid": HEAD}), \
             patch.object(amw, "find_review_verdict", return_value=None), \
             patch.object(amw, "classify_paths", side_effect=AssertionError("orden")), \
             patch.object(amw, "gh_pr_diff_names", side_effect=AssertionError("orden")), \
             patch.object(amw, "gh_commit_ci_status", side_effect=AssertionError("orden")):
            self.assertEqual(amw.evaluate_pr(324, enabled_classes={"A1"}).risk_class, "SIN_APROBACION")

    def test_main_not_green_or_changed_never_merges(self):
        self.merge_ports()
        for state in ("red", "pending", "unknown"):
            self.gh_commit_ci_status.return_value = state
            with self.assertRaises(RuntimeError):
                amw.perform_merge(self.decision)
            self.assertFalse(amw.PENDING_BREAKER_CHECK.exists())
        self.gh_commit_ci_status.return_value = "green"
        self.gh_main_head.side_effect = [BASE, MERGED]
        with self.assertRaises(RuntimeError):
            amw.perform_merge(self.decision)
        self.gh_pr_merge.assert_not_called()

    def test_guards_revalidated_including_push_marker_ledger(self):
        self.merge_ports()
        self.evaluate_pr.return_value = copy.copy(self.decision)
        self.evaluate_pr.return_value.head_sha = BASE
        with self.assertRaises(RuntimeError):
            amw.perform_merge(self.decision)
        self.evaluate_pr.return_value = self.decision
        amw.WRITE_ENABLED_MARKER.unlink()
        with self.assertRaises(RuntimeError):
            amw.perform_merge(self.decision)
        self.gh_pr_merge.assert_not_called()

    def test_one_merge_per_cycle_and_pending_blocks_next_cycle(self):
        self.merge_ports()
        self.assertEqual(amw.main(["--live", "--pr", "324", "--pr", "325"]), 0)
        self.gh_pr_merge.assert_called_once_with(324, HEAD)
        self.gh_commit_ci_status.return_value = "pending"
        self.assertEqual(amw.main(["--live", "--pr", "325"]), 0)
        self.assertEqual(self.gh_pr_merge.call_count, 1)
        self.assertEqual(json.loads(amw.PENDING_BREAKER_CHECK.read_text())["pr_number"], 324)
        with self.assertRaises(RuntimeError):
            amw.perform_merge(self.decision)
        self.assertEqual(self.gh_pr_merge.call_count, 1)

    def test_two_processes_global_lock_excludes_second_writer(self):
        self.merge_ports()
        with amw.execution_lock():
            pid = os.fork()
            if pid == 0:
                try:
                    amw.perform_merge(self.decision)
                except BlockingIOError:
                    os._exit(0)
                except BaseException:
                    os._exit(2)
                os._exit(3)
            _, status = os.waitpid(pid, 0)
            self.assertEqual(os.waitstatus_to_exitcode(status), 0)
            self.assertFalse(amw.PENDING_BREAKER_CHECK.exists())
        amw.perform_merge(self.decision)  # lock liberado, primer escritor permitido
        self.gh_pr_merge.assert_called_once()

    def test_journal_precedes_remote_and_notifications(self):
        self.merge_ports()
        def merge(pr, sha):
            pending = json.loads(amw.PENDING_BREAKER_CHECK.read_text())
            self.assertEqual(pending["state"], "intent")
            self.assertEqual(pending["head_sha"], sha)
        def view(*args):
            self.assertEqual(json.loads(amw.PENDING_BREAKER_CHECK.read_text())["state"], "merged-unknown")
            return {"state": "MERGED", "headRefOid": HEAD, "mergeCommit": {"oid": MERGED}}
        def notify(*args):
            self.assertEqual(json.loads(amw.PENDING_BREAKER_CHECK.read_text())["merge_commit_sha"], MERGED)
            raise RuntimeError("notificación caída")
        self.gh_pr_merge.side_effect = merge
        self.gh_pr_view.side_effect = view
        self.gh_pr_comment.side_effect = notify
        with self.assertRaisesRegex(RuntimeError, "notificación"):
            amw.perform_merge(self.decision)
        self.assertFalse(amw.is_write_enabled())
        self.gh_commit_ci_status.return_value = "red"
        self.assertIn("FRENO DISPARADO", amw.check_pending_breaker())
        self.assertTrue(amw.KILL_SWITCH.exists())
        self.assertFalse(amw.is_write_enabled())

    def test_restart_at_remote_timeout_or_process_exit_reconciles(self):
        self.merge_ports()
        for error in (subprocess.TimeoutExpired("gh merge", 120), SystemExit(9)):
            with self.subTest(error=error):
                self.gh_pr_merge.side_effect = error
                with self.assertRaises(type(error)):
                    amw.perform_merge(self.decision)
                self.assertEqual(json.loads(amw.PENDING_BREAKER_CHECK.read_text())["state"], "intent")
                self.assertFalse(amw.is_write_enabled())
                self.gh_commit_ci_status.return_value = "pending"
                self.assertIn("pendiente", amw.check_pending_breaker())
                self.assertEqual(json.loads(amw.PENDING_BREAKER_CHECK.read_text())["merge_commit_sha"], MERGED)
                self.gh_commit_ci_status.return_value = "green"
                amw.check_pending_breaker()
                self.assertFalse(amw.PENDING_BREAKER_CHECK.exists())

    def test_unknown_merge_and_failed_query_keep_journal(self):
        self.merge_ports()
        self.gh_pr_view.side_effect = subprocess.CalledProcessError(1, "gh view")
        with self.assertRaises(subprocess.CalledProcessError):
            amw.perform_merge(self.decision)
        self.assertEqual(json.loads(amw.PENDING_BREAKER_CHECK.read_text())["state"], "merged-unknown")
        self.gh_pr_view.side_effect = None
        for state, sha in [("OPEN", ""), ("MERGED", ""), ("MERGED", "badsha")]:
            self.gh_pr_view.return_value = {"state": state, "headRefOid": HEAD, "mergeCommit": {"oid": sha}}
            self.assertIn("incierta", amw.check_pending_breaker())
            self.assertFalse(amw.is_write_enabled())

    def test_actual_process_exit_leaves_intent_for_restart(self):
        self.merge_ports()
        self.gh_pr_merge.side_effect = lambda *args: os._exit(7)
        pid = os.fork()
        if pid == 0:
            amw.perform_merge(self.decision)
            os._exit(8)
        _, status = os.waitpid(pid, 0)
        self.assertEqual(os.waitstatus_to_exitcode(status), 7)
        self.assertEqual(json.loads(amw.PENDING_BREAKER_CHECK.read_text())["state"], "intent")
        self.gh_commit_ci_status.return_value = "pending"
        with amw.execution_lock():
            amw.check_pending_breaker()
        self.assertEqual(json.loads(amw.PENDING_BREAKER_CHECK.read_text())["merge_commit_sha"], MERGED)
        self.assertFalse(amw.is_write_enabled())

    def test_approval_or_ledger_revoked_at_last_guard(self):
        self.merge_ports()
        self.check_current_approval.return_value = amw.ApprovalCheck(False, "cambios pedidos")
        with self.assertRaises(RuntimeError):
            amw.perform_merge(self.decision)
        self.check_current_approval.return_value = amw.ApprovalCheck(True, "ok", self.decision.verdict)
        with patch.object(amw, "enabled_classes_from_ledger", side_effect=[{"A1"}, set()]):
            with self.assertRaises(RuntimeError):
                amw.perform_merge(self.decision)
        self.gh_pr_merge.assert_not_called()

    def test_disk_failure_before_merge_or_after_confirmation(self):
        self.merge_ports()
        original = amw.save_pending
        for fail_at in (1, 2, 3):
            count = 0
            def save(entry):
                nonlocal count
                count += 1
                if count == fail_at:
                    raise OSError("disco lleno")
                original(entry)
            with patch.object(amw, "save_pending", side_effect=save):
                with self.assertRaises(OSError):
                    amw.perform_merge(self.decision)
            if fail_at == 1:
                self.gh_pr_merge.assert_not_called()
            else:
                self.assertTrue(amw.PENDING_BREAKER_CHECK.exists())
                self.assertFalse(amw.is_write_enabled())
                amw.PENDING_BREAKER_CHECK.unlink()  # restablecer fixture, no operación real
            self.gh_pr_merge.reset_mock()

    def test_disabled_write_failure_never_removes_pending(self):
        self.merge_ports()
        amw.save_pending({"pr_number": 324, "merge_commit_sha": MERGED})
        self.gh_commit_ci_status.return_value = "red"
        with patch.object(amw, "atomic_write", side_effect=OSError("disco lleno")):
            with self.assertRaises(OSError):
                amw.check_pending_breaker()
        self.assertTrue(amw.PENDING_BREAKER_CHECK.exists())
        self.assertFalse(amw.is_write_enabled())

    def test_atomic_replace_failure_preserves_existing_record(self):
        amw.save_pending({"state": "intent"})
        with patch.object(amw.os, "replace", side_effect=OSError("replace falló")):
            with self.assertRaises(OSError):
                amw.save_pending({"state": "merged"})
        self.assertEqual(json.loads(amw.PENDING_BREAKER_CHECK.read_text()), {"state": "intent"})
        self.assertEqual(list(self.root.glob(".pending.json.*")), [])

    def test_invalid_decision_dates_actor_reason_and_class(self):
        for date, actor, reason, cls in [("not-a-date", "anyone", " ", "A1"),
                                        ("2026-02-30T00:00:00Z", "jose", "ok", "A1"),
                                        ("2026-11-12T00:00:00", "jose", "ok", "A1"),
                                        ("2026-11-12T00:00:00+01:99", "jose", "ok", "A1"),
                                        ("2026-11-12T00:00:00+24:00", "jose", "ok", "A1"),
                                        ("2026-11-12T00:00:00Z", "anyone", "ok", "A1"),
                                        ("2026-11-12T00:00:00Z", "jose", "   ", "A1"),
                                        ("2026-11-12T00:00:00Z", "jose", "ok", "A2")]:
            with self.subTest(date=date, actor=actor, reason=reason, cls=cls):
                amw.DECISIONS_LOG.write_text(f'DECISION {date} {actor} AUTORIZA clase={cls} motivo="{reason}"\n')
                with self.assertRaises(amw.DecisionLedgerError):
                    amw.enabled_classes_from_ledger(amw.DECISIONS_LOG)

    def board(self):
        con = sqlite3.connect(amw.BOARD_DB)
        con.executescript("CREATE TABLE tasks (id TEXT, title TEXT, body TEXT, status TEXT DEFAULT 'done');"
                          "CREATE TABLE task_runs (task_id TEXT, profile TEXT, metadata TEXT, ended_at INTEGER);"
                          "CREATE TABLE task_comments (task_id TEXT, author TEXT, body TEXT);")
        self.addCleanup(con.close)
        return con

    def add_review(self, con, tid, verdict="approved", *, identity=None, title="arbitrary", actor="alexis", sha=None):
        identity = IDENTITY if identity is None else identity
        con.execute("INSERT INTO tasks (id,title,body) VALUES (?, ?, ?)", (tid, title, "AUTO_MERGE_REVIEW " + json.dumps(identity)))
        if verdict:
            data = dict(identity, verdict=verdict)
            if sha is not None:
                data["sha"] = sha
            con.execute("INSERT INTO task_runs VALUES (?, ?, ?, 100)", (tid, actor, json.dumps(data)))
        con.commit()

    def test_all_review_cards_any_rejection_vetoes_regardless_age(self):
        con = self.board()
        self.add_review(con, "old", "changes_requested")
        self.add_review(con, "new", "approved", actor="rafael")
        self.assertFalse(amw.check_current_approval(324, HEAD).ok)
        # Incluso un APROBADO posterior en LA MISMA tarjeta no borra la crítica.
        con.execute("INSERT INTO task_runs VALUES ('old', 'alexis', ?, 200)", (json.dumps(dict(IDENTITY, verdict="approved")),))
        con.commit()
        self.assertFalse(amw.check_current_approval(324, HEAD).ok)

    def test_reopened_same_sha_and_active_run_veto_historical_approval(self):
        con = self.board()
        self.add_review(con, "approved")
        self.assertTrue(amw.check_current_approval(324, HEAD).ok)
        for status in ("ready", "todo", "running", "triage", "scheduled", "review", "blocked", "archived"):
            with self.subTest(status=status):
                con.execute("UPDATE tasks SET status=?", (status,))
                con.commit()
                self.assertFalse(amw.check_current_approval(324, HEAD).ok)
        con.execute("UPDATE tasks SET status='done'")
        con.execute("INSERT INTO task_runs VALUES ('approved', 'alexis', NULL, NULL)")
        con.commit()
        self.assertFalse(amw.check_current_approval(324, HEAD).ok)

    def test_pending_review_blocks_approved_other_card(self):
        con = self.board()
        self.add_review(con, "approved")
        self.add_review(con, "pending", None)
        self.assertFalse(amw.check_current_approval(324, HEAD).ok)

    def test_explicit_identity_not_pr_prefix_repo_or_type(self):
        con = self.board()
        for i, identity in enumerate([dict(IDENTITY, pr=3240), dict(IDENTITY, repo="other/repo"),
                                      dict(IDENTITY, review_type="implementation"), dict(IDENTITY, sha=BASE)]):
            self.add_review(con, str(i), identity=identity, title="Revisión PR #324: fake")
        self.assertFalse(amw.check_current_approval(324, HEAD).ok)
        self.add_review(con, "valid", title="No depende del título")
        self.assertTrue(amw.check_current_approval(324, HEAD).ok)

    def test_metadata_rejects_legacy_prose_short_sha_and_untrusted_actor(self):
        con = self.board()
        self.add_review(con, "short", sha=HEAD[:7])
        self.assertFalse(amw.check_current_approval(324, HEAD).ok)
        con.execute("DELETE FROM tasks")
        self.add_review(con, "actor", actor="jose")
        self.assertFalse(amw.check_current_approval(324, HEAD).ok)
        self.assertFalse(amw._sha_matches(HEAD[:7], HEAD))
        for data in [dict(IDENTITY, verdict="approved", sha="g" * 40),
                     {"pr": 324, "sha": HEAD, "verdict": "approved"}]:
            self.assertIsNone(amw._verdict_from_metadata(json.dumps(data), "alexis", "x", 324))


if __name__ == "__main__":
    unittest.main(verbosity=2)
