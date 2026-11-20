# Knowledge Service

Obsidian is the long-term, human-readable knowledge system for AI Empire HQ.
The app reads and writes plain Markdown files with frontmatter, so a vault
can be opened in Obsidian at any time.

Code: `src/backend/knowledge/` (server-only), sync design in
`src/infrastructure/knowledge/sync.ts`, UI at `/knowledge`.

## Vault layout

```
<vault>/
  hq/                                   headquarters scope (HQ roles only)
    projects/<slug>.md
    agents/<slug>.md
    reports/<yyyy>/<yyyy-mm-dd>-<slug>.md
  businesses/<business>/                one isolated folder per business
    business.md
    projects/<slug>.md
    agents/<slug>.md
    reports/<yyyy>/<yyyy-mm-dd>-<slug>.md
```

The vault is chosen with `KNOWLEDGE_VAULT_DIR`; it defaults to the committed
**sample** vault `knowledge/sample-vault`. Real vaults belong outside the
repository or under `vaults/` (git-ignored).

## Frontmatter

Every note starts with the same flat properties (Obsidian shows them as
Properties). Values are written as JSON, which is valid YAML.

```yaml
---
aehq_schema: 1
id: "rpt-sample-business-20261119-sector-candidates-research"
kind: "report"                 # business | project | report | agent
title: "Sector candidates research"
business: "sample-business"    # null = headquarters
project: "sector-discovery"
agent: "research-agent"
tasks: ["sample-task-sector-scan"]   # linked application task ids
author_kind: "system"          # user | agent | system (from the access context)
author_id: "sample-seed"
status: "final"                # draft | final
confidentiality: "internal"    # internal | restricted (never synced)
origin: "sample"               # app | sample
created: "2026-11-19T09:00:00.000Z"
updated: "2026-11-19T09:00:00.000Z"
tags: ["aehq/report","aehq/scope/sample-business","research"]
---
```

## Service API

```ts
const kb = getKnowledgeService();
await kb.createNote(ctx, { kind: "report", business: "acme", title, body, project, tasks });
await kb.readNote(ctx, path);
await kb.updateNote(ctx, path, { body, status: "final" });
await kb.linkToTask(ctx, path, taskId);          // link a report to an app task
await kb.findNotesForTask(ctx, taskId);          // reverse lookup
await kb.listNotes(ctx, { business, kind, project, task });
```

## Safety rules

| Concern | How it is enforced |
| --- | --- |
| Business isolation | Every call takes an access context. The note's scope is derived from its path and checked *before* any file access. Agents get `businessAgentContext(agentId, business)`: one business, no HQ. |
| HQ knowledge | `hq/` requires `hq: true` (owner, Chief AI Manager, Central PM). |
| Restricted notes | Readable by human users only; never selected for sync. |
| Path traversal | Paths are built from validated slugs. Caller-supplied paths must match a strict whitelist regex, then must resolve inside the vault root. Symlinks anywhere below the root are refused. |
| Smuggled notes | A note whose frontmatter `business`/`kind` disagrees with its folder is rejected. |
| Secrets | Titles, bodies, tags and task ids are scanned for API keys, tokens, private keys, credentialed URLs and password assignments; the write is refused and the message names only the kind of secret. |
| Integrity | Strict frontmatter schema (unknown keys rejected), size limits, atomic writes (temp file + `link`/`rename`), no overwrite on create. |
| Authorship | `author_kind`/`author_id` always come from the access context, never from input. |

Until authentication exists, the dashboard reads as the owner
(`ownerContext()`). The `/knowledge` page includes a live isolation check
using an agent context.

## Sample vault

`npm run knowledge:seed` regenerates `knowledge/sample-vault` through the
real service: two sample businesses, a project, an agent profile, an HQ
project, and a sample research report linked to `sample-task-sector-scan`.
Every note is `origin: "sample"` and carries a "Sample content" callout.

## Obsidian Headless Sync (design, not enabled)

Nothing syncs in this version: the only adapter in use is
`DisabledKnowledgeSync`, and the shipped policy (`DEFAULT_SYNC_POLICY`) is
frozen with `enabled: false`.

```
app vault ──selectNotesForSync(policy)──▶ sync mirror dir ──▶ headless Sync client ──▶ remote vault (E2E encrypted)
   ▲                                                                   │
   └──── validate inbound edits (schema, location, secrets) ◀──────────┘
```

Design decisions:

1. **Mirror, don't share.** The sync client never touches the app vault. A
   per-remote-vault mirror directory receives only notes allowed by policy.
2. **Default-deny policy** (`selectNotesForSync`, unit-tested): sync must be
   enabled, the business must be allow-listed, HQ and sample notes are opt-in,
   and `restricted` notes never leave the server.
3. **One remote vault per business** keeps isolation intact on the Obsidian
   side and limits the blast radius of a compromised device.
4. **Sidecar process.** The official Obsidian headless Sync client runs as a
   separate process/container with its credentials resolved from the server's
   secret store (`credentialRef`), never from Markdown or the repository.
5. **Inbound edits are untrusted.** Changes made in Obsidian are re-parsed and
   re-validated (schema, folder/metadata match, secret scan) before the app
   accepts them; conflicts keep both versions for human review.
6. **Approval gates.** Obsidian Sync is a paid service, so enabling it needs
   the owner's explicit approval. Before implementing, verify the official
   headless client's current CLI, deployment model and terms.

The Chromebook is never accessed remotely. To browse notes today, open the
vault folder in Obsidian from a local clone of this repository.
