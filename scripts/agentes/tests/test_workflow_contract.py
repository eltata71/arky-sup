"""Contrato documental de admisión; no demuestra enforcement del motor."""
from pathlib import Path
import re
import unittest

CANONICAL = Path(__file__).resolve().parents[1] / 'skills/latam-factory-orchestration/SKILL.md'


class WorkflowContractTests(unittest.TestCase):
    def test_create_example_uses_declared_300_second_budget_and_board(self):
        # El ejemplo canónico de creación es el envoltorio
        # crear-tarea-hija.sh, no `hermes kanban create` a mano (regla "el
        # reloj no se arregla con prosa"); el bloque de ejemplo se extiende
        # en dos líneas físicas por la continuación con `\`.
        text = CANONICAL.read_text()
        match = re.search(
            r"```\n(\s*bash scripts/agentes/crear-tarea-hija\.sh.*?)\n\s*```",
            text, re.DOTALL,
        )
        self.assertIsNotNone(match, "no se encontró el bloque de ejemplo de crear-tarea-hija.sh")
        example = match.group(1)
        self.assertIn('--board <tablero>', example)
        self.assertIn('--max-runtime 300', example)
        self.assertNotIn('--max-runtime 1800', text)

    def test_excluded_self_review_guard_is_not_claimed_as_delivered(self):
        document = (CANONICAL.parents[4] / 'docs/requerimiento-original-historias-usuario.txt').read_text()
        self.assertNotIn('Implementación de esta regla: `scripts/agentes/vigilar-autorrevision.py`', document)
        self.assertIn('EXCLUIDA de este paquete', document)
        self.assertIn('no acredita cumplimiento efectivo de RG-09', document)

    def test_short_route_contains_quality_and_both_reviews(self):
        text = CANONICAL.read_text()
        self.assertRegex(text, r'16a\+16b, 17 \(Calidad, Paola')
        # Calibración 2026-11-01: la cifra fija ("como mínimo complejidad 4 y
        # ruta completa") se reescribió como un suelo ("suelo complejidad 4,
        # ruta completa") para los hallazgos Critical/High -- la regla es la
        # misma, la palabra que la expresa cambió a propósito.
        self.assertIn('suelo complejidad 4, ruta completa', text)

    def test_does_not_claim_unsupported_runtime_repair(self):
        text = CANONICAL.read_text()
        self.assertNotIn('se corrige ahí mismo antes', text)

        # El veto sobre despachar una tarjeta sin reloj vive específicamente
        # en el párrafo de archivar+recrear -- comprobarlo en el documento
        # entero (como hacía la versión anterior de esta prueba) deja pasar
        # una regresión real: "no se despacha" aparece también en la regla
        # de autoejecución de José, un asunto distinto, así que esa
        # comprobación pasaba aunque el veto de ESTE párrafo desapareciera
        # (hallazgo de la revisión independiente, 2026-11-02). Acotar al
        # párrafo es lo que lo vuelve a hacer una prueba real.
        match = re.search(
            r"Si una tarjeta ya existe sin límite.*?(?=\*\*No usar `hermes kanban decompose`\*\*)",
            text, re.DOTALL,
        )
        self.assertIsNotNone(match, "no se encontró el párrafo de archivar y recrear")
        archive_and_recreate_paragraph = match.group(0)
        self.assertIn('no se despacha', archive_and_recreate_paragraph)
        # Ya existe una vía auditada (archivar+recrear): el documento no debe
        # volver a afirmar que no hay ninguna, eso sería falso hoy.
        self.assertNotIn('no tiene una vía soportada', text)


if __name__ == '__main__':
    unittest.main()
