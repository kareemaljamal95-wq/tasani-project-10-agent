"""Sandbox configuration.

Every value here is a ceiling on what a run may consume, and the network policy
is a declaration the operator must make by hand. There is no default for it on
purpose: the failure this guards against is a sandbox that quietly executes
model-written code with open egress because nobody set a variable.
"""

from __future__ import annotations

import os
from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _strip_blanks() -> None:
    for key, value in list(os.environ.items()):
        if isinstance(value, str) and value.strip() == "":
            del os.environ[key]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    SANDBOX_SECRET: str

    # Deliberately optional in type and mandatory in effect: an unset policy
    # leaves the service healthy but refusing to run, which is loud without
    # being a crash loop.
    SANDBOX_NETWORK_POLICY: Literal["blocked-at-platform", "allowed", ""] = ""

    SANDBOX_TIMEOUT_SECONDS: int = Field(default=60, ge=1, le=900)
    SANDBOX_MEMORY_MB: int = Field(default=512, ge=64, le=8192)
    SANDBOX_CPU_SECONDS: int = Field(default=45, ge=1, le=900)
    SANDBOX_MAX_OUTPUT_BYTES: int = Field(default=200_000, ge=1_000)
    SANDBOX_MAX_FILE_BYTES: int = Field(default=1_000_000, ge=1_000)
    SANDBOX_MAX_FILES: int = Field(default=200, ge=1, le=5_000)
    SANDBOX_MAX_CONCURRENT: int = Field(default=2, ge=1, le=16)

    @field_validator("SANDBOX_SECRET", mode="before")
    @classmethod
    def _trim(cls, v: str | None) -> str | None:
        return v.strip() if isinstance(v, str) else v

    @property
    def executes(self) -> bool:
        """Whether the operator has declared an egress posture."""
        return self.SANDBOX_NETWORK_POLICY in ("blocked-at-platform", "allowed")


@lru_cache(maxsize=1)
def settings() -> Settings:
    _strip_blanks()
    return Settings()
