# AI Empire HQ · sample knowledge vault

This folder is a **sample** Obsidian-compatible vault used for demos and
development. Every note is marked `origin: "sample"` and contains a
"Sample content" callout. It holds no real business information and no
secrets.

- Open it in Obsidian with *Open folder as vault* to browse the notes.
- Regenerate it with `npm run knowledge:seed` (only `hq/` and `businesses/`
  are rewritten).
- Real vaults must live outside the repository or under `vaults/`
  (git-ignored), set with `KNOWLEDGE_VAULT_DIR`. Sync is turned off.

Layout:

```
hq/                         headquarters notes (HQ roles only)
businesses/<business>/      one folder per business (isolated)
  business.md
  projects/<slug>.md
  agents/<slug>.md
  reports/<yyyy>/<yyyy-mm-dd>-<slug>.md
```
