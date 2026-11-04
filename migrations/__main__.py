"""
Purpose: Command line for the mx-inv migration runner - dry run (default) or apply.
Version: v1 (2026-10-05)
Scope: PRODUCTION - mx-inv data layer tool.
Architecture: Thin wrapper over migrations.run(); the server also runs it at start (db_schema.ensure_current).
Invocation: python -m migrations [--apply] [--db PATH]   (default DB = db_schema.DB_PATH / VESSEL_DB_PATH)
"""
from __future__ import annotations

import argparse
import sys

from . import SchemaTooNew, run, target_version


def main() -> int:
    import db_schema
    ap = argparse.ArgumentParser(description="mx-inv schema migrations (dry run unless --apply)")
    ap.add_argument("--db", default=db_schema.DB_PATH)
    ap.add_argument("--apply", action="store_true", help="migrate the file (a verified backup is taken first)")
    a = ap.parse_args()
    try:
        steps = run(a.db, apply=a.apply)
    except SchemaTooNew as e:
        print(f"REFUSED: {e}")
        return 2
    mode = "applied" if a.apply else "dry run (file untouched)"
    print(f"{a.db}: target v{target_version()}; {mode}: {', '.join(f'v{v}' for v in steps) or 'nothing to do'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
