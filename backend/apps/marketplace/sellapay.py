from __future__ import annotations

import logging
from decimal import Decimal
from typing import Any

import requests
from django.conf import settings
from django.core.cache import cache

logger = logging.getLogger("apps.marketplace.sellapay")

SELLAPAY_TOKEN_CACHE_KEY = "sellapay:marketplace:token"
SELLAPAY_TOKEN_SKEW_SECONDS = 60


class SellapayConfigurationError(RuntimeError):
    """Raised when SellaPay credentials are not configured."""


class SellapayApiError(RuntimeError):
    """Raised when the SellaPay API rejects or fails a request."""

    def __init__(
        self,
        message: str,
        *,
        status_code: int | None = None,
        payload: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.payload = payload or {}


def _sellapay_base_url() -> str:
    return str(getattr(settings, "SELLAPAY_BASE_URL", "")).rstrip("/")


def _sellapay_timeout() -> int:
    return int(getattr(settings, "SELLAPAY_TIMEOUT_SECONDS", 20))


def _sellapay_credentials() -> tuple[str, str]:
    api_key = str(getattr(settings, "SELLAPAY_API_KEY", "") or "").strip()
    api_secret = str(getattr(settings, "SELLAPAY_API_SECRET", "") or "").strip()
    if not api_key or not api_secret:
        raise SellapayConfigurationError(
            "SellaPay credentials are not configured. Set SELLAPAY_API_KEY and SELLAPAY_API_SECRET."
        )
    return api_key, api_secret


def normalize_sellapay_phone(phone_number: str) -> str:
    """Convert a stored phone number into SellaPay's local 9-digit format."""

    digits = "".join(character for character in str(phone_number or "") if character.isdigit())
    if not digits:
        raise ValueError("A phone number is required to request the M-Pesa prompt.")

    if digits.startswith("254") and len(digits) == 12:
        digits = digits[3:]
    elif digits.startswith("0") and len(digits) == 10:
        digits = digits[1:]

    if len(digits) != 9 or digits[0] not in {"7", "1"}:
        raise ValueError("Use a Kenyan Safaricom number in the format +2547XXXXXXXX or 07XXXXXXXX.")

    return digits


def authorize_sellapay(*, force_refresh: bool = False) -> dict[str, Any]:
    """Obtain and cache the Sellapay bearer token."""

    cache_key = SELLAPAY_TOKEN_CACHE_KEY
    if not force_refresh:
        cached_token = cache.get(cache_key)
        if cached_token:
            return {"access_token": cached_token}

    api_key, api_secret = _sellapay_credentials()
    response = requests.post(
        f"{_sellapay_base_url()}/authorize",
        headers={
            "X-API-KEY": api_key,
            "X-API-SECRET": api_secret,
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
        json={},
        timeout=_sellapay_timeout(),
    )

    try:
        payload = response.json()
    except ValueError:
        payload = {}

    if not response.ok:
        raise SellapayApiError(
            payload.get("message")
            or payload.get("error")
            or "Unable to authorize with SellaPay.",
            status_code=response.status_code,
            payload=payload,
        )

    access_token = payload.get("access_token")
    expires_in = int(payload.get("expires_in") or 3600)
    if not access_token:
        raise SellapayApiError("SellaPay did not return an access token.", payload=payload)

    cache.set(cache_key, access_token, timeout=max(expires_in - SELLAPAY_TOKEN_SKEW_SECONDS, 60))
    return payload


def _sellapay_bearer_token(*, force_refresh: bool = False) -> str:
    payload = authorize_sellapay(force_refresh=force_refresh)
    token = payload.get("access_token")
    if not token:
        raise SellapayApiError("Missing SellaPay access token.", payload=payload)
    return token


def request_stk_push(
    *,
    amount: Decimal | float | int,
    phone_number: str,
    reference: str,
    description: str,
) -> dict[str, Any]:
    """Initiate a Sellapay STK push and return the provider payload."""

    phone = normalize_sellapay_phone(phone_number)
    payload = {
        "phone": phone,
        "amount": float(amount),
        "reference": reference[:20],
        "description": description[:255],
    }

    for attempt in range(2):
        response = requests.post(
            f"{_sellapay_base_url()}/requestStkPush",
            headers={
                "Authorization": f"Bearer {_sellapay_bearer_token(force_refresh=bool(attempt))}",
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=_sellapay_timeout(),
        )

        try:
            data = response.json()
        except ValueError:
            data = {}

        if response.status_code == 401 and attempt == 0:
            cache.delete(SELLAPAY_TOKEN_CACHE_KEY)
            continue

        if not response.ok:
            raise SellapayApiError(
                data.get("message")
                or data.get("error")
                or "SellaPay could not start the payment prompt.",
                status_code=response.status_code,
                payload=data,
            )

        logger.info(
            "Sellapay STK push initiated | reference=%s | phone=%s | status=%s",
            payload["reference"],
            phone,
            data.get("status") or "unknown",
        )
        return data

    raise SellapayApiError("SellaPay authorization failed after retry.")
