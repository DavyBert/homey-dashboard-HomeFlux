# Posities en lijnen — HomeFlux 0.9.4

Onder **Instellingen → Posities en lijnen** zijn twee uitbreidingen toegevoegd.

## Eindpunt huis–batterijlijn

- **Batterij op de foto (huidige weergave)** behoudt het bestaande lijneindpunt.
- **Doorlopen tot batterijvenster** laat de lijn aansluiten op de zichtbare rand
  van het batterij-infovenster.

De standaard blijft de huidige weergave. Het venstereindpunt wordt in de browser
bepaald op basis van de actuele venstergrootte. Een andere schermbreedte, tekstgrootte
of het tonen/verbergen van de 24-uurswaarde wordt automatisch gevolgd.

## Infovensters wisselen

Zonnepanelen, elektriciteitsnet, batterij en autolader hebben elk één van de vier
hoekposities. Kies je een al gebruikte positie, dan wisselt het andere venster
automatisch naar de vrijgekomen plek. De knop **Standaardposities herstellen**
herstelt de vier posities; de aparte keuze voor het batterijlijneindpunt blijft behouden.
Gebruik **Dashboard opslaan** om wijzigingen toe te passen.

Standaard: zonnepanelen linksboven, net rechtsboven, batterij linksonder en
autolader rechtsonder. Het huisverbruik blijft in het midden. De wijziging is
globaal en werkt bij Huis, Tuin en Eigen foto's. De achtergrondafbeeldingen
worden niet gewijzigd: objecten die op een foto staan, verplaatsen niet mee.

Elke hoek heeft een bijbehorende lijnroute. Bij het wisselen volgt de lijn het
infovenster naar die hoek. De bestaande kleur-, standby-, knipper- en
animatie-instellingen blijven bij hun eigen onderdeel. PV/net behouden hun
richting naar het huis; batterij/autolader hun richting vanuit het huis, waarop
de bestaande omkeer-/import-/exportlogica toegepast blijft.

## Opslag en prestaties

De bestaande `visualConfig` krijgt twee velden:

```json
{
  "componentPositions": {
    "solar": "top-left",
    "grid": "top-right",
    "battery": "bottom-left",
    "ev": "bottom-right"
  },
  "batteryLineEnd": "device"
}
```

`batteryLineEnd: "card"` kiest het venster. Ontbrekende of ongeldige instellingen
vallen terug op een geldige, unieke indeling en de oorspronkelijke lijnlengte.
Bestaande foto- en weermappings blijven apart bewaard.

`widgets/dashboard/public/layout.js` deelt normalisatie en lijnberekening tussen
backend, instellingen en widget.
De HTML-pagina's bevatten deze gedeelde code rechtstreeks binnen hun
initialisatie, zodat het openen via een ingebed Homey-instellingenvenster geen
afzonderlijk relatief script vereist. Na wijzigingen aan `layout.js` houdt
`node scripts/sync-layout.cjs` beide pagina's gelijk; een test controleert dit.

Er zijn geen nieuwe afhankelijkheden,
machtigingen of Homey-API-aanvragen nodig. De indeling wordt alleen bij een
instellingswijziging aangepast. Venstergeometrie wordt alleen voor de nieuwe
vensteroptie gemeten, gebundeld via requestAnimationFrame bij een groottewijziging.

## Tests

- Instellingen openen op een afwijkend basispad, met geblokkeerde externe
  lay-outscripts en aanwezige CommonJS-globals; ook de widget werkt zonder
  afzonderlijk lay-outscript.
- Alle 24 indelingen: unieke posities en correcte automatische wissels.
- Alle vier oorspronkelijke SVG-paden blijven bij standaardinstellingen exact gelijk.
- Lijnkleur en logische richting blijven bij het juiste onderdeel.
- Venstereindpunt in alle vier hoeken bij 320, 390 en 1000 pixels schermbreedte.
- Tekstgrootte 50%/110% en tonen/verbergen van de 24-uurswaarde.
- Opslaan, pagina-herladen, app-herstart en herstellen van standaardposities.
- Bestaande Gallery-scenario's, fallback en alle weermodi blijven getest.
- 1000 ongewijzigde energie-updates veroorzaken geen nieuwe geometrieberekening
  nadat de indeling is gestabiliseerd.

De controles zijn uitgevoerd in Node en Chromium met een gesimuleerde Homey-
verbinding. Er is geen meting op fysieke Homey-hardware gedaan. De versie blijft
0.9.4. Niets is gepusht of gepubliceerd.
