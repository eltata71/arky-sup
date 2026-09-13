"""Operational thresholds use operator-entered measurements, never fabricated billing."""
import importlib.util
from pathlib import Path
import unittest


class MetricsTests(unittest.TestCase):
    def test_thresholds_and_unknown_measurements(self):
        path = Path(__file__).with_name('metrics.py')
        self.assertTrue(path.exists(), 'metrics implementation missing')
        spec = importlib.util.spec_from_file_location('metrics', path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.assertEqual(module.assess({})['status'], 'unknown')
        self.assertEqual(module.assess({'backup_age_hours': 25})['status'], 'warning')
        self.assertEqual(module.assess({'backup_age_hours': 49})['status'], 'critical')
        result = module.assess({'quota_used_percent': 91, 'secret': 'do-not-echo'})
        self.assertEqual(result['status'], 'critical')
        self.assertNotIn('do-not-echo', str(result))
        for value in (-1, float('nan'), True, '10'):
            with self.assertRaises(ValueError):
                module.assess({'quota_used_percent': value})


if __name__ == '__main__':
    unittest.main()
