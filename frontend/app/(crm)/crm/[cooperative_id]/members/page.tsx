"use client";

/**
 * CRM Members List Page
 * =====================
 * Displays all members for a cooperative with clickable names that navigate
 * to individual member dashboards. Shows member stats and quick actions.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useParams, useRouter } from "next/navigation";
import CRMImportModal from "@/components/shambaflow/CRMImportModal";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, FileSpreadsheet, FileUp, Plus, Upload } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { MemberFormDrawer } from "@/components/crm/member-form-drawer";
import { ShambaTable, type ColumnDef, type RowAction } from "@/components/shambaflow/ShambaTable";
import { 
  useActiveTemplate, 
  type TemplateField,
  type TargetModel 
} from "@/hooks/useFormBuilder";
import { useCRMImport } from "@/hooks/useCRMData";

/* ══════════════════════════════════════════════════════════════════
   TYPES
══════════════════════════════════════════════════════════════════ */

interface Member {
  id: string;
  member_number: string;
  status: "ACTIVE" | "INACTIVE" | "SUSPENDED" | "DECEASED";
  extra_data: Record<string, any>;
  created_at: string;
  updated_at: string;
}

interface MembersResponse {
  data: Member[];
  page: number;
  total_pages: number;
  total_count: number;
  has_next: boolean;
  has_previous: boolean;
}

type MemberTableRow = Member & Record<string, unknown>;
const CANONICAL_MEMBER_TABLE_KEYS = new Set(["member_number", "status"]);

/* ══════════════════════════════════════════════════════════════════
   COMPONENTS
══════════════════════════════════════════════════════════════════ */

function getMemberDisplayName(member: Member): string {
  const extra = member.extra_data || {};
  return (
    extra.full_name ||
    extra.jina_kamili ||
    extra.name ||
    `${extra.first_name || ""} ${extra.last_name || ""}`.trim() ||
    `Member ${member.member_number}`
  );
}

function getMemberLocation(member: Member): string {
  const extra = member.extra_data || {};
  return (
    extra.village ||
    extra.location ||
    extra.ward ||
    extra.district ||
    "Unknown location"
  );
}

function getMemberPhone(member: Member): string {
  const extra = member.extra_data || {};
  return extra.phone || extra.mobile || extra.phone_number || "—";
}

function getMemberEmail(member: Member): string {
  const extra = member.extra_data || {};
  return extra.email || extra.email_address || "—";
}

function getMemberGender(member: Member): string {
  const extra = member.extra_data || {};
  const gender = extra.gender;
  if (gender === 'male' || gender === 'm') return 'Male';
  if (gender === 'female' || gender === 'f') return 'Female';
  if (gender === 'other') return 'Other';
  return '—';
}

function formatStatusLabel(status: string): string {
  return status.replace(/_/g, " ");
}

function getMemberAge(member: Member): string {
  const extra = member.extra_data || {};
  if (extra.date_of_birth || extra.dob) {
    const birthDate = new Date(extra.date_of_birth || extra.dob);
    const today = new Date();
    const age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    const finalAge = monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate()) ? age - 1 : age;
    return finalAge > 0 ? `${finalAge} years` : '—';
  }
  if (extra.age) return `${extra.age} years`;
  return '—';
}

function getStatusColor(status: string): string {
  switch (status) {
    case "ACTIVE":
      return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400";
    case "INACTIVE":
      return "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400";
    case "SUSPENDED":
      return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400";
    case "DECEASED":
      return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400";
    default:
      return "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400";
  }
}

/* ══════════════════════════════════════════════════════════════════
   MAIN COMPONENT
══════════════════════════════════════════════════════════════════ */

export default function MembersListPage() {
  const params = useParams();
  const router = useRouter();
  const coopId = params.cooperative_id as string;

  const [members, setMembers] = useState<MembersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [memberFormState, setMemberFormState] = useState<Member | null | undefined>(undefined);
  const [pendingDeleteMember, setPendingDeleteMember] = useState<Member | null>(null);
  const [deletingMember, setDeletingMember] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const membersImport = useCRMImport(coopId, "members");

  // Get active form template for dynamic column generation
  const { template, loading: templateLoading } = useActiveTemplate(coopId, "MEMBER" as TargetModel);

  const loadMembers = useCallback(async () => {
    if (!coopId) return;

    try {
      setLoading(true);
      const response = await apiFetch<MembersResponse>(
        `/api/crm/${coopId}/members/?page=${page}&page_size=50`
      );
      setMembers(response);
      setError(null);
    } catch (err) {
      setError("Failed to load members");
      console.error("Error fetching members:", err);
    } finally {
      setLoading(false);
    }
  }, [coopId, page]);

  // Fetch members
  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  // Generate dynamic columns based on actual Member model + extra_data fields
  const columns: ColumnDef<MemberTableRow>[] = [
    // Core Member model fields
    {
      key: "member_number",
      label: "Member #",
      sortable: true,
      width: "120px",
    },
    {
      key: "status",
      label: "Status",
      sortable: true,
      width: "120px",
      render: (value) => {
        const status = typeof value === "string" ? value : "INACTIVE";
        return (
          <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${getStatusColor(status)}`}>
            {formatStatusLabel(status)}
          </span>
        );
      },
    },
  ];

  // Collect all unique extra_data keys from all members
  const allExtraDataKeys = new Set<string>();
  members?.data.forEach(member => {
    if (member.extra_data) {
      Object.keys(member.extra_data)
        .filter(key => !CANONICAL_MEMBER_TABLE_KEYS.has(key))
        .forEach(key => allExtraDataKeys.add(key));
    }
  });

  // Add columns for each extra_data field
  Array.from(allExtraDataKeys).forEach(key => {
    columns.push({
      key: key,
      label: key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()), // Capitalize words
      sortable: true,
      render: (value) => {
        if (value === null || value === undefined || value === "") {
          return <span className="text-muted-foreground text-sm">—</span>;
        }
        return (
          <span className="text-sm truncate max-w-32" title={String(value)}>
            {String(value)}
          </span>
        );
      },
    });
  });

  // Also add columns from FormField mappings if template exists
  if (template?.fields) {
    template.fields.forEach((field: TemplateField) => {
      if (
        field.is_custom_field &&
        field.maps_to_model_field &&
        !CANONICAL_MEMBER_TABLE_KEYS.has(field.maps_to_model_field)
      ) {
        // Check if we already have this column from extra_data
        const existingColumn = columns.find(col => col.key === field.maps_to_model_field);
        if (!existingColumn) {
          columns.push({
            key: field.maps_to_model_field,
            label: field.label,
            sortable: true,
            render: (value) => {
              if (value === null || value === undefined || value === "") {
                return <span className="text-muted-foreground text-sm">—</span>;
              }
              return (
                <span className="text-sm truncate max-w-32" title={String(value)}>
                  {String(value)}
                </span>
              );
            },
          });
        }
      }
    });
  }

  // Transform member data to work with dynamic columns
  const tableData = useMemo<MemberTableRow[]>(() => members?.data.map(member => {
    const transformed: MemberTableRow = {
      id: member.id,
      member_number: member.member_number,
      status: member.status,
      extra_data: member.extra_data,
      created_at: member.created_at,
      updated_at: member.updated_at,
    };

    // Add ALL extra_data fields
    if (member.extra_data) {
      Object.keys(member.extra_data).forEach(key => {
        const value = member.extra_data[key];
        transformed[key] = value;
      });
    }

    // Also add extra_data fields based on FormField mappings (if template exists)
    if (template?.fields) {
      template.fields.forEach((field: TemplateField) => {
        if (
          field.is_custom_field &&
          field.maps_to_model_field &&
          !CANONICAL_MEMBER_TABLE_KEYS.has(field.maps_to_model_field)
        ) {
          const value = member.extra_data?.[field.maps_to_model_field];
          transformed[field.maps_to_model_field] = value;
        }
      });
    }

    return transformed;
  }) || [], [members?.data, template?.fields]);

  const resolveMember = useCallback((row: MemberTableRow) => {
    return members?.data.find((member) => member.id === row.id) ?? null;
  }, [members?.data]);

  const handleEditMember = (row: MemberTableRow) => {
    const member = resolveMember(row);
    if (!member) {
      setError("Member record could not be loaded for editing");
      return;
    }
    setMemberFormState(member);
  };

  const handleDeleteMember = async (row: MemberTableRow) => {
    const member = resolveMember(row);
    if (!member) {
      setError("Member record could not be loaded for deletion");
      return;
    }

    setPendingDeleteMember(member);
  };

  const confirmDeleteMember = useCallback(async () => {
    if (!pendingDeleteMember) return;

    try {
      setDeletingMember(true);
      await apiFetch(`/api/crm/${coopId}/members/${pendingDeleteMember.id}/`, {
        method: "DELETE",
      });
      setPendingDeleteMember(null);
      await loadMembers();
    } catch (err) {
      console.error("Delete member failed:", err);
      setError("Failed to delete member");
    } finally {
      setDeletingMember(false);
    }
  }, [coopId, loadMembers, pendingDeleteMember]);

  const closeDeleteDialog = useCallback(() => {
    if (deletingMember) return;
    setPendingDeleteMember(null);
  }, [deletingMember]);

  // Define row actions
  const rowActions: RowAction<MemberTableRow>[] = [
    {
      label: "View Dashboard",
      onClick: (member) => router.push(`/crm/${coopId}/members/${member.id}`),
    },
    {
      label: "Edit Member",
      onClick: handleEditMember,
    },
    {
      label: "Delete Member",
      onClick: handleDeleteMember,
      variant: "destructive",
    },
  ];

  if (loading && !members) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-2 text-gray-600">Loading members...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="w-96">
          <CardContent className="pt-6">
            <div className="text-center text-red-600">
              <p>Error loading members</p>
              <p className="text-sm text-gray-500">{error}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Members</h1>
          <p className="text-gray-600">
            Manage and view all cooperative members
          </p>
        </div>
        <Button onClick={() => setMemberFormState(null)}>
          <Plus className="w-4 h-4 mr-2" />
          Add Member
        </Button>
      </div>

      {/* Members Table */}
      <Card>
        <CardHeader>
          <CardTitle>Members ({members?.data.length || 0})</CardTitle>
          <CardDescription>
            Click on member names to view their detailed dashboards
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ShambaTable
            variant="members"
            columns={columns}
            data={tableData}
            keyField="id"
            loading={loading || templateLoading}
            searchable={true}
            searchPlaceholder="Search members..."
            totalCount={members?.total_count}
            page={page}
            pageSize={50}
            onPageChange={setPage}
            rowActions={rowActions}
            emptyMessage="No members found. Try adjusting your filters or search terms."
            exportFileName={`members-${coopId}`}
            toolbarActions={
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-9 gap-2 text-sm font-semibold border-border hover:border-primary/40 hover:text-primary transition-colors">
                    <Upload size={14} />
                    <span className="hidden sm:inline">Import</span>
                    <ChevronDown size={12} className="text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem
                    className="gap-3 py-2.5"
                    onClick={() => setShowImport(true)}
                  >
                    <FileUp className="h-4 w-4 text-primary" />
                    <div>
                      <p className="text-sm font-semibold">Import Members</p>
                      <p className="text-[10px] text-muted-foreground">
                        Open the validation and upload flow
                      </p>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="gap-3 py-2.5"
                    onClick={() => membersImport.downloadTemplate()}
                  >
                    <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
                    <div>
                      <p className="text-sm font-semibold">Download Template</p>
                      <p className="text-[10px] text-muted-foreground">
                        Get the members CSV import template
                      </p>
                    </div>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            }
          />
        </CardContent>
      </Card>

      <MemberFormDrawer
        open={memberFormState !== undefined}
        onOpenChange={(open) => {
          if (!open) setMemberFormState(undefined);
        }}
        member={memberFormState ?? undefined}
        onSuccess={() => {
          void loadMembers();
          setMemberFormState(undefined);
        }}
      />

      <AnimatePresence>
        {pendingDeleteMember && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeDeleteDialog}
            />
            <motion.div
              className="relative z-10 w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-2xl"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
            >
              <h3 className="mb-2 font-semibold text-foreground">Delete member?</h3>
              <p className="mb-1 text-sm text-muted-foreground">
                This action cannot be undone.
              </p>
              <p className="mb-5 text-sm text-foreground">
                {getMemberDisplayName(pendingDeleteMember)} ({pendingDeleteMember.member_number}) will be permanently deleted.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={closeDeleteDialog}
                  disabled={deletingMember}
                  className="flex-1 rounded-xl bg-muted py-2 text-sm text-muted-foreground transition-colors hover:bg-muted/80 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void confirmDeleteMember()}
                  disabled={deletingMember}
                  className="flex-1 rounded-xl bg-destructive py-2 text-sm font-semibold text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:opacity-50"
                >
                  {deletingMember ? "Deleting..." : "Delete"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showImport && (
          <CRMImportModal
            modelSlug="members"
            modelLabel="Members"
            onImport={async (file, dryRun) => {
              const response = await membersImport.importFile(file, dryRun);
              if (response?.success_count && response.success_count > 0 && !dryRun) {
                await loadMembers();
              }
              return response;
            }}
            onDownloadTemplate={membersImport.downloadTemplate}
            importing={membersImport.importing}
            onClose={() => setShowImport(false)}
            onSuccess={() => {
              void loadMembers();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
