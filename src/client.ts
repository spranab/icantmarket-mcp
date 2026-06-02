/**
 * Thin fetch wrapper around the icantmarket /api/v1/* surface.
 *
 * - Reads are public (no token required)
 * - Writes (post_ask, submit_review) require ICANTMARKET_API_TOKEN
 * - Tokens are minted at https://icantmarket.com/me/api-tokens
 *
 * Token shape: ic_<24-byte hex>. Sent as Authorization: Bearer <token>.
 */

const DEFAULT_BASE = "https://icantmarket.com/api/v1";

export class IcantmarketClient {
  private readonly baseUrl: string;
  private readonly token: string | undefined;

  constructor(opts: { baseUrl?: string; token?: string } = {}) {
    this.baseUrl =
      opts.baseUrl ?? process.env.ICANTMARKET_BASE_URL ?? DEFAULT_BASE;
    this.token = opts.token ?? process.env.ICANTMARKET_API_TOKEN;
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    opts: { body?: unknown; needsAuth?: boolean } = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": "icantmarket-mcp/0.1.0",
    };
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    if (opts.needsAuth) {
      if (!this.token) {
        throw new Error(
          "ICANTMARKET_API_TOKEN env var is required for write operations. " +
            "Mint one at https://icantmarket.com/me/api-tokens (sign in first).",
        );
      }
      headers.Authorization = `Bearer ${this.token}`;
    }

    const response = await fetch(url, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });

    const text = await response.text();
    let payload: unknown;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = text;
    }

    if (!response.ok) {
      const errMsg =
        (payload as { error?: string } | null)?.error ??
        `HTTP ${response.status} ${response.statusText}`;
      const err = new Error(`icantmarket API error: ${errMsg}`);
      (err as Error & { status?: number }).status = response.status;
      (err as Error & { body?: unknown }).body = payload;
      throw err;
    }

    return payload as T;
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  listProducts(params: {
    limit?: number;
    offset?: number;
    category?: string;
  } = {}) {
    const qs = new URLSearchParams();
    if (params.limit !== undefined) qs.set("limit", String(params.limit));
    if (params.offset !== undefined) qs.set("offset", String(params.offset));
    if (params.category) qs.set("category", params.category);
    const q = qs.toString();
    return this.request<{
      ok: true;
      products: Array<Record<string, unknown>>;
      pagination: { limit: number; offset: number; nextOffset: number | null };
    }>("GET", `/products${q ? `?${q}` : ""}`);
  }

  getProduct(slug: string) {
    return this.request<{
      ok: true;
      product: Record<string, unknown> & { openAsks: number };
    }>("GET", `/products/${encodeURIComponent(slug)}`);
  }

  listAsks(params: {
    limit?: number;
    offset?: number;
    status?: string;
    type?: string;
    productSlug?: string;
  } = {}) {
    const qs = new URLSearchParams();
    if (params.limit !== undefined) qs.set("limit", String(params.limit));
    if (params.offset !== undefined) qs.set("offset", String(params.offset));
    if (params.status) qs.set("status", params.status);
    if (params.type) qs.set("type", params.type);
    if (params.productSlug) qs.set("productSlug", params.productSlug);
    const q = qs.toString();
    return this.request<{
      ok: true;
      asks: Array<Record<string, unknown>>;
      pagination: { limit: number; offset: number; nextOffset: number | null };
    }>("GET", `/asks${q ? `?${q}` : ""}`);
  }

  getAsk(id: string) {
    return this.request<{
      ok: true;
      ask: Record<string, unknown>;
    }>("GET", `/asks/${encodeURIComponent(id)}`);
  }

  whoami() {
    return this.request<{
      ok: true;
      user: {
        id: string;
        email: string;
        handle: string | null;
        isAdmin: boolean;
        helperVerifiedAt: string | null;
      };
    }>("GET", "/me", { needsAuth: true });
  }

  // ── Writes ───────────────────────────────────────────────────────────────

  postAsk(body: Record<string, unknown>) {
    return this.request<{
      ok: true;
      ask: {
        id: string;
        url: string | null;
        productSlug: string;
        closesAt: string;
      };
    }>("POST", "/asks", { body, needsAuth: true });
  }

  submitReview(body: Record<string, unknown>) {
    return this.request<{
      ok: true;
      review: { id: string; flags: string[] };
    }>("POST", "/reviews", { body, needsAuth: true });
  }
}
