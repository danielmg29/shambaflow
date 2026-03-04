"""
ShambaFlow — Base Repository Pattern
Adaptive Convergence: Repository Pattern (RP)

All database operations go through repositories.
This provides a clean interface between views and models.
"""

from typing import Any, Dict, List, Optional, Type, Union
from django.db.models import Model, Q
from django.core.paginator import Paginator
from django.core.exceptions import ValidationError


def create_repository(model_class: Type[Model]) -> Dict[str, Any]:
    """
    Create a repository dictionary with CRUD operations for a model.
    Returns a dict with methods that can be called like: repo['create'](data)
    """
    
    def get_all(
        filters: Optional[Dict[str, Any]] = None,
        order_by: Optional[List[str]] = None,
        page: int = 1,
        page_size: int = 50
    ) -> Dict[str, Any]:
        """Get paginated list with optional filters and ordering."""
        queryset = model_class.objects.all()
        
        # Apply filters
        if filters:
            q_objects = Q()
            for field, value in filters.items():
                if hasattr(model_class, field):
                    q_objects &= Q(**{field: value})
            queryset = queryset.filter(q_objects)
        
        # Apply ordering
        if order_by:
            queryset = queryset.order_by(*order_by)
        
        # Paginate
        paginator = Paginator(queryset, page_size)
        page_obj = paginator.get_page(page)
        
        # Serialize results
        results = []
        for obj in page_obj:
            data = {}
            for field in model_class._meta.fields:
                value = getattr(obj, field.name)
                if field.is_relation and value:
                    data[field.name] = str(value.pk)
                else:
                    data[field.name] = value
            results.append(data)
        
        return {
            'count': paginator.count,
            'num_pages': paginator.num_pages,
            'current_page': page,
            'next': page_obj.next_page_number() if page_obj.has_next() else None,
            'previous': page_obj.previous_page_number() if page_obj.has_previous() else None,
            'results': results
        }
    
    def get_by_id(pk: Union[str, int]) -> Optional[Model]:
        """Get a single instance by primary key."""
        try:
            return model_class.objects.get(pk=pk)
        except model_class.DoesNotExist:
            return None
    
    def create(data: Dict[str, Any]) -> Model:
        """Create a new instance."""
        try:
            instance = model_class(**data)
            instance.full_clean()
            instance.save()
            return instance
        except ValidationError as e:
            raise e
        except Exception as e:
            raise ValidationError(str(e))
    
    def update(pk: Union[str, int], data: Dict[str, Any]) -> Optional[Model]:
        """Update an instance (full update)."""
        instance = get_by_id(pk)
        if not instance:
            return None
        
        try:
            for field, value in data.items():
                if hasattr(instance, field):
                    setattr(instance, field, value)
            instance.full_clean()
            instance.save()
            return instance
        except ValidationError as e:
            raise e
        except Exception as e:
            raise ValidationError(str(e))
    
    def partial_update(pk: Union[str, int], data: Dict[str, Any]) -> Optional[Model]:
        """Partial update an instance."""
        instance = get_by_id(pk)
        if not instance:
            return None
        
        try:
            for field, value in data.items():
                if hasattr(instance, field):
                    setattr(instance, field, value)
            instance.save()
            return instance
        except Exception as e:
            raise ValidationError(str(e))
    
    def delete(pk: Union[str, int]) -> bool:
        """Delete an instance."""
        instance = get_by_id(pk)
        if not instance:
            return False
        
        instance.delete()
        return True
    
    return {
        'get_all': get_all,
        'get_by_id': get_by_id,
        'create': create,
        'update': update,
        'partial_update': partial_update,
        'delete': delete,
    }


def get_repository(model_class: Type[Model]) -> Dict[str, Any]:
    """Get repository for a model (alias for create_repository)."""
    return create_repository(model_class)