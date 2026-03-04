"""
ShambaFlow — Redis Cache Utilities (Upstash)
Thin wrappers around Django's cache framework tuned for Upstash Redis.
Provides typed helpers for the most common caching patterns in ShambaFlow.
"""

import json
import logging
from typing import Any, Optional, Callable
from functools import wraps
from django.core.cache import cache

logger = logging.getLogger('shambaflow.cache')

# ─────────────────────────────────────────
# TTL CONSTANTS (seconds)
# ─────────────────────────────────────────
TTL_SHORT = 60           # 1 minute  — live dashboards
TTL_MEDIUM = 300         # 5 minutes — member lists, tender lists
TTL_LONG = 3600          # 1 hour    — capacity index, schema
TTL_EXTRA_LONG = 86400   # 24 hours  — public profiles, static config


# ─────────────────────────────────────────
# GENERIC CACHE HELPERS
# ─────────────────────────────────────────
def cache_get(key: str) -> Optional[Any]:
    """Retrieve a value from Upstash Redis cache."""
    try:
        return cache.get(key)
    except Exception as e:
        logger.warning('Cache GET failed | key=%s | error=%s', key, e)
        return None


def cache_set(key: str, value: Any, ttl: int = TTL_MEDIUM) -> bool:
    """Store a value in Upstash Redis cache with TTL."""
    try:
        cache.set(key, value, timeout=ttl)
        return True
    except Exception as e:
        logger.warning('Cache SET failed | key=%s | error=%s', key, e)
        return False


def cache_delete(key: str) -> bool:
    """Remove a key from cache."""
    try:
        cache.delete(key)
        return True
    except Exception as e:
        logger.warning('Cache DELETE failed | key=%s | error=%s', key, e)
        return False


def cache_delete_pattern(pattern: str) -> None:
    """
    Delete all cache keys matching a pattern prefix.
    Example: cache_delete_pattern('cooperative:123:*')
    """
    try:
        from django_redis import get_redis_connection
        con = get_redis_connection('default')
        # Upstash Redis supports SCAN — safe for production
        keys = con.keys(f'shambaflow:{pattern}')
        if keys:
            con.delete(*keys)
            logger.debug('Cache pattern deleted | pattern=%s | count=%d', pattern, len(keys))
    except Exception as e:
        logger.warning('Cache pattern delete failed | pattern=%s | error=%s', pattern, e)


# ─────────────────────────────────────────
# CACHE KEY BUILDERS
# Centralised key definitions — prevents typos and collisions
# ─────────────────────────────────────────
class CacheKeys:
    """Structured cache key factory for all ShambaFlow entities."""

    # Schema (Adaptive Convergence — schema-driven frontend)
    @staticmethod
    def model_schema(model_name: str) -> str:
        return f'schema:{model_name}'

    @staticmethod
    def all_schemas() -> str:
        return 'schema:all'

    # Cooperative
    @staticmethod
    def cooperative(cooperative_id: str) -> str:
        return f'cooperative:{cooperative_id}'

    @staticmethod
    def cooperative_members(cooperative_id: str, page: int = 1) -> str:
        return f'cooperative:{cooperative_id}:members:page:{page}'

    @staticmethod
    def cooperative_capacity(cooperative_id: str) -> str:
        return f'cooperative:{cooperative_id}:capacity'

    @staticmethod
    def cooperative_public_profile(cooperative_id: str) -> str:
        return f'cooperative:{cooperative_id}:public_profile'

    # Tenders
    @staticmethod
    def tender_list(page: int = 1, filters: str = '') -> str:
        return f'tenders:list:page:{page}:{filters}'

    @staticmethod
    def tender_detail(tender_id: str) -> str:
        return f'tender:{tender_id}'

    @staticmethod
    def tender_bids(tender_id: str) -> str:
        return f'tender:{tender_id}:bids'

    # User
    @staticmethod
    def user_profile(user_id: str) -> str:
        return f'user:{user_id}:profile'

    # Form templates
    @staticmethod
    def form_templates(cooperative_id: str, module: str = '') -> str:
        return f'cooperative:{cooperative_id}:form_templates:{module}'

    # Reputation
    @staticmethod
    def reputation_score(cooperative_id: str) -> str:
        return f'cooperative:{cooperative_id}:reputation'


# ─────────────────────────────────────────
# CACHE DECORATOR
# ─────────────────────────────────────────
def cached(key_fn: Callable, ttl: int = TTL_MEDIUM):
    """
    Decorator to cache the return value of a function.

    Usage:
        @cached(key_fn=lambda coop_id: CacheKeys.cooperative(coop_id), ttl=TTL_LONG)
        def get_cooperative(coop_id):
            ...
    """
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            cache_key = key_fn(*args, **kwargs)
            cached_value = cache_get(cache_key)

            if cached_value is not None:
                logger.debug('Cache HIT | key=%s', cache_key)
                return cached_value

            logger.debug('Cache MISS | key=%s', cache_key)
            result = func(*args, **kwargs)

            if result is not None:
                cache_set(cache_key, result, ttl=ttl)

            return result
        return wrapper
    return decorator


# ─────────────────────────────────────────
# CAPACITY INDEX CACHE HELPERS
# ─────────────────────────────────────────
def get_cached_capacity_index(cooperative_id: str) -> Optional[dict]:
    """Retrieve a cooperative's cached capacity index."""
    return cache_get(CacheKeys.cooperative_capacity(cooperative_id))


def set_cached_capacity_index(cooperative_id: str, index_data: dict) -> None:
    """Store a cooperative's capacity index. TTL = 1 hour."""
    cache_set(CacheKeys.cooperative_capacity(cooperative_id), index_data, ttl=TTL_LONG)


def invalidate_cooperative_cache(cooperative_id: str) -> None:
    """
    Invalidate all cached data for a cooperative.
    Called after member updates, production record saves, etc.
    """
    keys_to_delete = [
        CacheKeys.cooperative(cooperative_id),
        CacheKeys.cooperative_capacity(cooperative_id),
        CacheKeys.cooperative_public_profile(cooperative_id),
        CacheKeys.reputation_score(cooperative_id),
    ]
    for key in keys_to_delete:
        cache_delete(key)

    # Also clear paginated member lists
    cache_delete_pattern(f'cooperative:{cooperative_id}:members:*')
    cache_delete_pattern(f'cooperative:{cooperative_id}:form_templates:*')

    logger.info('Cooperative cache invalidated | id=%s', cooperative_id)


# ─────────────────────────────────────────
# SCHEMA CACHE HELPERS
# Used by Adaptive Convergence schema introspection layer
# ─────────────────────────────────────────
def get_cached_schema(model_name: str) -> Optional[dict]:
    """Return cached schema for a Django model."""
    return cache_get(CacheKeys.model_schema(model_name))


def set_cached_schema(model_name: str, schema: dict) -> None:
    """Cache a model schema for 24 hours (schemas rarely change)."""
    cache_set(CacheKeys.model_schema(model_name), schema, ttl=TTL_EXTRA_LONG)


def invalidate_schema_cache(model_name: str = None) -> None:
    """Invalidate schema cache — called after migrations."""
    if model_name:
        cache_delete(CacheKeys.model_schema(model_name))
    else:
        cache_delete(CacheKeys.all_schemas())
        cache_delete_pattern('schema:*')
    logger.info('Schema cache invalidated | model=%s', model_name or 'ALL')