# mentor_bridge.py
import json
import sys
import io
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')
import traceback
from contextlib import redirect_stdout, redirect_stderr

from legacy_engine import run as run_mentor


def _read_stdin_json() -> dict:
    raw = sys.stdin.read()
    if not raw.strip():
        return {}
    return json.loads(raw)


def main() -> None:
    payload = {}
    try:
        payload = _read_stdin_json()
        debug = bool(payload.get("debug", False))

        # IMPORTANT:
        # - Always suppress stdout from legacy_engine so stdout stays JSON-only.
        # - If debug is False, also suppress stderr (keeps UI clean).
        # - If debug is True, allow stderr to show in Replit console for troubleshooting.
        stdout_buf = io.StringIO()
        stderr_buf = io.StringIO()

        if debug:
            with redirect_stdout(stdout_buf):
                result = run_mentor(payload)
        else:
            with redirect_stdout(stdout_buf), redirect_stderr(stderr_buf):
                result = run_mentor(payload)

        sys.stdout.write(json.dumps(result))
        sys.stdout.flush()

    except Exception as e:
        err = {"error": str(e), "error_type": type(e).__name__}

        if payload.get("debug"):
            err["traceback"] = traceback.format_exc()

        sys.stdout.write(json.dumps(err))
        sys.stdout.flush()
        sys.exit(1)


if __name__ == "__main__":
    main()