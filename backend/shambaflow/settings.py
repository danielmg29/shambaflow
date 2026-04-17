"""
ShambaFlow Django Settings
Adaptive Convergence Architecture — Single source of truth backend
Configured for: Neon PostgreSQL | Upstash Redis | Brevo Email | Infobip SMS
"""

import os
from pathlib import Path
from datetime import timedelta
import os
from dotenv import load_dotenv
from urllib.parse import urlparse, parse_qsl
import environ


load_dotenv()
# ─────────────────────────────────────────
# PATH & ENVIRONMENT BOOTSTRAP
# ─────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parent.parent

env = environ.Env(
    DJANGO_DEBUG=(bool, False),
    DJANGO_SECRET_KEY=(str, 'insecure-default-key-change-in-production'),
    DJANGO_ALLOWED_HOSTS=(list, ['localhost', '127.0.0.1']),
    DJANGO_CORS_ALLOWED_ORIGINS=(list, ['http://localhost:3000']),
)

env_file = BASE_DIR / '.env'
root_env_file = BASE_DIR.parent / '.env'
environ.Env.read_env(env_file if env_file.exists() else root_env_file)


def unfold_brand_styles(request):
    from django.templatetags.static import static

    return static('shambaflow/unfold_brand.css')


def unfold_brand_logo(request):
    from django.templatetags.static import static

    return static('shambaflow/logo-full.svg')

# ─────────────────────────────────────────
# CORE SETTINGS
# ─────────────────────────────────────────
SECRET_KEY = env('DJANGO_SECRET_KEY')
DEBUG = env('DJANGO_DEBUG')
ALLOWED_HOSTS = env.list('DJANGO_ALLOWED_HOSTS')
FRONTEND_URL = env('FRONTEND_URL', default='http://localhost:3000')

# ─────────────────────────────────────────
# INSTALLED APPS
# ─────────────────────────────────────────
DJANGO_APPS = [
    "unfold",  # before django.contrib.admin
    "unfold.contrib.filters",  # optional, if special filters are needed
    "unfold.contrib.forms",  # optional, if special form elements are needed
    "unfold.contrib.inlines",  # optional, if special inlines are needed
    "unfold.contrib.import_export",  # optional, if django-import-export package is used
    "unfold.contrib.guardian",  # optional, if django-guardian package is used
    "unfold.contrib.simple_history",  # optional, if django-simple-history package is used
    "unfold.contrib.location_field",  # optional, if django-location-field package is used
    "unfold.contrib.constance",  # optional, if django-constance package is used
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
]

THIRD_PARTY_APPS = [
    'rest_framework',
    'rest_framework_simplejwt',
    'rest_framework_simplejwt.token_blacklist',
    'corsheaders',
    'channels',
    'django_ckeditor_5',        # Rich text editor for governance notes, etc.
    'drf_spectacular',          # OpenAPI 3.0 / Swagger UI
    'import_export',            # Unfold import-export integration
]

LOCAL_APPS = [
    'core',                # All models + auth + Adaptive Convergence engine
    'apps.identity',      # Identity management
    'apps.crm',            # Cooperative CRM
    'apps.marketplace',    # Tender marketplace
    'apps.reputation',     # Reputation ledger
    'apps.notifications',  # Notification dispatcher
]

INSTALLED_APPS = DJANGO_APPS + THIRD_PARTY_APPS + LOCAL_APPS

# ─────────────────────────────────────────
# MIDDLEWARE
# ─────────────────────────────────────────
MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',            # Must be first
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
    'core.middleware.RequestLoggingMiddleware',          # Custom audit logger
]

ROOT_URLCONF = 'shambaflow.urls'
WSGI_APPLICATION = 'shambaflow.wsgi.application'
ASGI_APPLICATION = 'shambaflow.asgi.application'

# ─────────────────────────────────────────
# TEMPLATES
# ─────────────────────────────────────────
TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [BASE_DIR / 'templates'],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

def _is_neon_host(host: str | None) -> bool:
    return bool(host and "neon.tech" in host)


def _apply_database_defaults(config: dict) -> dict:
    options = dict(config.get('OPTIONS') or {})
    host = str(config.get('HOST') or '')

    config['CONN_MAX_AGE'] = config.get('CONN_MAX_AGE', 60)
    config['CONN_HEALTH_CHECKS'] = True

    if _is_neon_host(host):
        options.setdefault('sslmode', 'require')
        options.setdefault('connect_timeout', 10)
        options.setdefault('keepalives', 1)
        options.setdefault('keepalives_idle', 30)
        options.setdefault('keepalives_interval', 10)
        options.setdefault('keepalives_count', 5)
        options.setdefault('options', '-c statement_timeout=30000')

    config['OPTIONS'] = options
    return config


def _database_from_url(url: str | None) -> dict:
    parsed = urlparse(url or "")
    config = {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': parsed.path.replace('/', ''),
        'USER': parsed.username,
        'PASSWORD': parsed.password,
        'HOST': parsed.hostname,
        'PORT': parsed.port or 5432,
        'OPTIONS': dict(parse_qsl(parsed.query)),
    }
    return _apply_database_defaults(config)


# ─────────────────────────────────────────
# DATABASE — SQLite for local development
# Comment this out and use Neon config below for production
# ─────────────────────────────────────────
DATABASE_URL = env('DATABASE_URL', default='')
DATABASE_URL_UNPOOLED = env('DATABASE_URL_UNPOOLED', default=None)
ACTIVE_DATABASE_URL = DATABASE_URL_UNPOOLED if DEBUG and DATABASE_URL_UNPOOLED else DATABASE_URL

DATABASES = {
    'default': _database_from_url(ACTIVE_DATABASE_URL)
}

# ─────────────────────────────────────────
# DATABASE — Neon PostgreSQL
# https://console.neon.tech
# Uncomment this section for production/Neon usage
# ─────────────────────────────────────────
# DATABASES = {
#     'default': {
#         'ENGINE': 'django.db.backends.postgresql',
#         'NAME': env('DB_NAME', default='shambaflow'),
#         'USER': env('DB_USER', default='postgres'),
#         'PASSWORD': env('DB_PASSWORD', default=''),
#         'HOST': env('DB_HOST', default='localhost'),
#         'PORT': env('DB_PORT', default='5432'),
#
#         # Neon requires SSL
#         'OPTIONS': {
#             'sslmode': 'require',
#             'connect_timeout': 10,
#             'options': '-c statement_timeout=30000',
#         },
#
#         # Connection pooling — critical for Neon serverless
#         'CONN_MAX_AGE': 60,          # 60s pooled connections (Neon compatible)
#         'CONN_HEALTH_CHECKS': True,  # Django 4.1+ health checks
#     }
# }

# Allow DATABASE_URL override (used in Docker / CI)
# Add these at the top of your settings.py
import os
from dotenv import load_dotenv
from urllib.parse import urlparse, parse_qsl

load_dotenv()

# Replace the DATABASES section of your settings.py with this
tmpPostgres = urlparse(os.getenv("DATABASE_URL"))

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': tmpPostgres.path.replace('/', ''),
        'USER': tmpPostgres.username,
        'PASSWORD': tmpPostgres.password,
        'HOST': tmpPostgres.hostname,
        'PORT': 5432,
        'OPTIONS': dict(parse_qsl(tmpPostgres.query)),
    }
}
# ─────────────────────────────────────────
# CACHE — Upstash Redis
# Disabled for development - enable in production with Redis
# ─────────────────────────────────────────
REDIS_URL = env('REDIS_URL', default='redis://localhost:6379/0')

# Use local in-memory cache for development (no Redis required)
CACHES = {
    'default': {
        'BACKEND': 'django.core.cache.backends.locmem.LocMemCache',
        'LOCATION': 'shambaflow-dev',
    }
}

# Production cache configuration (uncomment for production with Redis)
# CACHES = {
#     'default': {
#         'BACKEND': 'django_redis.cache.RedisCache',
#         'LOCATION': REDIS_URL,
#         'OPTIONS': {
#             'CLIENT_CLASS': 'django_redis.client.DefaultClient',
#             'CONNECTION_POOL_KWARGS': {
#                 'max_connections': 20,       # Upstash free tier: keep low
#                 'socket_connect_timeout': 5,
#                 'socket_timeout': 5,
#                 'retry_on_timeout': True,
#             },
#             'SERIALIZER': 'django_redis.serializers.json.JSONSerializer',
#
#             # Upstash requires TLS — handled via rediss:// URL
#             # If using REST-based Upstash, set this:
#             # 'PASSWORD': env('UPSTASH_REDIS_REST_TOKEN', default=''),
#         },
#         'KEY_PREFIX': 'shambaflow',
#         'TIMEOUT': 3600,     # Default 1hr TTL
#     }
# }

# Django session via database (development) - switch to Redis in production
SESSION_ENGINE = 'django.contrib.sessions.backends.db'

# ─────────────────────────────────────────
# DJANGO CHANNELS — WebSocket via Redis
# Disabled for development - enable in production with Redis
# ─────────────────────────────────────────
# CHANNEL_LAYERS = {
#     'default': {
#         'BACKEND': 'channels_redis.core.RedisChannelLayer',
#         'CONFIG': {
#             'hosts': [REDIS_URL],
#             'capacity': 1500,
#             'expiry': 10,
#         },
#     },
# }
# Disable Django's automatic slash-append redirect.
# All API endpoints explicitly declare trailing slashes in urls.py.
# Without this, POST requests to a URL missing a trailing slash cause a 500
# because Django cannot redirect a POST while preserving its body.
APPEND_SLASH = False
# ─────────────────────────────────────────
# AUTHENTICATION — Custom User Model
# ─────────────────────────────────────────
AUTH_USER_MODEL = 'core.User'        # User model lives in core/models.py

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
     'OPTIONS': {'min_length': 8}},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

# ─────────────────────────────────────────
# JWT — djangorestframework-simplejwt
# ─────────────────────────────────────────
SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(
        hours=env.int('JWT_ACCESS_TOKEN_EXPIRY_HOURS', default=24)
    ),
    'REFRESH_TOKEN_LIFETIME': timedelta(
        days=env.int('JWT_REFRESH_TOKEN_EXPIRY_DAYS', default=7)
    ),
    'ROTATE_REFRESH_TOKENS': True,
    'BLACKLIST_AFTER_ROTATION': True,
    'UPDATE_LAST_LOGIN': True,
    'ALGORITHM': env('JWT_ALGORITHM', default='HS256'),
    'SIGNING_KEY': env('JWT_SECRET_KEY', default=SECRET_KEY),
    'AUTH_HEADER_TYPES': ('Bearer',),
    'AUTH_HEADER_NAME': 'HTTP_AUTHORIZATION',
    'USER_ID_FIELD': 'id',
    'USER_ID_CLAIM': 'user_id',
    'TOKEN_OBTAIN_SERIALIZER': 'core.auth.serializers.ShambaFlowTokenObtainSerializer',
}

# ─────────────────────────────────────────
# DJANGO REST FRAMEWORK
# ─────────────────────────────────────────
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'rest_framework_simplejwt.authentication.JWTAuthentication',
    ],
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.IsAuthenticated',
    ],
    'DEFAULT_RENDERER_CLASSES': [
        'rest_framework.renderers.JSONRenderer',
    ],
    'DEFAULT_PARSER_CLASSES': [
        'rest_framework.parsers.JSONParser',
        'rest_framework.parsers.MultiPartParser',  # File uploads
        'rest_framework.parsers.FormParser',
    ],
    'DEFAULT_PAGINATION_CLASS': 'core.pagination.StandardResultsPagination',
    'PAGE_SIZE': 50,
    'DEFAULT_SCHEMA_CLASS': 'drf_spectacular.openapi.AutoSchema',
    'DEFAULT_THROTTLE_CLASSES': [
        'rest_framework.throttling.AnonRateThrottle',
        'rest_framework.throttling.UserRateThrottle',
    ],
    'DEFAULT_THROTTLE_RATES': {
        'anon': '100/hour',
        'user': '1000/hour',
        'auth': '10/minute',      # Login / registration
        'sms_otp': '5/hour',      # Infobip OTP sends
    },
    'EXCEPTION_HANDLER': 'core.exceptions.custom_exception_handler',
}

# ─────────────────────────────────────────
# CORS — Cross-Origin Resource Sharing
# ─────────────────────────────────────────
CORS_ALLOWED_ORIGINS = env.list(
    'DJANGO_CORS_ALLOWED_ORIGINS',
    default=['http://localhost:3000']
)
CORS_ALLOW_CREDENTIALS = True
CORS_ALLOW_HEADERS = [
    'accept',
    'accept-encoding',
    'authorization',
    'content-type',
    'dnt',
    'origin',
    'user-agent',
    'x-csrftoken',
    'x-requested-with',
    'x-cooperative-id',     # ShambaFlow custom header
]

# ─────────────────────────────────────────
# EMAIL — Brevo (formerly Sendinblue)
# https://app.brevo.com → SMTP & API
# ─────────────────────────────────────────
BREVO_API_KEY = env('BREVO_API_KEY', default='')
BREVO_SENDER_EMAIL = env('BREVO_SENDER_EMAIL', default='noreply@shambaflow.com')
BREVO_SENDER_NAME = env('BREVO_SENDER_NAME', default='ShambaFlow')

# Django email backend — routes through Brevo SMTP
EMAIL_BACKEND = 'django.core.mail.backends.smtp.EmailBackend'
EMAIL_HOST = 'smtp-relay.brevo.com'
EMAIL_PORT = 587
EMAIL_USE_TLS = True
EMAIL_HOST_USER = env('BREVO_SENDER_EMAIL', default='')
EMAIL_HOST_PASSWORD = env('BREVO_SMTP_KEY', default='')    # Brevo SMTP key (different from API key)
DEFAULT_FROM_EMAIL = f"{BREVO_SENDER_NAME} <{BREVO_SENDER_EMAIL}>"
SERVER_EMAIL = BREVO_SENDER_EMAIL

# ─────────────────────────────────────────
# SMS — Infobip
# https://portal.infobip.com
# ─────────────────────────────────────────
INFOBIP_API_KEY = env('INFOBIP_API_KEY', default='')
INFOBIP_BASE_URL = env('INFOBIP_BASE_URL', default='https://api.infobip.com')
INFOBIP_SENDER_ID = env('INFOBIP_SENDER_ID', default='ShambaFlow')

# ─────────────────────────────────────────
# STATIC & MEDIA FILES
# ─────────────────────────────────────────
STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
STATICFILES_DIRS = [BASE_DIR / 'static']

# In production, use hashed static files (requires running `collectstatic`)
if not DEBUG:
    STATICFILES_STORAGE = 'django.contrib.staticfiles.storage.ManifestStaticFilesStorage'

MEDIA_URL = env('MEDIA_URL', default='/media/')
MEDIA_ROOT = BASE_DIR / env('MEDIA_ROOT', default='media')

MAX_UPLOAD_SIZE = env.int('MAX_UPLOAD_SIZE_MB', default=10) * 1024 * 1024

# ─────────────────────────────────────────
# INTERNATIONALISATION
# ─────────────────────────────────────────
LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'Africa/Nairobi'    # EAT — primary market
USE_I18N = True
USE_TZ = True

# ─────────────────────────────────────────
# DEFAULT PRIMARY KEY
# ─────────────────────────────────────────
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# ─────────────────────────────────────────
# SHAMBAFLOW APPLICATION CONFIG
# ─────────────────────────────────────────
SHAMBAFLOW = {
    # Cooperative settings
    'MAX_HELPER_ACCOUNTS': 20,
    'COOPERATIVE_TYPES': ['CROP', 'LIVESTOCK', 'MIXED'],
    'HELPER_ROLES': ['MANAGER', 'TREASURER', 'CLERK', 'DATA_OFFICER', 'EXTENSION_OFFICER'],

    # CRM settings
    'FORM_BUILDER_FIELD_TYPES': [
        'text', 'number', 'date', 'dropdown',
        'multi_select', 'boolean', 'file_upload', 'gps',
    ],
    'FORM_TAG_TYPES': ['CAPACITY', 'GOVERNANCE', 'FINANCIAL', 'INFORMATIONAL'],

    # Marketplace settings
    'TENDER_ELIGIBILITY_TIERS': ['OPEN', 'PREMIUM'],
    'MIN_CAPACITY_INDEX_FOR_PREMIUM': 60,  # Out of 100

    # Capacity index calculation weights
    'CAPACITY_WEIGHTS': {
        'data_completeness': 0.30,
        'production_consistency': 0.35,
        'governance_participation': 0.20,
        'verification_status': 0.15,
    },

    # Invitation expiry
    'INVITATION_EXPIRY_HOURS': 72,

    # OTP settings (Infobip)
    'OTP_LENGTH': 6,
    'OTP_EXPIRY_MINUTES': 10,
}

# ─────────────────────────────────────────
# DJANGO UNFOLD — Admin UI
# ─────────────────────────────────────────
UNFOLD = {
    'SITE_TITLE': 'ShambaFlow Admin',
    'SITE_HEADER': 'ShambaFlow',
    'SITE_SUBHEADER': 'Digital Infrastructure for Organised Agricultural Supply',
    'SITE_URL': '/',
    'SITE_LOGO': unfold_brand_logo,
    'SITE_SYMBOL': 'agriculture',          # Google Material symbol
    'SHOW_HISTORY': True,
    'SHOW_VIEW_ON_SITE': False,
    'ENVIRONMENT': 'shambaflow.admin_utils.get_environment_label',
    'STYLES': [
        unfold_brand_styles,
    ],
    'COLORS': {
        'base': {
            '50':  '#F5F5F5',  # Neutral (Light)
            '100': '#EAEAEA',
            '200': '#D6D6D6',
            '300': '#BFBFBF',
            '400': '#A0A0A0',
            '500': '#808080',
            '600': '#606060',
            '700': '#444444',
            '800': '#333333',
            '900': '#2C2C2C',  # Neutral (Dark)
            '950': '#1F1F1F',
        },
        'primary': {
            '50':  '#f0fdf4',
            '100': '#dcfce7',
            '200': '#bbf7d0',
            '300': '#86efac',
            '400': '#4ade80',
            '500': '#22c55e',  # Primary brand green
            '600': '#16a34a',
            '700': '#15803d',
            '800': '#166534',
            '900': '#14532d',
            '950': '#052e16',
        },
        'secondary': {
            '50':  '#f7fee7',
            '100': '#ecfccb',
            '200': '#d9f99d',
            '300': '#bef264',
            '400': '#a3e635',
            '500': '#93CE0C',  # Secondary brand lime
            '600': '#65a30d',
            '700': '#4d7c0f',
            '800': '#3f6212',
            '900': '#365314',
            '950': '#1a2e05',
        },
    },
    'SIDEBAR': {
        'show_search': True,
        'show_all_applications': False,
        'navigation': [
            {
                'title': 'Identity & Authority',
                'separator': True,
                'icon': 'manage_accounts',
                'items': [
                    {'title': 'Cooperatives', 'icon': 'groups', 'link': '/admin/core/cooperative/'},
                    {'title': 'Users', 'icon': 'person', 'link': '/admin/core/user/'},
                    {'title': 'Invitations', 'icon': 'mail', 'link': '/admin/core/cooperativeinvitation/'},
                ],
            },
            {
                'title': 'CRM',
                'separator': False,
                'icon': 'folder_shared',
                'items': [
                    {'title': 'Members', 'icon': 'people', 'link': '/admin/core/member/'},
                    {'title': 'Form Templates', 'icon': 'dynamic_form', 'link': '/admin/core/formtemplate/'},
                    {'title': 'Production Records', 'icon': 'agriculture', 'link': '/admin/core/productionrecord/'},
                    {'title': 'Livestock Logs', 'icon': 'pets', 'link': '/admin/core/livestockhealthlog/'},
                    {'title': 'Governance', 'icon': 'gavel', 'link': '/admin/core/governancerecord/'},
                    {'title': 'Financial Records', 'icon': 'account_balance_wallet', 'link': '/admin/core/financialrecord/'},
                ],
            },
            {
                'title': 'Marketplace',
                'separator': False,
                'icon': 'storefront',
                'items': [
                    {'title': 'Buyers', 'icon': 'business', 'link': '/admin/core/buyer/'},
                    {'title': 'Tenders', 'icon': 'assignment', 'link': '/admin/core/tender/'},
                    {'title': 'Bids', 'icon': 'gavel', 'link': '/admin/core/bid/'},
                ],
            },
            {
                'title': 'Analytics & Reputation',
                'separator': False,
                'icon': 'analytics',
                'items': [
                    {'title': 'Capacity Metrics', 'icon': 'speed', 'link': '/admin/core/capacitymetric/'},
                    {'title': 'Reputation Ledger', 'icon': 'star', 'link': '/admin/core/reputationledger/'},
                ],
            },
        ],
    },
}

# ─────────────────────────────────────────
# CKEDITOR 5 — Rich Text Editor
# Used for: Governance notes, resolution text,
# tender descriptions, bid narratives
# ─────────────────────────────────────────
CKEDITOR_5_CONFIGS = {
    'default': {
        'toolbar': [
            'heading', '|',
            'bold', 'italic', 'underline', '|',
            'bulletedList', 'numberedList', '|',
            'blockQuote', 'link', '|',
            'undo', 'redo',
        ],
        'height': 300,
        'width': '100%',
    },
    'extended': {
        'toolbar': [
            'heading', '|',
            'bold', 'italic', 'underline', 'strikethrough', '|',
            'bulletedList', 'numberedList', 'todoList', '|',
            'outdent', 'indent', '|',
            'blockQuote', 'insertTable', 'link', '|',
            'undo', 'redo',
        ],
        'table': {
            'contentToolbar': ['tableColumn', 'tableRow', 'mergeTableCells'],
        },
        'height': 450,
        'width': '100%',
    },
}
CKEDITOR_5_FILE_STORAGE = 'django.core.files.storage.DefaultStorage'
CKEDITOR_5_UPLOAD_PATH = 'ckeditor_uploads/'

# ─────────────────────────────────────────
# DRF SPECTACULAR — Swagger / OpenAPI 3
# Access at: /api/docs/      (Swagger UI)
#             /api/redoc/     (ReDoc)
#             /api/schema/    (raw OpenAPI JSON)
# ─────────────────────────────────────────
SPECTACULAR_SETTINGS = {
    'TITLE': 'ShambaFlow API',
    'DESCRIPTION': (
        'Digital Infrastructure for Organised Agricultural Supply.\n\n'
        'Covers: Identity & Authority | Cooperative CRM | '
        'Tender Marketplace | Reputation Ledger | Analytics Engine.'
    ),
    'VERSION': '1.0.0',
    'SERVE_INCLUDE_SCHEMA': False,
    'SWAGGER_UI_SETTINGS': {
        'deepLinking': True,
        'persistAuthorization': True,
        'displayOperationId': False,
    },
    'COMPONENT_SPLIT_REQUEST': True,
    'SORT_OPERATIONS': False,
    'TAGS': [
        {'name': 'auth', 'description': 'Authentication & token management'},
        {'name': 'cooperatives', 'description': 'Cooperative identity & onboarding'},
        {'name': 'members', 'description': 'Member lifecycle management'},
        {'name': 'forms', 'description': 'Dynamic Form Builder engine'},
        {'name': 'production', 'description': 'Production & harvest records'},
        {'name': 'livestock', 'description': 'Livestock health logs'},
        {'name': 'governance', 'description': 'Governance records & resolutions'},
        {'name': 'finance', 'description': 'Financial records (non-transactional)'},
        {'name': 'capacity', 'description': 'Capacity index & analytics'},
        {'name': 'tenders', 'description': 'Buyer tender marketplace'},
        {'name': 'bids', 'description': 'Cooperative bid submissions'},
        {'name': 'reputation', 'description': 'Reputation & performance ledger'},
        {'name': 'schema', 'description': 'Adaptive Convergence schema introspection'},
    ],
}

# ─────────────────────────────────────────
# LOGGING
# ─────────────────────────────────────────
LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {
        'verbose': {
            'format': '[{asctime}] {levelname} {name} {module}: {message}',
            'style': '{',
            'datefmt': '%Y-%m-%d %H:%M:%S',
        },
        'simple': {
            'format': '{levelname} {message}',
            'style': '{',
        },
    },
    'handlers': {
        'console': {
            'class': 'logging.StreamHandler',
            'formatter': 'verbose',
        },
        'file': {
            'class': 'logging.handlers.RotatingFileHandler',
            'filename': BASE_DIR / 'logs' / 'shambaflow.log',
            'maxBytes': 1024 * 1024 * 5,   # 5MB
            'backupCount': 5,
            'formatter': 'verbose',
        },
    },
    'root': {
        'handlers': ['console'],
        'level': 'INFO',
    },
    'loggers': {
        'django': {
            'handlers': ['console', 'file'],
            'level': env('DJANGO_LOG_LEVEL', default='INFO'),
            'propagate': False,
        },
        'django.db.backends': {
            'handlers': ['console'],
            'level': 'WARNING',     # Set to DEBUG to see raw SQL
            'propagate': False,
        },
        'shambaflow': {
            'handlers': ['console', 'file'],
            'level': 'DEBUG' if DEBUG else 'INFO',
            'propagate': False,
        },
        'core.notifications': {
            'handlers': ['console', 'file'],
            'level': 'INFO',
            'propagate': False,
        },
    },
}

# Create logs directory
os.makedirs(BASE_DIR / 'logs', exist_ok=True)

# ─────────────────────────────────────────
# DEVELOPMENT EXTRAS
# ─────────────────────────────────────────
if DEBUG:
    INSTALLED_APPS += ['debug_toolbar']
    MIDDLEWARE += ['debug_toolbar.middleware.DebugToolbarMiddleware']
    INTERNAL_IPS = ['127.0.0.1', 'localhost']

    # Show emails in console during development
    EMAIL_BACKEND = 'django.core.mail.backends.console.EmailBackend'
