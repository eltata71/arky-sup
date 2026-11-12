"""Pruebas manuales de pr_review_trigger.py (sin pytest en este host).

Ejecutar: python3 scripts/agentes/tests/test_pr_review_trigger.py
"""
import sqlite3
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pr_review_trigger as trg  # noqa: E402

PASS = 0
FAIL = 0


def check(label, cond):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ok  {label}")
    else:
        FAIL += 1
        print(f"FALLO {label}")


def _board(tmp: Path, tasks: list[tuple[str, str, str, int]]) -> Path:
    """tasks: [(id, title, assignee, status)]"""
    db = tmp / "board.db"
    con = sqlite3.connect(str(db))
    con.execute("CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT, assignee TEXT, status TEXT)")
    for tid, title, assignee, status in tasks:
        con.execute("INSERT INTO tasks VALUES (?, ?, ?, ?)", (tid, title, assignee, status))
    con.commit()
    con.close()
    return db


def test_idempotency_exact_prefix_not_substring():
    print("=== idempotencia: prefijo exacto, no subcadena ===")
    with tempfile.TemporaryDirectory() as d:
        db = _board(Path(d), [
            ("t_1", "Revisión PR #297: pone a salvo E-01..E11 — depende de #316, YA en conflicto", "alexis", "triage"),
        ])
        check("#297 SÍ tiene tarjeta -> existing_review_task encuentra t_1",
              trg.existing_review_task(297, db_path=db) == "t_1")
        check("#316 NO tiene tarjeta, aunque #297 lo mencione en el título -> None",
              trg.existing_review_task(316, db_path=db) is None)

        empty_dir = Path(tempfile.mkdtemp())
        db2 = empty_dir / "empty.db"
        con = sqlite3.connect(str(db2))
        con.execute("CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT, assignee TEXT, status TEXT)")
        con.commit()
        con.close()
        check("tablero vacío -> None, nunca revienta", trg.existing_review_task(1, db_path=db2) is None)


def test_load_based_picking():
    print("=== reparto por carga ===")
    with tempfile.TemporaryDirectory() as d:
        db = _board(Path(d), [
            ("t_1", "Revisión PR #1: x", "rafael", "ready"),
            ("t_2", "Revisión PR #2: x", "rafael", "ready"),
            ("t_3", "Revisión PR #3: x", "rafael", "done"),  # done no cuenta
            ("t_4", "Revisión PR #4: x", "alexis", "ready"),
        ])
        check("rafael tiene 2 no-terminales, alexis 1 -> carga rafael=2",
              trg.reviewer_load("rafael", db_path=db) == 2)
        check("alexis tiene 1 no-terminal (la 'done' de rafael no cuenta para nadie)",
              trg.reviewer_load("alexis", db_path=db) == 1)

        import pr_review_trigger as trg2
        orig = trg2.reviewer_load
        trg2.reviewer_load = lambda p, db_path=None: {"rafael": 2, "alexis": 1}[p]
        try:
            check("alexis tiene menos carga -> se le asigna un PR nuevo, sin importar paridad",
                  trg2.pick_reviewer(100) == "alexis")
        finally:
            trg2.reviewer_load = orig

        trg2.reviewer_load = lambda p, db_path=None: {"rafael": 1, "alexis": 1}[p]
        try:
            check("empate -> par va a rafael", trg2.pick_reviewer(100) == "rafael")
            check("empate -> impar va a alexis", trg2.pick_reviewer(101) == "alexis")
        finally:
            trg2.reviewer_load = orig


def test_overlap_detection():
    print("=== detección de solape de ficheros (nota, no gate duro) ===")
    all_files = {
        310: {"scripts/agentes/politica-por-perfil.md", "scripts/agentes/crear-tarea-hija.sh"},
        311: {"scripts/agentes/politica-por-perfil.md"},
        320: {"package-lock.json"},
    }
    ov = trg.detect_overlaps(311, all_files[311], all_files)
    check("#311 comparte politica-por-perfil.md con #310 -> lo detecta", ov == [310])
    ov = trg.detect_overlaps(320, all_files[320], all_files)
    check("#320 no comparte nada -> lista vacía", ov == [])


def main():
    test_idempotency_exact_prefix_not_substring()
    test_load_based_picking()
    test_overlap_detection()
    print(f"\n{PASS} ok, {FAIL} fallo(s)")
    return 1 if FAIL else 0


if __name__ == "__main__":
    raise SystemExit(main())
