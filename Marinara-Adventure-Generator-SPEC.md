# Generator przygód do Marinara Engine

Dokument startowy projektu — 25 października 2026 r.

Status: specyfikacja koncepcyjna oparta na ustaleniach z użytkownikiem. Aplikacja nie została jeszcze zbudowana. Rozwiązania oznaczone jako propozycje wymagają dopracowania podczas projektowania. Możliwości integracji należy potwierdzić na aktualnej wersji Marinary i wybranych połączeniach.

## 1. Cel i problem

Lokalna aplikacja webowa ma tworzyć kompletne, spójne przygody do Marinara Engine na podstawie krótkiego pomysłu i rozmowy o preferencjach użytkownika.

Użytkownik chce odkrywać historię podczas gry. Nie chce sam wymyślać sprawy, sekretów, motywacji NPC ani rozwiązania, ponieważ znajomość tych informacji odbiera mu przyjemność z rozgrywki.

Aplikacja ma przejąć tworzenie materiałów, ich konfigurację, kontrolę jakości i przygotowanie do importu. Nie wystarczy generator długiego tekstu lub pojedynczego JSON-a.

Docelowe doświadczenie:

**Pomysł → krótka rozmowa → zatwierdzenie wymagań → przygotowanie przygody poza widokiem gracza → kontrola i poprawki → awatary → eksport → gra w Marinarze.**

## 2. Forma rozwiązania

Uzgodniona forma: osobna lokalna aplikacja webowa z własnym backendem, uruchamiana na komputerze użytkownika i obsługiwana w przeglądarce.

Aplikacja ma własne połączenia z modelami. Marinara pozostaje miejscem rozgrywki. Pierwsza wersja powinna dostarczać materiały do ręcznego importu; bezpośrednia integracja z Marinarą jest oddzielnym etapem.

Reguły przypominające skill mogą stanowić wewnętrzne instrukcje generatora. Sam skill nie jest docelowym interfejsem produktu.

Lokalne działanie oznacza lokalne przechowywanie projektów i obsługę procesu. Treści wysyłane do zdalnych modeli nadal trafiają do wybranych dostawców.

## 3. Informacje od użytkownika

Użytkownik może rozpocząć od swobodnego opisu, na przykład:

> Detective mystery in noir genre placed in alternate reality 1940 New York where fantasy races and magic exist as normal parts of life. Max 4 characters. I am a small private investigator when suddenly a woman in red comes to me.

Aplikacja wyodrębnia wymagania i prowadzi krótką rozmowę o istotnych brakach. Nie zadaje długiego formularza pytań naraz i nie wymaga rozstrzygania fabuły.

Zakres wymagań obejmuje:

- Gatunek i ewentualne połączenie gatunków.
- Klimat, ton, stylistykę i sposób narracji.
- Setting: czas, miejsce, realia, poziom technologii i fantastyki.
- Sytuację początkową.
- Limit pełnych kart NPC.
- Personę protagonisty: istniejącą albo nową, przygotowaną według wymagań użytkownika.
- Oczekiwaną skalę i orientacyjną długość przygody.
- Preferencje oraz granice dotyczące treści, relacji, przemocy i innych istotnych tematów.
- ~~Język materiałów i gry.~~ Nieaktualne: język jest stały, angielski (patrz sekcja 22).
- Preferencje wizualne dla awatarów.

Powyższe dane nie muszą być obowiązkowymi pytaniami. Należy wykorzystać informacje już podane i stosować rozsądne, widoczne ustawienia domyślne.

Użytkownik zatwierdza bezspoilerowe podsumowanie wymagań. Pytania typu „co naprawdę ukrywa kobieta?”, „kto jest winny?” lub „jaki ma być finał?” są sprzeczne z celem aplikacji, chyba że użytkownik sam chce narzucić taki szczegół.

## 4. Obsada i persona

Limit postaci oznacza limit **pełnych kart NPC**. Przykładowe „maksymalnie 4 postacie” oznacza do czterech kart, a nie obowiązek utworzenia dokładnie czterech.

Persona użytkownika jest osobna i nie zużywa limitu kart NPC.

Dowolna liczba dodatkowych NPC może być opisana w lorebookach. Brak sztywnego limitu nie uzasadnia sztucznego rozbudowywania obsady: postacie powinny mieć funkcję w świecie lub przygodzie.

Imiona i awatary kart mogą być widoczne przy imporcie. Użytkownik akceptuje znajomość tych informacji. Nie wymagamy ukrywania całej listy kart ani stopniowego ujawniania ich tożsamości.

Chroniona ma być zawartość kart i lorebooków, motywy, sekrety oraz rozwiązania fabularne. Nazwy, tagi, zajawki i obrazy nie powinny przypadkowo ujawniać tych informacji.

## 5. Materiały wynikowe

Jedna przygoda powinna zawierać:

1. Zatwierdzone wymagania i bezspoilerową zajawkę.
2. Karty głównych NPC z awatarami, jeśli generowanie obrazów jest włączone.
3. Personę, jeżeli użytkownik zamówił nową.
4. Spójny zestaw lorebooków z ustawieniami aktywacji.
5. Ukrytą dokumentację przygody, stanowiącą źródło faktów i sekretów.
6. Początkowy plan do Secret Plot, zgodny z przygotowaną przygodą.
7. Scenę otwierającą i instrukcję rozpoczęcia gry bez spoilerów.
8. Raport kontroli jakości, manifest paczki i pliki do importu.

Dokumentacja wewnętrzna nie musi być osobnym plikiem do ręcznego importowania. Ważne, aby informacje potrzebne narratorowi miały właściwe reprezentacje w materiałach używanych podczas gry.

## 6. Karty postaci — zasady podziału pól

| Pole | Przeznaczenie |
|---|---|
| Description | Tożsamość, rola i najważniejsze cechy definiujące postać. Bez pełnej biografii. |
| Personality | Motywacje, wartości, sprzeczności, temperament, reakcje pod presją i wzorce zachowania. |
| Backstory | Przeszłość, pochodzenie, ważne relacje i przyczyny obecnej sytuacji. Rozróżnienie faktów od przekonań i wersji wydarzeń. |
| Appearance | Wygląd, ubiór i cechy wizualne. Podstawa spójnego awatara. |
| Scenario | Krótki kontekst początkowy i miejsce postaci w przygodzie. Bez streszczenia całej fabuły. |
| First Message | Grywalne wejście pokazujące głos postaci. Bez narzucania działań, wypowiedzi i decyzji protagonisty. |
| Example Dialogue | Próbki charakterystycznego sposobu mówienia i reagowania. Nie stanowią wydarzeń, które już zaszły w grze. |

Nie należy kopiować tej samej biografii między polami. Dialog może ilustrować osobowość, a otwarcie rozgrywać sytuację ze Scenario — to celowe użycie faktów, a nie automatycznie błąd.

Wspólne rozpoczęcie przygody musi być skoordynowane z First Message poszczególnych kart. Nie należy uruchamiać kilku sprzecznych lub powtarzających się otwarć. Dokładne zachowanie trzeba zweryfikować dla używanego sposobu rozpoczynania czatu w Marinarze.

Eksporter ma mapować te pola na aktualny natywny format Marinary. Poprawnie wyglądający JSON nie jest wystarczającą walidacją.

## 7. Lorebooki

Domyślny podział organizacyjny:

| Lorebook | Zawartość |
|---|---|
| World | Realia, miejsca, organizacje, historia, magia, zwyczaje i zasady świata. |
| Characters | NPC bez pełnych kart, ich cele, relacje, wiedza i kontekst. Dodatkowe wpisy dotyczące postaci z kart tylko wtedy, gdy mają osobną funkcję. |
| Plot | Prawda o sprawie, chronologia, wskazówki, tajemnice, zależności i warunki odkrywania informacji. |

To ustawienie domyślne, a nie wymóg tworzenia dokładnie trzech lorebooków dla każdej historii. Możliwe są inne podziały, gdy poprawiają organizację i aktywację.

Zasady konfiguracji:

- Constant: zwięzły fundament niezbędny w każdej scenie. Niewielka liczba wpisów.
- Normal: wiedza przywoływana przy konkretnych osobach, miejscach, przedmiotach i zagadnieniach.
- Selective i inne warunki: dodatkowe ograniczenie sytuacji, w której informacja ma być dostępna.
- Klucze: nazwy, aliasy i naturalne określenia występujące w grze; unikanie nadmiernie szerokich słów.
- Tagi: spójna organizacja i filtrowanie. Nie należy utożsamiać ich ze słowami kluczowymi aktywacji.
- Kolejność, pozycja, budżety i limity wpisów: dobierane do ważności treści oraz łącznego obciążenia kontekstu.
- Sticky, cooldown, rekurencja i pozostałe ustawienia: używane celowo, jeśli wspiera je docelowa wersja Marinary.
- Każdy istotny wpis ma mieć sprawdzony sposób aktywacji.
- Lorebooki mają być prawidłowo przypisane do docelowej przygody, czatu lub postaci, bez przypadkowego wpływania na inne gry.

Constant nie powinno być traktowane jako bezwarunkowa gwarancja obecności: inne ustawienia i ograniczenia kontekstu również wymagają sprawdzenia.

## 8. Wektory i embeddingi

Wyszukiwanie semantyczne ma być częścią świadomej konfiguracji, a nie przełącznikiem włączanym bez kontroli.

Wymagania:

- Osobne połączenie i wybór modelu embeddingowego.
- Ustawienia wektorów na poziomie lorebooka oraz wyłączenia poszczególnych wpisów.
- Zachowanie sensownych kluczy jako dodatkowej drogi aktywacji.
- Dobór zakresu zapytania, progu podobieństwa i limitu wyników.
- Faktyczne wykonanie wektoryzacji i potwierdzenie jej wyniku.
- Zgodność źródła embeddingów użytego do indeksowania i zapytań podczas gry.
- Ponowna wektoryzacja po zmianie treści lub modelu, w odpowiednim zakresie.

Wektory nie rozpoznają automatycznie, czy gracz powinien już znać sekret. Wyłączenie wektorów także nie zabezpiecza przed ujawnieniem przez inne ścieżki.

Wersja oparta na eksporcie musi jasno odróżniać „przygotowane ustawienia wektorów” od „wektoryzacja wykonana i sprawdzona w docelowej Marinarze”. Nie należy zakładać przenośności zapisanych embeddingów bez sprawdzenia formatu importu.

## 9. Sekrety, prawda i swoboda gry

Generator ma przygotować sytuację z motywacjami i konfliktami, która reaguje na decyzje gracza. Nie powinien wymuszać z góry ustalonej sekwencji scen.

Dla kryminału i podobnych zagadek:

- Prawda zostaje ustalona przed rozpoczęciem gry.
- Sprawca, motywy, chronologia i mechanizm zdarzenia nie zmieniają się tylko dlatego, że gracz zbliżył się do rozwiązania.
- Wskazówki muszą wspierać rozwiązanie, a fałszywe tropy mieć uzasadnienie.
- Istotne zasady magii nie mogą być dopisywane dopiero w finale, aby uzasadnić rozwiązanie.
- Dochodzenie może przebiegać różnymi drogami, a NPC mogą reagować na działania gracza.
- Warto unikać sytuacji, w której pominięcie jednej wskazówki trwale uniemożliwia postęp.

Należy oddzielać:

1. Obiektywną prawdę świata.
2. Wiedzę i przekonania poszczególnych NPC.
3. To, co NPC deklarują, w tym kłamstwa.
4. Wiedzę odkrytą przez protagonistę.
5. Bieżące wskazówki dotyczące prowadzenia narracji.

W innych gatunkach należy zachować spójność faktów, bez narzucania każdej przygodzie konstrukcji kryminalnej.

## 10. Narrative Director i Secret Plot

Wykorzystujemy istniejącą funkcję Marinary jako element prowadzenia przygody.

Generator przygotowuje początkowy plan zgodny z kartami, lorebookami i dokumentacją fabuły. Director może dostosowywać prowadzenie wątków do gry, zachowując ustalone fakty.

Secret Plot nie zastępuje kompletnej dokumentacji przygody. Ukryty panel nie stanowi również technicznej gwarancji, że model nigdy nie zdradzi informacji w narracji.

Do weryfikacji przed implementacją integracji:

- Format i sposób inicjalizacji pamięci Secret Plot.
- Przekazywanie planu do modelu prowadzącego grę.
- Współpraca z kartami, lorebookami i wybranym presetem.
- Możliwość przeniesienia początkowego stanu przez eksport lub API.

Nie należy obiecywać, że zwykły import kart i lorebooków sam skonfiguruje pamięć agenta.

## 11. Kontrola duplikatów i jedno źródło faktu

Audyt musi obejmować cały pakiet: pola kart, lorebooki, personę, plan i otwarcie.

Wykrywamy:

- Kopie dosłowne i niemal dosłowne.
- Ten sam fakt zapisany innymi słowami.
- Rozbieżne wersje tej samej informacji.
- Niepotrzebne streszczenia biografii lub zasad świata w wielu miejscach.

Zasada: **każdy fakt ma jedno główne miejsce przechowywania**. Karta i lorebook nie powinny zawierać kilku pełnych wersji tej samej biografii.

Kontrolowane, krótkie powtórzenie jest dopuszczalne, jeśli jest potrzebne dla dostępności kontekstu albo ilustruje zachowanie. Audyt musi odróżniać fakt, kłamstwo, przekonanie, cytat i przykład dialogu.

Przed usunięciem duplikatu należy sprawdzić, czy główne źródło informacji będzie dostępne wtedy, kiedy narrator go potrzebuje. Oszczędność tokenów nie może tworzyć luk w kontekście.

Propozycja implementacyjna: wewnętrzny rejestr faktów z identyfikatorami, podmiotem, statusem wiedzy i docelowym miejscem zapisu. Materiały wynikowe powstają z tego rejestru i wspólnego planu zamiast z niezależnych, niepowiązanych generacji.

## 12. Kontrola jakości całej przygody

Obowiązkowe obszary kontroli:

1. Zgodność z zatwierdzonymi wymaganiami i limitem kart.
2. Poprawność formatów, pól, identyfikatorów, plików i odwołań.
3. Spójność świata, postaci, chronologii, relacji i sekretów.
4. Rozróżnialność głosów, celów i zachowań głównych NPC.
5. Duplikaty i konflikty informacji w całym pakiecie.
6. Logika zagadki i możliwość odkrycia rozwiązania, jeśli gatunek tego wymaga.
7. Aktywacja lorebooków, dostępność kluczowych faktów i budżety.
8. Zgodność awatarów z Appearance i wspólnym stylem.
9. Brak przypadkowych spoilerów w interfejsie i materiałach przeznaczonych dla gracza.
10. Faktyczna poprawność importu i końcowego kontekstu w Marinarze, w zakresie objętym testami integracji.

Kontrole strukturalne wykonuje kod. Kontrole znaczenia i jakości wspiera LLM. Ocena modelu jest heurystyczna i nie stanowi dowodu braku wszystkich sprzeczności lub spoilerów.

Użytkownik otrzymuje bezspoilerowy raport: status, zakres kontroli, wykryte problemy, poprawki i elementy nieweryfikowane. Nie pokazujemy sekretów jako przykładów błędów w domyślnym widoku.

## 13. Połączenia z modelami

Aplikacja ma obsługiwać oba sposoby połączenia:

- API dostawcy z kluczem i adresem API.
- Logowanie ChatGPT/Codex.

Można zapisać wiele połączeń i przypisywać je do zadań. Tekst, obrazy i embeddingi nie muszą korzystać z tego samego dostawcy.

Przykładowe konfiguracje: tekst i obrazy przez ChatGPT/Codex; tekst przez OpenRouter i obrazy przez ChatGPT/Codex; połączenia API do wszystkich zadań.

Połączenie API powinno obejmować nazwę, typ dostawcy, bazowy URL, klucz, wybrane modele i obsługiwane parametry. Zgodność z API należy określać na poziomie adaptera — samo podobieństwo endpointów nie gwarantuje wszystkich funkcji.

### Osobny fetch modeli

Wymagane są niezależne akcje i selektory:

- **Pobierz modele tekstowe.**
- **Pobierz modele graficzne.**
- Osobny wybór modelu embeddingowego; pobieranie listy tam, gdzie dostawca je umożliwia.

Gdy dostawca ma wspólny katalog, adapter klasyfikuje modele według możliwości. Gdy katalog jest niepełny lub niedostępny, należy umożliwić ręczne wpisanie identyfikatora i jasno oznaczyć brak potwierdzenia.

Samo pobranie listy nie uruchamia generowania i nie jest dowodem dostępu do modelu. Test tekstu oraz test obrazu są osobnymi akcjami. Akcje wywołujące generowanie lub zużycie limitów muszą być czytelnie opisane.

Nie należy po cichu zmieniać dostawcy, modelu ani przechodzić z subskrypcji na płatne API.

### ChatGPT/Codex

Użytkownik potwierdził działające generowanie GPT Image 2.5 Sunburst przez połączenie ChatGPT (Codex login) w Marinarze. To dowód wykonalności tego konkretnego mechanizmu, a nie dowód działania dowolnej integracji OAuth.

Wymaganie produktu: obsługa tekstu i obrazów przez logowanie ChatGPT/Codex. Dokładna realizacja wymaga sprawdzenia aktualnego mechanizmu Marinary/Codex, dostępnych modeli, odświeżania sesji i ograniczeń danej ścieżki.

Nie należy utożsamiać mechanizmu Marinary z każdym oficjalnym wariantem Sign in with ChatGPT. Podczas wcześniejszej analizy oficjalna ścieżka współdzielenia planu miała inne ograniczenia, w tym dotyczące narzędzia obrazowego.

Interfejs powinien pokazywać stan logowania, umożliwiać ponowne logowanie i wylogowanie oraz zachowywać postęp pracy po wyczerpaniu limitów. Nie zakładamy nieograniczonego użycia ani tego, że katalog modeli potwierdza uprawnienia.

Plan awaryjny: jeśli weryfikacja wykaże, że logowanie ChatGPT/Codex nie da się sensownie użyć w nowej aplikacji, rezygnujemy z niego. Tekst i obrazy idą wtedy przez API Nano-GPT. Adapter Nano-GPT jest więc priorytetowym połączeniem API.

## 14. Narzędzia i sterowanie procesem

Backend aplikacji udostępnia modelowi kontrolowane narzędzia. Model zgłasza wywołanie; aplikacja sprawdza argumenty, wykonuje operację i zwraca wynik.

Proponowane funkcje:

| Funkcja | Cel |
|---|---|
| get_requirements | Odczyt zatwierdzonych wymagań. |
| read_entity / save_entity | Praca z postaciami, miejscami i innymi elementami przygody. |
| search_facts | Odszukiwanie istniejących faktów i ich źródeł. |
| validate_package | Walidacja strukturalna i kontrola odwołań. |
| audit_duplicates | Kontrola powtórzeń i konfliktów. |
| generate_avatar | Generowanie obrazu przez wybrane połączenie. |
| export_package | Budowa paczki zgodnej z docelowym formatem. |

Nazwy są propozycją, nie zamrożonym kontraktem API.

To aplikacja wymusza obowiązkowe kontrole przed eksportem. Model nie może ich ominąć deklaracją „gotowe”. Nie należy zakładać natywnej obsługi narzędzi przez każdy model; możliwości połączenia trzeba wykrywać i walidować.

## 15. Generowanie etapami i trwałość pracy

Proponowany przebieg wewnętrzny:

1. Wywiad i zatwierdzenie wymagań.
2. Wspólny plan świata, obsady i fabuły.
3. Ustalenie faktów, sekretów i zakresów wiedzy.
4. Utworzenie kart i wpisów lorebooków.
5. Kontrola i korekty treści oraz duplikatów.
6. Konfiguracja aktywacji i kontrola budżetów.
7. Awatary na podstawie zatwierdzonych wewnętrznie opisów wyglądu.
8. Walidacja, eksport i raport.
9. Integracja, wektoryzacja i sprawdzenie po stronie Marinary — jeśli obejmuje je dana wersja produktu.

Stan projektu zapisuje się po etapach. Błąd, restart lub wyczerpanie limitu nie może wymuszać rozpoczynania całej przygody od nowa.

Ponowienie pojedynczego etapu powinno zachować resztę projektu. Jeśli zmiana wpływa na inne elementy, aplikacja oznacza je do aktualizacji i ponownego audytu. Zmiana faktów może unieważniać karty, lorebooki, obrazy lub embeddingi.

Należy kontrolować liczbę automatycznych poprawek, aby nie tworzyć niekończącej się pętli zapytań. Po nieudanej naprawie użytkownik dostaje czytelny, bezspoilerowy status problemu.

## 16. Interfejs

Proponowane główne widoki:

| Widok | Funkcje |
|---|---|
| Nowa przygoda | Krótka rozmowa, ustawienia i zatwierdzenie wymagań. |
| Przygotowanie | Etapy, postęp, problemy, ponowienia, zużycie i stan kontroli. |
| Biblioteka przygód | Zapisane projekty, eksporty, wersje i ponowne generowanie wybranych elementów. |
| Połączenia | API, ChatGPT/Codex, osobny fetch i wybór modeli tekstowych, obrazowych oraz embeddingów. |

Domyślnie interfejs nie pokazuje treści sekretów. Opcjonalne „Pokaż spoilery” umożliwia świadomy podgląd. Logi techniczne oraz komunikaty błędów również wymagają oddzielenia od widoku gracza.

## 17. Dane i bezpieczeństwo konfiguracji

- Projekty, postęp i eksporty przechowywane lokalnie.
- Klucze i tokeny przechowywane po stronie lokalnego backendu, z ochroną odpowiednią dla systemu operacyjnego.
- Brak sekretów autoryzacji w eksportach, logach i treści promptów.
- Poświadczenia nie są domyślnie udostępniane innym aplikacjom ani przeglądarkowemu frontendowi.
- Model nie ma dowolnego dostępu do plików komputera; pracuje przez kontrolowane funkcje projektu.
- Materiały fabularne są ukrywane dla komfortu gracza. Nie należy obiecywać, że właściciel komputera nie może ich odczytać.
- Bezpośrednia integracja z Marinarą ma tworzyć nowe zasoby i zachowywać istniejące przygody, czaty oraz konfiguracje. Nadpisywanie wymaga osobnej, wyraźnej akcji.

## 18. Zakres pierwszej wersji

Pierwsza wersja ma realizować kompletny przepływ tworzenia przygody:

- Rozmowa i wymagania.
- Zapisane połączenia API oraz ChatGPT/Codex.
- Oddzielny fetch i wybór modeli tekstowych oraz obrazowych.
- Wybór embeddingów i przygotowanie właściwej konfiguracji lorebooków.
- Generowanie kart, lorebooków, planu Secret Plot i otwarcia.
- Awatary, z możliwością pominięcia lub ponowienia.
- Audyt struktury, spójności, duplikatów i spoilerów.
- Trwały zapis, wznowienie i poprawianie etapów.
- Eksport oraz bezspoilerowy raport i instrukcja importu.

Bezpośredni import do Marinary, automatyczne założenie czatu, zapis pamięci Directora i zdalna wektoryzacja są następnym etapem, zależnym od weryfikacji API. Ograniczenia eksportu należy pokazać otwarcie, bez oznaczania niewykonanych czynności jako ukończonych.

Poza początkowym zakresem: własny silnik rozgrywki, zastępowanie Marinary, hosting wieloużytkownikowy, publiczny katalog przygód oraz zaawansowane multimedia inne niż awatary.

## 19. Kryteria akceptacji

1. Z przykładowego pomysłu noir można przygotować przygodę bez ręcznego wymyślania sekretów przez użytkownika.
2. Liczba kart respektuje limit, a dodatkowi NPC mogą występować w lorebookach.
3. Karty używają właściwych pól, a materiały przechodzą walidację docelowego importu.
4. Świat, postacie i fabuła nie zawierają wykrytych, nierozwiązanych sprzeczności; raport określa granice kontroli.
5. Audyt obejmuje powtórzenia znaczeniowe między kartami i lorebookami, nie tylko identyczne ciągi tekstu.
6. Lorebooki mają uzasadnione ustawienia aktywacji i przechodzą reprezentatywne próby trafnych oraz nietrafnych wyzwoleń.
7. Status embeddingów odróżnia konfigurację, wykonanie i weryfikację po stronie gry.
8. API i ChatGPT/Codex można konfigurować niezależnie; modele tekstowe i graficzne mają osobne pobieranie list oraz wybór.
9. Ponowienie awatara lub uszkodzonego etapu nie resetuje całej przygody.
10. Użytkownik może wyeksportować i rozpocząć przygodę bez czytania zaplecza fabuły.
11. Testy generujące treść i zużywające środki lub limity są jawne; brak cichego przełączania na płatny fallback.
12. Eksport nie zawiera kluczy ani tokenów, a integracja nie uszkadza istniejących danych Marinary.

## 20. Pierwsze zadanie w nowym projekcie

Przed wyborem ostatecznego stosu i budową całego interfejsu należy wykonać krótki etap weryfikacji technicznej:

1. Sprawdzić aktualne formaty importu kart, person i lorebooków oraz zachowanie ich powiązań.
2. Sprawdzić mechanizm tekstowego i graficznego połączenia ChatGPT/Codex, osobne katalogi modeli i możliwość wykorzystania go w nowej aplikacji.
3. Sprawdzić inicjalizację Secret Plot oraz granice eksportu i API Marinary.
4. Sprawdzić wektoryzację, format danych i zgodność źródła embeddingów w docelowej instalacji.
5. Zaproponować architekturę, model danych i plan realizacji pierwszej wersji na podstawie wyników.

W tym etapie nie należy generować właściwej przykładowej przygody w widocznym dla użytkownika czacie ani ujawniać potencjalnych sekretów. Testy wykorzystują neutralne dane. Nie wykonujemy generacji zużywających płatne środki lub limity bez wyraźnej zgody na taki test.

## 21. Gotowe polecenie startowe

> Przeczytaj dołączoną specyfikację generatora przygód do Marinara Engine. Jest ona punktem wyjścia projektu. Najpierw wykonaj etap weryfikacji technicznej opisany w sekcji 20, korzystając z aktualnych źródeł i dostępnego kodu. Rozróżnij potwierdzone możliwości od założeń. Następnie zaproponuj konkretną architekturę, model danych i plan implementacji kompletnej pierwszej wersji. Zachowaj wszystkie uzgodnione wymagania: tworzenie bez spoilerów, poprawny podział pól kart, wiele lorebooków, świadomą aktywację i embeddingi, globalny audyt duplikatów, API i ChatGPT/Codex oraz osobny fetch modeli tekstowych i graficznych. Nie generuj sekretów przykładowej przygody w moim widocznym czacie i nie zmieniaj działającej instalacji Marinary podczas analizy.

## 22. Doprecyzowania (25 października 2026 r.)

Ustalenia z użytkownikiem, ważniejsze od wcześniejszych zapisów, jeśli są z nimi sprzeczne:

1. **Język.** Interfejs aplikacji i wszystkie generowane treści (karty, lorebooki, persona, Secret Plot, otwarcie, raporty, prompty wewnętrzne) są po angielsku. Język nie jest pytaniem w wywiadzie. Użytkownik może opisać pomysł w dowolnym języku, ale wymagania i materiały powstają po angielsku.
2. **Marinara docelowa.** Wersja staging w Dockerze na VPS użytkownika, dostępna przez Tailscale (`ubuntu@100.106.8.61`). To działająca instalacja: tylko odczyt, bez zmian podczas analizy.
3. **Marinara testowa.** Do weryfikacji technicznej i testów używamy lokalnej kopii gałęzi staging z GitHuba, a nie instalacji na VPS.
4. **ChatGPT/Codex.** Do sprawdzenia; plan awaryjny to API Nano-GPT (sekcja 13).
5. **Stos technologiczny.** Bez preferencji użytkownika. Wybór należy do wykonawcy i ma wynikać z weryfikacji technicznej.
6. **Repozytorium.** Projekt ma trafić na GitHub użytkownika. Wymaga skonfigurowania dostępu (np. `gh auth login`) na tym komputerze.
