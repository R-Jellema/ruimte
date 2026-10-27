---
name: model-catalog
description: Add, rename, retire or remove a model in the model pickers of Claude, Codex, Grok, Copilot or Antigravity. Use when a lab ships a new model, when a model should move to legacy or leave the picker, when asked to "add model X", "mark X as legacy", "remove X", or to bring the catalogs, the bundled manifests and the model comparison in line. Covers the catalogs in the address book's D1, the manifests in ADE CORE, the benchmark table of the comparison, and deciding by itself which older models become legacy.
---

# Model catalog

A model reaches every machine's picker from the address book's D1, without a release or a deploy. Three places
describe a model, and a change touches each that applies:

| Where | What it is | How it changes |
| --- | --- | --- |
| D1 `ruimte-pulsar`, tables `model_catalogs`, `model_catalog_profiles`, `model_catalog_models` | The source of truth that `/v1` and `/v2/models/catalog` answer | SQL with wrangler, no deploy |
| `../adecore/packages/agents/src/providers/<kind>-models.json` | What a release starts with before its first answer, and the Worker's fallback | An edit and a commit in ADE CORE, released when Bas asks |
| D1 table `model_catalog_benchmarks` | The model comparison (bench.ruimte.app and the app): which Artificial Analysis model stands for each effort | SQL with wrangler, no deploy |

`apps/pulsar-worker/README.md` ("Model catalogs" and "Model benchmarks") holds the rules of the tables; read it
once before the first edit. Kinds: `claude` and `codex` (served on v1 and v2), `grok`, `copilot` and `antigravity` (v2 only).

## Steps

1. **Read what is there.** Run every wrangler command from `apps/pulsar-worker` with
   `CLOUDFLARE_API_TOKEN=$(cat ~/.private/cloudflare-api-token)`:

   ```sh
   bunx wrangler d1 execute ruimte-pulsar --remote --json --command "SELECT slug, position, name, profile, badge, legacy, min_cli_version FROM model_catalog_models WHERE kind = 'claude' ORDER BY position"
   bunx wrangler d1 execute ruimte-pulsar --remote --json --command "SELECT name, options, context_window_tokens FROM model_catalog_profiles WHERE kind = 'claude'"
   ```

   A kind without a row in `model_catalogs` is not in D1 yet. Seed it first from its manifest with
   `bun scripts/seed-model-catalog.ts <kind>` (from the repository root), then edit it in D1.

2. **Find the facts, never guess them.** From the lab's own announcement or the CLI: the exact slug the CLI
   takes, the name, the context window and the efforts it offers, and the oldest CLI version that knows it
   (`min_cli_version`, only when known). A slug matches `^[a-z0-9][a-z0-9._-]*$`. Reuse a profile whose options
   and context windows match exactly. Add a new profile only for a new combination. Name what you could not
   confirm to Bas instead of filling it in.

3. **Decide what becomes legacy.** See "Legacy" below. Also decide whether the default (`default_model`) should
   move, and say why.

4. **Write D1** in one command per kind, so the kind is changed in one go. Make room with `position` first, then
   insert:

   ```sql
   UPDATE model_catalog_models SET position = position + 1 WHERE kind = 'claude' AND position >= 2;
   INSERT INTO model_catalog_models (kind, slug, position, name, profile, badge, legacy) VALUES ('claude', 'claude-opus-6', 2, 'Claude Opus 6', 'opus', 'New', 0);
   UPDATE model_catalog_models SET legacy = 1 WHERE kind = 'claude' AND slug = 'claude-opus-5-5';
   ```

   Removing a model is a `DELETE FROM model_catalog_models WHERE kind = ... AND slug = ...`. A chat that named it
   falls back to the default. Remove only on request or for a model the CLI no longer accepts; legacy is the
   usual end of a model. Never delete the default model or a profile a model still names. The triggers date
   the kind themselves.

5. **Check that machines take it.** A catalog that fails the frozen schema of its route is answered from the
   bundled manifest instead, so an edit can fail without an error. Compare the date D1 holds with the one the
   route answers. They must be the same:

   ```sh
   bunx wrangler d1 execute ruimte-pulsar --remote --json --command "SELECT updated_at FROM model_catalogs WHERE kind = 'claude'"
   curl -s "https://pulsar.ruimte.app/v2/models/catalog?fresh=$RANDOM" | jq '.catalogs.claude | {updatedAt, models: [.models[] | [.slug, .legacy]]}'
   ```

   For `claude` and `codex`, check `/v1/models/catalog` the same way. That is the route released daemons read.
   A machine asks again after fifteen minutes (six hours for a daemon that reads `/v1`).

6. **Mirror into ADE CORE.** Bring `<kind>-models.json` in line with D1, with `updatedAt` set to the D1
   `updated_at`. Work in `../adecore` on main: `git pull --ff-only` first, run
   `bun --conditions=source test packages/agents/src/providers` there, commit as
   `feat(agents): ...` and push. Do not release ADE CORE unless Bas asks.

7. **The model comparison.** Every model of `claude` and `codex` the picker shows has rows in
   `model_catalog_benchmarks`, and so does a Grok or Gemini model (kinds `grok` and `antigravity`) Bas wants
   compared. Copilot has no lab and is never compared. One row per choice of the model's effort option, with
   `position` cheapest first. Name and legacy come from the catalog row, so they need nothing here, and a
   deleted model takes its rows along. `source_id` and `source_name` are Artificial Analysis's own id and name
   of that effort. Find them among what the last refresh measured, which needs no key:

   ```sh
   bunx wrangler d1 execute ruimte-pulsar --remote --json --command "SELECT source_id, name FROM benchmark_measurements WHERE name LIKE '%Opus 6%' ORDER BY name"
   ```

   Take an id only when the name names that model and effort without doubt. A model they have not measured yet
   gets its rows with both columns null (see GPT-6.1 Terra), and an `UPDATE` once it shows up. Check the answer of
   `GET https://pulsar.ruimte.app/v1/models/benchmarks`: the model is in `models`, with a point per measured
   effort.

8. **Report** what changed per place, every legacy or default decision with its reason, and what you could not
   confirm.

## Legacy

Decide it yourself, the way a person who follows the labs would. A model becomes legacy when a newer model of the
same lab and the same tier replaces it in the picker:

- Same line, newer version: Claude Opus 5.5 made Claude Opus 5 legacy, Haiku 5.5 made Haiku 4.5 legacy. A
  new name in a line (GPT-6 Astra beside GPT-6.1 Terra) is a successor only when the lab says it replaces the
  older one; otherwise both stay current.
- A different tier is no successor: a new Haiku leaves Sonnet and Opus as they are, and a fast or mini variant
  leaves the full model alone.
- A model that stays the newest of its tier stays current, however old.
- At most one current model per tier and line. Two current versions of one line means the older one is legacy.
- For an ACP kind the agent's own list decides what a person can pick. Legacy there only marks how the picker
  shows it.

Never mark the default model legacy. When the default is superseded, move `default_model` to its successor in
the same command, unless the successor is a preview or costs a different tier. Then keep the default and say so.
A legacy model keeps its row and its benchmark row, so chats on it and the comparison keep working.

## Rules

- No secrets in a commit or a report; the token stays in `~/.private`.
- A schema change (a new option type, a new field) never goes through SQL: that needs a new route with a frozen
  schema of its own (`apps/pulsar-worker/src/catalog-schemas.ts`), which is code and a plan.
- Commits follow the repository: English, conventional, no co-author lines.
