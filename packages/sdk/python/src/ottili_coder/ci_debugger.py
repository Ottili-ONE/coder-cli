"""CI debugger client for Ottili Coder.

Wraps the ``ottili-coder ci-debugger`` CLI so Python consumers can discover
failed CI checks, fetch root causes, and rerun only the validations that
failed. Output is parsed from the ``--json`` form.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass
class CIRootCause:
    category: str
    summary: str
    detail: Optional[str] = None
    file: Optional[str] = None
    line: Optional[int] = None
    suggestion: Optional[str] = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "CIRootCause":
        return cls(
            category=data["category"],
            summary=data["summary"],
            detail=data.get("detail"),
            file=data.get("file"),
            line=data.get("line"),
            suggestion=data.get("suggestion"),
        )


@dataclass
class CICheckRun:
    id: str
    name: str
    status: str
    conclusion: Optional[str] = None
    url: Optional[str] = None
    workflow: Optional[str] = None
    logs: Optional[str] = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "CICheckRun":
        return cls(
            id=data["id"],
            name=data["name"],
            status=data["status"],
            conclusion=data.get("conclusion"),
            url=data.get("url"),
            workflow=data.get("workflow"),
            logs=data.get("logs"),
        )


@dataclass
class CIDebugReport:
    provider: str
    head_sha: str
    discovered: list[CICheckRun] = field(default_factory=list)
    failed: list[CICheckRun] = field(default_factory=list)
    root_causes: list[CIRootCause] = field(default_factory=list)
    reran: list[str] = field(default_factory=list)
    state_path: Optional[str] = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "CIDebugReport":
        return cls(
            provider=data["provider"],
            head_sha=data["headSha"],
            discovered=[CICheckRun.from_dict(r) for r in data.get("discovered", [])],
            failed=[CICheckRun.from_dict(r) for r in data.get("failed", [])],
            root_causes=[CIRootCause.from_dict(r) for r in data.get("rootCauses", [])],
            reran=list(data.get("reran", [])),
            state_path=data.get("statePath"),
        )


def _run(args: list[str], cwd: Optional[str]) -> dict[str, Any]:
    binary = shutil.which("ottili-coder")
    if binary is None:
        raise RuntimeError("ottili-coder CLI not found on PATH")
    completed = subprocess.run(
        [binary, "ci-debugger", *args],
        cwd=cwd,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0 and "--json" not in args:
        raise RuntimeError(completed.stderr or f"ci-debugger exited with code {completed.returncode}")
    return json.loads(completed.stdout or "{}")


def discover_failed_checks(cwd: Optional[str] = None, sha: Optional[str] = None) -> CIDebugReport:
    args = ["discover", *( [sha] if sha else []), "--json"]
    return CIDebugReport.from_dict(_run(args, cwd))


def identify_root_causes(cwd: Optional[str] = None, sha: Optional[str] = None) -> list[CIRootCause]:
    args = ["root-cause", *( [sha] if sha else []), "--json"]
    return [CIRootCause.from_dict(r) for r in _run(args, cwd).get("rootCauses", [])]


def rerun_failed_checks(
    cwd: Optional[str] = None,
    sha: Optional[str] = None,
    patch: Optional[str] = None,
) -> list[str]:
    args = ["rerun", *( [sha] if sha else [])]
    if patch:
        args += ["--patch", patch]
    args.append("--json")
    return _run(args, cwd).get("reran", [])


def show_state(cwd: Optional[str] = None) -> dict[str, Any]:
    return _run(["state", "--json"], cwd)
