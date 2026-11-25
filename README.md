# HomeFlux

HomeFlux visualizes live household energy flows on Homey.

## Key features

- Swap Solar, Grid, Battery and Charger information panels between four corners, with matching flow lines
- Choose whether the house-to-battery line ends at the illustrated battery or at the battery information panel

- Optional Homey Gallery photos per weather scene, with automatic fallback to built-in images

- Live PV, battery, grid, home-consumption and EV charging flows
- Up to 10 PV sources, 10 batteries and 10 EV chargers
- Components disappear automatically when their configured count is 0
- Animated energy lines with configurable standby lines for PV, battery and grid
- Day/night backgrounds controlled by local hours or total PV production, with a 10-minute delay before night
- Custom mapping for detected weather values, with Auto fallback
- EV flow turns green when PV exceeds home consumption
- Manual period and weather selection for testing
- Overlay colour: Automatic, Light or Dark
- Optional battery value from approximately 24 hours ago
- Configurable labels, units, transparency and refresh interval
- Extra Homey capabilities as tiles below the illustration
- Dutch and English interface

## Backgrounds

Day scenes are bright and use no house lighting. Evening scenes use an early-evening look with warm interior lights. Energy-flow lines are drawn dynamically by the widget.

## Configuration

Open HomeFlux settings: use **Input** to choose Integrated configurator or Flow cards and connect your sources. Use **Settings** for colours, values, units and labels. Use **Mapping** to choose a scene for each detected weather value; **Auto** keeps automatic mapping. Mapping changes save immediately, and removed values return as Auto when received again.

## Support HomeFlux

If HomeFlux is useful to you and you would like to support its development, you can [buy me a coffee](https://buymeacoffee.com/davybert). Donations are completely optional.

## Why `homey:manager:api` is required

HomeFlux is an Energy app that visualizes values from energy-related devices already installed in Homey, such as solar inverters, home batteries, grid meters and EV chargers. Because these sources can come from many different Homey apps and expose different capabilities, HomeFlux cannot declare one fixed set of devices in advance.

The `homey:manager:api` permission is used locally to discover available devices/capabilities and Logic variables when the user opens source selection, read the initial value of configured sources, and create realtime subscriptions for only those configured sources. During normal runtime HomeFlux keeps a compact cache updated by those realtime events. HomeFlux does not use this permission to control devices or send Homey data to an external HomeFlux service.

## What's new in v0.9.4

- Added optional Gallery photos, swappable information panels with matching flow lines, and a selectable battery line endpoint.

## What's new in v0.9.3

- Added partly cloudy backgrounds for house and garden, day and night, with Dutch and English weather mapping.

## What's new in v0.9.2

- Added widget and widgets search tags.

## What's new in v0.9.1

- Added Input, Settings and Mapping tabs with custom weather mapping. EV flow turns green when PV exceeds home consumption; PV-based night switching now waits 10 minutes.

## What's new in v0.8.62

- Added a lightweight self-recovery watchdog for stale widget realtime connections, using only the existing HomeFlux dashboard cache.
- Removed unnecessary MutationObserver-driven layout checks when EV visibility or other attributes change.
- Added a W/kW display choice for combined EV charger power.

## What's new in v0.8.6

- Updated the HomeFlux app preview artwork.
- Removed the unused legacy `energy-house.jpg` widget asset.

## What's new in v0.8.5

- Lowered the battery flow connection at the home card for clearer separation from the grid line.
- EV charger flow colour follows the battery when it is actively charging (green) or discharging (blue).
- With an idle or unconfigured battery, the EV charger flow falls back to the grid colour.
- Removed obsolete simple light/dark background assets that are no longer used.
- Removed sunrise/sunset geolocation calculations; automatic day/night can now follow configured local hours or PV production.

## What's new in v0.8.4

- HomeFlux now keeps a compact cache that is updated by realtime Homey capability events for only the configured sources.
- Widgets perform one initial cache read and then receive shared `dashboard.updated` pushes; opening extra widgets does not multiply device reads.
- Dashboard pushes are coalesced and sent no faster than the configured refresh interval, and unchanged snapshots are not retransmitted.
- Full device discovery remains limited to the settings/source-selection screen; configured device metadata is seeded once when subscriptions are created.
- Removed local battery-history sampling and persistence; the optional 24-hour comparison relies on Homey Insights only.

## What's new in v0.8.3

- Removed stale-source detection and fallback polling during normal runtime.
- The selected widget refresh interval is now the authoritative live refresh: each widget tick rereads only the configured sources.
- HomeFlux no longer depends on third-party apps emitting realtime change events for dashboard values to advance.
- App startup and dashboard configuration saves still perform an initial/full configured-source read so the cache starts with current values.

## What's new in v0.8.2

- Reduced fallback polling for unchanged sources.
- Realtime events remain the primary update path; changed sources refresh normally on the next widget request.
- The stale threshold is a fixed 1800 seconds (30 minutes), independent of the widget refresh interval.
- Sources with naturally slow reporting intervals are therefore not treated as stale after only a few widget refreshes.

## What's new in v0.8.1

- Added separate English and Dutch Homey App Store descriptions (`README.txt` and `README.nl.txt`).
- Updated the App Store day/night wording so it accurately reflects the current automatic behavior.
- This version follows v0.8.0 because v0.8.0 was already uploaded to Athom Test.

## What's new in v0.8.0

- Refined the dynamic energy-line layout for a more balanced visual composition.
- Moved the grid line start lower and further left, closer to the bottom of the grid value card.
- Shortened the solar line and aligned the solar/grid connection height at the home-consumption card.
- Added Homey App Store metadata for the GitHub source, issue tracker and project homepage.
- Shortened `README.txt` for the Homey App Store and removed links/changelog-style release notes from it.
- Automatic day/night switching now uses Homey's configured timezone when determining the local date and fallback hour for sunrise/sunset calculation.

## Release/versioning policy

The HomeFlux app version follows the version that is actually published to Athom/Homey. During normal development the version in `.homeycompose/app.json` stays unchanged. Only bump the version when a new build is intentionally prepared for `homey app publish`; after publishing, commit/tag that exact version. GitHub release notes can be maintained here in `README.md` (and/or `CHANGELOG.md`), while `README.txt` remains a short App Store description without version history.


## What’s new in v0.9.6

- Added German, French and Spanish translations for settings, Flow cards, widgets and messages, plus App Store descriptions in these three languages.

## 1.0.1

- EN: Added a charger display option: hide at zero power or always show.
- NL: Weergaveoptie voor laders toegevoegd: verbergen bij nul vermogen of altijd tonen.
- DE: Anzeigeoption für Ladegeräte hinzugefügt: bei null Leistung ausblenden oder immer anzeigen.
- FR: Ajout du choix d’affichage des bornes : masquer à puissance nulle ou toujours afficher.
- ES: Añadida una opción para ocultar los cargadores con potencia cero o mostrarlos siempre.

- EN: Added locale-aware numeric text input with confirmation dropdowns for ambiguous values.
- NL: Taalbewuste numerieke tekstinvoer toegevoegd met bevestigingsdropdowns voor dubbelzinnige waarden.
- DE: Sprachabhängige Zahleneingaben mit Bestätigungsauswahl für mehrdeutige Werte hinzugefügt.
- FR: Ajout des entrées numériques selon la langue avec listes de confirmation pour les valeurs ambiguës.
- ES: Añadidas entradas numéricas según el idioma con listas de confirmación para valores ambiguos.

- EN: Updated the Homey API dependency for Node.js 22 compatibility.
- NL: Homey API-afhankelijkheid bijgewerkt voor compatibiliteit met Node.js 22.
- DE: Homey-API-Abhängigkeit für die Kompatibilität mit Node.js 22 aktualisiert.
- FR: Mise à jour de la dépendance Homey API pour la compatibilité avec Node.js 22.
- ES: Actualizada la dependencia Homey API para la compatibilidad con Node.js 22.

## 1.0.2

- EN: Added a separate standby line thickness factor when using power-dependent line thickness; the default preserves the existing appearance.
- NL: Aparte factor voor stand-bylijndikte toegevoegd bij vermogensafhankelijke lijndikte; de standaard behoudt de bestaande weergave.
- DE: Separaten Faktor für die Standby-Liniendicke bei leistungsabhängiger Liniendicke hinzugefügt; die Standardeinstellung erhält das bisherige Aussehen.
- FR: Ajout d’un facteur distinct pour l’épaisseur des lignes en veille avec l’épaisseur selon la puissance ; la valeur par défaut conserve l’apparence existante.
- ES: Añadido un factor independiente para el grosor de las líneas en espera al usar el grosor según potencia; el valor por defecto conserva la apariencia existente.

- EN: Made Flux Ribbon glow adjustable (0–200%, default 100%). Fixed Comet Flow animation and thin base lines, and applied corner rounding consistently to all effect layers. Standby lines now follow the selected line style while retaining their colour and blink settings.
- NL: Flux Ribbon-gloed instelbaar gemaakt (0–200%, standaard 100%). Comet Flow-animatie en dunne basislijnen hersteld en hoekafronding consequent toegepast op alle effectlagen. Stand-bylijnen volgen nu de gekozen lijnstijl met behoud van hun kleur- en knipperinstellingen.
- DE: Flux-Ribbon-Leuchtstärke einstellbar gemacht (0–200%, Standard 100%). Comet-Flow-Animation und dünne Grundlinien korrigiert sowie abgerundete Ecken auf alle Effektebenen angewendet. Standby-Linien folgen nun dem gewählten Linienstil und behalten ihre Farb- und Blinkoptionen.
- FR: Intensité lumineuse de Flux Ribbon réglable (0–200 %, 100 % par défaut). Correction de l’animation Comet Flow et des lignes de base fines, avec angles arrondis sur toutes les couches. Les lignes en veille suivent désormais le style choisi tout en conservant leur couleur et leur clignotement.
- ES: Brillo de Flux Ribbon ajustable (0–200 %, 100 % por defecto). Corregidas la animación Comet Flow y las líneas de base finas, con esquinas redondeadas en todas las capas. Las líneas en espera siguen el estilo seleccionado y conservan su color y parpadeo.

- EN: Refined Flux Ribbon into a calm glowing energy pulse and added tapered, fading comet trails.
- NL: Flux Ribbon verfijnd tot een rustige gloeiende energiepuls en kometen voorzien van een taps toelopende, vervagende lichtstaart.
- DE: Flux Ribbon zu einem ruhigen leuchtenden Energieimpuls verfeinert und sich verjüngende, verblassende Kometenschweife hinzugefügt.
- FR: Flux Ribbon devient une douce impulsion lumineuse et les comètes disposent d’une traînée effilée qui s’estompe.
- ES: Flux Ribbon refinado con un suave pulso de energía luminosa y cometas con estelas que se estrechan y desvanecen.

- EN: Improved text contrast throughout the configuration in light and dark mode.
- NL: Tekstcontrast in de volledige configuratie verbeterd voor lichte en donkere weergave.
- DE: Textkontrast in der gesamten Konfiguration im hellen und dunklen Modus verbessert.
- FR: Amélioration du contraste des textes dans toute la configuration en mode clair et sombre.
- ES: Mejorado el contraste del texto en toda la configuración en modo claro y oscuro.

- EN: Added optional Flux Ribbon and Comet Flow lines, power-dependent speed or thickness, corner rounding and value transitions. Yellow can be selected independently for the PV line and value. Existing colours, layout and data refresh are retained.
- NL: Optionele Flux Ribbon- en Comet Flow-lijnen, vermogensafhankelijke snelheid of dikte, afgeronde hoeken en waardeovergangen toegevoegd. Geel is afzonderlijk te kiezen voor de PV-lijn en PV-waarde. Bestaande kleuren, indeling en datavernieuwing blijven behouden.
- DE: Optionale Flux-Ribbon- und Comet-Flow-Linien, leistungsabhängige Geschwindigkeit oder Dicke, abgerundete Ecken und Wertübergänge hinzugefügt. Gelb ist für PV-Linie und PV-Wert getrennt wählbar. Bestehende Farben, Layout und Datenaktualisierung bleiben erhalten.
- FR: Ajout des lignes facultatives Flux Ribbon et Comet Flow, de la vitesse ou épaisseur selon la puissance, des angles arrondis et des transitions de valeurs. Le jaune est sélectionnable séparément pour la ligne et la valeur PV. Les couleurs, la disposition et l’actualisation existantes sont conservées.
- ES: Añadidas líneas opcionales Flux Ribbon y Comet Flow, velocidad o grosor según potencia, esquinas redondeadas y transiciones de valores. El amarillo se puede seleccionar por separado para la línea y el valor FV. Se conservan los colores, la distribución y la actualización existentes.


## 1.0.3

- EN: Gallery filename extensions and image MIME types now accept uppercase and mixed case.
- NL: Gallery-bestandsextensies en afbeeldings-MIME-types accepteren nu ook hoofdletters en gemengde schrijfwijzen.
- DE: Gallery-Dateiendungen und Bild-MIME-Typen akzeptieren nun auch Groß- und gemischte Schreibweisen.
- FR: Les extensions des fichiers Gallery et les types MIME des images acceptent désormais les majuscules et les casses mixtes.
- ES: Las extensiones de archivos Gallery y los tipos MIME de imagen ahora aceptan mayúsculas y combinaciones de mayúsculas y minúsculas.

- EN: Gallery backgrounds now load through the HomeFlux widget API instead of a direct Gallery URL on the viewing device. Added a bounded single-photo cache; existing photo selections and fallback scenes are retained.
- NL: Gallery-achtergronden laden nu via de HomeFlux-widget-API in plaats van een directe Gallery-URL op het toestel. Een begrensde cache voor één foto toegevoegd; bestaande fotokeuzes en terugvalscènes blijven behouden.
- DE: Gallery-Hintergründe werden nun über die HomeFlux-Widget-API statt über eine direkte Gallery-URL auf dem Anzeigegerät geladen. Begrenzten Cache für ein Foto hinzugefügt; bestehende Fotoauswahl und Ersatzszenen bleiben erhalten.
- FR: Les arrière-plans Gallery se chargent désormais via l’API du widget HomeFlux au lieu d’une URL Gallery directe sur l’appareil. Ajout d’un cache limité à une photo ; les sélections et scènes de remplacement sont conservées.
- ES: Los fondos de Gallery se cargan ahora mediante la API del widget HomeFlux en lugar de una URL directa de Gallery en el dispositivo. Se añade una caché limitada a una foto; se conservan las selecciones y las escenas de respaldo.
