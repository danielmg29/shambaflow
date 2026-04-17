from types import SimpleNamespace

from django.test import SimpleTestCase, TestCase
from django.utils import timezone

from core.models import Cooperative, DynamicFieldDefinition, FormField, FormTemplate, Member, ProductionRecord, User
from core.services.field_registry import check_label_conflict, preview_field_semantics, update_field
from core.services.form_submission import _merge_template_defaults, submit_form_with_member_context
from core.services.form_semantic import _are_similar_labels, refresh_template_semantic_state
from core.services.semantic_text import slugify_to_field_key


class FieldRegistrySemanticTests(TestCase):
    def setUp(self):
        self.cooperative = Cooperative.objects.create(
            name="Semantic Test Cooperative",
            slug="semantic-test-cooperative",
            registration_number="SEM-001",
            cooperative_type=Cooperative.CoopType.CROP,
            region="Nairobi",
        )

    def _register_existing(self, label: str, *, target_model: str = "LAND") -> DynamicFieldDefinition:
        return DynamicFieldDefinition.objects.create(
            cooperative=self.cooperative,
            target_model=target_model,
            field_key=slugify_to_field_key(label),
            label=label,
        )

    def test_bilingual_name_is_still_treated_as_duplicate(self):
        self._register_existing("Name")

        result = check_label_conflict(self.cooperative.id, "LAND", "Jina")

        self.assertTrue(result.is_conflict)
        self.assertEqual(result.conflict_type, "semantic_overlap")
        self.assertIn("Name", result.conflicting_labels)

    def test_distinct_land_and_soil_fields_are_not_treated_as_duplicates(self):
        self._register_existing("Land Ownership Type")

        result = check_label_conflict(self.cooperative.id, "LAND", "Soil Type")

        self.assertFalse(result.is_conflict)

    def test_phone_and_mobile_labels_are_treated_as_same_concept(self):
        self._register_existing("Phone")

        result = check_label_conflict(self.cooperative.id, "LAND", "Mobile Number")

        self.assertTrue(result.is_conflict)
        self.assertEqual(result.conflict_type, "semantic_overlap")

    def test_gender_and_sex_labels_are_treated_as_same_concept(self):
        self._register_existing("Gender")

        result = check_label_conflict(self.cooperative.id, "LAND", "Sex")

        self.assertTrue(result.is_conflict)
        self.assertEqual(result.conflict_type, "semantic_overlap")

    def test_conflicts_do_not_cross_target_models(self):
        self._register_existing("Name", target_model="LAND")

        result = check_label_conflict(self.cooperative.id, "PRODUCTION", "Jina")

        self.assertFalse(result.is_conflict)


class TemplateSemanticSimilarityTests(TestCase):
    def test_first_name_translation_is_recognized(self):
        self.assertTrue(_are_similar_labels("Jina la Kwanza", "First Name"))

    def test_vaccination_and_immunization_are_recognized(self):
        self.assertTrue(_are_similar_labels("Vaccination Date", "Immunization Date"))

    def test_soil_and_land_ownership_are_not_collapsed(self):
        self.assertFalse(_are_similar_labels("Land Ownership Type", "Soil Type"))


class FieldRegistrySemanticPreviewTests(TestCase):
    def setUp(self):
        self.cooperative = Cooperative.objects.create(
            name="Preview Test Cooperative",
            slug="preview-test-cooperative",
            registration_number="SEM-002",
            cooperative_type=Cooperative.CoopType.CROP,
            region="Nairobi",
        )

    def _register_existing(self, label: str, *, target_model: str = "MEMBER", display_type: str = "text") -> DynamicFieldDefinition:
        return DynamicFieldDefinition.objects.create(
            cooperative=self.cooperative,
            target_model=target_model,
            field_key=slugify_to_field_key(label),
            label=label,
            display_type=display_type,
        )

    def test_registry_preview_warns_on_abbreviation_without_blocking_save(self):
        self._register_existing("Date of Birth")

        issues = preview_field_semantics(
            self.cooperative.id,
            "MEMBER",
            "DOB",
            display_type="text",
        )

        self.assertTrue(
            any(issue["issue_type"] == "ABBREVIATION_CLASH" and issue["severity"] == "WARNING" for issue in issues)
        )
        self.assertFalse(any(issue["severity"] == "ERROR" for issue in issues))

    def test_registry_preview_warns_when_numeric_label_has_no_unit(self):
        issues = preview_field_semantics(
            self.cooperative.id,
            "MEMBER",
            "Harvest Weight",
            display_type="number",
        )

        self.assertTrue(
            any(issue["issue_type"] == "NUMERIC_UNIT_AMBIGUITY" and issue["severity"] == "WARNING" for issue in issues)
        )


class FieldRegistryTemplateSyncTests(TestCase):
    def setUp(self):
        self.cooperative = Cooperative.objects.create(
            name="Template Sync Cooperative",
            slug="template-sync-cooperative",
            registration_number="SEM-003",
            cooperative_type=Cooperative.CoopType.CROP,
            region="Nairobi",
        )

    def test_updating_registry_field_syncs_draft_template_and_revalidates(self):
        primary = DynamicFieldDefinition.objects.create(
            cooperative=self.cooperative,
            target_model="MEMBER",
            field_key="name",
            label="Name",
            display_type="text",
        )
        duplicate = DynamicFieldDefinition.objects.create(
            cooperative=self.cooperative,
            target_model="MEMBER",
            field_key="jina",
            label="Jina",
            display_type="text",
        )

        template = FormTemplate.objects.create(
            cooperative=self.cooperative,
            name="Member Registry",
            target_model="MEMBER",
        )
        FormField.objects.create(
            template=template,
            label=primary.label,
            display_type=primary.display_type,
            tag=primary.tag,
            field_order=1,
            maps_to_model_field=primary.field_key,
            is_custom_field=True,
        )
        synced_field = FormField.objects.create(
            template=template,
            label=duplicate.label,
            display_type=duplicate.display_type,
            tag=duplicate.tag,
            field_order=2,
            maps_to_model_field=duplicate.field_key,
            is_custom_field=True,
        )

        refresh_template_semantic_state(template)
        template.refresh_from_db()
        self.assertTrue(template.has_blocking_errors)
        self.assertTrue(template.semantic_issues.filter(issue_type="LABEL_DUPLICATE").exists())

        updated = update_field(dfd_id=duplicate.id, label="Preferred Name")

        synced_field.refresh_from_db()
        template.refresh_from_db()

        self.assertEqual(synced_field.label, "Preferred Name")
        self.assertEqual(updated.template_sync["affected_count"], 1)
        self.assertFalse(template.semantic_issues.filter(issue_type="LABEL_DUPLICATE").exists())
        self.assertFalse(template.has_blocking_errors)


class FormSubmissionAutoDefaultsTests(SimpleTestCase):
    def test_auto_defaults_resolve_runtime_objects(self):
        cooperative = SimpleNamespace(id="coop-1")
        user = SimpleNamespace(id="user-1")
        kwargs = {}

        _merge_template_defaults(
            kwargs,
            {
                "cooperative": "__auto__",
                "recorded_by": "__auto__",
                "added_by_id": "__auto__",
                "status": "ACTIVE",
            },
            user,
            cooperative,
        )

        self.assertIs(kwargs["cooperative"], cooperative)
        self.assertIs(kwargs["recorded_by"], user)
        self.assertEqual(kwargs["added_by_id"], "user-1")
        self.assertEqual(kwargs["status"], "ACTIVE")


class MemberContextSubmissionTests(TestCase):
    def setUp(self):
        self.cooperative = Cooperative.objects.create(
            name="Member Context Cooperative",
            slug="member-context-cooperative",
            registration_number="SEM-004",
            cooperative_type=Cooperative.CoopType.CROP,
            region="Nairobi",
        )
        self.chair = User.objects.create_chair(
            email="member-context@example.com",
            password="StrongPass123!",
            first_name="Member",
            last_name="Context",
            phone_number="+254700000101",
            cooperative=self.cooperative,
        )
        self.cooperative.chair = self.chair
        self.cooperative.save(update_fields=["chair"])
        self.member = Member.objects.create(
            cooperative=self.cooperative,
            added_by=self.chair,
            status=Member.MemberStatus.ACTIVE,
            extra_data={"full_name": "Grace Producer"},
        )

    def test_member_context_submission_backfills_missing_production_record_date(self):
        template = FormTemplate.objects.create(
            cooperative=self.cooperative,
            name="Member Production Capture",
            target_model="PRODUCTION",
            status=FormTemplate.Status.ACTIVE,
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

        instance, submission = submit_form_with_member_context(
            str(template.id),
            str(self.cooperative.id),
            str(self.member.id),
            {"product_name": "Maize"},
            self.chair,
        )

        self.assertIsInstance(instance, ProductionRecord)
        self.assertEqual(instance.extra_data["product_name"], "Maize")
        self.assertEqual(instance.extra_data["collection_scope"], "MEMBER")
        self.assertEqual(instance.extra_data["member_number"], self.member.member_number)
        self.assertEqual(instance.record_date, timezone.localdate())
        self.assertEqual(submission.created_model, "ProductionRecord")
