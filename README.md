# HomeFlux v0.6.10

- brandColor aangepast naar donkerder groen `#4F8A10` voor voldoende contrast met witte Homey-iconen.


## v0.6.11
- Widgetnaam gewijzigd van WebDash naar HomeFlux.
- App Store-/productafbeeldingen opnieuw ontworpen in een minimalistischer stijl.
- Auteurvermelding verwijderd uit de productafbeeldingen.


## v0.6.12
- Widgetvoorvertoning en widgetnaam aangepast naar HomeFlux.
- Productafbeeldingen opnieuw minimalistischer vormgegeven.
- Auteurvermelding verwijderd uit de productafbeeldingen.


## v0.6.13
- Productafbeeldingen verder vereenvoudigd in minimalistische stijl.
- Widgetnaam blijft HomeFlux, niet langer WebDash.


## v0.6.14 — final test build
- Energiebeeld gewijzigd naar 7:5 landschap en alle zes scenes fysiek in dezelfde verhouding gecropt.
- Geen uitrekking meer van de achtergrond.
- Huisverbruik wordt automatisch berekend als geen bruikbare huisverbruik-capability gekoppeld is.
- Formule: zonnepanelen + netimport/export - batterijladen (met ondersteuning voor batterij-polariteit omkeren).
- Berekende waarde wordt in de widget gemarkeerd als Berekend.


## v0.6.15
- Final test build.
- Minimalistische HomeFlux productafbeeldingen zonder voorbeelddata of auteursnaam.
- Berekend huisverbruik gebruikt expliciet: zon + net - batterij-laden. Voorbeeld: 5 kW zon, 4 kW laden, 0 kW net = 1 kW huisverbruik.


## v0.6.16
- Dashboardachtergronden vernieuwd: geen ingebakken iconen of tekst meer.
- Alleen de verbindingslijnen blijven zichtbaar in de scène.
- Alle dag/nacht/weer-afbeeldingen vervangen door schone 7:5 achtergronden.


## v0.6.17
- Widget picker previews vervangen door echte HomeFlux previews.
- Oude mock-up afbeelding verwijderd uit de widgetselectie.


## v0.6.19
- Nachtachtergronden lichter gemaakt en verschoven naar avondschemering / blue hour.
- Night clear, night cloudy en night rain vervangen door zachtere, beter leesbare scènes.


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

## v0.6.24 diagnostics
- Runtime source cache is now limited to configured HomeFlux sources only.
- Opening/scanning the settings page no longer fills the runtime cache with every Homey capability.
- Stale cache entries are pruned after configuration changes and before fallback refreshes.
- Diagnostics now report configuredCacheKeys and unexpectedCacheEntries.

## v0.6.25
- Production build without diagnostics logging or diagnostics API.
- Keeps the v0.6.24 cache optimization: only configured HomeFlux sources are retained in the runtime cache.
- Realtime events remain the primary update path, with a 60-second selected-source fallback refresh.

## v0.6.26
- Herstelt live widget-updates met selectieve polling op het ingestelde refreshinterval.
- Tijdens runtime worden uitsluitend de geconfigureerde devices/capabilities uitgelezen; er wordt geen volledige devicescan uitgevoerd.
- Realtime events blijven actief als extra snelle updatebron.

## v0.6.27
- Battery SOC from 24 hours ago now prefers Homey Insights and falls back to local samples when Insights is unavailable.
- Widget refreshes selectively refresh only configured sources on demand, with single-flight cache updates to prevent duplicate polling.
- Background fallback refresh remains low-frequency while realtime events stay enabled.

## v0.6.28
- Battery status and battery power are more prominent in the widget.
- Battery charging power is green; discharging power is blue.
- Grid import is blue; grid export is green.

## v0.6.29
- Fixed Dutch clear-sky weather mapping (including "onbewolkt" and "heldere lucht").
- Added safe handling for both WMO and OpenWeather numeric condition codes.
- Prevented OpenWeather clear code 800 from being interpreted as thunder.



## v0.6.30
- Fixed Homey weather enum mapping by using the translated displayed condition before numeric weather codes.
- Added clear-sky aliases including 'heldere hemel'.

### v0.6.31
- Avoid treating generic Homey numeric weather values as WMO codes.
- Improved translated enum value lookup for weather capabilities.
- Added change-only `[HomeFlux WEATHER]` diagnostics for unknown weather source values.


## v0.6.32
- Clarified that the automatic weather source must be a capability exposed by an installed weather device (for example KMI).
- Clarified that Homey's built-in weather condition may not appear as a selectable device capability.
- Removed temporary weather debug logging.

## v0.6.33
- Added optional second solar source; both PV powers are summed in the dashboard.
- Added optional second battery with separate SOC, power, polarity and usable capacity.
- Combined battery SOC is capacity-weighted (for example 10 kWh at 100% + 5 kWh at 0% = 66.7%).
- Combined battery power is summed after per-battery polarity correction.
- Added optional second EV charger; charger powers are summed.
- Added a dynamic battery-flow overlay: green while charging, blue while discharging and hidden while idle.
- Home-consumption fallback now uses the combined PV and battery values.



## v0.6.35
- Grid flow line rerouted to enter the house from the right with a vertical drop and 90° turn.


## v0.6.36
- Restored the configurable grid-flow threshold in Settings.


## v0.6.37
- Added per-battery power direction settings for battery flow interpretation.
- Battery flow line rerouted with clean 90° bends to avoid crossing the house image.


## v0.6.38
- Refined battery flow line to use a single 90° corner and stay above the yellow line in the scene.


## v0.6.41
- Batterijlijn iets hoger geplaatst.
- Animatierichting-instelling hersteld: de keuze wordt nu correct bewaard en doorgegeven aan de widget.


## v0.6.42
- Reversed the default battery line animation direction.
- Replaced the long “24u geleden” label with a compact ◷ 24h indicator.


## v0.6.44
- Fixed widget loading issue introduced by the dynamic EV charger card.
- EV charger card now hides safely below 50 W and reappears automatically while charging.
