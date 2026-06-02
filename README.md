# icantmarket-mcp

MCP server for [icantmarket](https://icantmarket.com) — a verified help-exchange for technical founders. Browse verified products, browse open asks, post structured asks, submit reviews — all from a Claude Code / Cursor / Claude Desktop / any MCP-aware client.

```
list_products → get_product → list_asks → get_ask → whoami
                                                         ↓
                                              post_ask · submit_review
```

## Install

### Claude Code

```bash
claude mcp add icantmarket --env ICANTMARKET_API_TOKEN=ic_xxx \
  -- npx -y icantmarket-mcp
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "icantmarket": {
      "command": "npx",
      "args": ["-y", "icantmarket-mcp"],
      "env": { "ICANTMARKET_API_TOKEN": "ic_xxx" }
    }
  }
}
```

### Cursor

Add to your `mcp.json`:

```json
{
  "mcpServers": {
    "icantmarket": {
      "command": "npx",
      "args": ["-y", "icantmarket-mcp"],
      "env": { "ICANTMARKET_API_TOKEN": "ic_xxx" }
    }
  }
}
```

## Get a token

Mint at [icantmarket.com/me/api-tokens](https://icantmarket.com/me/api-tokens) (sign in first). Token shape: `ic_<24-byte hex>`. Shown exactly once at creation — only the SHA-256 hash is stored server-side.

Reads (`list_products`, `get_product`, `list_asks`, `get_ask`) work without a token. Writes (`whoami`, `post_ask`, `submit_review`) need one.

## Tools

| Tool | Auth | What it does |
| --- | --- | --- |
| `list_products` | none | Browse L1+ verified active products. Filter by `category`. Paginated. |
| `get_product` | none | One product by slug + count of open asks. |
| `list_asks` | none | Browse open public asks. Filter by `status`, `type`, `product_slug`. |
| `get_ask` | none | One public ask by UUID + product summary. |
| `whoami` | token | Sanity-check the token + return identity. |
| `post_ask` | token | Post a structured ask. Must own the product. |
| `submit_review` | token | Submit a substantive review on someone else's ask. |

## What this is for

When a maker says to their agent:

- *"Post an update ask for my YantrikDB Server v0.8.20 launch."* → agent uses `list_products` to find the slug + UUID, then `post_ask`.
- *"Find me a launch ask in `devtools` I could review."* → agent uses `list_asks?type=launch` and surfaces the results.
- *"Review the open ask on `saga-mcp`."* → agent uses `list_asks?product_slug=saga-mcp` → `get_ask` → `submit_review`.

## What this is NOT for

- **Not a freelance marketplace** — no money changes hands; the exchange is peer review of work, not paid help.
- **Not for non-technical / consumer marketing** — the cohort is technical founders shipping devtools, AI/ML, infra, or OSS libraries.
- **Not for bulk outreach / scraping** — Review-to-Post + per-token rate limits make automation-as-spam unviable by design.
- **Not for anonymous posting** — every ask is tied to a verified maker identity (GitHub repo admin, DNS TXT, or package provenance).
- **Not for post-launch ad placement** — asks are pre-/at-launch help requests, not retrospective promo.

## Anti-gaming the agent should know about

icantmarket runs the same anti-gaming surface on the API path that the browser path does:

- **Hype-word detector** — `revolutionary`, `game-changing`, `best-in-class`, `10x`, etc. on `post_ask` body fields trigger 422. Rewrite, or pass `hype_acknowledged: true` to override and accept the soft-flag.
- **Review-to-Post gate** — second-and-onward asks need one credited Helpful/Completed review on someone else's ask first. `post_ask` returns 422 with the reason if blocked.
- **Self-review block** — `submit_review` rejects reviewing one's own asks.
- **Content-fingerprint similarity** — pasted boilerplate against your own prior reviews surfaces as a soft-flag.
- **Famous-name gate** — claims on famous package/repo names (react, numpy, etc.) go through admin pending_review before they're posted to.
- **Per-token rate limits** — 30/hr for posts and reviews.

If an agent gets repeatedly 422-blocked, the platform is telling it the submissions aren't substantive. Fix the content, not the path.

## Voice constraint

The agent's `post_ask` and `submit_review` content should be:

- factual, concrete, specific
- no marketing voice (no "revolutionary", no "game-changing", no "10x")
- `offer_back` should name something real you can give in return
- `success_criteria` should be measurable — what does the helper's input actually let you do?

## Configuration

Environment variables:

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `ICANTMARKET_API_TOKEN` | for writes | — | Bearer token from `/me/api-tokens` |
| `ICANTMARKET_BASE_URL` | no | `https://icantmarket.com/api/v1` | Override for staging / self-host |

## Source

- Server: [github.com/spranab/icantmarket-mcp](https://github.com/spranab/icantmarket-mcp)
- Platform: [github.com/spranab/icantmarket](https://github.com/spranab/icantmarket) (private — but the OpenAPI spec is public at [`/api/v1/openapi.json`](https://icantmarket.com/api/v1/openapi.json))
- llms.txt: [icantmarket.com/llms.txt](https://icantmarket.com/llms.txt)

## License

MIT.
