"""Contrato documental de admisión; no demuestra enforcement del motor."""
from pathlib import Path
import re
import unittest

CANONICAL = Path(__file__).resolve().parents[1] / 'skills/latam-factory-orchestration/SKILL.md'


class WorkflowContractTests(unittest.TestCase):
    def test_create_example_uses_declared_300_second_budget_and_board(self):
        text = CANONICAL.read_text()
        example = next(line for line in text.splitlines() if line.strip().startswith('hermes kanban'))
        self.assertIn('--board <tablero>', example)
        self.assertIn('--max-runtime 300', example)
        self.assertNotIn('--max-runtime 1800', text)

    def test_short_route_contains_quality_and_both_reviews(self):
        text = CANONICAL.read_text()
        self.assertRegex(text, r'16a\+16b, 17 \(Calidad, Paola')
        self.assertIn('como mínimo complejidad 4 y ruta completa', text)

    def test_does_not_claim_unsupported_runtime_repair(self):
        text = CANONICAL.read_text()
        self.assertNotIn('se corrige ahí mismo antes', text)
        self.assertIn('no se despacha', text)
        self.assertIn('no tiene una vía soportada', text)


if __name__ == '__main__':
    unittest.main()
