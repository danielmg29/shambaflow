from datetime import date

from django.test import TestCase

from apps.crm.services.collection import (
    delete_record,
    get_cooperative_certification_workspace,
    get_cooperative_dashboard_payload,
    get_cooperative_submissions_workspace,
    get_member_dashboard_payload,
    get_member_records,
    get_member_templates,
    get_model_analytics,
    save_record,
)
from core.models import CapacityMetric, CapacitySnapshot, Cooperative, DynamicFieldDefinition, FormField, FormTemplate, Member, ProductionRecord, User, VerificationDocument


class CollectionServiceEditDeleteTests(TestCase):
    def setUp(self):
        self.cooperative = Cooperative.objects.create(
            name="Test Cooperative",
            slug="test-cooperative",
            registration_number="REG-001",
            cooperative_type=Cooperative.CoopType.CROP,
            region="Nairobi",
        )
        self.chair = User.objects.create_chair(
            email="chair@example.com",
            password="StrongPass123!",
            first_name="Test",
            last_name="Chair",
            phone_number="+254700000001",
            cooperative=self.cooperative,
        )
        self.cooperative.chair = self.chair
        self.cooperative.save(update_fields=["chair"])

        self.member = Member.objects.create(
            cooperative=self.cooperative,
            added_by=self.chair,
            status=Member.MemberStatus.ACTIVE,
            extra_data={"full_name": "Alice Farmer"},
        )

    def test_editing_member_scoped_production_record_can_switch_to_cooperative_scope(self):
        created = save_record(
            self.cooperative,
            self.chair,
            "production",
            {
                "record_date": "2026-03-23",
                "collection_scope": "MEMBER",
                "member_number": self.member.member_number,
            },
        )

        record = ProductionRecord.objects.get(pk=created["id"])
        self.assertEqual(record.extra_data["collection_scope"], "MEMBER")
        self.assertEqual(record.extra_data["member_number"], self.member.member_number)

        updated = save_record(
            self.cooperative,
            self.chair,
            "production",
            {
                "record_date": "2026-03-24",
                "collection_scope": "COOPERATIVE",
            },
            instance=record,
        )

        record.refresh_from_db()
        self.assertEqual(str(record.record_date), "2026-03-24")
        self.assertEqual(record.extra_data["collection_scope"], "COOPERATIVE")
        self.assertNotIn("member_id", record.extra_data)
        self.assertNotIn("member_number", record.extra_data)
        self.assertNotIn("member_name", record.extra_data)
        self.assertEqual(updated["collection_scope"], "COOPERATIVE")
        self.assertIsNone(updated["member_id"])
        self.assertIsNone(updated["member_number"])

    def test_delete_record_removes_saved_production_entry(self):
        created = save_record(
            self.cooperative,
            self.chair,
            "production",
            {
                "record_date": "2026-03-23",
                "collection_scope": "MEMBER",
                "member_number": self.member.member_number,
            },
        )

        record_id = created["id"]
        self.assertTrue(ProductionRecord.objects.filter(pk=record_id).exists())

        deleted = delete_record(self.cooperative, "production", record_id)

        self.assertTrue(deleted)
        self.assertFalse(ProductionRecord.objects.filter(pk=record_id).exists())

    def test_member_model_analytics_returns_status_breakdown(self):
        Member.objects.create(
            cooperative=self.cooperative,
            added_by=self.chair,
            status=Member.MemberStatus.SUSPENDED,
            extra_data={"full_name": "Bob Grower"},
        )

        analytics = get_model_analytics(self.cooperative, "members")

        self.assertEqual(analytics["model_slug"], "members")
        self.assertEqual(analytics["total_records"], 2)
        self.assertTrue(any(card["id"] == "active_members" for card in analytics["cards"]))
        status_chart = next((chart for chart in analytics["charts"] if chart["id"] == "status_breakdown"), None)
        self.assertIsNotNone(status_chart)
        self.assertEqual(
            {item["label"] for item in status_chart["data"]},
            {"Active", "Suspended"},
        )

    def test_production_model_analytics_returns_scope_and_member_signals(self):
        second_member = Member.objects.create(
            cooperative=self.cooperative,
            added_by=self.chair,
            status=Member.MemberStatus.ACTIVE,
            extra_data={"full_name": "Carol Producer"},
        )

        save_record(
            self.cooperative,
            self.chair,
            "production",
            {
                "record_date": "2026-03-12",
                "collection_scope": "MEMBER",
                "member_number": self.member.member_number,
            },
        )
        save_record(
            self.cooperative,
            self.chair,
            "production",
            {
                "record_date": "2026-03-18",
                "collection_scope": "MEMBER",
                "member_number": second_member.member_number,
            },
        )
        save_record(
            self.cooperative,
            self.chair,
            "production",
            {
                "record_date": "2026-03-25",
                "collection_scope": "COOPERATIVE",
            },
        )

        analytics = get_model_analytics(self.cooperative, "production")

        self.assertEqual(analytics["total_records"], 3)
        self.assertTrue(any(card["id"] == "unique_members" for card in analytics["cards"]))
        self.assertTrue(any(chart["id"] == "timeline" for chart in analytics["charts"]))
        scope_chart = next((chart for chart in analytics["charts"] if chart["id"] == "scope_breakdown"), None)
        self.assertIsNotNone(scope_chart)
        self.assertEqual(
            {item["label"] for item in scope_chart["data"]},
            {"Member", "Cooperative"},
        )

    def test_member_dashboard_payload_includes_member_scoped_module_analytics(self):
        save_record(
            self.cooperative,
            self.chair,
            "production",
            {
                "record_date": "2026-03-20",
                "collection_scope": "MEMBER",
                "member_number": self.member.member_number,
            },
        )

        payload = get_member_dashboard_payload(self.cooperative, self.member, self.chair)

        self.assertIn("module_analytics", payload)
        self.assertIn("production", payload["module_analytics"])
        self.assertEqual(payload["module_analytics"]["production"]["total_records"], 1)
        self.assertEqual(
            [item["value"] for item in payload["member_status_options"]],
            [
                Member.MemberStatus.ACTIVE,
                Member.MemberStatus.INACTIVE,
                Member.MemberStatus.SUSPENDED,
                Member.MemberStatus.DECEASED,
            ],
        )

    def test_member_templates_include_missing_production_discriminator_field(self):
        template = FormTemplate.objects.create(
            cooperative=self.cooperative,
            name="Quick Production Capture",
            target_model="PRODUCTION",
            status=FormTemplate.Status.ACTIVE,
            is_default=True,
            created_by=self.chair,
        )
        FormField.objects.create(
            template=template,
            label="Product Name",
            display_type="text",
            tag=FormField.FieldTag.CAPACITY,
            field_order=1,
            maps_to_model_field="product_name",
            is_custom_field=True,
        )

        templates = get_member_templates(self.cooperative, self.chair)
        serialized = next(item for item in templates if item["id"] == str(template.id))
        record_date = next(
            field for field in serialized["fields"]
            if field["maps_to_model_field"] == "record_date"
        )

        self.assertEqual(record_date["display_type"], "date")
        self.assertTrue(record_date["is_required"])
        self.assertEqual(record_date["default_value"], date.today().isoformat())
        self.assertTrue(serialized["is_default"])

    def test_member_templates_include_governance_templates_for_tab_sync(self):
        template = FormTemplate.objects.create(
            cooperative=self.cooperative,
            name="Governance Overview",
            target_model="GOVERNANCE",
            status=FormTemplate.Status.ACTIVE,
            created_by=self.chair,
        )
        FormField.objects.create(
            template=template,
            label="Meeting Title",
            display_type="text",
            tag=FormField.FieldTag.GOVERNANCE,
            field_order=1,
            maps_to_model_field="title",
            is_custom_field=True,
        )

        templates = get_member_templates(self.cooperative, self.chair)

        self.assertTrue(any(item["id"] == str(template.id) for item in templates))

    def test_member_dashboard_payload_uses_template_backed_module_metadata(self):
        template = FormTemplate.objects.create(
            cooperative=self.cooperative,
            name="Production Snapshot",
            target_model="PRODUCTION",
            status=FormTemplate.Status.ACTIVE,
            is_default=True,
            created_by=self.chair,
        )
        FormField.objects.create(
            template=template,
            label="Harvest Crop",
            display_type="text",
            tag=FormField.FieldTag.CAPACITY,
            field_order=1,
            maps_to_model_field="product_name",
            is_custom_field=True,
        )
        FormField.objects.create(
            template=template,
            label="Season Cycle",
            display_type="text",
            tag=FormField.FieldTag.CAPACITY,
            field_order=2,
            maps_to_model_field="season",
            is_custom_field=True,
        )

        payload = get_member_dashboard_payload(self.cooperative, self.member, self.chair)
        production_metadata = payload["module_metadata"]["production"]

        self.assertEqual(production_metadata["source"], "template")
        self.assertEqual(production_metadata["source_template_id"], str(template.id))
        self.assertEqual(production_metadata["date_field"], "record_date")
        self.assertEqual(
            [field["label"] for field in production_metadata["table_columns"]],
            ["Harvest Crop", "Season Cycle"],
        )
        self.assertIn(
            "Record Date",
            [field["label"] for field in production_metadata["filter_fields"]],
        )

    def test_member_dashboard_payload_calculates_member_waste_from_production_data(self):
        for field_key, label in (
            ("quantity_kg", "Harvest Quantity (kg)"),
            ("marketable_kg", "Marketable Quantity (kg)"),
        ):
            DynamicFieldDefinition.objects.create(
                cooperative=self.cooperative,
                target_model="PRODUCTION",
                field_key=field_key,
                label=label,
                display_type="number",
                tag="CAPACITY",
                created_by=self.chair,
            )

        save_record(
            self.cooperative,
            self.chair,
            "production",
            {
                "record_date": "2026-03-20",
                "collection_scope": "MEMBER",
                "member_number": self.member.member_number,
                "quantity_kg": 1200,
                "marketable_kg": 1080,
            },
        )

        payload = get_member_dashboard_payload(self.cooperative, self.member, self.chair)

        self.assertEqual(payload["analytics"]["production"]["waste_kg"], 120.0)
        self.assertEqual(payload["analytics"]["production"]["waste_rate"], 10.0)
        self.assertEqual(payload["analytics"]["production"]["records_with_waste"], 1)

    def test_cooperative_dashboard_payload_calculates_collective_waste(self):
        for field_key, label in (
            ("quantity_kg", "Harvest Quantity (kg)"),
            ("marketable_kg", "Marketable Quantity (kg)"),
            ("rejected_kg", "Rejected Quantity (kg)"),
        ):
            DynamicFieldDefinition.objects.create(
                cooperative=self.cooperative,
                target_model="PRODUCTION",
                field_key=field_key,
                label=label,
                display_type="number",
                tag="CAPACITY",
                created_by=self.chair,
            )

        save_record(
            self.cooperative,
            self.chair,
            "production",
            {
                "record_date": "2026-03-20",
                "collection_scope": "MEMBER",
                "member_number": self.member.member_number,
                "quantity_kg": 1200,
                "marketable_kg": 1080,
            },
        )
        save_record(
            self.cooperative,
            self.chair,
            "production",
            {
                "record_date": "2026-03-28",
                "collection_scope": "COOPERATIVE",
                "quantity_kg": 500,
                "rejected_kg": 50,
            },
        )

        payload = get_cooperative_dashboard_payload(self.cooperative, self.chair)

        self.assertEqual(payload["waste_volume_kg"], 170.0)
        self.assertEqual(payload["waste_rate"], 10.0)

    def test_member_dashboard_recent_activity_uses_dynamic_template_title_and_date_fields(self):
        DynamicFieldDefinition.objects.create(
            cooperative=self.cooperative,
            target_model="LIVESTOCK",
            field_key="treatment_name",
            label="Treatment Name",
            display_type="text",
            tag="INFORMATIONAL",
            created_by=self.chair,
        )
        DynamicFieldDefinition.objects.create(
            cooperative=self.cooperative,
            target_model="LIVESTOCK",
            field_key="event_date",
            label="Event Date",
            display_type="date",
            tag="INFORMATIONAL",
            created_by=self.chair,
        )
        template = FormTemplate.objects.create(
            cooperative=self.cooperative,
            name="Livestock Treatments",
            target_model="LIVESTOCK",
            status=FormTemplate.Status.ACTIVE,
            is_default=True,
            created_by=self.chair,
        )
        FormField.objects.create(
            template=template,
            label="Treatment Name",
            display_type="text",
            tag=FormField.FieldTag.INFORMATIONAL,
            field_order=1,
            maps_to_model_field="treatment_name",
            is_custom_field=True,
        )
        FormField.objects.create(
            template=template,
            label="Event Date",
            display_type="date",
            tag=FormField.FieldTag.INFORMATIONAL,
            field_order=2,
            maps_to_model_field="event_date",
            is_custom_field=True,
        )

        save_record(
            self.cooperative,
            self.chair,
            "livestock",
            {
                "event_type": "VACCINATION",
                "event_date": "2026-04-10",
                "treatment_name": "Alpha Drench",
                "collection_scope": "MEMBER",
                "member_number": self.member.member_number,
            },
        )
        save_record(
            self.cooperative,
            self.chair,
            "livestock",
            {
                "event_type": "TREATMENT",
                "event_date": "2026-03-01",
                "treatment_name": "Beta Dose",
                "collection_scope": "MEMBER",
                "member_number": self.member.member_number,
            },
        )

        payload = get_member_dashboard_payload(self.cooperative, self.member, self.chair)

        self.assertEqual(payload["analytics"]["livestock"]["latest_event"], "2026-04-10")
        self.assertEqual(payload["recent_activity"][0]["type"], "livestock")
        self.assertEqual(payload["recent_activity"][0]["title"], "Alpha Drench")
        self.assertEqual(payload["recent_activity"][0]["date"], "2026-04-10")

    def test_get_member_records_supports_search_and_field_filters(self):
        save_record(
            self.cooperative,
            self.chair,
            "production",
            {
                "record_date": "2026-03-20",
                "collection_scope": "MEMBER",
                "member_number": self.member.member_number,
                "product_name": "Maize",
                "season": "Long Rains",
            },
        )
        save_record(
            self.cooperative,
            self.chair,
            "production",
            {
                "record_date": "2026-03-26",
                "collection_scope": "MEMBER",
                "member_number": self.member.member_number,
                "product_name": "Beans",
                "season": "Short Rains",
            },
        )

        searched = get_member_records(
            self.cooperative,
            self.member,
            "production",
            search="beans",
        )
        self.assertEqual(searched["total_count"], 1)
        self.assertEqual(searched["data"][0]["extra_data"]["product_name"], "Beans")

        filtered = get_member_records(
            self.cooperative,
            self.member,
            "production",
            filters={"product_name": "Maize"},
        )
        self.assertEqual(filtered["total_count"], 1)
        self.assertEqual(filtered["data"][0]["extra_data"]["product_name"], "Maize")

        dated = get_member_records(
            self.cooperative,
            self.member,
            "production",
            filters={"record_date": "2026-03-26"},
        )
        self.assertEqual(dated["total_count"], 1)
        self.assertEqual(dated["data"][0]["extra_data"]["product_name"], "Beans")

    def test_cooperative_dashboard_payload_aggregates_live_crm_and_capacity_data(self):
        second_member = Member.objects.create(
            cooperative=self.cooperative,
            added_by=self.chair,
            status=Member.MemberStatus.ACTIVE,
            extra_data={"full_name": "Brian Harvester"},
        )
        self.cooperative.verification_status = Cooperative.VerificationStatus.VERIFIED
        self.cooperative.save(update_fields=["verification_status"])

        CapacityMetric.objects.create(
            cooperative=self.cooperative,
            overall_index=81,
            data_completeness_score=76,
            governance_participation_score=64,
            production_consistency_score=71,
            is_premium_eligible=True,
        )

        save_record(
            self.cooperative,
            self.chair,
            "production",
            {
                "record_date": "2026-04-10",
                "collection_scope": "MEMBER",
                "member_number": self.member.member_number,
                "season": "Long Rains",
            },
        )
        save_record(
            self.cooperative,
            self.chair,
            "production",
            {
                "record_date": "2026-04-12",
                "collection_scope": "MEMBER",
                "member_number": second_member.member_number,
                "season": "Short Rains",
            },
        )

        payload = get_cooperative_dashboard_payload(self.cooperative, self.chair)

        self.assertEqual(payload["member_count"], 2)
        self.assertEqual(payload["active_cycles"], 2)
        self.assertEqual(payload["capacity_index"], 81)
        self.assertEqual(payload["data_completeness"], 76)
        self.assertEqual(payload["member_engagement"], 64)
        self.assertEqual(payload["production_regularity"], 71)
        self.assertTrue(payload["is_verified"])
        self.assertTrue(payload["tender_eligible"])
        self.assertTrue(payload["permissions"]["production"]["can_view"])
        self.assertTrue(
            any(item["type"] == "Production Record" for item in payload["recent_submissions"])
        )
        self.assertTrue(
            any(item["member"] == "Alice Farmer" for item in payload["recent_submissions"])
        )
        self.assertEqual(payload["stat_cards"][0]["id"], "members")
        self.assertEqual(payload["stat_cards"][2]["id"], "capacity_index")
        self.assertTrue(payload["stat_cards"][2]["trend_value"])

    def test_submissions_workspace_returns_widgets_and_paginated_rows(self):
        save_record(
            self.cooperative,
            self.chair,
            "production",
            {
                "record_date": "2026-04-10",
                "collection_scope": "MEMBER",
                "member_number": self.member.member_number,
                "season": "Long Rains",
            },
        )
        save_record(
            self.cooperative,
            self.chair,
            "governance",
            {
                "record_date": "2026-04-13",
                "collection_scope": "COOPERATIVE",
                "decision": "Approved budget",
            },
        )

        payload = get_cooperative_submissions_workspace(
            self.cooperative,
            self.chair,
            page=1,
            page_size=10,
        )

        self.assertEqual(payload["total_count"], 3)
        self.assertEqual(payload["cards"][0]["id"], "total_submissions")
        self.assertTrue(any(chart["id"] == "submission_timeline" for chart in payload["charts"]))
        self.assertTrue(any(item["model_slug"] == "production" for item in payload["data"]))
        self.assertTrue(any(option["value"] == "governance" for option in payload["module_options"]))

    def test_certification_workspace_returns_scores_snapshots_and_documents(self):
        self.cooperative.verification_status = Cooperative.VerificationStatus.VERIFIED
        self.cooperative.save(update_fields=["verification_status"])

        CapacityMetric.objects.create(
            cooperative=self.cooperative,
            overall_index=81,
            data_completeness_score=76,
            governance_participation_score=64,
            production_consistency_score=71,
            verification_score=92,
            estimated_annual_volume_kg=15420,
            is_premium_eligible=True,
        )
        CapacitySnapshot.objects.create(
            cooperative=self.cooperative,
            overall_index=74,
            snapshot_date=date(2026, 2, 1),
        )
        CapacitySnapshot.objects.create(
            cooperative=self.cooperative,
            overall_index=81,
            snapshot_date=date(2026, 4, 1),
        )
        VerificationDocument.objects.create(
            cooperative=self.cooperative,
            document_type="REGISTRATION_CERTIFICATE",
            file="verification/test.pdf",
            status="APPROVED",
        )

        payload = get_cooperative_certification_workspace(self.cooperative, self.chair)

        self.assertEqual(payload["scores"]["capacity_index"], 81)
        self.assertTrue(payload["status"]["is_verified"])
        self.assertTrue(payload["status"]["is_premium_eligible"])
        self.assertEqual(payload["documents"]["approved"], 1)
        self.assertTrue(any(chart["id"] == "capacity_trend" for chart in payload["charts"]))
        self.assertEqual(payload["cards"][0]["id"], "capacity_index")
