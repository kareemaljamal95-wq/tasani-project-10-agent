"""Laying out a run's files on disk.

Every path here arrives from a model, which means every path is hostile until
proven otherwise. `../../../etc/passwd`, `/etc/passwd`, a symlink pointing out
of the tree and a name that normalises to an escape all have to be refused
before anything is written — after a write it is already too late.
"""

from __future__ import annotations

import os
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from .config import settings


class UnsafePath(ValueError):
    """A file path that would write outside the workspace."""


class WorkspaceTooLarge(ValueError):
    """More files, or larger files, than a run is allowed."""


@dataclass(frozen=True)
class SourceFile:
    path: str
    content: str


def _safe_relative(raw: str) -> PurePosixPath:
    """Reduce a requested path to a safe relative one, or refuse it.

    Checked before touching the filesystem, so a refusal costs nothing and a
    trick that only reveals itself at write time cannot exist.
    """
    if not raw or raw.strip() != raw:
        raise UnsafePath(f"Path is empty or padded: {raw!r}")

    p = PurePosixPath(raw)

    if p.is_absolute():
        raise UnsafePath(f"Absolute path refused: {raw!r}")

    # `..` anywhere, not just at the front. `a/../../b` normalises out of the
    # tree while looking harmless.
    if any(part == ".." for part in p.parts):
        raise UnsafePath(f"Parent traversal refused: {raw!r}")

    if any(part in ("", ".") for part in p.parts):
        raise UnsafePath(f"Malformed path: {raw!r}")

    # A NUL truncates the name at the syscall boundary, so a path that looks
    # like "safe.txt\0../../evil" writes somewhere else entirely.
    if "\x00" in raw:
        raise UnsafePath("Path contains a null byte.")

    return p


class Workspace:
    """A throwaway directory holding one run's files."""

    def __init__(self) -> None:
        # Created under the process's own temp root, which the Dockerfile makes
        # writable to the sandbox user and nothing else.
        self.root = Path(tempfile.mkdtemp(prefix="run-"))

    def write(self, files: list[SourceFile]) -> list[str]:
        cfg = settings()

        if len(files) > cfg.SANDBOX_MAX_FILES:
            raise WorkspaceTooLarge(
                f"{len(files)} files exceeds the limit of {cfg.SANDBOX_MAX_FILES}."
            )

        written: list[str] = []
        total = 0

        for f in files:
            rel = _safe_relative(f.path)
            data = f.content.encode("utf-8")
            total += len(data)

            if len(data) > cfg.SANDBOX_MAX_FILE_BYTES:
                raise WorkspaceTooLarge(f"{f.path} exceeds the per-file limit.")
            if total > cfg.SANDBOX_MAX_FILE_BYTES * 10:
                raise WorkspaceTooLarge("Total workspace size exceeds the limit.")

            target = self.root / Path(*rel.parts)
            target.parent.mkdir(parents=True, exist_ok=True)

            # The last line of defence: after resolving symlinks, the target
            # must still sit inside the workspace. A directory created by an
            # earlier file in the same batch could be a symlink out.
            resolved = target.parent.resolve()
            if not str(resolved).startswith(str(self.root.resolve())):
                raise UnsafePath(f"Path escapes the workspace: {f.path!r}")

            target.write_bytes(data)
            written.append(str(rel))

        return written

    def collect(self, limit_bytes: int) -> dict[str, str]:
        """Read back what the run produced, bounded.

        A run that writes a gigabyte must not be able to push it through the
        response — the cap is applied while walking, not after.
        """
        out: dict[str, str] = {}
        budget = limit_bytes

        for path in sorted(self.root.rglob("*")):
            if not path.is_file() or path.is_symlink():
                continue
            rel = str(path.relative_to(self.root))
            try:
                data = path.read_bytes()[:budget]
            except OSError:
                continue
            budget -= len(data)
            out[rel] = data.decode("utf-8", errors="replace")
            if budget <= 0:
                break

        return out

    def close(self) -> None:
        shutil.rmtree(self.root, ignore_errors=True)

    def __enter__(self) -> "Workspace":
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()


def minimal_env() -> dict[str, str]:
    """The environment a run is given.

    Built from nothing rather than filtered from the parent. A denylist means
    every new secret added to the service leaks by default until somebody
    remembers to add it; an allowlist of four harmless values cannot.
    """
    return {
        "PATH": "/usr/local/bin:/usr/bin:/bin",
        "HOME": "/tmp",
        "LANG": "C.UTF-8",
        "PYTHONDONTWRITEBYTECODE": "1",
        # Unbuffered, so output survives a run killed at its timeout.
        "PYTHONUNBUFFERED": "1",
        # Proxy variables are deliberately absent: an inherited HTTPS_PROXY is
        # a working route to the internet from inside the sandbox.
        "NO_PROXY": "*",
    }


def dropped_env_keys() -> list[str]:
    """Parent variables not passed through — reported by /health, never valued."""
    return sorted(k for k in os.environ if k not in minimal_env())
