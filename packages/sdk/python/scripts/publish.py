#!/usr/bin/env python3
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    token = os.environ.get("PYPI_TOKEN") or os.environ.get("PYPI_API_TOKEN")
    env = os.environ.copy()
    if token:
        env["TWINE_USERNAME"] = "__token__"
        env["TWINE_PASSWORD"] = token

    subprocess.run([sys.executable, "-m", "pip", "install", "--upgrade", "build", "twine"], check=True)
    subprocess.run([sys.executable, "-m", "build", str(ROOT)], check=True, cwd=ROOT)
    subprocess.run([sys.executable, "-m", "twine", "upload", "dist/*"], check=True, cwd=ROOT, env=env)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
