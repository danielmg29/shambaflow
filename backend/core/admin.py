from django.contrib import admin

from core.models import TenderMarketplaceAccessPayment, TenderMarketplaceBanner


@admin.register(TenderMarketplaceBanner)
class TenderMarketplaceBannerAdmin(admin.ModelAdmin):
    list_display = (
        "title",
        "placement",
        "surface_theme",
        "is_active",
        "starts_at",
        "ends_at",
        "sort_order",
    )


@admin.register(TenderMarketplaceAccessPayment)
class TenderMarketplaceAccessPaymentAdmin(admin.ModelAdmin):
    list_display = (
        "reference",
        "cooperative",
        "status",
        "amount_kes",
        "phone_number",
        "provider_transaction_id",
        "access_expires_at",
        "created_at",
    )
    list_filter = ("status", "provider", "created_at")
    search_fields = (
        "reference",
        "cooperative__name",
        "phone_number",
        "provider_transaction_id",
    )
    readonly_fields = (
        "created_at",
        "updated_at",
        "provider_response",
    )
    ordering = ("-created_at",)
