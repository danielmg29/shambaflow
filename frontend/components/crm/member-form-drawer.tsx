"use client";

import { useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { User } from "lucide-react";
import { FormRenderer } from "@/components/shambaflow/FormRenderer";
import { type TargetModel } from "@/hooks/useFormBuilder";
import { apiFetch } from "@/lib/api";

interface MemberFormDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member?: any; // For edit mode - actual Member object from database
  onSuccess?: () => void;
}

export function MemberFormDrawer({ open, onOpenChange, member, onSuccess }: MemberFormDrawerProps) {
  const params = useParams();
  const coopId = params.cooperative_id as string;
  const isEdit = !!member;

  const handleSubmitSuccess = useCallback((_recordId: string) => {
    onOpenChange(false);
    onSuccess?.();
  }, [onOpenChange, onSuccess]);

  const handleEditSubmit = useCallback(async (data: Record<string, unknown>) => {
    if (!member) {
      return;
    }

    await apiFetch(`/api/crm/${coopId}/members/${member.id}/`, {
      method: "PATCH",
      body: data,
    });

    onOpenChange(false);
    onSuccess?.();
  }, [coopId, member, onOpenChange, onSuccess]);

  const initialValues = useMemo<Record<string, unknown> | undefined>(() => {
    if (!member) {
      return undefined;
    }

    const values: Record<string, unknown> = {
      ...(((member.extra_data as Record<string, unknown> | null) ?? {})),
    };

    Object.entries(member).forEach(([key, value]) => {
      if (
        key === "id" ||
        key === "cooperative" ||
        key === "added_by" ||
        key === "extra_data" ||
        key === "created_at" ||
        key === "updated_at" ||
        value === undefined
      ) {
        return;
      }
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return;
      }
      values[key] = value;
    });

    return values;
  }, [member]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-[600px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            {isEdit ? "Edit Member" : "Add New Member"}
          </SheetTitle>
          <SheetDescription>
            {isEdit
              ? "Update this member using the active form template."
              : "Add a new member using the active form template."
            }
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6">
          <FormRenderer
            coopId={coopId}
            targetModel={"MEMBER" as TargetModel}
            onSubmitSuccess={isEdit ? undefined : handleSubmitSuccess}
            onSubmit={isEdit ? handleEditSubmit : undefined}
            initialValues={initialValues}
            submitLabel={isEdit ? "Save Changes" : "Save Record"}
          />
        </div>

        <SheetFooter className="mt-6">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
