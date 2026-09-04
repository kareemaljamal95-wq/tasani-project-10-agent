"""Environment contract, validated once at boot.

Fail-closed everywhere: a missing credential stops the process rather than
letting the line run in a half-configured mode that looks healthy and quietly
skips a step.

Two rules carried over from the main platform, both of which cost real
incidents to learn:

* A variable present but blank is, to an operator, the same as one never set.
  Pydantic disagrees — an empty string satisfies `str`. Blanks are stripped
  before validation so one empty box in a hosting dashboard degrades to the
  documented default instead of poisoning a URL.
* Credentials are stripped of surrounding whitespace. A secret pasted out of a
  provider dashboard with a trailing newline authenticates exactly as badly as
  a wrong one, and looks correct everywhere a human can inspect it.
"""

from __future__ import annotations

import os
from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _strip_blanks() -> None:
    """Remove whitespace-only variables so defaults apply to them."""
    for key, value in list(os.environ.items()):
        if isinstance(value, str) and value.strip() == "":
            del os.environ[key]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DATABASE_URL: str

    # The ingestion webhook's shared secret. Without it every delivery is
    # rejected — the unattended door stays shut rather than defaulting open.
    INGEST_WEBHOOK_SECRET: str

    # Where a finished package is announced. Empty disables delivery entirely;
    # it never falls back to "send anywhere".
    DELIVERY_WEBHOOK_URL: str = ""

    # The execution sandbox. Both are required together; one without the other
    # is a half-configuration that would fail on the first run rather than at
    # boot, so `sandbox_configured` treats it as absent.
    SANDBOX_URL: str = ""
    SANDBOX_SECRET: str = ""
    SANDBOX_TIMEOUT_SECONDS: int = Field(default=120, ge=10, le=900)

    OPENAI_API_KEY: str = ""
    ANTHROPIC_API_KEY: str = ""

    PAYPAL_CLIENT_ID: str = ""
    PAYPAL_CLIENT_SECRET: str = ""
    PAYPAL_ENVIRONMENT: Literal["sandbox", "production"] = "sandbox"
    PAYPAL_WEBHOOK_ID: str = ""

    # A ticket priced above this reaches a human before the line starts. The
    # ceiling exists because an automated line that accepts any price is one
    # malformed payload away from committing to work it cannot deliver.
    AUTO_ACCEPT_CEILING_MINOR: int = Field(default=50_000, ge=0)
    MAX_PARALLEL_AGENTS: int = Field(default=4, ge=1, le=16)
    AGENT_TIMEOUT_SECONDS: int = Field(default=120, ge=10, le=900)

    @field_validator(
        "INGEST_WEBHOOK_SECRET",
        "PAYPAL_CLIENT_ID",
        "PAYPAL_CLIENT_SECRET",
        "PAYPAL_WEBHOOK_ID",
        "SANDBOX_SECRET",
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
        mode="before",
    )
    @classmethod
    def _trim(cls, v: str | None) -> str | None:
        return v.strip() if isinstance(v, str) else v

    @property
    def paypal_base_url(self) -> str:
        return (
            "https://api-m.paypal.com"
            if self.PAYPAL_ENVIRONMENT == "production"
            else "https://api-m.sandbox.paypal.com"
        )

    @property
    def sandbox_configured(self) -> bool:
        return bool(self.SANDBOX_URL and self.SANDBOX_SECRET)

    @property
    def has_model_provider(self) -> bool:
        return bool(self.OPENAI_API_KEY or self.ANTHROPIC_API_KEY)

    @property
    def can_receive_payment(self) -> bool:
        return bool(self.PAYPAL_CLIENT_ID and self.PAYPAL_CLIENT_SECRET)

    @property
    def can_deliver(self) -> bool:
        return bool(self.DELIVERY_WEBHOOK_URL)


@lru_cache(maxsize=1)
def settings() -> Settings:
    _strip_blanks()
    return Settings()  # raises on a missing required value, which is the point
