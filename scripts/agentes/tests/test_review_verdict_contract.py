"""Coherencia documental, no enforcement ni recepción de perfiles."""
import unittest
from pathlib import Path

class ReviewContractTests(unittest.TestCase):
    def test_complete_identity_all_outcomes_and_native_surface(self):
        text = (Path(__file__).resolve().parents[1] / 'skills/latam-factory-orchestration/SKILL.md').read_text()
        section = text.split('## Cerrar una revisión de PR:', 1)[1].split('## José coordina', 1)[0]
        for token in ['AUTO_MERGE_REVIEW', '"repo":"eltata71/arky-sup"', '"review_type":"independent"',
                      'kanban_complete(metadata={...})', 'BLOQUEADO se codifica', 'changes_requested',
                      'Veredicto: CAMBIOS PEDIDOS sobre <sha40>', 'Rafael y Alexis',
                      'run abierto', 'no `done`', 'Precondición operacional']:
            self.assertIn(token, section)
        self.assertNotIn('el más reciente de la tarjeta', section)

if __name__ == '__main__':
    unittest.main()
