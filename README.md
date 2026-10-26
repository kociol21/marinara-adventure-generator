# Marinara Adventure Generator

**Version 0.2.1.** This is a local web app that builds a complete, ready-to-play adventure for [Marinara Engine](https://github.com/Pasta-Devs/Marinara-Engine) and keeps the plot hidden from you, the player, while it works.

You describe the story you want in a few sentences, in any language, and answer some short questions about your preferences. The app then writes the whole adventure:

- character cards;
- your persona;
- lorebooks;
- a hidden plot for Marinara's Narrative Director;
- an opening scene;
- portraits;
- a title.

It checks its own work and hands the result to Marinara, either as a single click or as a file to import. You never see the twist, the culprit or the secrets until you play.

> Status: early release. It works end to end with Marinara 2.5.1, but it has been tested by one person on Windows, and the Docker setup is new. Expect rough edges and please report them.

## What it does

1. **Interview without spoilers.** You write a short pitch and pick from short multiple-choice questions: genre, tone, narration style, content limits, the hero, the starting situation and so on. Defaults are visible and you can edit them. The summary you approve contains only things you chose yourself.
2. **Generation in stages.** The model first writes a hidden plan, a fact registry and clues. Then it writes each card, the persona, each lorebook and the opening as separate steps. Code checks the steps against each other and repairs them a limited number of times.
   - Every stage can be resumed or regenerated on its own.
   - The progress view shows stage names and counts, never the content.
3. **Quality audit.**
   - Code checks catch passages copied between files, secrets that leak into visible text, and clues the player can never reach.
   - An optional embedding check catches paraphrased leaks.
   - Model reviews cover consistency, character voices, mystery logic, style and spoilers.
   - Problems are fixed in capped rounds.
   - The report shows only numbers and labels, never content.
4. **Judge (optional).** You can assign a decision model, [TypeSafe Jev](https://nano-gpt.com) on NanoGPT or OpenRouter. The judge scores every card, the persona, each lorebook and the opening for fit with your requirements and for quality.
   - Parts at or below the pass mark (0.7 by default) are rewritten, for up to 4 rounds.
   - The loop stops early when a round brings no improvement.
   - If a rewrite scores clearly worse than an earlier version, the earlier version is kept.
5. **Portraits.**
   - Prompts come from each card's appearance, with a style preset and notes for each adventure.
   - Images are cropped square.
   - If the text model accepts images, it checks each portrait against the description and the portrait is redrawn once on a mismatch. Otherwise the portrait is marked unchecked.
   - You can regenerate any portrait.
   - Portraits are embedded on export as WebP.
6. **Title.** The adventure gets a title of its own that fits the style you chose and gives nothing away, for example *The Lamp Beneath the Pier* rather than *Slice of life yuri romance*. **New title** writes another one without redoing anything else and never repeats a title you replaced.
7. **Export and Push to Marinara.** You get a zip that uses Marinara's native formats.
   - The zip includes a START-HERE guide, your requirements sheet, a manifest and a spoiler-free QA report.
   - **Push to Marinara** imports the adventure into your running Marinara:
     - it creates one folder per panel, named after the adventure;
     - it starts a new roleplay chat with the connection and preset you pick and the lorebooks attached;
     - it seeds the opening scene and the Narrative Director's Secret Plot;
     - it can optionally vectorize the lorebooks.
   - Push only creates new things. If any step fails, it deletes everything it created.

## Model connections

You can use any of these. Each task (text, image, embedding, judge) gets its own connection and model on the **Connections** page.

| Provider | Text | Images | Embeddings | Judge (Jev) |
| --- | --- | --- | --- | --- |
| **ChatGPT via Codex login** (your ChatGPT subscription) | yes | yes | – | – |
| **NanoGPT** (API key; the model list shows which models your subscription covers) | yes | yes | yes | yes |
| **OpenRouter** (API key) | yes | yes | yes | yes |
| **Any OpenAI-compatible endpoint** (local LLM servers, other providers) | yes | if supported | if supported | – |

- **Tests cost money.** Connection tests are explicit and labelled with what they cost. Nothing calls a model until you start a test or a generation, and the generation start dialog says how many requests to expect.
- **Codex login.** The ChatGPT connection reads your existing `~/.codex/auth.json` in place. It never copies the file.

## Requirements

- **Node.js 24 or newer.** Nothing else to install: pnpm runs through `npx`.
- **Or Docker**, with nothing else installed. See [Docker](#docker).
- **Tested systems.** It has been tested on Windows. Linux and macOS should work, because the keys go into the system keychain through `@napi-rs/keyring`, but they have not been tested yet.

## Quick start

**Windows:** double-click `Start Adventure Generator.bat`. The first start installs dependencies and builds the app, which takes a minute or two. After that, the browser opens at http://localhost:7880. If the app is already running, the file just opens the browser.

**Linux and macOS:** run `./start.sh` from the app folder. It does the same as the Windows launcher.

**By hand, on any system:**

```bash
git clone https://github.com/kociol21/marinara-adventure-generator.git
cd marinara-adventure-generator
npx --yes pnpm@12.15.0 install
npx --yes pnpm@12.15.0 build
npx --yes pnpm@12.15.0 start
```

Then open http://127.0.0.1:7880.

**Updating.** Download the new version (`git pull`, or a fresh zip from [Releases](https://github.com/kociol21/marinara-adventure-generator/releases)), then start the app again with the launcher. The launcher installs any new dependencies and rebuilds. Your projects and keys stay where they are. When a new release is out, the top bar shows **Update available**; you can turn that check off in Settings.

**First steps:**

1. Add a connection on **Connections** and assign it to the Text task. Image, embedding and judge are optional.
2. In **Settings**, set your Marinara URL if you want to use Push.
3. Create an adventure and go through the interview.
4. Approve the summary and start the generation.

## Docker

```bash
git clone https://github.com/kociol21/marinara-adventure-generator.git
cd marinara-adventure-generator
docker compose up -d --build
```

Then open http://localhost:7880.

- **Where things live.** Projects, settings and API keys go into the `adventure-data` volume. A container has no OS credential store, so the keys are kept in `secrets.json` in that volume, readable only inside the container.
- **Network.** The port is published on `127.0.0.1` only. To use another port, set `PORT` (for example `PORT=7990 docker compose up -d`), not just the left side of the mapping.
- **Updating.** `git pull`, then `docker compose up -d --build`.
- **ChatGPT (Codex login).** Uncomment the `.codex` volume and `CODEX_HOME` in `docker-compose.yml`.

**Reaching Marinara from the container:**

| Where Marinara runs | Marinara URL in Settings |
| --- | --- |
| **In Docker on the same machine** (recommended pairing) | `http://marinara:7860`. Start the generator with both compose files: `docker compose -f docker-compose.yml -f docker-compose.marinara.yml up -d --build`. This joins Marinara's Docker network. If Marinara's network is not called `marinara-engine_default`, set `MARINARA_NETWORK` (see `docker network ls`). |
| **Directly on the same machine** (not in Docker) | Simpler to run the generator without Docker too. Otherwise use `http://host.docker.internal:7860`, start Marinara with `HOST=0.0.0.0`, and add `host.docker.internal` to Marinara's `TRUSTED_HOSTS`. |
| **On another machine or a VPS** | The same address as without Docker (see below). |

## Connecting to Marinara

The generator talks to Marinara's HTTP API from its own server, never from your browser. In **Settings**:

1. Set **Marinara URL**.
2. If your Marinara has a login, enter it under **Marinara login**.
3. Press **Check Marinara connection**. It shows Marinara's version, whether the Narrative Director is installed, and which connections can build vectors.

| Where Marinara runs | What to enter | Notes |
| --- | --- | --- |
| **Same computer, started with pnpm or the launcher** | `http://127.0.0.1:7860` | Works out of the box. Marinara trusts local connections, so no login is needed. |
| **Same computer, in Docker** | `http://127.0.0.1:7860`, or whatever port you published | Works out of the box. Marinara trusts its Docker host while no login is set. If you set a login, enter it here too. |
| **Another machine or a VPS, with or without Docker** | The address you use in your browser, for example `http://100.x.y.z:7860` over Tailscale, or `https://marinara.example.com` | Marinara must accept remote connections. That means Tailscale, which is trusted automatically, or a remote login, or an `IP_ALLOWLIST` entry for your computer. Enter the remote login here. See Marinara's [REMOTE_ACCESS.md](https://github.com/Pasta-Devs/Marinara-Engine/blob/main/docs/REMOTE_ACCESS.md). |

- **HTTPS** needs a certificate your system trusts: Let's Encrypt, Tailscale Serve, or a proxy with a real certificate. Self-signed certificates are rejected.
- **Marinara version.** Tested with Marinara **2.5.1**. Older versions without the folders API still import, but skip the folder step.
- **Secret Plot.** The Secret Plot needs Marinara's Narrative Director. Without it, you still get the cards, the lorebooks and the opening.
- **Without Push.** You can always use the zip instead and import it in Marinara by hand. The START-HERE guide in the zip walks you through it.

## Privacy and keys

- **Network.** The app listens on `127.0.0.1` only, and in Docker its port is published on `127.0.0.1` only. It rejects requests with a foreign `Host` or `Origin` header.
- **Keys.** API keys, tokens and the Marinara login are kept in your operating system's credential store, for example Windows Credential Manager under `marinara-adventure-generator`. In Docker they are kept in `secrets.json` in the data volume instead. They are never in the database, the browser, the logs or the exports, and every exported file is checked for stored secrets before you can download it.
- **Data.** Projects and settings live in `data/app.db`, a SQLite file. Set `DATA_DIR` to keep it elsewhere.
- **Telemetry.** There is none. Requests go only to the model providers you configure and to your Marinara.
- **Update check.** The update check is the one other request. At most twice a day it asks GitHub for the latest release, and it sends nothing about you or your adventures. You can turn it off in Settings.

## Known limitations

- All generated content is in English. Your pitch can be in any language.
- A full adventure takes dozens of model requests. On paid APIs this costs real money, so check the estimate before you start.
- Quality depends heavily on the text model. Strong models give much better mysteries.
- This is not an official Marinara project.

## For developers

pnpm monorepo:

- `packages/shared` holds the zod schemas and shared types;
- `packages/server` is the Fastify server, with node:sqlite, the pipeline, the audit, the connections and the Marinara client;
- `packages/web` is the React UI, built with Vite and TanStack Query.

```bash
npx --yes pnpm@12.15.0 dev        # hot reload, UI on http://127.0.0.1:5173
npx --yes pnpm@12.15.0 typecheck
npx --yes pnpm@12.15.0 test
```

The integration tests run against a throwaway local Marinara clone. Put it in `vendor/Marinara-Engine`, then start it on port 7870 with:

```bash
node tools/marinara-test/start.mjs
```

```bash
MARINARA_TEST_URL=http://127.0.0.1:7870 npx --yes pnpm@12.15.0 --filter @adv/server test:marinara
```

The design documents are written in Polish:

- [specification](Marinara-Adventure-Generator-SPEC.md);
- [technical verification](docs/01-weryfikacja-techniczna.md);
- [architecture](docs/02-architektura-i-plan.md);
- [acceptance criteria](docs/03-kryteria-akceptacji.md).
