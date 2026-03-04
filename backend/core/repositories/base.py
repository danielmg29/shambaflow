"""
ShambaFlow — Generic Repository Factory
Adaptive Convergence: Performance-First Architecture (PFA)

One factory function creates repository closures for ANY Django model.
Pure functions only — no class instantiation overhead on hot paths.
All CRUD operations are identical across models; write them ONCE here.
"""

from typing import Type, TypeVar, Optional, Dict, Any, List, Callable
from functools import lru_cache
from django.db.models import Model, QuerySet
from django.core.paginator import Paginator
from django.apps import apps
import logging

logger = logging.getLogger('shambaflow.repositories')

T = TypeVar('T', bound=Model)


def create_repository(model_class: Type[T]) -> Dict[str, Callable]:
    """
    Factory that returns a dict of repository functions for ANY Django model.

    Usage:
        repo = create_repository(Member)
        members = repo['get_all'](filters={'cooperative_id': coop_id})
        member  = repo['get_by_id'](uuid)

    Returns a dict (not a class) — avoids MRO lookups on every request.
    """

    # ── READ — paginated list with optional filters ────────────
    def get_all(
        filters: Optional[Dict[str, Any]] = None,
        exclude: Optional[Dict[str, Any]] = None,
        order_by: Optional[List[str]] = None,
        select_related: Optional[List[str]] = None,
        prefetch_related: Optional[List[str]] = None,
        page: int = 1,
        page_size: int = 50,
    ) -> Dict[str, Any]:
        """
        Return a paginated queryset as plain dicts.
        Direct .values() call avoids model instantiation for list views.
        """
        qs: QuerySet = model_class.objects.all()

        if filters:
            qs = qs.filter(**filters)

        if exclude:
            qs = qs.exclude(**exclude)

        if select_related:
            qs = qs.select_related(*select_related)

        if prefetch_related:
            qs = qs.prefetch_related(*prefetch_related)

        if order_by:
            qs = qs.order_by(*order_by)

        paginator = Paginator(qs, page_size)
        page_obj  = paginator.get_page(page)

        return {
            'data':        list(page_obj.object_list.values()),
            'page':        page,
            'page_size':   page_size,
            'total_pages': paginator.num_pages,
            'total_count': paginator.count,
            'has_next':    page_obj.has_next(),
            'has_prev':    page_obj.has_previous(),
        }

    # ── READ — single instance ─────────────────────────────────
    def get_by_id(pk) -> Optional[T]:
        """Fetch one instance by PK. Returns None if not found."""
        try:
            return model_class.objects.get(pk=pk)
        except model_class.DoesNotExist:
            logger.debug('%s pk=%s not found', model_class.__name__, pk)
            return None

    # ── READ — first match for arbitrary filter ────────────────
    def get_one(filters: Dict[str, Any]) -> Optional[T]:
        """Return first matching instance or None."""
        try:
            return model_class.objects.get(**filters)
        except model_class.DoesNotExist:
            return None
        except model_class.MultipleObjectsReturned:
            logger.warning('%s: multiple results for filters=%s', model_class.__name__, filters)
            return model_class.objects.filter(**filters).first()

    # ── CREATE ─────────────────────────────────────────────────
    def create(data: Dict[str, Any]) -> T:
        """
        Create and persist a new instance.
        Calls full_clean() before save — Django field validation is enforced.
        Raises ValidationError on constraint violation.
        """
        instance = model_class(**data)
        instance.full_clean()
        instance.save()
        logger.info('Created %s pk=%s', model_class.__name__, instance.pk)
        return instance

    # ── UPDATE ─────────────────────────────────────────────────
    def update(pk, data: Dict[str, Any]) -> Optional[T]:
        """
        Fetch, update fields, validate, and save.
        Returns None if instance does not exist.
        """
        instance = get_by_id(pk)
        if not instance:
            return None

        for key, value in data.items():
            setattr(instance, key, value)

        instance.full_clean()
        instance.save()
        logger.info('Updated %s pk=%s fields=%s', model_class.__name__, instance.pk, list(data.keys()))
        return instance

    # ── PARTIAL UPDATE (PATCH) ─────────────────────────────────
    def partial_update(pk, data: Dict[str, Any]) -> Optional[T]:
        """
        Update only specified fields via update_fields for efficiency.
        Skips validation of untouched fields.
        """
        instance = get_by_id(pk)
        if not instance:
            return None

        update_fields = []
        for key, value in data.items():
            setattr(instance, key, value)
            update_fields.append(key)

        instance.save(update_fields=update_fields)
        logger.info('Partial update %s pk=%s fields=%s', model_class.__name__, instance.pk, update_fields)
        return instance

    # ── DELETE ─────────────────────────────────────────────────
    def delete(pk) -> bool:
        """Delete an instance. Returns True on success, False if not found."""
        instance = get_by_id(pk)
        if not instance:
            return False
        instance.delete()
        logger.info('Deleted %s pk=%s', model_class.__name__, pk)
        return True

    # ── EXISTS ─────────────────────────────────────────────────
    def exists(filters: Dict[str, Any]) -> bool:
        """Check existence without fetching data — uses optimised SQL EXISTS."""
        return model_class.objects.filter(**filters).exists()

    # ── COUNT ──────────────────────────────────────────────────
    def count(filters: Optional[Dict[str, Any]] = None) -> int:
        """Return count of matching records."""
        qs = model_class.objects.all()
        if filters:
            qs = qs.filter(**filters)
        return qs.count()

    # ── BULK CREATE ────────────────────────────────────────────
    def bulk_create(data_list: List[Dict[str, Any]], batch_size: int = 500) -> List[T]:
        """
        Create multiple instances in a single DB round-trip.
        Skips full_clean() — caller must validate before calling.
        """
        instances = [model_class(**data) for data in data_list]
        created = model_class.objects.bulk_create(instances, batch_size=batch_size)
        logger.info('Bulk created %d %s instances', len(created), model_class.__name__)
        return created

    return {
        'get_all':       get_all,
        'get_by_id':     get_by_id,
        'get_one':       get_one,
        'create':        create,
        'update':        update,
        'partial_update': partial_update,
        'delete':        delete,
        'exists':        exists,
        'count':         count,
        'bulk_create':   bulk_create,
    }


@lru_cache(maxsize=64)
def get_repository(app_label: str, model_name: str) -> Dict[str, Callable]:
    """
    Cached repository factory.
    lru_cache ensures each model's repository is created ONCE per process lifetime.
    Cache invalidates on process restart (acceptable — repos are stateless).
    """
    model_class = apps.get_model(app_label, model_name)
    return create_repository(model_class)


# ── Convenience pre-built repositories for ShambaFlow models ──────
# Import lazily to avoid circular imports at module load time.

def cooperative_repo():
    return get_repository('core', 'Cooperative')

def member_repo():
    return get_repository('core', 'Member')

def tender_repo():
    return get_repository('core', 'Tender')

def bid_repo():
    return get_repository('core', 'Bid')

def reputation_repo():
    return get_repository('core', 'ReputationLedger')

def capacity_repo():
    return get_repository('core', 'CapacityMetric')

def form_template_repo():
    return get_repository('core', 'FormTemplate')

def form_submission_repo():
    return get_repository('core', 'FormSubmission')