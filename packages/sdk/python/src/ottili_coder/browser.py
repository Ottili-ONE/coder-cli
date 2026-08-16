"""Browser / Playwright client for Ottili Coder.

Wraps the ``ottili-coder browser`` CLI so Python consumers can launch, inspect
and test web apps with screenshots, console/network capture and deterministic
cleanup. Output is parsed from the ``--json`` form.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from dataclasses import dataclass, field
from typing import Any, Literal, Optional


@dataclass
class ConsoleMessage:
    level: Literal["log", "info", "warn", "error", "debug", "trace"]
    text: str
    source: Optional[str] = None
    location: Optional[str] = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ConsoleMessage":
        return cls(
            level=data["level"],
            text=data["text"],
            source=data.get("source"),
            location=data.get("location"),
        )


@dataclass
class NetworkEntry:
    method: str
    url: str
    status: Optional[int] = None
    request_headers: Optional[dict[str, str]] = None
    response_headers: Optional[dict[str, str]] = None
    timing_ms: Optional[float] = None
    failed: Optional[bool] = None
    error_text: Optional[str] = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "NetworkEntry":
        return cls(
            method=data["method"],
            url=data["url"],
            status=data.get("status"),
            request_headers=data.get("requestHeaders"),
            response_headers=data.get("responseHeaders"),
            timing_ms=data.get("timingMs"),
            failed=data.get("failed"),
            error_text=data.get("errorText"),
        )


@dataclass
class Artifact:
    kind: Literal["screenshot", "trace", "video", "har"]
    path: str
    width: Optional[int] = None
    height: Optional[int] = None
    size_bytes: Optional[int] = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Artifact":
        return cls(
            kind=data["kind"],
            path=data["path"],
            width=data.get("width"),
            height=data.get("height"),
            size_bytes=data.get("sizeBytes"),
        )


@dataclass
class BrowserReport:
    schema_version: str
    session_id: str
    target: str
    headless: bool
    browser: str
    status: Literal["done", "failed", "cancelled"]
    console: list[ConsoleMessage] = field(default_factory=list)
    network: list[NetworkEntry] = field(default_factory=list)
    artifacts: list[Artifact] = field(default_factory=list)
    exit_code: int = 0
    started_at: int = 0
    finished_at: int = 0
    state_path: Optional[str] = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "BrowserReport":
        return cls(
            schema_version=data["schemaVersion"],
            session_id=data["sessionId"],
            target=data["target"],
            headless=data["headless"],
            browser=data["browser"],
            status=data["status"],
            console=[ConsoleMessage.from_dict(c) for c in data.get("console", [])],
            network=[NetworkEntry.from_dict(n) for n in data.get("network", [])],
            artifacts=[Artifact.from_dict(a) for a in data.get("artifacts", [])],
            exit_code=data.get("exitCode", 0),
            started_at=data.get("startedAt", 0),
            finished_at=data.get("finishedAt", 0),
            state_path=data.get("statePath"),
        )


def _run(args: list[str], cwd: Optional[str]) -> dict[str, Any]:
    binary = shutil.which("ottili-coder")
    if binary is None:
        raise RuntimeError("ottili-coder CLI not found on PATH")
    completed = subprocess.run(
        [binary, "browser", *args],
        cwd=cwd,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0 and "--json" not in args:
        raise RuntimeError(completed.stderr or f"browser exited with code {completed.returncode}")
    return json.loads(completed.stdout or "{}")


def _base_args(sub: str, target: str, opts: dict[str, Any]) -> list[str]:
    args = [sub, target, "--json"]
    if opts.get("headless") is False:
        args.append("--no-headless")
    if opts.get("browser") and opts["browser"] != "chromium":
        args += ["--browser", opts["browser"]]
    if opts.get("session"):
        args += ["--session", opts["session"]]
    if opts.get("output_dir"):
        args += ["--output-dir", opts["output_dir"]]
    if opts.get("timeout"):
        args += ["--timeout", str(opts["timeout"])]
    return args


def launch(target: str, cwd: Optional[str] = None, **opts: Any) -> BrowserReport:
    args = _base_args("launch", target, opts)
    return BrowserReport.from_dict(_run(args, cwd))


def screenshot(target: str, cwd: Optional[str] = None, **opts: Any) -> BrowserReport:
    args = _base_args("screenshot", target, opts)
    return BrowserReport.from_dict(_run(args, cwd))


def test(target: str, cwd: Optional[str] = None, **opts: Any) -> BrowserReport:
    args = _base_args("test", target, opts)
    if opts.get("capture_console") is False:
        args.append("--no-capture-console")
    if opts.get("capture_network") is False:
        args.append("--no-capture-network")
    return BrowserReport.from_dict(_run(args, cwd))


def show_state(session: str, cwd: Optional[str] = None) -> dict[str, Any]:
    return _run(["state", session, "--json"], cwd)
