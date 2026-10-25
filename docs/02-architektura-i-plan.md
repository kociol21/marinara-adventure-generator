# Architektura, model danych i plan pierwszej wersji

Dokument z 25 października 2026 r. Opiera się na wynikach z [01-weryfikacja-techniczna.md](01-weryfikacja-techniczna.md). Tam, gdzie decyzja zależy od czegoś niepotwierdzonego, jest to zaznaczone.

## 1. Decyzje główne

| Obszar | Decyzja | Uzasadnienie |
|---|---|---|
| Język | TypeScript w całym projekcie | Ten sam język co Marinara. Wspólne typy frontend–backend i schematy formatów. |
| Runtime | Node.js 24 | Zgodny z Marinarą 2.5.1 i już zainstalowany na komputerze. |
| Backend | Fastify | Lekki, z dobrym wsparciem walidacji schematów. Marinara też go używa, więc łatwiej porównywać zachowanie. |
| Walidacja | Zod | Jeden schemat służy do walidacji wyjścia modeli, argumentów narzędzi i formatów eksportu. |
| Baza | SQLite (better-sqlite3) + Drizzle ORM | Lokalnie, jeden plik, transakcje i trwałość etapów bez serwera bazy. |
| Frontend | React + Vite + TanStack Query | Prosty SPA serwowany przez backend. Bez SSR, bo aplikacja jest lokalna. |
| Repozytorium | pnpm workspace: `server`, `web`, `shared` | `shared` zawiera schematy formatów Marinary i kontrakty API. |
| Sekrety | Systemowy magazyn poświadczeń (Windows Credential Manager przez `@napi-rs/keyring`) | Klucze API nie trafiają do SQLite, logów ani frontendu. |
| Logowanie Codex | Odczyt `auth.json` z `CODEX_HOME` / `~/.codex`, bez kopiowania tokenów | Ten sam mechanizm co w Marinarze; tokeny zostają tam, gdzie zapisał je `codex login`. |
| Język treści | Angielski, stały | Ustalenie z sekcji 22 specyfikacji. Interfejs także po angielsku. |

Nie używamy frameworków agentowych (LangChain itp.). Pętla „model → wywołanie narzędzia → walidacja → wynik” jest krótka i musi być pod pełną kontrolą aplikacji, bo to aplikacja wymusza bramki jakości.

## 2. Moduły backendu

```
server/
  connections/   adaptery dostawców: codex-chatgpt, nano-gpt, openai-compatible, openrouter
                 + katalogi modeli (osobno text / image / embedding), testy połączeń
  pipeline/      orkiestrator etapów, zapis stanu, unieważnianie zależności, limity poprawek
  generation/    prompty etapów (EN), wywołania z ustrukturyzowanym wyjściem, narzędzia modelu
  facts/         rejestr faktów, warstwy wiedzy, graf wskazówek
  audit/         kontrole strukturalne (kod) i semantyczne (LLM + embeddingi)
  marinara/      mapowanie na natywny format, budowa paczki, symulator aktywacji lorebooków,
                 (etap 2) klient REST Marinary
  projects/      biblioteka przygód, wersje, eksporty
  secrets/       magazyn poświadczeń
```

### Adaptery połączeń

Każdy adapter deklaruje możliwości zamiast zakładać je z podobieństwa endpointów:

```ts
interface ProviderAdapter {
  kind: "codex-chatgpt" | "nano-gpt" | "openai-compatible" | "openrouter";
  listTextModels(): Promise<ModelInfo[]>;      // osobny fetch
  listImageModels(): Promise<ModelInfo[]>;     // osobny fetch
  listEmbeddingModels?(): Promise<ModelInfo[]>;
  capabilities(modelId): Capabilities;         // tools, json_schema, vision, cost class
  generateText(req): Promise<TextResult>;
  generateImage?(req): Promise<ImageResult>;
  embed?(texts): Promise<number[][]>;
}
```

`ModelInfo` ma pole `confirmed` (z katalogu dostawcy albo ręcznie wpisany) i `billing` (`subscription` | `paid` | `unknown`). To pozwala pokazać, że model jest płatny, zanim zostanie użyty. Przypisanie zadania (tekst etapu X, obrazy, embeddingi audytu) wskazuje dokładnie jedno połączenie i model. Brak cichych fallbacków: błąd zatrzymuje etap i pokazuje status.

## 3. Model danych

Wszystkie treści przygody są wersjonowane. Tabele (skrót):

- **project**: id, title, status, created/updated, `spoilerSafeTeaser`.
- **requirements**: project_id, wersja, JSON wymagań (gatunek, ton, setting, sytuacja startowa, `maxNpcCards`, persona mode, skala, granice treści, styl wizualny), `approvedAt`.
- **interview_message**: historia rozmowy o wymaganiach (bez spoilerów z definicji).
- **connection**: id, name, kind, baseUrl, `secretRef` (klucz w magazynie systemowym, nie sam klucz), ustawienia.
- **task_assignment**: task (`plan`, `cards`, `lore`, `audit`, `image`, `embedding_audit`…) → connection_id + model_id.
- **entity**: id, project_id, type (`npc_card` | `npc_lore` | `location` | `organization` | `item` | `event` | `rule`), name, aliases[], `cardSlot` (dla max N kart), `spoilerSafe` (czy nazwę i aliasy można pokazać).
- **fact** — serce systemu:
  - id, project_id, subject_entity_id, statement (EN)
  - `layer`: `objective_truth` | `npc_belief` | `npc_claim` | `discovered` | `narration_hint`
  - `holderEntityId` (kto wierzy lub kłamie, dla warstw 2–3), `contradicts` (fact_id kłamstwa → prawda)
  - `secrecy`: `public` | `hidden` | `secret`
  - `home`: dokładnie jedno główne miejsce zapisu (card field albo lorebook entry)
  - `mirrors[]`: dopuszczone krótkie powtórzenia z uzasadnieniem
- **clue**: id, fact_id (do czego prowadzi), gdzie i jak można ją znaleźć, `redundancyGroup` (kilka dróg do tego samego wniosku, żeby pominięcie jednej wskazówki nie blokowało gry), red herring + jego uzasadnienie.
- **card**: entity_id, pola Marinary (`description`, `personality`, `extensions.backstory`, `extensions.appearance`, `scenario`, `first_mes`, `mes_example`, tags, `extensions.imageAppearance`).
- **persona**: analogicznie (osobna od limitu kart).
- **lorebook** / **lorebook_entry**: pełny zestaw pól natywnych Marinary (keys, secondaryKeys, selective/logic, constant, position, depth, order, sticky/cooldown/delay, probability, group, filtry tagów, vectors, decision…) + `factIds[]`, z których wpis został zbudowany.
- **secret_plot_seed**: `overarchingArc` {description, protagonistArc, characterArc} + opcjonalne `sceneDirections`, `pacing`.
- **opening**: wspólna scena otwierająca + powiązanie z `first_mes` wybranej karty.
- **asset**: avatar per entity, prompt, connection, seed, status.
- **stage_run**: etap, wejście (hashe zależności), wynik, status, liczba prób, koszt i zużycie.
- **audit_finding**: obszar, ważność, `spoilerSafeSummary` (domyślny widok) i `spoilerDetail` (tylko po „Show spoilers”), status poprawki.
- **export_bundle**: wersja, manifest, lista plików, wynik walidacji.

**Jedno źródło faktu.** Karty i lorebooki są renderowane z rejestru faktów, a nie pisane niezależnie. Audyt duplikatów porównuje treść wynikową z rejestrem i między sobą: dokładne n-gramy, embeddingi i ocena LLM dla par podejrzanych.

## 4. Pipeline

Etapy zgodne z sekcją 15 specyfikacji. Każdy etap:

1. Ma deklarowane wejścia. Hash wejść jest zapisany w `stage_run`.
2. Zapisuje wynik w transakcji. Restart wznawia od pierwszego etapu bez aktualnego wyniku.
3. Unieważnia zależne etapy, gdy zmieni się jego wynik. Przykład: zmiana faktu oznacza karty i wpisy z tym `factId` do aktualizacji oraz awatar, jeśli zmienił się `appearance`.
4. Ma limit automatycznych poprawek (domyślnie 2). Potem dostajesz bezspoilerowy status i wybór: ponów, pomiń albo zmień model.

Model nie kończy etapu sam. Etap jest zakończony dopiero wtedy, gdy przejdą walidatory kodu tego etapu.

### Narzędzia dla modelu

Zgodnie z sekcją 14 specyfikacji: `get_requirements`, `read_entity`, `save_entity`, `search_facts`, `save_fact`, `validate_package`, `audit_duplicates`, `generate_avatar`, `export_package`. Gdy model nie obsługuje natywnych narzędzi, ta sama logika działa przez ustrukturyzowane wyjście JSON per etap. Wybór zależy od wykrytych możliwości połączenia.

## 5. Paczka eksportu (wersja 1)

Wynik weryfikacji wymusza dwie zasady.

1. **Nie używamy powiązań przez ID w plikach.** Marinara przenosi `characterIds` i `characterFilterIds` z pliku bez zmian, więc po imporcie wskazują na nieistniejące rekordy. Zamiast tego:
   - prywatna wiedza NPC: filtr wpisu po **tagu** postaci (`characterTagFilterMode: include`). Tagi przetrwają import przy domyślnym trybie „All tags”. Tag jest neutralny i nie zdradza treści, np. `adv-<slug>-<imię>`;
   - przypięcie lorebooków do przygody: instrukcja „Add Lorebook” w ustawieniach czatu (Chat badge). Nigdy Global, bo przeciekałoby do innych gier;
   - opcjonalnie lorebook postaci osadzony w karcie (`character_book`), który import zamienia w lorebook powiązany z kartą. To jedyne automatyczne powiązanie w plikach, ale działa tylko dla jednego lorebooka na kartę.
2. **Secret Plot i wektory nie przechodzą przez pliki.** Secret Plot żyje w pamięci agenta danego czatu, a wektory trzeba zbudować po imporcie. Raport mówi to wprost.

Zawartość zipa:

```
<adventure>/
  START-HERE.md                 instrukcja importu i startu, bez spoilerów
  characters/*.marinara.json    karty (envelope marinara_character v1, z avatarem)
  persona/*.marinara.json       persona, jeśli zamówiona nowa
  lorebooks/*.marinara.json     World / Characters / Plot (+ ewentualne inne)
  qa-report.md                  bezspoilerowy raport
  manifest.json                 wersje, hashe, statusy (np. vectors: configured / not executed)
  director/secret-plot.sealed.json   tylko do etapu 2; nie do ręcznego czytania
```

## 6. Integracja bezpośrednia (etap 2, API potwierdzone w kodzie)

Klient REST Marinary tworzy wyłącznie nowe zasoby:

1. `POST /api/characters`, `POST /api/lorebooks` (+ `/:id/entries/bulk`) oraz persona. Linkowanie i filtry dostają prawdziwe ID docelowej instalacji.
2. `POST /api/chats` (mode `roleplay`, characterIds, personaId). Metadata czatu: `enableAgents`, `activeLorebookIds`, `activeAgentIds: ["director"]`, `narrativeDirectorSecretPlotEnabled`. Warunek: w Marinarze musi być zainstalowany pakiet `director`. Aplikacja sprawdza to przed wysłaniem i nie instaluje go sama bez twojej zgody.
3. `PATCH /api/agents/memory/director/:chatId` z `overarchingArc` (+ `sceneDirections`, `pacing`). Do tego `secretPlotLastAssistantMessageId` ustawione na wiadomość otwierającą, żeby pierwsza aktualizacja Directora nastąpiła dopiero po Run Interval.
4. `POST /api/lorebooks/:id/vectorize` z wybranym połączeniem Marinary. Indeksowanie i zapytania używają wtedy tego samego źródła embeddingów.
5. Odczyt kontrolny: Active Context lub Peek Prompt na czacie testowym.

Uwierzytelnienie: VPS wymaga loginu przez Tailscale Serve (401 bez niego). Aplikacja potrzebuje danych logowania Marinary w magazynie systemowym. Testy integracyjne idą najpierw na lokalną instancję.

**Rekomendacja:** przenieść kroki 1–3 do wersji 1 jako opcjonalną akcję „Push to Marinara”. Bez API Secret Plot da się zasiać tylko ręcznie, a to wymaga od ciebie przeczytania sekretów. Decyzja należy do ciebie.

## 7. Plan realizacji wersji 1

| Kamień milowy | Zakres | Wynik do sprawdzenia |
|---|---|---|
| M0. Szkielet | Monorepo, Fastify, SQLite, React, magazyn sekretów, ustawienia | Aplikacja startuje lokalnie, zapisuje projekt |
| M1. Połączenia | Adaptery Codex i Nano-GPT (+ OpenAI-compatible), osobne fetch modeli, testy tekstu i obrazu, przypisanie zadań | Listy modeli pobrane osobno; testy wymagają kliknięcia i opisują koszt |
| M2. Formaty Marinary | Schematy Zod natywnych formatów, eksporter, symulator aktywacji lorebooków, testy importu na lokalnej Marinarze | Pliki neutralnej przygody importują się bez błędów; aktywacja zgodna z symulacją |
| M3. Wywiad | Rozmowa o wymaganiach, domyślne wartości, bezspoilerowe podsumowanie, zatwierdzenie | Zatwierdzone wymagania zapisane w wersji |
| M4. Pipeline | Orkiestrator, plan świata, obsady i fabuły, rejestr faktów, wskazówki, generacja kart i lorebooków, persona, otwarcie, Secret Plot seed | Neutralny scenariusz testowy generuje się etapami i wznawia po przerwaniu |
| M5. Audyt | Walidatory kodu, duplikaty (n-gramy, embeddingi, LLM), logika zagadki, spoilery w polach jawnych, budżety | Raport bezspoilerowy; poprawki z limitem prób |
| M6. Awatary | Prompt z `appearance` i wspólnego stylu, generowanie, ponowienie, pominięcie | Awatar osadzony w karcie; ponowienie nie rusza reszty |
| M7. Eksport | Zip, START-HERE, manifest, raport | Kryteria akceptacji 1–12 sprawdzone na neutralnej przygodzie |
| M8 (opcjonalny w v1). Push | Klient REST Marinary, kroki 1–4 z sekcji 6 | Nowy czat z zasianym Secret Plot na lokalnej Marinarze |

Testy automatyczne: walidatory formatów, symulator aktywacji, orkiestrator (wznowienie, unieważnianie), mapowanie eksportu z porównaniem do importu w lokalnej Marinarze. Testy wywołujące płatne modele uruchamiamy tylko ręcznie, za twoją zgodą.
