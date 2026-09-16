"""Offline regression tests: python3 -m unittest discover -s scripts/supabase -p 'test_remote_runner.py'."""
import importlib.util
from pathlib import Path
import unittest

RUNNER = Path(__file__).with_name('test-remote.py')


class RemoteRunnerTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(RUNNER.exists(), 'The fail-closed remote runner must exist')
        spec = importlib.util.spec_from_file_location('remote_runner', RUNNER)
        self.runner = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.runner)

    def test_wrapper_captures_each_select_without_changing_quoted_sql(self):
        sql = "-- comment;\nbegin; select no_plan(); do $$begin perform 'x;y'; end$$; select ok(true, 'a;--b'); select * from finish(); rollback;"
        statements = self.runner.contract_statements(sql)
        self.assertEqual(len(statements), 4)
        self.assertIn("'a;--b'", statements[2])
        wrapped = self.runner.wrap_sql(statements, 'testnonce')
        self.assertTrue(wrapped.startswith('begin;'))
        self.assertTrue(wrapped.rstrip().endswith('rollback;'))
        self.assertIn('for result_row in execute statement loop', wrapped)
        self.assertIn('jsonb_build_array(to_jsonb(result_row))', wrapped)
        self.assertIn("lock_timeout = '3s'", wrapped)

    def test_cli_zero_with_failed_assertion_is_not_success(self):
        result = self.runner.check_tap(['ok 1 - passes', 'not ok 2 - deliberate', '# Failed test', '1..2'])
        self.assertFalse(result['passed'])
        self.assertEqual(result['failed_assertions'], [2])
        self.assertEqual(result['assertions'], 2)


if __name__ == '__main__':
    unittest.main()
