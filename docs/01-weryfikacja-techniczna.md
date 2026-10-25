# Weryfikacja techniczna (sekcja 20 specyfikacji)

Data: 25 października 2026 r. Źródło: Marinara Engine, gałąź `staging`, commit `1bf5a7d` (wersja 2.5.1), sklonowana do `vendor/Marinara-Engine`. Wersja na VPS (`marinara-staging`) to także 2.5.1. Instalacji na VPS nie zmieniałem: wykonałem tylko odczyt `docker ps`/`docker inspect` i jedno zapytanie HTTP GET.

Testy wykonałem na lokalnej instancji (`tools/marinara-test/start.mjs`, port 7870, osobny katalog danych) z neutralnymi danymi typu „Probe Alpha”. Model językowy zastąpiłem lokalną atrapą (`tools/marinara-test/mock-llm.mjs`), która zapisuje każdy prompt wysłany przez Marinarę. Nie było żadnych płatnych wywołań ani wywołań zużywających limity.

Legenda: **✅ potwierdzone testem**, **🔎 potwierdzone w kodzie**, **❓ założenie / do sprawdzenia**.

## 1. Formaty importu kart, person i lorebooków

| Ustalenie | Status |
|---|---|
| Natywny format to koperta `{ type, version: 1, exportedAt, data }` z typem `marinara_character` / `marinara_persona` / `marinara_lorebook`. Import idzie przez `POST /api/import/marinara`. | ✅ |
| Karta: `data` = Chara Card V2 (`spec: chara_card_v2`). Pola: `description`, `personality`, `scenario`, `first_mes`, `mes_example`, `tags`, a Marinara dodaje `extensions.backstory` i `extensions.appearance` (+ `extensions.imageAppearance`). Wszystkie pola specyfikacji (sekcja 6) mają natywne odpowiedniki. | ✅ (import + odczyt + obecność w finalnym prompcie) |
| Avatar jest osadzany jako data URL w polu `avatar` koperty. | 🔎 |
| Persona: płaski obiekt (`name`, `description`, `personality`, `backstory`, `appearance`, `scenario`, `mes_example`, `tags`…). | ✅ |
| Lorebook: `{ lorebook, entries, folders }`. Import zachowuje wszystkie ustawienia aktywacji: constant, selective (+ logika), klucze, whole words, sticky, cooldown, delay, ephemeral, probability, group, position/depth/order, Outlet, Decision (require/trigger), No Vector, ustawienia wektorów lorebooka. | ✅ |
| **Powiązania przez ID nie są przenośne.** Import zostawia `characterIds` lorebooka i `characterFilterIds` wpisów w postaci z pliku. Po imporcie wskazują na rekordy, których nie ma. Nieaktualny filtr ID **blokuje wpis całkowicie** (powód `filters`). | ✅ |
| **Filtry po tagu postaci są przenośne.** Wpis z `characterTagFilterMode: include` + tag postaci odpalał w czacie z tą postacią, a w czacie z inną postacią był zablokowany. Tagi kart przetrwały import. | ✅ |
| Kategoria lorebooka (World/Character/NPC…) to tylko etykieta. Nie wpływa na aktywację. Assign Lorebook w edytorze postaci pokazuje jednak tylko kategorię Character. | 🔎 (dokumentacja) |
| Lorebook osadzony w karcie (`character_book`) może przy imporcie stać się lorebookiem powiązanym z kartą. Działa to tylko dla jednego lorebooka na kartę i wymaga wyboru „Import Lorebook” w oknie importu. | 🔎 (dokumentacja + importer) |
| Format „Compatible JSON/PNG” dokleja Backstory i Appearance do Description. Dla Marinary używamy wyłącznie formatu natywnego. | 🔎 |

**Wniosek:** eksport plikowy jest wykonalny. Prywatna wiedza NPC wymaga filtrów po tagach, nie po ID. Przypięcie lorebooków do czatu przygody to ręczny krok („Add Lorebook” w ustawieniach czatu). Globalnych lorebooków unikamy.

## 2. Połączenie ChatGPT/Codex

| Ustalenie | Status |
|---|---|
| Marinara nie uruchamia Codex CLI. Czyta plik `auth.json` z `CODEX_HOME` lub `~/.codex` (tworzy go `codex login`), sama odświeża token przez `https://auth.openai.com/oauth/token` (client_id Codexa) i zapisuje odświeżony plik z powrotem. | 🔎 |
| Tekst: OpenAI **Responses API** pod `https://chatgpt.com/backend-api/codex`, nagłówki `Authorization: Bearer`, `ChatGPT-Account-ID`, `originator`. | 🔎 |
| Katalog modeli: `GET …/codex/models` (pole `slug`). Nie potwierdza uprawnień. Obrazy mają osobny endpoint. | 🔎 |
| Obrazy: `POST …/codex/images/generations` lub `/images/edits` (do 16 obrazów referencyjnych), domyślny model `gpt-image-2`, nagłówek `x-codex-image-turn-id`. Endpoint nie zawsze trzyma zadany rozmiar. | 🔎 |
| Embeddingów przez ChatGPT/Codex nie ma. | 🔎 (dokumentacja) |
| Na tym komputerze istnieje `C:\Users\Kociol\.codex\auth.json`. Codex CLI nie jest zainstalowany (plik mógł powstać z aplikacji Codex). | ✅ (sprawdziłem tylko, czy plik istnieje; nie czytałem treści) |
| Kontener na VPS ma `CODEX_HOME=/app/data/codex` z własnym `auth.json`. | ✅ |

**Wniosek: wykonalne w nowej aplikacji tym samym mechanizmem.** Ryzyka:

- To nieoficjalny endpoint ChatGPT. OpenAI może go zmienić bez ostrzeżenia, co Marinara zaznacza w dokumentacji. Adapter musi mieć czytelne błędy i nie przełączać się po cichu na inną drogę.
- Rotacja refresh tokena: jeśli z jednego `auth.json` korzystają aplikacja Codex i nasz generator, obie strony odświeżają token. Trzeba zapisywać plik atomowo, ponownie go wczytywać przed odświeżeniem i obsłużyć utratę ważności komunikatem „zaloguj ponownie”.
- Zgodność z warunkami korzystania ze ścieżki subskrypcyjnej w aplikacji osób trzecich jest szarą strefą. Plan awaryjny to Nano-GPT.
- ❓ Obsługa ustrukturyzowanego wyjścia (`text.format: json_schema`) i narzędzi na tej ścieżce. Do sprawdzenia testem, który zużyje niewielki limit, więc tylko za twoją zgodą.

Plan awaryjny Nano-GPT 🔎: API zgodne z OpenAI (`https://nano-gpt.com/api/v1`) z obsługą tekstu i obrazów. Katalog modeli oznacza modele z subskrypcji (mnożnik) i płatne, co pozwala spełnić zasadę „bez cichego przejścia na płatne”.

## 3. Secret Plot, Narrative Director i API Marinary

| Ustalenie | Status |
|---|---|
| Narrative Director to agent do pobrania (pakiet `director` 1.0.3 z katalogu Marinara-Agents). W świeżej instalacji go nie ma. Na VPS do potwierdzenia przy integracji. | ✅ |
| Secret Plot żyje w pamięci agenta **dla konkretnego czatu**. Nie przechodzi przez pliki kart ani lorebooków. | ✅ |
| Struktura: `overarchingArc { description, protagonistArc, characterArc?, completed }` + opcjonalnie `sceneDirections[]`, `pacing`. Domyślny prompt Directora każe zachować „core mystery” aktywnego łuku. Łuk ma 2–4 zdania, więc to wskazówka prowadzenia, a nie dokumentacja. | 🔎 |
| Zasiew przez API: `PATCH /api/agents/memory/director/:chatId` z `{ patch: { overarchingArc, … } }`. Czat wymaga w metadata `enableAgents`, `activeAgentIds: ["director"]` i `narrativeDirectorSecretPlotEnabled: true`. | ✅ |
| **Pułapka:** bez znacznika `secretPlotLastAssistantMessageId` Director przepisuje plan już przed pierwszą odpowiedzią. Test na atrapie: zasiany łuk został nadpisany. | ✅ |
| **Rozwiązanie:** zasiać plan razem z `secretPlotLastAssistantMessageId` ustawionym na wiadomość otwierającą. Test: Director nie uruchomił się, a zasiany łuk trafił do głównego promptu. | ✅ |
| Blok Secret Plot jest wstrzykiwany do promptu jako wiadomość systemowa. Panel UI tylko go ukrywa przed graczem, model widzi go zawsze. | ✅ |
| REST API pozwala tworzyć postacie, persony, lorebooki z wpisami, czaty (`POST /api/chats`: mode, characterIds, personaId, promptPresetId, connectionId) i metadata czatu (`activeLorebookIds`, agenci). Zapis wymaga nagłówka `x-marinara-csrf: 1`. | ✅ (lokalnie) |
| VPS: kontener nasłuchuje na `127.0.0.1:7861`, dostęp przez Tailscale Serve (`vps-ce03a41d.tail860c71.ts.net`). API zwraca **401** bez logowania, więc integracja potrzebuje danych logowania Marinary. | ✅ |
| Symulacja aktywacji bez modelu: `POST /api/lorebooks/:id/test` z `chatId` (uwzględnia filtry i tagi postaci z czatu). Pełny finalny prompt da się sprawdzić tylko przez generację, np. na atrapie modelu. | ✅ |

**Wniosek:** przy samym eksporcie plikowym Secret Plot da się ustawić tylko ręcznie w panelu „Reveal spoilers”, czyli czytając sekrety. To jest sprzeczne z celem aplikacji. Bezpośrednia integracja przez API jest potwierdzona i mała (tworzenie nowych zasobów + jeden PATCH pamięci). Rekomenduję włączenie jej do wersji 1 jako opcjonalnej akcji. Decyzja należy do ciebie.

## 4. Wektoryzacja i embeddingi

| Ustalenie | Status |
|---|---|
| Wektory lorebooka buduje Marinara: `POST /api/lorebooks/:id/vectorize` z `connectionId` jej połączenia (+ `onlyMissing`). Źródło jest rozwiązywane tak samo jak przy zapytaniach w czasie gry, więc przestrzeń embeddingów indeksu i zapytań jest zgodna. | ✅ (na atrapie embeddingów: 2 z 3 zwektoryzowane, wpis „No Vector” pominięty) |
| Import plików nie przenosi embeddingów. Po imporcie trzeba ponownie wektoryzować (potwierdza dokumentacja). | ✅ / 🔎 |
| Ustawienia przenoszone w pliku: Vectors on/off per lorebook, Query Messages, Score Threshold (kalibrowany), Vector Limit, No Vector per wpis. | ✅ |
| Zmiana modelu embeddingów wymaga „Re-vectorize all”. Przy niezgodnym wymiarze zapytań Marinara **po cichu** pomija wpisy. | 🔎 (dokumentacja) |
| Stan zwektoryzowania widać w danych wpisów (`embedding`), więc aplikacja może go zweryfikować po swojej stronie. | ✅ |

**Wniosek:** generator nie powinien sam liczyć embeddingów dla Marinary. Przygotowuje ustawienia, a wektoryzację zleca Marinarze (etap integracji) albo podaje instrukcję w eksporcie. Własne połączenie embeddingowe aplikacji służy do audytu duplikatów znaczeniowych (sekcja 11 specyfikacji). Status w raporcie ma trzy poziomy: *configured* → *vectorized* (przez API) → *verified* (odczyt statusu i test aktywacji).

## 5. Co zostało niesprawdzone

1. ❓ Ustrukturyzowane wyjście i narzędzia przez ChatGPT/Codex. Wymaga jednego testowego wywołania, które zużyje limit, więc tylko za twoją zgodą.
2. ❓ Generowanie obrazu przez Codex z nowej aplikacji. Wiemy, że działa w Marinarze, ale z nowej aplikacji nie było testu z tego samego powodu.
3. ❓ Czy na VPS jest zainstalowany Narrative Director i jakie są dane logowania do API. Potrzebne dopiero przy integracji.
4. ❓ Zachowanie filtrów tagów w czatach grupowych z trybem narratora (wszystkie postacie w jednym prompcie). Test na lokalnej instancji podczas M2.
5. ❓ Koordynacja `first_mes` wielu kart ze wspólnym otwarciem. Czat Roleplay startuje od greetingu jednej karty, więc otwarcie trzeba osadzić w karcie „prowadzącej” albo w osobnej karcie narratora. Do decyzji w M4.

## 6. Narzędzia testowe w repo

- `tools/marinara-test/start.mjs`: lokalna Marinara z `vendor/` na porcie 7870 i własnym katalogiem danych.
- `tools/marinara-test/mock-llm.mjs`: atrapa modelu (chat completions i embeddings), zapisuje prompty do JSONL.
- `tools/marinara-test/import-probe.mjs`, `activation-probe.mjs`: sondy importu i aktywacji na neutralnych danych.

`vendor/` jest w `.gitignore`. Klon Marinary pobiera się poleceniem `git clone --depth 1 --branch staging https://github.com/Pasta-Devs/Marinara-Engine.git vendor/Marinara-Engine`, a buduje przez `npx pnpm@12.15.0 install && npx pnpm@12.15.0 build`.
