from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from core.models import Cooperative, Notification, NotificationPreference, User
from core.services.notifications import notifications


class NotificationApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.cooperative = Cooperative.objects.create(
            name="Mavuno Growers",
            slug="mavuno-growers",
            registration_number="REG-NOTIF-001",
            cooperative_type=Cooperative.CoopType.CROP,
            region="Nyeri",
        )
        self.chair = User.objects.create_chair(
            email="chair@mavuno.test",
            password="StrongPass123!",
            first_name="Martha",
            last_name="Wanjiru",
            phone_number="+254700000111",
            cooperative=self.cooperative,
        )
        self.cooperative.chair = self.chair
        self.cooperative.save(update_fields=["chair"])
        self.client.force_authenticate(user=self.chair)

    def test_notification_list_returns_user_items_and_unread_count(self):
        Notification.objects.create(
            recipient=self.chair,
            cooperative=self.cooperative,
            title="Verification approved",
            message="Your cooperative has been verified.",
            category=Notification.Category.VERIFICATION,
            event_type="verification_status_changed",
        )
        Notification.objects.create(
            recipient=self.chair,
            cooperative=self.cooperative,
            title="Tender update",
            message="A new tender is available.",
            category=Notification.Category.TENDER,
            event_type="tender_published",
            is_read=True,
        )

        response = self.client.get("/api/notifications/?limit=10")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["total"], 2)
        self.assertEqual(response.data["unread_count"], 1)
        self.assertEqual(len(response.data["items"]), 2)

    def test_notification_detail_marks_item_read(self):
        notification = Notification.objects.create(
            recipient=self.chair,
            cooperative=self.cooperative,
            title="Invitation accepted",
            message="A helper account accepted its invitation.",
            category=Notification.Category.INVITATION,
            event_type="helper_invited",
        )

        response = self.client.patch(
            f"/api/notifications/{notification.id}/",
            {"is_read": True},
            format="json",
        )

        notification.refresh_from_db()
        self.assertEqual(response.status_code, 200)
        self.assertTrue(notification.is_read)
        self.assertIsNotNone(notification.read_at)
        self.assertEqual(response.data["unread_count"], 0)

    def test_notification_mark_all_read_updates_every_unread_item(self):
        Notification.objects.create(
            recipient=self.chair,
            cooperative=self.cooperative,
            title="First",
            message="First unread notification",
            category=Notification.Category.SYSTEM,
            event_type="system_announcement",
        )
        Notification.objects.create(
            recipient=self.chair,
            cooperative=self.cooperative,
            title="Second",
            message="Second unread notification",
            category=Notification.Category.SYSTEM,
            event_type="system_announcement",
        )

        response = self.client.post("/api/notifications/read-all/", {}, format="json")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["marked_read"], 2)
        self.assertEqual(response.data["unread_count"], 0)
        self.assertFalse(Notification.objects.filter(recipient=self.chair, is_read=False).exists())


class NotificationDispatcherPreferenceTests(TestCase):
    @patch("core.services.notifications.send_invitation_sms")
    @patch("core.services.notifications.send_invitation_email")
    def test_helper_invitation_respects_saved_channel_preferences(
        self,
        mock_send_email,
        mock_send_sms,
    ):
        cooperative = Cooperative.objects.create(
            name="Kijani Cooperative",
            slug="kijani-cooperative",
            registration_number="REG-NOTIF-002",
            cooperative_type=Cooperative.CoopType.CROP,
            region="Murang'a",
        )
        chair = User.objects.create_chair(
            email="chair@kijani.test",
            password="StrongPass123!",
            first_name="James",
            last_name="Mwangi",
            phone_number="+254700000222",
            cooperative=cooperative,
        )
        helper = User.objects.create_helper(
            email="helper@kijani.test",
            temporary_password="TempPass123!",
            first_name="Njeri",
            last_name="Kariuki",
            role="MANAGER",
            cooperative=cooperative,
            phone_number="+254700000333",
        )
        cooperative.chair = chair
        cooperative.save(update_fields=["chair"])

        NotificationPreference.objects.create(
            user=helper,
            cooperative=cooperative,
            email_invitations=False,
            email_tender_updates=True,
            email_verification_alerts=True,
            email_system_announcements=True,
            sms_invitations=False,
            sms_otp=True,
            sms_tender_updates=True,
            sms_critical_alerts=True,
        )

        notifications.on_helper_invited(
            email=helper.email,
            phone=helper.phone_number,
            invitee_name=helper.full_name,
            cooperative_name=cooperative.name,
            role=helper.helper_role or "MANAGER",
            invitation_token="invite-token",
            temporary_password="TempPass123!",
            recipient_user=helper,
            cooperative=cooperative,
        )

        mock_send_email.assert_not_called()
        mock_send_sms.assert_not_called()

        created = Notification.objects.get(recipient=helper, event_type="helper_invited")
        self.assertEqual(created.delivery_channels, [notifications.IN_APP])
