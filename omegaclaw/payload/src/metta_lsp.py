"""Python bridge used by the OmegaClaw MeTTa-LSP skills.

The installer writes the absolute MeTTa-LSP checkout path into LSP_ROOT. Each
function invokes the CLI as an argv array, never through the shell.
"""

from __future__ import annotations

import os
import shlex
import subprocess
from pathlib import Path

LSP_ROOT = Path(os.environ.get("METTA_LSP_ROOT", "__METTA_LSP_ROOT__")).expanduser()
NODE = os.environ.get("METTA_LSP_NODE", "node")
TIMEOUT_SECONDS = float(os.environ.get("METTA_LSP_TIMEOUT", "30"))
MAX_OUTPUT_CHARS = int(os.environ.get("METTA_LSP_MAX_OUTPUT", "12000"))


def _cli_path() -> Path:
    return LSP_ROOT / "dist" / "cli" / "cli.js"


def _bounded(text: str) -> str:
    if len(text) <= MAX_OUTPUT_CHARS:
        return text
    return text[:MAX_OUTPUT_CHARS] + "\n[metta-lsp output truncated]"


def _run(args: list[str]) -> str:
    cli = _cli_path()
    if not cli.exists():
        return f"METTA_LSP_NOT_BUILT: {cli} is missing. Run npm run compile in {LSP_ROOT}."

    try:
        completed = subprocess.run(
            [NODE, str(cli), *args],
            cwd=str(LSP_ROOT),
            text=True,
            capture_output=True,
            timeout=TIMEOUT_SECONDS,
            check=False,
        )
    except FileNotFoundError:
        return f"METTA_LSP_NODE_NOT_FOUND: {NODE}"
    except subprocess.TimeoutExpired:
        return f"METTA_LSP_TIMEOUT: command exceeded {TIMEOUT_SECONDS:g}s"

    parts = []
    if completed.stdout.strip():
        parts.append(completed.stdout.strip())
    if completed.stderr.strip():
        parts.append("stderr:\n" + completed.stderr.strip())
    if completed.returncode != 0:
        parts.append(f"exit={completed.returncode}")
    return _bounded("\n".join(parts) if parts else "OK")


def _position(spec: str) -> list[str] | str:
    parts = shlex.split(str(spec))
    if len(parts) != 3:
        return "METTA_LSP_USAGE: expected path line character"
    return parts


def check(path: str) -> str:
    return _run(["check", str(path), "--json"])


def symbols(path: str) -> str:
    return _run(["symbols", str(path), "--json"])


def test(path: str) -> str:
    return _run(["test", str(path), "--tap"])


def run(path: str) -> str:
    return _run(["run", str(path)])


def format_check(path: str) -> str:
    return _run(["fmt", str(path), "--check"])


def hover(spec: str) -> str:
    parts = _position(spec)
    if isinstance(parts, str):
        return parts
    return _run(["hover", *parts, "--json"])


def definition(spec: str) -> str:
    parts = _position(spec)
    if isinstance(parts, str):
        return parts
    return _run(["def", *parts, "--json"])


def references(spec: str) -> str:
    parts = _position(spec)
    if isinstance(parts, str):
        return parts
    return _run(["refs", *parts, "--json"])


def explain(spec: str) -> str:
    parts = _position(spec)
    if isinstance(parts, str):
        return parts
    return _run(["explain", *parts, "--json"])


def cli(args: str) -> str:
    return _run(shlex.split(str(args)))
