from __future__ import annotations

import os
import platform
import shutil
import stat
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

from . import __version__

DEFAULT_RELEASE_REPO = "Ottili-ONE/coder-cli"
DEFAULT_VERSION = __version__


def _release_repo() -> str:
    return os.environ.get("OTTILI_CODER_RELEASE_REPO", DEFAULT_RELEASE_REPO)


def _release_version() -> str:
    return os.environ.get("OTTILI_CODER_VERSION", DEFAULT_VERSION).lstrip("v")


def _platform_key() -> tuple[str, str]:
    system = platform.system().lower()
    machine = platform.machine().lower()

    if system == "darwin":
        os_name = "darwin"
    elif system == "linux":
        os_name = "linux"
    elif system == "windows":
        os_name = "windows"
    else:
        raise RuntimeError(f"Unsupported operating system: {system}")

    if machine in {"x86_64", "amd64"}:
        arch = "x64"
    elif machine in {"aarch64", "arm64"}:
        arch = "arm64"
    else:
        raise RuntimeError(f"Unsupported CPU architecture: {machine}")

    return os_name, arch


def _asset_name(os_name: str, arch: str) -> tuple[str, str]:
    if os_name == "windows":
        return f"ottili-coder-{os_name}-{arch}.zip", "ottili-coder.exe"
    return f"ottili-coder-{os_name}-{arch}.tar.gz", "ottili-coder"


def _download(url: str, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers={"User-Agent": "ottili-coder-python"})
    with urllib.request.urlopen(request, timeout=120) as response:
        destination.write_bytes(response.read())


def _extract(archive: Path, destination: Path, binary_name: str) -> Path:
    if archive.suffix == ".zip":
        with zipfile.ZipFile(archive) as zf:
            members = [name for name in zf.namelist() if name.endswith(binary_name)]
            if not members:
                raise RuntimeError(f"Could not find {binary_name} in {archive.name}")
            extracted = destination / binary_name
            extracted.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(members[0]) as src, extracted.open("wb") as dst:
                dst.write(src.read())
            return extracted

    import tarfile

    with tarfile.open(archive) as tf:
        members = [member for member in tf.getmembers() if member.name.endswith(binary_name)]
        if not members:
            raise RuntimeError(f"Could not find {binary_name} in {archive.name}")
        tf.extract(members[0], destination, filter="data")
        extracted = destination / members[0].name
        target = destination / binary_name
        if extracted != target:
            if target.exists():
                target.unlink()
            extracted.rename(target)
        return target


def _install_dir() -> Path:
    override = os.environ.get("OTTILI_CODER_INSTALL_DIR")
    if override:
        return Path(override)
    return Path.home() / ".ottili-coder" / "bin"


def ensure_binary() -> Path:
    env_path = os.environ.get("OTTILI_CODER_BIN_PATH")
    if env_path:
        path = Path(env_path)
        if path.exists():
            return path

    install_dir = _install_dir()
    binary_name = "ottili-coder.exe" if platform.system().lower() == "windows" else "ottili-coder"
    installed = install_dir / binary_name
    if installed.exists():
        return installed

    os_name, arch = _platform_key()
    asset, inner_binary = _asset_name(os_name, arch)
    version = _release_version()
    repo = _release_repo()
    url = f"https://github.com/{repo}/releases/download/v{version}/{asset}"

    with tempfile.TemporaryDirectory(prefix="ottili-coder-py-") as tmp:
        archive = Path(tmp) / asset
        try:
            _download(url, archive)
        except urllib.error.HTTPError as error:
            raise RuntimeError(
                f"Failed to download Ottili Coder v{version} for {os_name}-{arch} from {url}: {error}"
            ) from error

        extracted = _extract(archive, Path(tmp), inner_binary)
        install_dir.mkdir(parents=True, exist_ok=True)
        if installed.exists():
            installed.unlink()
        shutil.copy2(extracted, installed)
        if os_name != "windows":
            installed.chmod(installed.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
        return installed


def main() -> None:
    binary = ensure_binary()
    completed = subprocess.run([str(binary), *sys.argv[1:]], check=False)
    raise SystemExit(completed.returncode)


if __name__ == "__main__":
    main()
