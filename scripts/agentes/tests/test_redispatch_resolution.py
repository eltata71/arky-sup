"""Contrato de resolución nativo, sin abrir ni modificar ninguna DB operacional."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

RUNTIME = Path(os.environ.get('HERMES_RUNTIME_PYTHON', '/home/tata/.local/share/hermes-agent-v0.22.2/.venv/bin/python'))


@unittest.skipUnless(RUNTIME.is_file(), 'Contrato nativo opcional: requiere runtime operacional de Hermes')
class NativeResolutionTests(unittest.TestCase):
    def test_pin_explicit_board_current_and_fencing(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            current = home / 'kanban' / 'current'
            current.parent.mkdir()
            current.write_text('board-a')
            # El resolver nativo ignora un current cuyo tablero no existe.
            for slug in ('board-a', 'board-b'):
                metadata = home / 'kanban' / 'boards' / slug / 'board.json'
                metadata.parent.mkdir(parents=True)
                metadata.write_text(json.dumps({'slug': slug, 'archived': False}))
            a = home / 'kanban' / 'boards' / 'board-a' / 'kanban.db'
            b = home / 'kanban' / 'boards' / 'board-b' / 'kanban.db'
            base = {k: v for k, v in os.environ.items()
                    if not k.startswith(('HERMES_KANBAN_', 'HERMES_DELEGATED_'))}
            base.update(HERMES_HOME=str(home), HERMES_KANBAN_HOME=str(home))
            cases = [
                ('', {}, a),
                ('', {'HERMES_KANBAN_DB': str(b), 'HERMES_KANBAN_BOARD': 'board-b'}, b),
                ('board-a', {'HERMES_KANBAN_DB': str(b)}, a),
                ('board-b', {}, b),  # board del CLI o de la herramienta
                ('board-a', {'HERMES_KANBAN_DB': str(b), 'HERMES_KANBAN_TASK': 't_fixture'}, b),
                ('board-a', {'HERMES_KANBAN_DB': str(b), 'HERMES_DELEGATED_CHILD_CONTEXT': str(home)}, b),
            ]
            for board, overrides, expected in cases:
                with self.subTest(board=board, overrides=sorted(overrides)):
                    result = subprocess.run([
                        str(RUNTIME), '-B', '-c',
                        'import json,sys; from hermes_cli.kanban_db import kanban_db_path; '
                        'print(json.dumps(str(kanban_db_path(board=sys.argv[1] or None))))', board,
                    ], cwd=RUNTIME.parent.parent.parent, env=dict(base, **overrides),
                        capture_output=True, text=True, timeout=15, check=True)
                    self.assertEqual(Path(json.loads(result.stdout)).resolve(), expected.resolve())
            # Resolver no conectó ni creó las bases temporales.
            self.assertEqual(list(home.rglob('*.db')), [])


if __name__ == '__main__':
    unittest.main()
