"""
ShambaFlow WSGI Configuration

Used by:
  - Gunicorn (production):  gunicorn shambaflow.wsgi
  - Django dev server:      python manage.py runserver (falls back to this)

For real-time WebSocket support (Django Channels), the production
server uses asgi.py + Daphne/Uvicorn instead.

WSGI handles standard HTTP requests only.
"""

import os
from django.core.wsgi import get_wsgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'shambaflow.settings')

application = get_wsgi_application()