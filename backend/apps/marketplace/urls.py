from django.urls import path

from apps.marketplace.views import (
    buyer_onboarding_status_view,
    chat_threads_view,
    cooperative_bid_view,
    cooperative_marketplace_access_confirm_view,
    cooperative_marketplace_access_pay_view,
    cooperative_marketplace_access_view,
    cooperative_tender_collection_view,
    cooperative_tender_detail_view,
    marketplace_dashboard_view,
    tender_collection_view,
    tender_bid_status_view,
    tender_detail_view,
    tender_messages_view,
)

app_name = 'marketplace'

urlpatterns = [
    path("onboarding/", buyer_onboarding_status_view, name="onboarding"),
    path("dashboard/", marketplace_dashboard_view, name="dashboard"),
    path("chat/threads/", chat_threads_view, name="chat-threads"),
    path("tenders/", tender_collection_view, name="tenders"),
    path("tenders/<str:tender_id>/", tender_detail_view, name="tender-detail"),
    path("tenders/<str:tender_id>/messages/", tender_messages_view, name="tender-messages"),
    path("tenders/<str:tender_id>/bids/<str:bid_id>/", tender_bid_status_view, name="tender-bid-status"),
    path("cooperative/access/", cooperative_marketplace_access_view, name="cooperative-marketplace-access"),
    path("cooperative/access/pay/", cooperative_marketplace_access_pay_view, name="cooperative-marketplace-access-pay"),
    path("cooperative/access/confirm/", cooperative_marketplace_access_confirm_view, name="cooperative-marketplace-access-confirm"),
    path("cooperative/tenders/", cooperative_tender_collection_view, name="cooperative-tenders"),
    path("cooperative/tenders/<str:tender_id>/", cooperative_tender_detail_view, name="cooperative-tender-detail"),
    path("cooperative/tenders/<str:tender_id>/bid/", cooperative_bid_view, name="cooperative-bid"),
]
