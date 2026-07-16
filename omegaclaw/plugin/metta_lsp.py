"""OmegaClaw plugin that exposes the MeTTa-LSP CLI to MeTTa skill wrappers.

OmegaClaw loads this module from its plugins.yaml file and keeps it in the
Python plugin registry. The MeTTa wrappers call these functions through
py-call. Arguments are always passed to Node as an argv array, never a shell
command.
"""

from __future__ import annotations

import os
import shlex
import subprocess
from pathlib import Path

LSP_ROOT = Path(os.environ.get("METTA_LSP_ROOT", Path(__file__).resolve().parents[2])).expanduser()
NODE = os.environ.get("METTA_LSP_NODE", "node")
TIMEOUT_SECONDS = float(os.environ.get("METTA_LSP_TIMEOUT", "30"))
MAX_OUTPUT_CHARS = int(os.environ.get("METTA_LSP_MAX_OUTPUT", "64000"))


def _cli_path() -> Path:
    return LSP_ROOT / "dist" / "cli" / "cli.js"


def loadOmegaClawPlugin() -> None:
    """Validate the external CLI when OmegaClaw loads the plugin."""

    cli = _cli_path()
    if not cli.is_file():
        raise RuntimeError(f"MeTTa-LSP is not built: {cli}. Run npm run compile in {LSP_ROOT}.")


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


def _position(path: str, line: object, character: object) -> list[str]:
    return [str(path), str(line), str(character)]


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


def hover(path: str, line: object, character: object) -> str:
    return _run(["hover", *_position(path, line, character), "--json"])


def definition(path: str, line: object, character: object) -> str:
    return _run(["def", *_position(path, line, character), "--json"])


def references(path: str, line: object, character: object) -> str:
    return _run(["refs", *_position(path, line, character), "--json"])


def explain(path: str, line: object, character: object) -> str:
    return _run(["explain", *_position(path, line, character), "--json"])


def list_stdlib() -> str:
    return _run(["list", "stdlib"])


def inspect(name: str) -> str:
    return _run(["inspect", str(name)])


def cli(args: str) -> str:
    return _run(shlex.split(str(args)))
