"""The model call.

One function, one contract: given a system prompt and a task, return parsed
JSON or raise. Every role speaks JSON, so parsing lives here rather than being
re-invented ten times with ten different failure behaviours.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

import httpx

from ..config import settings

log = logging.getLogger(__name__)

_FENCE = re.compile(r"^```(?:json)?\s*([\s\S]*?)\s*```$", re.IGNORECASE)


class ModelUnavailable(RuntimeError):
    """No provider is configured, or none could be reached."""


class ModelOutputInvalid(RuntimeError):
    """The model answered, but not in the shape the role requires."""


def _extract(text: str) -> str:
    """Strip a fence a model adds despite being told not to."""
    stripped = text.strip()
    m = _FENCE.match(stripped)
    return m.group(1).strip() if m else stripped


async def complete(system: str, task: str, *, temperature: float) -> dict[str, Any]:
    cfg = settings()

    if not cfg.has_model_provider:
        # Named explicitly. "Something went wrong" sends an operator reading
        # logs instead of reading their environment.
        raise ModelUnavailable(
            "No model provider configured — set OPENAI_API_KEY or ANTHROPIC_API_KEY."
        )

    timeout = httpx.Timeout(cfg.AGENT_TIMEOUT_SECONDS)

    async with httpx.AsyncClient(timeout=timeout) as client:
        if cfg.OPENAI_API_KEY:
            content = await _openai(client, cfg.OPENAI_API_KEY, system, task, temperature)
        else:
            content = await _anthropic(
                client, cfg.ANTHROPIC_API_KEY, system, task, temperature
            )

    try:
        parsed = json.loads(_extract(content))
    except json.JSONDecodeError as exc:
        raise ModelOutputInvalid("Role returned output that was not JSON.") from exc

    if not isinstance(parsed, dict):
        raise ModelOutputInvalid("Role returned JSON that was not an object.")

    return parsed


async def _openai(
    client: httpx.AsyncClient, key: str, system: str, task: str, temperature: float
) -> str:
    r = await client.post(
        "https://api.openai.com/v1/chat/completions",
        headers={"authorization": f"Bearer {key}"},
        json={
            "model": "gpt-4o",
            "temperature": temperature,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": task},
            ],
        },
    )
    # The body can echo the key; only the status is logged.
    if r.status_code >= 400:
        log.error("Model call rejected", extra={"status": r.status_code})
        raise ModelUnavailable(f"Provider returned HTTP {r.status_code}.")

    return r.json()["choices"][0]["message"]["content"]


async def _anthropic(
    client: httpx.AsyncClient, key: str, system: str, task: str, temperature: float
) -> str:
    r = await client.post(
        "https://api.anthropic.com/v1/messages",
        headers={
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        json={
            "model": "claude-sonnet-4-5",
            "max_tokens": 8192,
            "temperature": temperature,
            "system": system,
            "messages": [{"role": "user", "content": task}],
        },
    )
    if r.status_code >= 400:
        log.error("Model call rejected", extra={"status": r.status_code})
        raise ModelUnavailable(f"Provider returned HTTP {r.status_code}.")

    return r.json()["content"][0]["text"]
