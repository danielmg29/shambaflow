from datetime import timedelta
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from core.models import (
    Bid,
    Buyer,
    BuyerProfile,
    CapacityMetric,
    Cooperative,
    Tender,
    TenderMarketplaceBanner,
    TenderMessage,
    User,
)


class MarketplaceViewTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.coop_client = APIClient()
        self.helper_client = APIClient()
        self.user = User.objects.create_buyer(
            email="buyer@marketplace.test",
            password="StrongPass123!",
            first_name="Alice",
            last_name="Buyer",
            phone_number="+254700111222",
        )
        self.user.is_email_verified = True
        self.user.save(update_fields=["is_email_verified"])

        self.profile = BuyerProfile.objects.create(
            user=self.user,
            company_name="Harvest Foods Ltd",
            buyer_type=BuyerProfile.BuyerType.RETAILER,
        )
        self.buyer = Buyer.objects.create(user=self.user, profile=self.profile)
        self.client.force_authenticate(user=self.user)

        self.cooperative = Cooperative.objects.create(
            name="Kieni Farmers",
            slug="kieni-farmers",
            registration_number="REG-MKT-001",
            cooperative_type=Cooperative.CoopType.CROP,
            region="Nyeri",
            verification_status=Cooperative.VerificationStatus.VERIFIED,
        )
        self.chair = User.objects.create_chair(
            email="chair@coop.test",
            password="StrongPass123!",
            first_name="Grace",
            last_name="Chair",
            phone_number="+254700333444",
            cooperative=self.cooperative,
        )
        self.chair.is_email_verified = True
        self.chair.save(update_fields=["is_email_verified"])
        self.cooperative.chair = self.chair
        self.cooperative.save(update_fields=["chair"])
        self.coop_client.force_authenticate(user=self.chair)
        self.helper = User.objects.create_helper(
            email="helper@coop.test",
            temporary_password="StrongPass123!",
            first_name="Helen",
            last_name="Helper",
            phone_number="+254700333555",
            cooperative=self.cooperative,
            role=User.HelperRole.MANAGER,
        )
        self.helper.is_email_verified = True
        self.helper.save(update_fields=["is_email_verified"])
        self.helper_client.force_authenticate(user=self.helper)

        CapacityMetric.objects.create(
            cooperative=self.cooperative,
            overall_index=84,
            data_completeness_score=80,
            production_consistency_score=78,
            governance_participation_score=72,
            verification_score=100,
            is_premium_eligible=True,
        )

    def grant_marketplace_access(self):
        self.cooperative.subscription_tier = Cooperative.SubscriptionTier.PREMIUM
        self.cooperative.subscription_expires_at = timezone.now() + timedelta(days=30)
        self.cooperative.save(update_fields=["subscription_tier", "subscription_expires_at", "updated_at"])

    def test_onboarding_endpoint_reports_missing_profile_sections(self):
        response = self.client.get("/api/marketplace/onboarding/")

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.data["is_complete"])
        self.assertIn("region", response.data["missing_fields"])
        self.assertIn("description", response.data["missing_fields"])

    def test_dashboard_and_tender_detail_return_real_marketplace_data(self):
        tender = Tender.objects.create(
            buyer=self.buyer,
            title="White Maize Supply Q3",
            product_category=Tender.ProductCategory.CEREALS,
            product_name="White Maize",
            status=Tender.TenderStatus.PUBLISHED,
            eligibility_tier=Tender.EligibilityTier.OPEN,
            quantity_kg_min=2500,
            quantity_kg_max=5000,
            quality_specs="Moisture content below 13.5%.",
            delivery_location="Nairobi",
            delivery_start=timezone.localdate() + timedelta(days=14),
            delivery_end=timezone.localdate() + timedelta(days=30),
            bid_deadline=timezone.now() + timedelta(days=10),
            published_at=timezone.now(),
            total_bids=1,
        )
        Bid.objects.create(
            tender=tender,
            cooperative=self.cooperative,
            status=Bid.BidStatus.SUBMITTED,
            offered_quantity_kg=3200,
            offered_price_ksh=48.5,
            proposed_delivery_date=timezone.localdate() + timedelta(days=20),
            submitted_at=timezone.now(),
        )

        dashboard = self.client.get("/api/marketplace/dashboard/")
        detail = self.client.get(f"/api/marketplace/tenders/{tender.id}/")

        self.assertEqual(dashboard.status_code, 200)
        self.assertEqual(dashboard.data["summary"]["active_tenders"], 1)
        self.assertEqual(dashboard.data["summary"]["bids_received"], 1)
        self.assertEqual(len(dashboard.data["featured_tenders"]), 1)
        self.assertTrue(dashboard.data["hero_cards"])
        self.assertTrue(dashboard.data["summary_cards"])
        self.assertIn("analytics", dashboard.data)
        self.assertTrue(dashboard.data["analytics"]["charts"])

        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.data["tender"]["title"], "White Maize Supply Q3")
        self.assertEqual(detail.data["bids_summary"]["total"], 1)
        self.assertEqual(detail.data["bids"][0]["cooperative_name"], self.cooperative.name)
        self.assertEqual(detail.data["viewer_role"], "buyer")

    def test_tender_collection_post_creates_tender(self):
        payload = {
            "title": "Coffee Cherry Procurement",
            "product_category": Tender.ProductCategory.CASH_CROPS,
            "product_name": "Coffee Cherries",
            "status": Tender.TenderStatus.PUBLISHED,
            "eligibility_tier": Tender.EligibilityTier.PREMIUM,
            "quantity_kg_min": "1800",
            "quantity_kg_max": "3500",
            "delivery_location": "Thika",
            "delivery_start": (timezone.localdate() + timedelta(days=7)).isoformat(),
            "delivery_end": (timezone.localdate() + timedelta(days=21)).isoformat(),
            "bid_deadline": (timezone.now() + timedelta(days=5)).isoformat(),
            "quality_specs": "Ripe red cherry only.",
            "indicative_price_min_ksh": "82",
            "indicative_price_max_ksh": "95",
            "min_capacity_index": 75,
        }

        response = self.client.post("/api/marketplace/tenders/", payload, format="json")

        self.assertEqual(response.status_code, 201)
        self.assertEqual(Tender.objects.filter(buyer=self.buyer).count(), 1)
        self.assertEqual(response.data["tender"]["status"], Tender.TenderStatus.PUBLISHED)

    def test_cooperative_can_browse_submit_bid_and_open_chat(self):
        self.grant_marketplace_access()
        tender = Tender.objects.create(
            buyer=self.buyer,
            title="Premium Coffee Cherry Supply",
            product_category=Tender.ProductCategory.CASH_CROPS,
            product_name="Coffee Cherries",
            status=Tender.TenderStatus.PUBLISHED,
            eligibility_tier=Tender.EligibilityTier.PREMIUM,
            quantity_kg_min=1800,
            quantity_kg_max=3200,
            quality_specs="Ripe cherry only.",
            delivery_location="Thika",
            delivery_start=timezone.localdate() + timedelta(days=7),
            delivery_end=timezone.localdate() + timedelta(days=21),
            bid_deadline=timezone.now() + timedelta(days=5),
            published_at=timezone.now(),
        )

        collection = self.coop_client.get("/api/marketplace/cooperative/tenders/")
        self.assertEqual(collection.status_code, 200)
        self.assertEqual(collection.data["items"][0]["id"], str(tender.id))
        self.assertTrue(collection.data["items"][0]["can_submit_bid"])
        self.assertTrue(collection.data["hero_metrics"])
        self.assertTrue(collection.data["summary_cards"])

        bid_response = self.coop_client.post(
            f"/api/marketplace/cooperative/tenders/{tender.id}/bid/",
            {
                "offered_quantity_kg": "2500",
                "offered_price_ksh": "92",
                "proposed_delivery_date": (timezone.localdate() + timedelta(days=14)).isoformat(),
                "narrative": "We can aggregate from verified members and deliver in two tranches.",
                "terms_notes": "Packaging in 50kg bags.",
                "status": Bid.BidStatus.SUBMITTED,
            },
            format="json",
        )
        self.assertEqual(bid_response.status_code, 201)
        tender.refresh_from_db()
        self.assertEqual(tender.total_bids, 1)
        self.assertEqual(Bid.objects.filter(tender=tender, cooperative=self.cooperative).count(), 1)

        detail = self.coop_client.get(f"/api/marketplace/cooperative/tenders/{tender.id}/")
        self.assertEqual(detail.status_code, 200)
        self.assertTrue(detail.data["can_chat"])
        self.assertEqual(detail.data["my_bid"]["status"], Bid.BidStatus.SUBMITTED)

        attachment = SimpleUploadedFile("sample-note.txt", b"bid follow-up", content_type="text/plain")
        message_response = self.coop_client.post(
            f"/api/marketplace/tenders/{tender.id}/messages/",
            {"body": "We can also attach origin documents.", "attachment": attachment},
            format="multipart",
        )
        self.assertEqual(message_response.status_code, 201)
        self.assertTrue(message_response.data["item"]["attachment"]["name"].startswith("sample-note"))
        self.assertTrue(message_response.data["item"]["attachment"]["name"].endswith(".txt"))
        self.assertEqual(message_response.data["item"]["message_type"], TenderMessage.MessageType.DOCUMENT)

        buyer_messages = self.client.get(
            f"/api/marketplace/tenders/{tender.id}/messages/",
            {"cooperative_id": str(self.cooperative.id)},
        )
        self.assertEqual(buyer_messages.status_code, 200)
        self.assertEqual(len(buyer_messages.data["messages"]), 1)
        self.assertEqual(buyer_messages.data["messages"][0]["body"], "We can also attach origin documents.")

        buyer_threads = self.client.get("/api/marketplace/chat/threads/")
        self.assertEqual(buyer_threads.status_code, 200)
        self.assertEqual(buyer_threads.data["summary"]["threads_count"], 1)
        self.assertEqual(buyer_threads.data["threads"][0]["cooperative_id"], str(self.cooperative.id))

        cooperative_threads = self.coop_client.get("/api/marketplace/chat/threads/")
        self.assertEqual(cooperative_threads.status_code, 200)
        self.assertEqual(cooperative_threads.data["summary"]["threads_count"], 1)
        self.assertEqual(cooperative_threads.data["threads"][0]["tender_id"], str(tender.id))

    def test_cooperative_collection_returns_active_marketplace_banners(self):
        self.grant_marketplace_access()
        TenderMarketplaceBanner.objects.create(
            placement=TenderMarketplaceBanner.Placement.COOPERATIVE_DISCOVER,
            eyebrow="Admin Campaign",
            title="Get export-ready before peak demand hits",
            body="Use CRM certification workflows to unlock more premium buyer briefs this month.",
            highlight="Featured until month end",
            surface_theme=TenderMarketplaceBanner.SurfaceTheme.SUNRISE,
            primary_cta_label="Open certification",
            primary_cta_href=f"/crm/{self.cooperative.id}/certification",
            is_active=True,
            starts_at=timezone.now() - timedelta(days=1),
            ends_at=timezone.now() + timedelta(days=3),
        )
        TenderMarketplaceBanner.objects.create(
            placement=TenderMarketplaceBanner.Placement.COOPERATIVE_DISCOVER,
            title="Expired campaign",
            is_active=True,
            starts_at=timezone.now() - timedelta(days=5),
            ends_at=timezone.now() - timedelta(days=1),
        )
        TenderMarketplaceBanner.objects.create(
            placement=TenderMarketplaceBanner.Placement.COOPERATIVE_DISCOVER,
            title="Inactive campaign",
            is_active=False,
        )

        response = self.coop_client.get("/api/marketplace/cooperative/tenders/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data["promotions"]), 1)
        self.assertEqual(response.data["promotions"][0]["title"], "Get export-ready before peak demand hits")
        self.assertEqual(
            response.data["promotions"][0]["primary_cta_href"],
            f"/crm/{self.cooperative.id}/certification",
        )

    @patch("apps.marketplace.views.request_stk_push")
    def test_cooperative_marketplace_access_payment_flow_unlocks_collection(self, mock_request_stk_push):
        mock_request_stk_push.return_value = {
            "message": "STK push initiated",
            "transaction_id": "TXN-ACCESS-001",
            "phone": "254700333444",
            "amount": 1.0,
            "status": "pending",
            "description": "Tender marketplace access",
        }

        locked = self.coop_client.get("/api/marketplace/cooperative/tenders/")
        self.assertEqual(locked.status_code, 402)
        self.assertEqual(locked.data["code"], "MARKETPLACE_PAYMENT_REQUIRED")

        access = self.coop_client.get("/api/marketplace/cooperative/access/")
        self.assertEqual(access.status_code, 200)
        self.assertFalse(access.data["access"]["has_access"])
        self.assertEqual(access.data["access"]["billing_phone_number"], self.chair.phone_number)

        pay = self.coop_client.post("/api/marketplace/cooperative/access/pay/", {}, format="json")
        self.assertEqual(pay.status_code, 201)
        self.assertEqual(pay.data["payment"]["status"], "PENDING")
        self.assertEqual(pay.data["payment"]["provider_transaction_id"], "TXN-ACCESS-001")

        confirm = self.coop_client.post(
            "/api/marketplace/cooperative/access/confirm/",
            {"reference": pay.data["payment"]["reference"]},
            format="json",
        )
        self.assertEqual(confirm.status_code, 200)
        self.assertTrue(confirm.data["access"]["has_access"])

        unlocked = self.coop_client.get("/api/marketplace/cooperative/tenders/")
        self.assertEqual(unlocked.status_code, 200)

    def test_helper_accounts_cannot_access_cooperative_marketplace(self):
        tender = Tender.objects.create(
            buyer=self.buyer,
            title="Warehouse Bean Procurement",
            product_category=Tender.ProductCategory.PULSES,
            product_name="Dry Beans",
            status=Tender.TenderStatus.PUBLISHED,
            eligibility_tier=Tender.EligibilityTier.OPEN,
            quantity_kg_min=1500,
            quantity_kg_max=2600,
            quality_specs="Sorted beans with moisture below 14%.",
            delivery_location="Nakuru",
            delivery_start=timezone.localdate() + timedelta(days=9),
            delivery_end=timezone.localdate() + timedelta(days=20),
            bid_deadline=timezone.now() + timedelta(days=4),
            published_at=timezone.now(),
        )

        collection = self.helper_client.get("/api/marketplace/cooperative/tenders/")
        detail = self.helper_client.get(f"/api/marketplace/cooperative/tenders/{tender.id}/")
        bid = self.helper_client.post(
            f"/api/marketplace/cooperative/tenders/{tender.id}/bid/",
            {
                "offered_quantity_kg": "1800",
                "offered_price_ksh": "74",
                "proposed_delivery_date": (timezone.localdate() + timedelta(days=14)).isoformat(),
            },
            format="json",
        )

        self.assertEqual(collection.status_code, 403)
        self.assertEqual(detail.status_code, 403)
        self.assertEqual(bid.status_code, 403)
        self.assertIn("chair", collection.data["error"].lower())

    def test_buyer_can_shortlist_and_accept_a_bid(self):
        tender = Tender.objects.create(
            buyer=self.buyer,
            title="White Maize Supply Q4",
            product_category=Tender.ProductCategory.CEREALS,
            product_name="White Maize",
            status=Tender.TenderStatus.PUBLISHED,
            eligibility_tier=Tender.EligibilityTier.OPEN,
            quantity_kg_min=2200,
            quantity_kg_max=4200,
            quality_specs="Grade 1 maize.",
            delivery_location="Nairobi",
            delivery_start=timezone.localdate() + timedelta(days=10),
            delivery_end=timezone.localdate() + timedelta(days=28),
            bid_deadline=timezone.now() + timedelta(days=4),
            published_at=timezone.now(),
        )
        bid = Bid.objects.create(
            tender=tender,
            cooperative=self.cooperative,
            submitted_by=self.chair,
            status=Bid.BidStatus.SUBMITTED,
            offered_quantity_kg=3000,
            offered_price_ksh=58,
            proposed_delivery_date=timezone.localdate() + timedelta(days=16),
            submitted_at=timezone.now(),
        )
        TenderMessage.objects.create(
            tender=tender,
            sender=self.chair,
            body="We are ready to negotiate delivery cadence.",
        )
        _ = self.client.get(f"/api/marketplace/tenders/{tender.id}/")

        shortlist = self.client.patch(
            f"/api/marketplace/tenders/{tender.id}/bids/{bid.id}/",
            {"status": Bid.BidStatus.SHORTLISTED},
            format="json",
        )
        self.assertEqual(shortlist.status_code, 200)
        bid.refresh_from_db()
        tender.refresh_from_db()
        self.assertEqual(bid.status, Bid.BidStatus.SHORTLISTED)
        self.assertEqual(tender.status, Tender.TenderStatus.UNDER_REVIEW)

        accept = self.client.patch(
            f"/api/marketplace/tenders/{tender.id}/bids/{bid.id}/",
            {"status": Bid.BidStatus.ACCEPTED},
            format="json",
        )
        self.assertEqual(accept.status_code, 200)
        bid.refresh_from_db()
        tender.refresh_from_db()
        self.assertEqual(bid.status, Bid.BidStatus.ACCEPTED)
        self.assertEqual(tender.status, Tender.TenderStatus.AWARDED)
