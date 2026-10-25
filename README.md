# Marinara Adventure Generator

Local web app that prepares complete, spoiler-free adventures (character cards, persona, lorebooks, Secret Plot seed, opening) for [Marinara Engine](https://github.com/Pasta-Devs/Marinara-Engine). See the [specification](Marinara-Adventure-Generator-SPEC.md), [technical verification](docs/01-weryfikacja-techniczna.md) and [architecture plan](docs/02-architektura-i-plan.md).

Status: milestones M0 (app skeleton) and M1 (model connections: ChatGPT via Codex login, NanoGPT, OpenRouter, OpenAI-compatible; separate text, image and embedding model lists; explicit, cost-labelled tests; task assignments) and M2 (Marinara native formats, structural validation, export bundle, offline lorebook activation simulator checked against a real Marinara) and M3 (spoiler-free requirements interview: any-language pitch, short preference questions, visible defaults, editable summary, approval) and M4 (staged generation: plan, fact registry, clues, one stage per card and lorebook, persona, opening and Secret Plot seed; code consistency checks with capped repairs; resumable, per-stage regeneration, spoiler-free progress; zip download).

## Requirements

- Node.js 24+
- pnpm 12.15.0, used through `npx --yes pnpm@12.15.0` (no global install needed)

## Run

```bash
npx --yes pnpm@12.15.0 install
npx --yes pnpm@12.15.0 build
npx --yes pnpm@12.15.0 start
```

Open http://127.0.0.1:7880. For development with hot reload, use `npx --yes pnpm@12.15.0 dev` and open http://127.0.0.1:5173.

## Where data lives

- Projects and settings: `data/app.db` (SQLite, override with `DATA_DIR`). Not committed.
- API keys and tokens: the operating system credential store (Windows Credential Manager), under the service name `marinara-adventure-generator`. The database stores only secret names.
- The server listens on `127.0.0.1` only and rejects foreign `Host`/`Origin` headers.

## Checks

```bash
npx --yes pnpm@12.15.0 typecheck
npx --yes pnpm@12.15.0 test
```

Marinara integration test tools live in `tools/marinara-test/` (local Marinara clone under `vendor/`, mock LLM, import and activation probes).

Differential test against a throwaway local Marinara (imports the exported probe package, compares stored fields and lorebook activation with the simulator, then deletes what it created):

```bash
node tools/marinara-test/start.mjs
```

```bash
MARINARA_TEST_URL=http://127.0.0.1:7870 npx --yes pnpm@12.15.0 --filter @adv/server test:marinara
```
