HomeFlux
Zie waar je energie naartoe gaat.

HomeFlux geeft je in Homey een visueel en live overzicht van de energiestromen in en rond je woning. Zonnepanelen, thuisbatterij, elektriciteitsnet, laadpaal en huisverbruik worden samengebracht in één duidelijke widget.

BELANGRIJKSTE FUNCTIES

- Live energie-overzicht voor zonnepanelen, batterij, net, laadpaal en huisverbruik.
- Automatische berekening van het huisverbruik wanneer er geen aparte verbruiksmeter beschikbaar is.
- Batterijstatus met laden, ontladen of stand-by.
- Vergelijking van de huidige batterij-SOC met de waarde van ongeveer 24 uur geleden.
- Automatische dag-/nachtweergave.
- Dynamische achtergrond op basis van een gekoppelde Homey-weerbron.
- Ondersteuning voor helder, bewolkt en regenachtig weer, zowel overdag als 's nachts.
- Vrij instelbare extra dashboarditems uit Homey-devices en Logic-variabelen.
- Instelbare vernieuwingsfrequentie van 1 seconde tot 5 minuten.
- Realtime updates via Homey-events, met periodieke synchronisatie als fallback.
- Responsieve widget die zich aanpast aan de beschikbare ruimte en inhoud.

ENERGIEBALANS

Wanneer geen directe waarde voor huisverbruik is gekoppeld, kan HomeFlux deze automatisch afleiden uit de beschikbare energiestromen.

Voorbeeld:
Zonnepanelen: 5 kW
Batterij laden: 4 kW
Net: 0 kW
Huisverbruik: 1 kW

HomeFlux houdt hierbij rekening met de ingestelde polariteit van het batterijvermogen.

CONFIGURATIE

Na installatie open je de instellingen van HomeFlux in de Homey-app. Daar kun je:

- de zonnepanelen koppelen;
- batterij-SOC, batterijvermogen en optioneel batterijstatus koppelen;
- laadpaalvermogen en optioneel laadstatus koppelen;
- netvermogen koppelen;
- optioneel een directe waarde voor huisverbruik koppelen;
- een Homey-weerbron selecteren voor automatische achtergronden;
- extra sensoren, apparaten en Logic-variabelen toevoegen;
- de vernieuwingsfrequentie instellen.

PRIVACY EN NETWERK

HomeFlux werkt lokaal op je Homey. Er is geen externe HomeFlux-cloud, geen aparte accountregistratie en geen publieke webinterface nodig voor de widget. De app gebruikt Homey's API om de door jou geselecteerde apparaten, capabilities en Logic-variabelen te lezen.

COMPATIBILITEIT

HomeFlux is ontworpen voor Homey Pro met ondersteuning voor Homey Dashboard Widgets.

HomeFlux - Zie waar je energie naartoe gaat.


## v0.6.20
- Unieke weerachtergronden toegevoegd voor mist, sneeuw en onweer.
- Zowel dag- als avondschemering/nachtvarianten geïntegreerd.
- Automatische weermapping uitgebreid: mist, sneeuw en onweer worden nu als aparte scene getoond.


## v0.6.21
- CPU optimization: runtime only refreshes configured devices/capabilities.
- Realtime device events now refresh only the affected configured device instead of all configured sources.
- The 1-300 second widget refresh interval now only controls UI cache reads; backend fallback polling is limited to once per minute.
- Full device/Logic scans remain limited to configuration/source selection.


v0.6.22 diagnostics: adds low-overhead aggregated runtime logging every 60 seconds for CPU, memory, widget API calls, Homey API calls, realtime events, refresh/debounce activity, subscriptions and battery-history writes.

v0.6.23
- Fixed diagnostics API registration so the diagnostics build starts correctly on Homey.

## v0.6.24 diagnostics
- Runtime source cache is now limited to configured HomeFlux sources only.
- Opening/scanning the settings page no longer fills the runtime cache with every Homey capability.
- Stale cache entries are pruned after configuration changes and before fallback refreshes.
- Diagnostics now report configuredCacheKeys and unexpectedCacheEntries.

## v0.6.25
- Production build without diagnostics logging or diagnostics API.
- Keeps the v0.6.24 cache optimization: only configured HomeFlux sources are retained in the runtime cache.
- Realtime events remain the primary update path, with a 60-second selected-source fallback refresh.
