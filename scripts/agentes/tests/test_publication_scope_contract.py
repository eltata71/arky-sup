"""Alcance escrito de publicación: no acredita permisos operativos."""
import unittest
from pathlib import Path

class PublicationContractTests(unittest.TestCase):
    def test_remote_publication_exceptions_are_closed(self):
        text = (Path(__file__).resolve().parents[1] / 'skills/latam-factory-orchestration/SKILL.md').read_text()
        step = text.split('9. Enviar implementación', 1)[1].split('10. Elena', 1)[0]
        for token in ['merge/publicación remota', 'no forzado', 'asignada al propio implementador',
                      'no existe otra reserva', 'Hecha', 'Descartada', 'force-push', 'tags/releases',
                      'borrado de ramas', 'edición de PR ajenos', 'autorización específica de su caso',
                      'local-only', 'no prohíbe el push', 'rama ajena', 'renovar la revisión',
                      'despliegue de producción', 'no declara esos archivos externos actualizados']:
            self.assertIn(token, step)
        self.assertNotIn('el disparador de tarjetas de corrección', step)

if __name__ == '__main__':
    unittest.main()
