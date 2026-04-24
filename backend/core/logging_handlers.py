"""
Logging helpers for ShambaFlow.

Windows + OneDrive can briefly lock the active log file while it is being
indexed or synced. Django's default RotatingFileHandler uses os.rename() for
rollover, which raises PermissionError in that situation and then floods the
console with logging failures.

This handler keeps normal size-based rotation, but if rollover is blocked it
quietly defers rotation for a short cooldown window and continues appending to
the current file.
"""

from __future__ import annotations

import os
import time
from logging import FileHandler
from logging.handlers import RotatingFileHandler


class SafeRotatingFileHandler(RotatingFileHandler):
    """
    RotatingFileHandler variant that tolerates transient Windows file locks.
    """

    def __init__(self, *args, rollover_cooldown: float = 30.0, **kwargs):
        self.rollover_cooldown = float(rollover_cooldown)
        self._rollover_retry_at = 0.0
        super().__init__(*args, **kwargs)

    def emit(self, record):
        try:
            if self.shouldRollover(record):
                self._maybe_rollover()
            FileHandler.emit(self, record)
        except Exception:
            self.handleError(record)

    def _maybe_rollover(self) -> None:
        now = time.monotonic()
        if now < self._rollover_retry_at:
            return

        try:
            super().doRollover()
            self._rollover_retry_at = 0.0
        except PermissionError:
            self._defer_rollover()
        except OSError as exc:
            if os.name == "nt" and getattr(exc, "winerror", None) in {32, 33}:
                self._defer_rollover()
                return
            raise

    def _defer_rollover(self) -> None:
        self._rollover_retry_at = time.monotonic() + self.rollover_cooldown
        try:
            if self.stream:
                self.stream.flush()
                self.stream.close()
        finally:
            self.stream = self._open()
