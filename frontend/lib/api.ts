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
  localStorage.setItem("sf_access", access);
  localStorage.setItem("sf_refresh", refresh);
}

export function clearTokens() {
  localStorage.removeItem("sf_access");
  localStorage.removeItem("sf_refresh");
  localStorage.removeItem("sf_user");
}

export function saveUser(user: object) {
  localStorage.setItem("sf_user", JSON.stringify(user));
}

export function getUser(): Record<string, unknown> | null {
  const raw = localStorage.getItem("sf_user");
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
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
      data.error ?? `HTTP ${res.status}`,
      res.status,
      data.errors ?? [],
      data.code ?? "UNKNOWN_ERROR"
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
    if (data.access) {
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
  user: {
    id: string;
    email: string;
    full_name: string;
    user_type: "CHAIR" | "HELPER" | "BUYER" | "PLATFORM";
    must_change_password: boolean;
    cooperative_id: string | null;
    helper_role: string | null;
    is_email_verified: boolean;
    is_phone_verified: boolean;
  };
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
  updateMe: (data: object) =>
    apiFetch("/api/auth/me/", { method: "PATCH", body: data }),
};