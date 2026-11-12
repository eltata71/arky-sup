"""Pruebas manuales (sin pytest disponible en este host) de auto_merge_watch.py.

Ejecutar: python3 scripts/agentes/tests/test_auto_merge_watch.py

Cubre, en orden: clasificación por rutas (caso #312/#313/#319 reales de
hoy), el backstop de contenido, el libro de decisiones (incluida la falla
cerrada ante una línea mal formada), y el freno -- simulando una fusión que
rompe el CI y comprobando que el fichero de corte se escribe y que bloquea
TODAS las clases, no solo la que falló.
"""
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import auto_merge_watch as amw  # noqa: E402

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


def test_classification_a1():
    print("=== clasificación A1 ===")
    cls = amw.classify_paths(
        ["docs/limites-de-herramienta.md", "__tests__/foo.test.ts"], enabled_classes={"A1"},
    )
    check("docs + tests, A1 habilitada -> A1", cls.risk_class == "A1")

    cls = amw.classify_paths(["docs/operacion/multiagente.md"], enabled_classes={"A1"})
    check("docs/operacion/ está excluido de A1 -> ALTO_RIESGO", cls.risk_class == "ALTO_RIESGO")

    cls = amw.classify_paths(["docs/foo.md"], enabled_classes=set())
    check("A1 no habilitada -> ALTO_RIESGO aunque la ruta encajaría", cls.risk_class == "ALTO_RIESGO")

    cls = amw.classify_paths(["scripts/agentes/vigilar-limites.py"], enabled_classes={"A1"})
    check("script .py fuera de A1 (no es tests/) -> ALTO_RIESGO (fail-closed)", cls.risk_class == "ALTO_RIESGO")


def test_classification_deny_wins():
    print("=== el veto siempre gana, aunque el resto del diff sea A1 ===")
    cls = amw.classify_paths(
        ["__tests__/foo.test.ts", "scripts/agentes/skills/latam-factory-orchestration/SKILL.md"],
        enabled_classes={"A1"},
    )
    check("un archivo de skill canónica entre archivos A1 -> ALTO_RIESGO", cls.risk_class == "ALTO_RIESGO")

    for path in ("package.json", ".github/workflows/ci.yml", "supabase/migrations/x.sql",
                 "scripts/agentes/command_allowlist.json", "api/ai.ts"):
        cls = amw.classify_paths([path], enabled_classes={"A1"})
        check(f"vetado siempre: {path}", cls.risk_class == "ALTO_RIESGO")


def test_content_backstop():
    print("=== backstop de contenido (caso #319 real) ===")
    hit = amw.content_backstop_hit(
        title="fix(skill): el coordinador debe crear hijas por terminal directo",
        body="",
        diff_text="+Esto es falso: kanban_create no admite max_runtime_seconds",
    )
    check("menciona kanban_tools/kanban_create en el diff -> backstop dispara",
          hit is not None and "motor" in hit)

    hit = amw.content_backstop_hit(title="docs: typo", body="", diff_text="+arreglo un typo")
    check("diff inocuo -> sin backstop", hit is None)


def test_decision_ledger():
    print("=== libro de decisiones ===")
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / "ledger.log"
        p.write_text(
            'DECISION 2026-11-12T00:00:00+01:00 jose AUTORIZA clase=A1 motivo="arranque, documentación y pruebas"\n'
        )
        enabled = amw.enabled_classes_from_ledger(p)
        check("una línea bien formada habilita A1", enabled == {"A1"})

        p.write_text(
            'DECISION 2026-11-12T00:00:00+01:00 jose AUTORIZA clase=A1 motivo="arranque"\n'
            'DECISION 2026-11-13T00:00:00+01:00 jose REVOCA clase=A1 motivo="freno disparado, retirar hasta revisar"\n'
        )
        enabled = amw.enabled_classes_from_ledger(p)
        check("REVOCA después de AUTORIZA la quita", enabled == set())

        p.write_text("enabled_classes: [A1]\n")  # alguien intentando un atajo de config
        try:
            amw.enabled_classes_from_ledger(p)
            check("una línea que no es una DECISION completa hace fallar el libro entero", False)
        except amw.DecisionLedgerError:
            check("una línea que no es una DECISION completa hace fallar el libro entero", True)

        if not p.exists():
            pass
        missing = Path(d) / "no-existe.log"
        check("libro ausente = ninguna clase habilitada (no ALTO_RIESGO universal, pero tampoco nada fusiona)",
              amw.enabled_classes_from_ledger(missing) == set())


def test_breaker_trips_and_blocks_everything():
    print("=== el freno: simular una fusión que rompe CI ===")
    with tempfile.TemporaryDirectory() as d:
        log_dir = Path(d)
        amw.LOG_DIR = log_dir
        amw.KILL_SWITCH = log_dir / "auto-merge-DISABLED"
        amw.WRITE_ENABLED_MARKER = log_dir / "auto-merge-ENABLED"
        amw.PENDING_BREAKER_CHECK = log_dir / "pending.json"
        amw.JSONL_LOG = log_dir / "auto-merges.jsonl"

        # Antes de cualquier fusión: sin freno, sin marcador de escritura.
        check("sin ENABLED todavía -> is_write_enabled() es False", amw.is_write_enabled() is False)

        amw.WRITE_ENABLED_MARKER.write_text("ok")
        check("con ENABLED y sin DISABLED -> is_write_enabled() es True", amw.is_write_enabled() is True)

        # Simula que una fusión anterior quedó pendiente de confirmar, y que
        # el CI de ese commit de fusión viene en rojo.
        amw.PENDING_BREAKER_CHECK.write_text(json.dumps({"pr_number": 999, "merge_commit_sha": "deadbeef" * 5}))
        amw.gh_commit_ci_status = lambda sha: "red"  # type: ignore[assignment]

        msg = amw.check_pending_breaker()
        check("check_pending_breaker() informa que el freno se disparó", msg is not None and "FRENO DISPARADO" in msg)
        check("el fichero de corte se escribió de verdad", amw.KILL_SWITCH.is_file())
        check("la comprobación pendiente se limpió (no se repite cada vez)",
              not amw.PENDING_BREAKER_CHECK.is_file())

        # El punto que pide Jose explícitamente: con el freno puesto, NINGUNA
        # clase puede escribir -- no solo la que rompió CI.
        check("con DISABLED presente, is_write_enabled() es False aunque ENABLED siga puesto",
              amw.is_write_enabled() is False)

        # Y una PR de clase A1 perfectamente aprobada tampoco se fusionaría:
        # is_write_enabled() es lo que `main()` consulta antes de llamar a
        # perform_merge(), así que una vez en False ningún PR se toca.
        check("is_kill_switch_active() ve el mismo fichero", amw.is_kill_switch_active() is True)


def main():
    test_classification_a1()
    test_classification_deny_wins()
    test_content_backstop()
    test_decision_ledger()
    test_breaker_trips_and_blocks_everything()
    print(f"\n{PASS} ok, {FAIL} fallo(s)")
    return 1 if FAIL else 0


if __name__ == "__main__":
    raise SystemExit(main())
