/**
 * ShambaFlow — API Client
 *
 * Typed fetch wrapper for all backend endpoints.
 * Handles: auth headers, token refresh, error parsing.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// ── Token helpers ────────────────────────────────────────────────

export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("sf_access");
}

export function getRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("sf_refresh");
}

export function saveTokens(access: string, refresh: string) {
  if (typeof window !== "undefined") {
    localStorage.setItem("sf_access", access);
    localStorage.setItem("sf_refresh", refresh);
  }
}

export function clearTokens() {
  if (typeof window !== "undefined") {
    localStorage.removeItem("sf_access");
    localStorage.removeItem("sf_refresh");
    localStorage.removeItem("sf_user");
  }
}

export function saveUser(user: object) {
  if (typeof window !== "undefined") {
    localStorage.setItem("sf_user", JSON.stringify(user));
    window.dispatchEvent(new CustomEvent(USER_UPDATED_EVENT));
  }
}

export const USER_UPDATED_EVENT = "sf:user-updated";

export interface ModulePermissionFlags {
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
  can_edit_templates?: boolean;
}

export interface UserSnapshot {
  id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  user_type: "CHAIR" | "HELPER" | "BUYER" | "PLATFORM";
  must_change_password?: boolean;
  cooperative_id: string | null;
  cooperative_name?: string | null;
  company_name?: string | null;
  avatar_url?: string | null;
  helper_role: string | null;
  is_email_verified?: boolean;
  is_phone_verified?: boolean;
  permissions?: Record<string, ModulePermissionFlags>;
}

export function getUser(): UserSnapshot | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem("sf_user");
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

export function hasPermission(
  module: string,
  action: keyof ModulePermissionFlags,
  user: UserSnapshot | null = getUser()
): boolean {
  if (!user) return false;
  if (user.user_type === "CHAIR") return true;
  return Boolean(user.permissions?.[module]?.[action]);
}

// ── Core fetch ───────────────────────────────────────────────────

interface ApiOptions extends Omit<RequestInit, "body"> {
  body?: object | FormData;
  skipAuth?: boolean;
  skipRefresh?: boolean;
}

export async function apiFetch<T = unknown>(
  path: string,
  options: ApiOptions = {}
): Promise<T> {
  const { body, skipAuth = false, skipRefresh = false, ...rest } = options;

  const headers: HeadersInit = {
    ...(!(body instanceof FormData) && { "Content-Type": "application/json" }),
    ...rest.headers,
  };

  if (!skipAuth) {
    const token = getAccessToken();
    if (token) (headers as Record<string, string>)["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...rest,
    headers,
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });

  // Auto token refresh on 401
  if (res.status === 401 && !skipRefresh && !skipAuth) {
    const refreshed = await attemptTokenRefresh();
    if (refreshed) {
      return apiFetch(path, { ...options, skipRefresh: true });
    }
    clearTokens();
    if (typeof window !== "undefined") window.location.href = "/login";
    throw new Error("Session expired. Please log in again.");
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const err = new ApiError(
      data.message ?? data.detail ?? data.error ?? `HTTP ${res.status}`,
      res.status,
      data.errors ?? [],
      data.code ?? data.error ?? "UNKNOWN_ERROR"
    );
    throw err;
  }

  return data as T;
}

async function attemptTokenRefresh(): Promise<boolean> {
  const refresh = getRefreshToken();
  if (!refresh) return false;
  try {
    const res = await fetch(`${API_BASE}/api/auth/token/refresh/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    if (data.access && typeof window !== "undefined") {
      localStorage.setItem("sf_access", data.access);
      return true;
    }
  } catch {}
  return false;
}

// ── Error class ──────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public errors: Array<{ field: string; message: string }>,
    public code: string
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** Get field-level error message or null */
  fieldError(field: string): string | null {
    return this.errors.find((e) => e.field === field)?.message ?? null;
  }

  /** Get all errors as a flat record {field: message} */
  get fieldErrors(): Record<string, string> {
    return Object.fromEntries(this.errors.map((e) => [e.field, e.message]));
  }
}

// ── Auth API ─────────────────────────────────────────────────────

export interface LoginResponse {
  access: string;
  refresh: string;
  user: UserSnapshot;
}

export const authApi = {
  login: (email: string, password: string) =>
    apiFetch<LoginResponse>("/api/auth/login/", {
      method: "POST",
      body: { email, password },
      skipAuth: true,
    }),

  logout: (refresh: string) =>
    apiFetch("/api/auth/logout/", {
      method: "POST",
      body: { refresh },
    }),

  registerCooperative: (data: object) =>
    apiFetch("/api/auth/register/cooperative/", {
      method: "POST",
      body: data,
      skipAuth: true,
    }),

  registerBuyer: (data: object) =>
    apiFetch("/api/auth/register/buyer/", {
      method: "POST",
      body: data,
      skipAuth: true,
    }),

  verifyEmail: (token: string) =>
    apiFetch("/api/auth/verify-email/", {
      method: "POST",
      body: { token },
      skipAuth: true,
    }),

  resendVerification: (email: string) =>
    apiFetch("/api/auth/resend-verification/", {
      method: "POST",
      body: { email },
      skipAuth: true,
    }),

  verifyOtp: (phone_number: string, otp: string, purpose: string) =>
    apiFetch("/api/auth/verify-otp/", {
      method: "POST",
      body: { phone_number, otp, purpose },
      skipAuth: true,
    }),

  resendOtp: (phone_number: string, purpose: string) =>
    apiFetch("/api/auth/resend-otp/", {
      method: "POST",
      body: { phone_number, purpose },
      skipAuth: true,
    }),

  forgotPassword: (identifier: string, verification_method: string) =>
    apiFetch("/api/auth/forgot-password/", {
      method: "POST",
      body: { identifier, verification_method },
      skipAuth: true,
    }),

  resetPassword: (token: string, new_password: string, confirm_password: string) =>
    apiFetch("/api/auth/reset-password/", {
      method: "POST",
      body: { token, new_password, confirm_password },
      skipAuth: true,
    }),

  resetPasswordOtp: (phone: string, otp: string, new_password: string) =>
    apiFetch("/api/auth/reset-password-otp/", {
      method: "POST",
      body: { phone, otp, new_password },
      skipAuth: true,
    }),

  changePassword: (current_password: string, new_password: string, confirm_password: string) =>
    apiFetch("/api/auth/change-password/", {
      method: "POST",
      body: { current_password, new_password, confirm_password },
    }),

  acceptInvitation: (token: string, new_password: string, confirm_password: string) =>
    apiFetch("/api/auth/accept-invitation/", {
      method: "POST",
      body: { token, new_password, confirm_password },
      skipAuth: true,
    }),

  me: () => apiFetch("/api/auth/me/"),
  updateMe: (data: object | FormData) =>
    apiFetch("/api/auth/me/", { method: "PATCH", body: data }),
};

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token =
    typeof window !== "undefined" ? localStorage.getItem("sf_access") : null;
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

// ── Error normaliser ───────────────────────────────────────────────────────────

async function throwOnError(res: Response): Promise<never> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = { error: `HTTP ${res.status}` };
  }
  const b = body as Record<string, unknown>;
  throw { error: b.error ?? `HTTP ${res.status}`, errors: b.errors ?? undefined };
}

// ── Blob download (export / template) ─────────────────────────────────────────

export async function downloadBlob(path: string): Promise<Blob> {
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) await throwOnError(res);
  return res.blob();
}

// ── Multipart POST (file upload) ───────────────────────────────────────────────

export async function postForm<T = unknown>(
  path: string,
  formData: FormData
): Promise<T> {
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  // Do NOT set Content-Type — browser sets it with the correct boundary
  const res = await fetch(url, {
    method: "POST",
    headers: authHeaders(),
    body: formData,
  });
  if (!res.ok) await throwOnError(res);
  return res.json() as Promise<T>;
}

// ── Convenience apiClient object ───────────────────────────────────────────────

export const apiClient = {
  get<T = unknown>(path: string): Promise<T> {
    return apiFetch<T>(path, { method: "GET" });
  },

  post<T = unknown>(path: string, body: object | FormData): Promise<T> {
    return apiFetch<T>(path, {
      method: "POST",
      body,
    });
  },

  patch<T = unknown>(path: string, body: object | FormData): Promise<T> {
    return apiFetch<T>(path, {
      method: "PATCH",
      body,
    });
  },

  put<T = unknown>(path: string, body: object | FormData): Promise<T> {
    return apiFetch<T>(path, {
      method: "PUT",
      body,
    });
  },

  delete<T = unknown>(path: string): Promise<T> {
    return apiFetch<T>(path, { method: "DELETE" });
  },

  postForm<T = unknown>(path: string, formData: FormData): Promise<T> {
    return postForm<T>(path, formData);
  },

  downloadBlob(path: string): Promise<Blob> {
    return downloadBlob(path);
  },
};

export default apiClient;
