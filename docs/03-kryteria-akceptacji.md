# Kryteria akceptacji (sekcja 19 specyfikacji)

Stan na 26 października 2026 r., po M8 (Push to Marinara na lokalnej instancji). Sprawdzone na neutralnej przygodzie testowej („Probe Harbor” i „Probe Case”). Obie mają same znaczniki zamiast fabuły.

Uzupełnieniem są dwa prawdziwe przebiegi przygody „Woman in Red” przez ChatGPT/Codex. Z nich podaję tylko liczby.

Legenda:
- **✅ test automatyczny**: działa przy każdym `pnpm test`;
- **🧪 próba ręczna lub na prawdziwym modelu**: wykonana raz, opisana niżej;
- **⏳ zależy od M8**: wymaga Push to Marinara.

| # | Kryterium | Stan | Dowód |
|---|---|---|---|
| 1 | Przygodę noir da się przygotować bez ręcznego wymyślania sekretów | ✅ 🧪 | `pipeline.test.ts` „runs every stage, assembles a valid package and exports it”. Prawdziwy przebieg „Woman in Red”: z samej zajawki i krótkiego wywiadu powstało 90 faktów, 3 karty, persona, 3 lorebooki (41 wpisów) i scena otwierająca. Sekretów nie wpisywałeś. |
| 2 | Liczba kart respektuje limit; dodatkowi NPC mogą być w lorebookach | ✅ | `marinara.test.ts`: walidator blokuje eksport przy przekroczeniu `maxNpcCards`. `stage-checks.test.ts` „ask for more entities, places and minor characters”: pomniejsze postacie dostają wpisy, nie karty. |
| 3 | Karty używają właściwych pól; materiały przechodzą walidację importu | ✅ 🧪 | `marinara.test.ts` (mapowanie pól V2 plus `extensions.backstory` i `appearance`, walidacja). Test różnicowy `integration/marinara-import.test.ts` importuje paczkę do lokalnej Marinary 2.5.1 i porównuje zapisane pola. 16/16 zgodnych po M7. |
| 4 | Brak wykrytych nierozwiązanych sprzeczności; raport określa granice kontroli | ✅ 🧪 | `audit.test.ts` „reports a clean package with its scope and limits”. Raport ma sekcje „Checked” i „Not checked”, a kontrole modelowe są opisane jako heurystyka. „Woman in Red” po dwóch rundach poprawek: 4 otwarte uwagi (1 major, na poziomie planu, zostawiona świadomie). |
| 5 | Audyt obejmuje powtórzenia znaczeniowe, nie tylko identyczny tekst | ✅ | `audit.test.ts` „uses embeddings for duplicate candidates…”: parafrazy przez embeddingi, gdy model embeddingów jest przypisany. Bez niego szuka ich przegląd modelowy, a raport mówi to wprost. |
| 6 | Lorebooki mają uzasadnione ustawienia aktywacji i przechodzą próby trafnych i nietrafnych wyzwoleń | ✅ 🧪 | Nowe w M7: `acceptance.test.ts`. Przy każdym raporcie w symulatorze aktywacji działają trzy próby: (1) każdy wpis odpala na własny klucz; (2) zwykła rozmowa nie odpala żadnego wpisu słownego; (3) prywatna wiedza nie trafia do innych postaci. Do tego test wskazówek z M5 i 14 scenariuszy różnicowych z prawdziwą Marinarą. „Woman in Red”: 39 trafień, 12 prób nietrafnych i 8 prób izolacji, wszystkie zaliczone. |
| 7 | Status embeddingów odróżnia konfigurację, wykonanie i weryfikację w grze | ✅ | `manifest.json` → `vectors[]`: `configured`, `built: false`, `verifiedInGame: false`. START-HERE i podgląd eksportu mówią, że wektory buduje się w Marinarze po imporcie. |
| 8 | API i ChatGPT/Codex konfiguruje się niezależnie; osobne listy i wybór modeli tekstowych i graficznych | ✅ 🧪 | `connections.test.ts` (osobny fetch tekstu i obrazów, NanoGPT, Codex, przypisania zadań). Prawdziwe próby: lista modeli Codex, test tekstu, obraz `gpt-image-2`. |
| 9 | Ponowienie awatara lub etapu nie resetuje przygody | ✅ 🧪 | `pipeline.test.ts` „regenerates one card and only what depends on it”, „resumes after a failure…”. `portraits.test.ts` „re-renders only the portraits…”. Portrety „Woman in Red” powstały bez ponawiania innych etapów. |
| 10 | Można wyeksportować i zacząć grę bez czytania zaplecza fabuły | ✅ 🧪 | `acceptance.test.ts`: START-HERE zawiera tylko tytuł, zajawkę i nazwy, a powitanie ma tylko karta otwierająca. Ścieżki w interfejsie sprawdziłem na lokalnej Marinarze 2.5.1 (szczegóły niżej). `requirements.md` i `qa-report.md` są bezpieczne do czytania. |
| 11 | Testy zużywające limity są jawne; brak cichego płatnego fallbacku | ✅ | Każde zapytanie do modelu wymaga `confirmUsage: true`, sprawdzają to `connections.test.ts`, `pipeline.test.ts` i `acceptance.test.ts`. Tekst i obrazy idą tylko przez przypisane połączenie, bez fallbacku (`generation/text.ts`, `generation/images.ts`). |
| 12 | Eksport nie zawiera kluczy ani tokenów; integracja nie uszkadza danych Marinary | ✅ | Nowe w M7: przed każdym eksportem pliki są skanowane pod kątem zapisanych kluczy i tokenów (`sk-…`, JWT, `Bearer …`). Trafienie blokuje eksport i nie ujawnia, co znaleziono (`acceptance.test.ts`). Klucze nie trafiają do przeglądarki ani logów (`connections.test.ts`). Część o danych Marinary: eksport plikowy niczego w Marinarze nie zmienia. Push to Marinara tylko tworzy nowe zasoby, a przy błędzie usuwa wyłącznie to, co sam utworzył (`push.test.ts`, test integracyjny `marinara-push.test.ts`). Hasło Marinary nie trafia do komunikatów błędów. |

## Próba instrukcji START-HERE na lokalnej Marinarze

Paczka „Probe Harbor”, Marinara 2.5.1 (staging), katalog `vendor/marinara-test-data`.

- **Import:** natywny import przyjął wszystkie pliki: 2 karty, personę i 2 lorebooki. Okno **Characters → Import** ma opcję **Imported card tags → All tags**. Panele Personas i Lorebooks mają przycisk **Import**.
- **Kreator czatu:** **Home → Roleplay** ma kroki dla postaci, persony, lorebooków i agentów. Z kodu kreatora (`ChatSetupWizard.tsx`) wynika, że wkleja on `first_mes` każdej dodanej karty.
  - Dlatego eksport zostawia powitanie tylko karcie otwierającej. Wejścia pozostałych postaci trafiają do `alternate_greetings`.
  - Po imporcie sprawdziłem przez API, że karta pomocnicza ma pusty `first_mes`.
- **Lorebooki i wektory:** w ustawieniach czatu jest **Lorebooks → Add Lorebook**. W edytorze lorebooka jest **Overview → Semantic Search (Embeddings)**.
- **Director:** **Chat Settings → Agents → Enable Agents → Add Agent**. Jeśli brak pakietu, pobiera się go w panelu **Agents** („Download Agents”).
- **Czego nie przeszedłem w interfejsie:** samego kliknięcia przez kreator do końca. Okno podglądu w aplikacji było za wąskie i kreator się zamykał. Zachowanie powitań sprawdziłem w kodzie kreatora i przez API.

## Push to Marinara (M8)

- **Test integracyjny** `test/integration/marinara-push.test.ts` (lokalna Marinara 2.5.1 z Directorem): neutralna przygoda przechodzi przez trasę aplikacji. Potem odczytuję prosto z Marinary:
  - czat roleplay ma przypięte wszystkie lorebooki, włączonego Directora i Secret Plot;
  - w czacie jest dokładnie jedna wiadomość: scena otwierająca;
  - pamięć Directora zawiera zasiany łuk i znacznik `secretPlotLastAssistantMessageId` wskazujący tę wiadomość;
  - historia pushy w aplikacji nie zawiera tekstu fabuły.

  Po teście wszystko jest usuwane.
- **Testy jednostkowe** `test/push.test.ts`:
  - odmowa bez Directora albo push bez Secret Plot na wyraźne życzenie;
  - wycofanie zmian w odwrotnej kolejności po błędzie;
  - wektoryzacja: błąd nie usuwa czatu;
  - nagłówek Basic Auth, hasło nieobecne w błędach.
- **Prawdziwa przygoda:** „Woman in Red” wysłana z interfejsu na lokalną Marinarę testową:
  - wszystkie 8 kroków zaliczone (3 karty, persona, 3 lorebooki z 41 wpisami, czat, scena otwierająca, Secret Plot z 6 wskazówkami scen, odczyt kontrolny);
  - 4 portrety zapisane jako WebP;
  - przygoda została w lokalnej instancji (`vendor/marinara-test-data`).
- **Zachowanie Directora przy pierwszej odpowiedzi:** że ze znacznikiem nie przepisuje planu, potwierdziła weryfikacja techniczna (docs/01, sekcja 3). W M8 nie generowałem odpowiedzi w Marinarze.

## Push na VPS (26 października 2026 r., za zgodą użytkownika)

- **Adres:** Marinara staging jest pod `https://vps-ce03a41d.tail860c71.ts.net:9443`. Według `tailscale serve status` ten port prowadzi do `127.0.0.1:7861`, kontenera `marinara-staging`.
  - Główny adres hosta prowadzi do innej aplikacji („Hermes Agent”). To jej API zwracało wcześniej 401.
  - Dostęp przez Tailscale jest zaufany, więc login nie był potrzebny.
- **Wynik:** wersja 2.5.1, Director zainstalowany. Push „Woman in Red”: wszystkie 8 kroków zaliczone, odczyt kontrolny zgodny, 3 portrety kart jako WebP.
- **Zostaje do zrobienia ręcznie:** czat nie ma przypisanego połączenia z modelem ani presetu, bo na VPS nie ma połączenia domyślnego. Wybiera się je w ustawieniach czatu przed pierwszą wiadomością.

## Co zostaje

- **Wektory na prawdziwym modelu embeddingów:** ścieżka jest przetestowana na atrapie, a „Woman in Red” nie ma lorebooków z wyszukiwaniem semantycznym.
