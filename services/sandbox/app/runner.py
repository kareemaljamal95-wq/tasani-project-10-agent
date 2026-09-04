"""Executing a run.

What this does and does not claim, stated plainly because the difference
matters more than any code below it:

**It is a resource jail, not an adversarial sandbox.** Kernel rlimits, a fresh
temp workspace, a scrubbed environment and a hard timeout contain the failures
this service actually meets: runaway loops, memory exhaustion, disk filling,
accidental network calls, and a script that would otherwise read the service's
own secrets out of `os.environ`. They do not contain a determined attacker with
a kernel exploit. Nothing achievable inside one Linux process does.

**Real isolation is the platform's job.** Egress is stopped by a Northflank
network policy, not by anything here, which is why the service refuses to
execute at all until an operator declares that posture. Per-run container
isolation (a Northflank job per run, gVisor, Firecracker) is the next step up
and is a deployment change rather than a code change.

The code it runs comes from the account's own agents working its own tickets.
That threat model is "buggy and occasionally careless", and this is sized for
exactly that — said out loud so nobody mistakes it for more.
"""

from __future__ import annotations

import asyncio
import logging
import os
import resource
import signal
import time
from dataclasses import dataclass

from .config import settings
from .workspace import Workspace, minimal_env

log = logging.getLogger(__name__)

# Only these may be launched. An allowlist rather than a shell string: with a
# shell, `python -c 'x' ; curl evil` is one run, and the second half is
# invisible to every check above it.
COMMANDS: dict[str, list[str]] = {
    "python": ["python3"],
    "pytest": ["python3", "-m", "pytest", "-q", "--color=no"],
    "node": ["node"],
    "npm-test": ["npm", "test", "--silent"],
}


@dataclass
class RunResult:
    ok: bool
    exit_code: int | None
    stdout: str
    stderr: str
    duration_ms: int
    timed_out: bool
    truncated: bool


def _apply_limits() -> None:
    """Applied in the child between fork and exec.

    Set here rather than passed as flags because the child must not be able to
    raise them: rlimits are inherited and the soft limit is capped by the hard
    limit, which is set to the same value.
    """
    cfg = settings()

    mem = cfg.SANDBOX_MEMORY_MB * 1024 * 1024
    resource.setrlimit(resource.RLIMIT_AS, (mem, mem))

    # CPU seconds, distinct from the wall-clock timeout: a process that spins
    # is killed by the kernel even if the supervisor is starved.
    cpu = cfg.SANDBOX_CPU_SECONDS
    resource.setrlimit(resource.RLIMIT_CPU, (cpu, cpu))

    fsize = cfg.SANDBOX_MAX_FILE_BYTES * 10
    resource.setrlimit(resource.RLIMIT_FSIZE, (fsize, fsize))

    # Caps fork bombs. Per-user on Linux, so the sandbox runs as its own uid.
    resource.setrlimit(resource.RLIMIT_NPROC, (64, 64))
    resource.setrlimit(resource.RLIMIT_NOFILE, (256, 256))

    # No core dumps: a crash would otherwise write memory contents to disk.
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))

    # The new session comes from `start_new_session=True` on the spawn, not
    # from a setsid() here: the child is already a session leader by then, and
    # calling it twice fails with EPERM — which surfaces as an opaque
    # "Exception occurred in preexec_fn" that says nothing about limits.


async def _read(stream: asyncio.StreamReader | None, cap: int) -> tuple[str, bool]:
    """Read a stream up to a cap.

    Bounded while reading, not after: a run printing without end would
    otherwise fill this process's memory before anyone could truncate it.
    """
    if stream is None:
        return "", False

    chunks: list[bytes] = []
    total = 0
    truncated = False

    while True:
        chunk = await stream.read(8192)
        if not chunk:
            break
        if total < cap:
            chunks.append(chunk[: cap - total])
            total += len(chunk)
        else:
            truncated = True

    return b"".join(chunks).decode("utf-8", errors="replace"), truncated


async def execute(workspace: Workspace, command: str, args: list[str]) -> RunResult:
    cfg = settings()

    if command not in COMMANDS:
        raise ValueError(f"Command not permitted: {command}")

    argv = [*COMMANDS[command], *args]
    started = time.monotonic()

    proc = await asyncio.create_subprocess_exec(
        *argv,
        cwd=str(workspace.root),
        env=minimal_env(),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        stdin=asyncio.subprocess.DEVNULL,
        preexec_fn=_apply_limits,  # noqa: PLW1509 — deliberate; see _apply_limits
        start_new_session=True,
    )

    cap = cfg.SANDBOX_MAX_OUTPUT_BYTES // 2
    timed_out = False

    try:
        stdout, stderr, code = await asyncio.wait_for(
            asyncio.gather(
                _read(proc.stdout, cap), _read(proc.stderr, cap), proc.wait()
            ),
            timeout=cfg.SANDBOX_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        timed_out = True
        # The whole group, not the leader: a run that forked leaves orphans
        # holding memory and file handles otherwise. SIGKILL because a run
        # already past its deadline has forfeited a graceful exit.
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            pass
        await proc.wait()
        stdout, stderr, code = ("", False), ("", False), None

    duration = int((time.monotonic() - started) * 1000)
    out, out_cut = stdout
    err, err_cut = stderr

    return RunResult(
        ok=(code == 0 and not timed_out),
        exit_code=code,
        stdout=out,
        stderr=err,
        duration_ms=duration,
        timed_out=timed_out,
        truncated=out_cut or err_cut,
    )
