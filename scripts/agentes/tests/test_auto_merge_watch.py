"""Pruebas manuales (sin pytest disponible en este host) de auto_merge_watch.py.

Ejecutar: python3 scripts/agentes/tests/test_auto_merge_watch.py

Cubre, en orden: clasificación por rutas (caso #312/#313/#319 reales de
hoy), el backstop de contenido, el libro de decisiones (incluida la falla
cerrada ante una línea mal formada), la REGLA DE JOSE del 12-nov (aprobación
vigente de Rafael/Alexis como primera comprobación inviolable), y el freno
-- simulando una fusión que rompe el CI y comprobando que el fichero de
corte se escribe y que bloquea TODAS las clases, no solo la que falló.
"""
import json
import sqlite3
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


def _make_review_board(tmp_dir: Path, pr_number: int, comments: list[tuple[str, str, int]]) -> Path:
    """comments: [(author, body, created_at)], más viejo primero.
    Crea una tarjeta "Revisión PR #<N>..." con esos comentarios, igual que
    las de hoy en el tablero real."""
    db = tmp_dir / f"board-{pr_number}.db"
    con = sqlite3.connect(str(db))
    con.execute("CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT, created_at INTEGER)")
    con.execute("CREATE TABLE task_comments (task_id TEXT, author TEXT, body TEXT, created_at INTEGER)")
    con.execute("CREATE TABLE task_runs (task_id TEXT, profile TEXT, summary TEXT, metadata TEXT, ended_at INTEGER)")
    con.execute("INSERT INTO tasks VALUES (?, ?, ?)", (f"t_fake{pr_number}", f"Revisión PR #{pr_number}: algo", 1))
    for author, body, ts in comments:
        con.execute("INSERT INTO task_comments VALUES (?, ?, ?, ?)", (f"t_fake{pr_number}", author, body, ts))
    con.commit()
    con.close()
    return db


def test_approval_is_the_first_and_only_gate_when_it_fails():
    print("=== REGLA DE JOSE (12-nov): aprobación vigente, primera e inviolable ===")
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)

        def check_approval(pr, sha, db_path):
            amw.BOARD_DB = db_path
            return amw.check_current_approval(pr, sha)

        # Caso 1: sin ningún veredicto -> no hay aprobación.
        db = _make_review_board(tmp, 501, [])
        a = check_approval(501, "a" * 40, db)
        check("sin veredicto -> ok=False", a.ok is False)

        # Caso 2: aprobado, pero sobre un SHA ANTERIOR (el error que casi
        # cometimos con #313) -> no cuenta.
        db = _make_review_board(tmp, 502, [
            ("rafael", "Veredicto: APROBADO sobre aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", 100),
        ])
        a = check_approval(502, "b" * 40, db)
        check("aprobación sobre un SHA anterior -> ok=False (el error de #313)", a.ok is False)

        a = check_approval(502, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", db)
        check("mismo SHA que el aprobado -> ok=True", a.ok is True)

        # Caso 2b (real, encontrado en la prueba en seco de hoy): el
        # veredicto llegó por `kanban complete --result`, en task_runs.summary,
        # no como comentario -- exactamente lo que pasó con #313 hoy.
        con = sqlite3.connect(str(db))
        con.execute(
            "INSERT INTO task_runs (task_id, profile, summary, ended_at) VALUES (?, ?, ?, ?)",
            ("t_fake502", "alexis", "Veredicto: APROBADO sobre aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, reconfirmación", 150),
        )
        con.commit()
        con.close()
        a = check_approval(502, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", db)
        check("veredicto solo en task_runs.summary (sin comentario) -> se encuentra igual (caso real #313)",
              a.ok is True and a.verdict.author == "alexis")

        # Caso 3: Rafael aprueba, LUEGO Alexis pide cambios sobre el mismo SHA
        # -> el más restrictivo manda, aunque el de Rafael sea una
        # aprobación real.
        sha = "c" * 40
        db = _make_review_board(tmp, 503, [
            ("rafael", f"Veredicto: APROBADO sobre {sha}", 100),
            ("alexis", f"Veredicto: CAMBIOS PEDIDOS sobre {sha}", 200),
        ])
        a = check_approval(503, sha, db)
        check("cambios pedidos DESPUÉS de una aprobación de otro revisor -> ok=False", a.ok is False)

        # Caso 4: autor que no es Rafael ni Alexis -> no cuenta, aunque diga
        # APROBADO sobre el SHA correcto.
        db = _make_review_board(tmp, 504, [
            ("jose", f"Veredicto: APROBADO sobre {sha}", 100),
        ])
        a = check_approval(504, sha, db)
        check("veredicto de un autor que no es Rafael/Alexis -> ok=False", a.ok is False)

        # Caso 5: el orden de evaluate_pr -- si la aprobación falla, no debe
        # llegar a llamar classify_paths ni content_backstop_hit ni pedir CI.
        # Se comprueba sustituyendo esas funciones por espías que fallan si
        # se les llama.
        def _boom(*a, **k):
            raise AssertionError("se evaluó algo después de que la aprobación fallara -- viola la regla de Jose")

        orig_classify = amw.classify_paths
        orig_backstop = amw.content_backstop_hit
        orig_ci = amw.gh_commit_ci_status
        orig_diff_names = amw.gh_pr_diff_names
        orig_diff_text = amw.gh_pr_diff_text
        orig_pr_view = amw.gh_pr_view
        orig_find_verdict = amw.find_review_verdict
        amw.classify_paths = _boom
        amw.content_backstop_hit = _boom
        amw.gh_commit_ci_status = _boom
        amw.gh_pr_diff_names = _boom
        amw.gh_pr_diff_text = _boom
        amw.gh_pr_view = lambda pr, fields: {"title": "x", "headRefOid": "d" * 40, "isDraft": False, "body": ""}
        amw.find_review_verdict = lambda pr, db_path=None: None  # nunca hay veredicto en este caso
        try:
            decision = amw.evaluate_pr(505, enabled_classes={"A1"})
            check("evaluate_pr no revienta, y se detiene en SIN_APROBACION sin evaluar nada más",
                  decision.action == "RETENER" and decision.risk_class == "SIN_APROBACION")
        except AssertionError as exc:
            check(str(exc), False)
        finally:
            amw.classify_paths = orig_classify
            amw.content_backstop_hit = orig_backstop
            amw.gh_commit_ci_status = orig_ci
            amw.gh_pr_diff_names = orig_diff_names
            amw.gh_pr_diff_text = orig_diff_text
            amw.gh_pr_view = orig_pr_view
            amw.find_review_verdict = orig_find_verdict

        # Caso 6: gh no responde con certeza (headRefOid vacío/ausente) ->
        # se trata como sin aprobación, nunca como "se asume que sí".
        a = amw.check_current_approval(506, "")
        check("sin SHA actual determinado -> ok=False (falla cerrado)", a.ok is False)


def test_structured_metadata_schema():
    print("=== metadata estructurada (esquema fijado el 12-nov) ===")
    v = amw._verdict_from_metadata(
        '{"verdict": "approved", "sha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "pr": 291}',
        "alexis", "t_x", 291,
    )
    check("verdict/sha válidos -> se reconoce como APROBADO", v is not None and v.outcome == "APROBADO")

    v = amw._verdict_from_metadata(
        json.dumps({"review_outcome": "changes_requested", "reviewed_sha": "b" * 40, "pr": 316}),
        "rafael", "t_y", 316,
    )
    check("esquema distinto (review_outcome/reviewed_sha) -> NO se reconoce, no se adivina", v is None)

    v = amw._verdict_from_metadata(
        '{"verdict": "approved_reconfirmation", "sha": "' + "c" * 40 + '", "pr": 313}',
        "alexis", "t_z", 313,
    )
    check("valor no documentado (approved_reconfirmation) -> no se reconoce", v is None)

    v = amw._verdict_from_metadata(
        json.dumps({"verdict": "changes_requested", "sha": "f" * 40, "pr": "https://github.com/eltata71/arky-sup/pull/318"}),
        "alexis", "t_w", 318,
    )
    check("pr como URL en vez de entero -> NO se reconoce (caso real #318)", v is None)

    v = amw._verdict_from_metadata(
        json.dumps({"verdict": "approved", "sha": "a" * 40, "pr": 291}),
        "alexis", "t_v", 999,
    )
    check("pr no coincide con el PR que se evalúa -> NO se reconoce", v is None)

    # find_review_verdict: la metadata y la prosa se mezclan por fecha real.
    with tempfile.TemporaryDirectory() as d:
        db = Path(d) / "board.db"
        con = sqlite3.connect(str(db))
        con.execute("CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT, created_at INTEGER)")
        con.execute("CREATE TABLE task_comments (task_id TEXT, author TEXT, body TEXT, created_at INTEGER)")
        con.execute("CREATE TABLE task_runs (task_id TEXT, profile TEXT, summary TEXT, metadata TEXT, ended_at INTEGER)")
        con.execute("INSERT INTO tasks VALUES ('t_600', 'Revisión PR #600: x', 1)")
        sha = "d" * 40
        con.execute(
            "INSERT INTO task_runs (task_id, profile, summary, metadata, ended_at) VALUES (?, ?, NULL, ?, ?)",
            ("t_600", "rafael", json.dumps({"verdict": "approved", "sha": sha, "pr": 600}), 100),
        )
        con.commit()
        con.close()
        v = amw.find_review_verdict(600, db_path=db)
        check("solo metadata, sin comentarios -> se encuentra vía metadata", v is not None and v.outcome == "APROBADO")

        # Un comentario POSTERIOR en prosa con cambios pedidos debe ganar
        # (más reciente manda, sea cual sea la fuente).
        con = sqlite3.connect(str(db))
        con.execute(
            "INSERT INTO task_comments VALUES (?, ?, ?, ?)",
            ("t_600", "alexis", f"Veredicto: CAMBIOS PEDIDOS sobre {sha}", 200),
        )
        con.commit()
        con.close()
        v = amw.find_review_verdict(600, db_path=db)
        check("comentario en prosa POSTERIOR a la metadata -> gana el más reciente, no la metadata",
              v is not None and v.outcome == "CAMBIOS PEDIDOS" and v.author == "alexis")


def test_task_lookup_ignores_followup_cards_mentioning_the_pr():
    print("=== búsqueda de tarjeta: prefijo exacto, no subcadena (caso real #291) ===")
    with tempfile.TemporaryDirectory() as d:
        db = Path(d) / "board.db"
        con = sqlite3.connect(str(db))
        con.execute("CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT, created_at INTEGER)")
        con.execute("CREATE TABLE task_comments (task_id TEXT, author TEXT, body TEXT, created_at INTEGER)")
        con.execute("CREATE TABLE task_runs (task_id TEXT, profile TEXT, summary TEXT, metadata TEXT, ended_at INTEGER)")
        sha = "e" * 40
        con.execute("INSERT INTO tasks VALUES ('t_real', 'Revisión PR #291: x', 100)")
        con.execute(
            "INSERT INTO task_runs (task_id, profile, metadata, ended_at) VALUES (?, ?, ?, ?)",
            ("t_real", "alexis", json.dumps({"verdict": "approved", "sha": sha, "pr": 291}), 150),
        )
        # Tarjeta de SEGUIMIENTO creada DESPUÉS, que menciona "PR #291" en el
        # título pero no es una revisión -- exactamente lo que pasó hoy.
        con.execute("INSERT INTO tasks VALUES ('t_followup', 'Endurecer algo (L1 de Alexis, PR #291)', 200)")
        con.commit()
        con.close()
        v = amw.find_review_verdict(291, db_path=db)
        check("la tarjeta de seguimiento (más reciente) no esconde el veredicto real",
              v is not None and v.task_id == "t_real" and v.outcome == "APROBADO")


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
    test_approval_is_the_first_and_only_gate_when_it_fails()
    test_structured_metadata_schema()
    test_task_lookup_ignores_followup_cards_mentioning_the_pr()
    test_breaker_trips_and_blocks_everything()
    print(f"\n{PASS} ok, {FAIL} fallo(s)")
    return 1 if FAIL else 0


if __name__ == "__main__":
    raise SystemExit(main())
