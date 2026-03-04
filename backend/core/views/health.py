"""
ShambaFlow — Health Check Endpoint
Used by Docker, load balancers, and uptime monitors.
Verifies: Django, PostgreSQL (Neon), Redis (Upstash)
"""

import logging
from django.http import JsonResponse
from django.db import connection
from django.core.cache import cache

logger = logging.getLogger('shambaflow')


def health_check(request):
    """
    GET /health/
    Returns 200 if all critical services are reachable, 503 otherwise.
    """
    status = {
        'django': True,
        'postgres': False,
        'redis': False,
    }

    # Check Neon PostgreSQL
    try:
        connection.ensure_connection()
        with connection.cursor() as cursor:
            cursor.execute('SELECT 1')
        status['postgres'] = True
    except Exception as e:
        logger.error('Health check — Postgres unreachable: %s', e)

    # Check Upstash Redis
    try:
        cache.set('health_ping', 'pong', timeout=5)
        result = cache.get('health_ping')
        status['redis'] = result == 'pong'
    except Exception as e:
        logger.error('Health check — Redis unreachable: %s', e)

    all_healthy = all(status.values())
    http_status = 200 if all_healthy else 503

    return JsonResponse(
        {
            'status': 'healthy' if all_healthy else 'degraded',
            'services': status,
        },
        status=http_status,
    )