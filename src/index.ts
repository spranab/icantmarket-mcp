#!/usr/bin/env node
/**
 * icantmarket MCP server.
 *
 * Exposes the public /api/v1/* surface as MCP tools so agents in
 * Claude Code, Cursor, ChatGPT Desktop, and any MCP-aware client can
 * browse verified products, browse open asks, post asks, and submit
 * reviews — all from natural-language intent.
 *
 * Auth:
 *   - Reads are public.
 *   - Writes (post_ask, submit_review) require ICANTMARKET_API_TOKEN.
 *     Mint a token at https://icantmarket.com/me/api-tokens (sign in first).
 *
 * Voice constraint: icantmarket enforces a hype-word detector
 * (revolutionary / game-changing / best-in-class / 10x / etc.) on POST.
 * If your tool call gets blocked with a 422 listing hype words, rewrite
 * before retrying, or pass hype_acknowledged: true to override.
 *
 * Install (Claude Code):
 *   claude mcp add icantmarket --env ICANTMARKET_API_TOKEN=ic_... \
 *     -- npx -y icantmarket-mcp
 *
 * Install (Claude Desktop, claude_desktop_config.json):
 *   {
 *     "mcpServers": {
 *       "icantmarket": {
 *         "command": "npx",
 *         "args": ["-y", "icantmarket-mcp"],
 *         "env": { "ICANTMARKET_API_TOKEN": "ic_..." }
 *       }
 *     }
 *   }
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { IcantmarketClient } from "./client.js";

const client = new IcantmarketClient();

// ── Tool input schemas ────────────────────────────────────────────────────

const CATEGORIES = [
  "devtools",
  "oss_libraries",
  "apis_infra",
  "ai_ml_workflow",
  "devops",
] as const;
const STAGES = [
  "idea",
  "mvp",
  "beta",
  "launched",
  "revenue",
  "scaling",
] as const;
const ASK_TYPES = [
  "launch",
  "update",
  "milestone",
  "retro",
  "feedback",
  "roast",
  "collab",
  "postmortem",
] as const;
const ASK_STATUSES = [
  "open",
  "answered",
  "completed",
  "expired",
  "closed",
] as const;
const TIME_BUCKETS = ["5m", "15m", "30m", "1h"] as const;
const VISIBILITIES = ["public", "verified_only"] as const;

const ListProductsInput = z.object({
  limit: z.number().int().min(1).max(50).optional(),
  offset: z.number().int().min(0).optional(),
  category: z.enum(CATEGORIES).optional(),
});

const GetProductInput = z.object({
  slug: z.string().min(1).describe("Product slug, e.g. 'yantrikdb-server'"),
});

const ListAsksInput = z.object({
  limit: z.number().int().min(1).max(50).optional(),
  offset: z.number().int().min(0).optional(),
  status: z.enum(ASK_STATUSES).optional(),
  type: z.enum(ASK_TYPES).optional(),
  product_slug: z.string().optional(),
});

const GetAskInput = z.object({
  id: z.string().uuid().describe("Ask UUID"),
});

const WhoamiInput = z.object({});

const PostAskInput = z.object({
  product_id: z.string().uuid().describe("UUID of a product the caller owns at L1+ trust level. Get from list_products."),
  type: z.enum(ASK_TYPES),
  i_am_building: z.string().min(10).max(200).describe("One-line product summary."),
  current_stage: z.enum(STAGES),
  need_help_with: z.string().min(15).max(500).describe("Specific help requested. Be concrete."),
  helper_profile: z.string().min(10).max(200).describe("Who would be a good helper. Be specific."),
  artifact_url: z.string().url().describe("Link to the thing you want feedback on (repo, doc, landing page)."),
  time_needed: z.enum(TIME_BUCKETS).describe("How much of the helper's time you're asking for."),
  offer_back: z.string().min(10).max(200).describe("What you'll give in return. The cohort is barter-based."),
  closes_in_days: z.number().int().min(1).max(30).describe("Days until the ask auto-closes."),
  success_criteria: z.string().min(10).max(300).describe("How you'll know the help worked."),
  visibility: z.enum(VISIBILITIES).default("public").optional(),
  hype_acknowledged: z.boolean().optional().describe("Set true to override the hype-word detector. The hype words still get recorded as a soft-flag on the ask."),
});

const SubmitReviewInput = z.object({
  ask_id: z.string().uuid().describe("UUID of the ask you're reviewing. Get from list_asks."),
  body: z.string().min(50).max(4000).describe("Substantive prose. Pasted boilerplate, low-similarity content, and AI-detected text get flagged."),
  hype_acknowledged: z.boolean().optional(),
});

// ── Tool definitions ──────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "list_products",
    description:
      "List verified products on icantmarket. Public, no auth needed. " +
      "Use this to find product slugs and UUIDs before posting an ask or " +
      "to help a user browse the maker cohort. Only L1+ verified active " +
      "products are returned.",
    inputSchema: ListProductsInput,
  },
  {
    name: "get_product",
    description:
      "Fetch a single verified product by slug. Public. Returns the " +
      "product details plus the count of currently open asks. Useful " +
      "to grab a product UUID before posting an ask, or to summarize a " +
      "product for the user.",
    inputSchema: GetProductInput,
  },
  {
    name: "list_asks",
    description:
      "List open public asks on icantmarket. Public, no auth needed. " +
      "Use this when the user wants to find a review opportunity that " +
      "fits their profile, or when they're researching the kind of " +
      "help requests the community posts. Verified-only asks are not " +
      "returned (they stay behind the page-level helper-cohort gate).",
    inputSchema: ListAsksInput,
  },
  {
    name: "get_ask",
    description:
      "Fetch one public ask by UUID, with the bundled product summary. " +
      "Returns 404 / error if the ask is verified-only. Use this after " +
      "list_asks to inspect an ask in detail before deciding to review it.",
    inputSchema: GetAskInput,
  },
  {
    name: "whoami",
    description:
      "Confirm the configured ICANTMARKET_API_TOKEN is valid and return " +
      "the principal user (id, email, handle, isAdmin, helperVerifiedAt). " +
      "Cheap, no side-effects. Call once on startup to cache the user id.",
    inputSchema: WhoamiInput,
  },
  {
    name: "post_ask",
    description:
      "Post a structured ask on behalf of the authenticated maker. " +
      "Requires ICANTMARKET_API_TOKEN. The maker must own the target " +
      "product (use list_products to find product_id), and the product " +
      "must be at L1+ trust. Second-and-onward asks require a credited " +
      "Helpful/Completed review (Review-to-Post gate). " +
      "Hype-words (revolutionary / game-changing / best-in-class / etc.) " +
      "trigger 422 — rewrite, or retry with hype_acknowledged=true to " +
      "override and accept the soft-flag. " +
      "Voice rule: factual, concrete, with a real 'offer_back' and " +
      "a measurable 'success_criteria'.",
    inputSchema: PostAskInput,
  },
  {
    name: "submit_review",
    description:
      "Submit a substantive review on someone else's open ask. Requires " +
      "ICANTMARKET_API_TOKEN. Cannot self-review own asks. Body is " +
      "scored for hype-words, content-fingerprint similarity against the " +
      "reviewer's prior reviews, profile-match, sock-puppet clustering, " +
      "and AI-content detection. Flags don't block; they surface on the " +
      "admin review queue. The recipient sets the Helpful/Completed " +
      "verdict later — that's what credits the reviewer's Review-to-Post " +
      "balance. Use list_asks to find an ask UUID first.",
    inputSchema: SubmitReviewInput,
  },
] as const;

// ── Server wiring ─────────────────────────────────────────────────────────

const server = new Server(
  { name: "icantmarket-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: zodToJsonSchema(t.inputSchema),
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const tool = TOOLS.find((t) => t.name === req.params.name);
  if (!tool) {
    return {
      content: [{ type: "text", text: `Unknown tool: ${req.params.name}` }],
      isError: true,
    };
  }

  const parsed = tool.inputSchema.safeParse(req.params.arguments ?? {});
  if (!parsed.success) {
    return {
      content: [
        {
          type: "text",
          text: `Invalid arguments for ${tool.name}: ${parsed.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ")}`,
        },
      ],
      isError: true,
    };
  }

  try {
    const result = await dispatch(tool.name, parsed.data);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      content: [{ type: "text", text: msg }],
      isError: true,
    };
  }
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function dispatch(name: string, args: any): Promise<unknown> {
  switch (name) {
    case "list_products":
      return client.listProducts({
        limit: args.limit,
        offset: args.offset,
        category: args.category,
      });
    case "get_product":
      return client.getProduct(args.slug);
    case "list_asks":
      return client.listAsks({
        limit: args.limit,
        offset: args.offset,
        status: args.status,
        type: args.type,
        productSlug: args.product_slug,
      });
    case "get_ask":
      return client.getAsk(args.id);
    case "whoami":
      return client.whoami();
    case "post_ask":
      return client.postAsk({
        productId: args.product_id,
        type: args.type,
        iAmBuilding: args.i_am_building,
        currentStage: args.current_stage,
        needHelpWith: args.need_help_with,
        helperProfile: args.helper_profile,
        artifactUrl: args.artifact_url,
        timeNeeded: args.time_needed,
        offerBack: args.offer_back,
        closesInDays: args.closes_in_days,
        successCriteria: args.success_criteria,
        visibility: args.visibility ?? "public",
        hypeAcknowledged: args.hype_acknowledged,
      });
    case "submit_review":
      return client.submitReview({
        askId: args.ask_id,
        body: args.body,
        hypeAcknowledged: args.hype_acknowledged,
      });
    default:
      throw new Error(`Unhandled tool: ${name}`);
  }
}

/** Minimal zod-to-JSON-Schema for tool inputSchema. Covers what we need. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function zodToJsonSchema(schema: z.ZodTypeAny): any {
  // The MCP SDK accepts a permissive JSON schema. We hand-shape the
  // commonly-used Zod constructs into a JSON Schema fragment.
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(value);
      if (!value.isOptional()) required.push(key);
    }
    return {
      type: "object",
      properties,
      ...(required.length ? { required } : {}),
      additionalProperties: false,
    };
  }
  if (schema instanceof z.ZodOptional) {
    return zodToJsonSchema(schema._def.innerType as z.ZodTypeAny);
  }
  if (schema instanceof z.ZodDefault) {
    return {
      ...zodToJsonSchema(schema._def.innerType as z.ZodTypeAny),
      default: schema._def.defaultValue(),
    };
  }
  if (schema instanceof z.ZodString) {
    const out: Record<string, unknown> = { type: "string" };
    const def = schema._def;
    if (def.description) out.description = def.description;
    for (const check of def.checks ?? []) {
      if (check.kind === "min") out.minLength = check.value;
      if (check.kind === "max") out.maxLength = check.value;
      if (check.kind === "uuid") out.format = "uuid";
      if (check.kind === "url") out.format = "uri";
    }
    return out;
  }
  if (schema instanceof z.ZodNumber) {
    const out: Record<string, unknown> = { type: "number" };
    for (const check of schema._def.checks ?? []) {
      if (check.kind === "int") out.type = "integer";
      if (check.kind === "min") out.minimum = check.value;
      if (check.kind === "max") out.maximum = check.value;
    }
    if (schema._def.description) out.description = schema._def.description;
    return out;
  }
  if (schema instanceof z.ZodBoolean) {
    const out: Record<string, unknown> = { type: "boolean" };
    if (schema._def.description) out.description = schema._def.description;
    return out;
  }
  if (schema instanceof z.ZodEnum) {
    return { type: "string", enum: [...schema._def.values] };
  }
  // Fallback — best-effort, very permissive.
  return {};
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Stderr is fine for MCP — stdout is the transport.
  console.error("icantmarket-mcp ready (stdio). Tools:", TOOLS.map((t) => t.name).join(", "));
}

main().catch((err) => {
  console.error("icantmarket-mcp fatal:", err);
  process.exit(1);
});
