# HomeFlux 0.9.4 — Eigen foto's

De bestaande sets Huis en Tuin blijven de standaardkeuzes. Eigen foto's is een
afzonderlijke, optionele set. De instellingen bevatten een nieuw tabblad met
14 rijen: dag/nacht × helder, licht bewolkt, bewolkt, regen, mist, sneeuw en onweer.
De rijlijst wordt opgebouwd uit de bestaande weerscènes in app.js.

## Integratie en verificatie

De gebruikte interface is de officiële Homey Apps SDK ApiApp:

```js
homey.api.getApiApp('com.athom.gallery').get('/image')
```

De geïnstalleerde app en versie worden eerst gecontroleerd. Gallery 3.3.1 of
nieuwer is vereist. De exacte API is nagekeken in Athoms officiële Gallery 3.3.1
broncode, commit `ef55ef2df8cdc455dd40155352042d459044610c`.
`api.js/getImages` retourneert de opgeslagen Gallery-lijst via `app.getImages()`.
Deze bevat per vaste Gallery-ID een naam, MIME-type en `/userdata/ID.ext`.
De dropdown toont de door de gebruiker benoemde Gallery-naam; de technische
bestandsnaam staat in de tooltip. Er hoeft geen URL ingevoerd te worden.

De bestandsroute `/app/com.athom.gallery/userdata/ID.ext` volgt dezelfde methode
als Athoms eigen Gallery Slideshow-widget. Er wordt geen tijdelijk
ManagerImages-ID opgeslagen. Gallery bewaart de vaste IDs en bestanden bij een
app- of Homey-herstart; de tests voeren die initialisatie opnieuw uit.

Er is één noodzakelijke nieuwe machtiging: `homey:app:com.athom.gallery`, voor de
gedocumenteerde app-naar-app-communicatie. Er zijn geen nieuwe runtimeafhankelijkheden.
Zonder Gallery blijven Huis en Tuin werken. De nieuwe toestemming geeft HomeFlux
toegang tot Gallery's app-API; deze implementatie voert uitsluitend GET-verzoeken uit.
Gallery wordt niet gewijzigd en er worden geen foto's geüpload of verwijderd.

Officiële bronnen:

- https://apps.developer.homey.app/advanced/web-api#accessing-the-web-api-of-another-app
- https://apps-sdk-v3.developer.homey.app/ApiApp.html
- https://github.com/athombv/com.athom.gallery/blob/master/api.js
- https://github.com/athombv/com.athom.gallery/blob/master/app.js
- https://github.com/athombv/com.athom.gallery/blob/master/widgets/slideshow/public/index.html

## Opslag en terugval

De setkeuze staat zoals voorheen in `visualConfig.backgroundSet`: `house`,
`garden` of nieuw `custom`. Bestaande installaties behouden hun eigen set.

Fotokeuzes worden direct en afzonderlijk opgeslagen onder de Homey-instelling
`photoMappings`. Bijvoorbeeld:

```json
{
  "day-clear": { "id": "vaste-gallery-id", "name": "Mijn huis overdag" },
  "night-clear": { "id": "andere-gallery-id", "name": "Mijn huis 's nachts" }
}
```

Dezelfde foto mag bij meerdere modi gebruikt worden. Fotokeuzes wijzigen nooit
de bestaande `weatherMappings`, broninstellingen of Huis/Tuin-afbeeldingsmappen.
Gelijktijdige wijzigingen worden na elkaar opgeslagen om verloren keuzes te
voorkomen. 'Standaardafbeelding' verwijdert uitsluitend de keuze voor die rij.

Eigen foto's gebruikt als fallback altijd het ingebouwde **huisbeeld van dezelfde
weermodus**. Dit gebeurt bij een lege keuze, ontbrekende metadata, niet-beschikbare
Gallery, een ontbrekend bestand, decodeerfout of laadtimeout. De eigen foto wordt
pas zichtbaar na succesvol laden; tot dan blijft het standaardbeeld zichtbaar.

Een ontbrekende of onbereikbare foto wordt nooit automatisch uit photoMappings
verwijderd. Metadata wordt op vaste Gallery-ID opgezocht, zodat dezelfde foto bij
herstel opnieuw gebruikt kan worden. Een nieuw geüploade foto met dezelfde naam
maar een andere Gallery-ID moet opnieuw gekozen worden.

De controle op Gallery-metadata is relevant: Gallery 3.3.1 verwijdert bij het
verwijderen van een foto de lijstregistratie, maar wist in die methode niet het
achterliggende bestand. Alleen een HTTP-laadcontrole zou dus onvoldoende zijn.

## Prestaties en herstel

- Huis/Tuin initialiseren Gallery niet, tenzij het fototabblad wordt geopend.
- De lijst heeft een gedeelde cache van 60 seconden en één gelijktijdig verzoek.
- Gallery-wijzigingen en installatie-/uitvalmeldingen maken de cache ongeldig.
- Alleen met Eigen foto's actief en minstens één fotokeuze wordt iedere 5 minuten gereconcilieerd, ook
  voor herstel na een gemiste melding of tijdelijke fout.
- De lijstaanvraag heeft een timeout van 6 seconden. De widget blijft werken.
- Een fotolaadpoging heeft een timeout van 15 seconden en herstelt na
  30/60/120/240 seconden, daarna maximaal één poging per 5 minuten.
- Alleen mislukte herpogingen gebruiken een cachedoorbrekende queryparameter.
- Wisselen van set of foto annuleert oude timers en negeert late antwoorden.
- Energie-updates downloaden geen foto's en vragen geen Gallery-lijst op.
- De backend bewaart alleen metadata. Afbeeldingsbytes en decodering blijven bij
  de browser, met de gewone browsercache; er worden geen foto's in HomeFlux gekopieerd.

## Gewijzigde bestanden

- `app.js`: optionele Gallery-runtime, aparte fotokeuzes en derde set.
- `lib/gallery.js`: SDK-koppeling, naam-/bestandsvalidatie, cache en foutherstel.
- `api.js`: GET /photos en PUT /photo-mapping.
- `settings/index.html`: vierde tab, derde setkeuze, dropdowns en previews.
- `widgets/dashboard/public/index.html`: optioneel fotoladen en fallback/herstel.
- `locales/en.json`, `locales/nl.json`: nieuwe teksten.
- `app.json`, `.homeycompose/app.json`: routes, gerichte machtiging en versie.
- `package.json`, `package-lock.json`: uitsluitend versie naar 0.9.4.
- `.homeychangelog.json`, `CHANGELOG.md`, `README.md`: korte feature-update.
- `widgets/dashboard/public/layout.js`, `test/layout.test.js`, `LAYOUT.md`: vensterposities en lijneindpunten.
- `test/gallery.test.js`, `test/gallery-ui.cjs`: backend- en browsertests.

## Daadwerkelijk uitgevoerde controles

1. Tien Node-tests met nagebootste SDK-grens, zowel zelfstandig als met de
   ongewijzigde officiële Gallery app.js/api.js van bovenstaand commit:
   lijstinhoud, namen/paden, gedeelde cache, nieuwe tijdelijke image-IDs na
   herstart met blijvende Gallery-IDs, 14 afzonderlijke en gelijktijdig opgeslagen
   keuzes, dezelfde foto bij meerdere modi, herstart van HomeFlux, verwijdering,
   tijdelijke uitval/herstel, niet-geïnstalleerde app, versiecontrole, onveilige
   paden, ongeldige metadata en timeout.
2. Chromium/Playwright met de echte instellingen- en widgetcode en lokale HTTP-
   simulatie van Homey: NL/EN-tab, drie setkeuzes, 14 dropdowns, previews,
   directe opslag, vernieuwen, pagina-herladen, mobiele breedte, alle 14 modi
   maal drie sets, verwijderde foto, HTTP 404, HTTP 200 met beschadigde bytes,
   vastlopende afbeelding, herstel met timer, laat antwoord en timerannulering.
   Geen JavaScript-fouten.
3. 10.000 backend-dashboardberekeningen: nul extra Gallery-verzoeken.
   1.000 widgetupdates: nul extra fotolaadverzoeken, ook tijdens een laadfout.
4. Vergelijking met de volledige 0.9.3-bron: alle 34 bestaande afbeeldingen,
   beide ingebouwde afbeeldingsmappen en de weersinterpretatie zijn bytegelijk.
   Ook README.txt/README.nl.txt, slogan, naam en tags blijven ongewijzigd.

Uitvoeren:

```sh
node --test test/gallery.test.js test/layout.test.js
OFFICIAL_GALLERY_PATH=/pad/naar/com.athom.gallery node --test test/gallery.test.js test/layout.test.js
CHROMIUM_EXECUTABLE=/pad/naar/chromium node test/gallery-ui.cjs
```

De laatste controle vereist Playwright in de ontwikkelomgeving; het is geen
runtimeafhankelijkheid van de Homey-app.

## Resterende beperkingen

Er is in deze werkomgeving geen verbinding met een fysieke Homey. De daadwerkelijke
SDK-transportlaag, een echte Homey-herstart, toegang op afstand en Homey CPU/RAM
zijn daarom niet op hardware gemeten. De integratie is gecontroleerd tegen de
officiële API en uitgevoerde Gallery-code; de browsercontroles gebruiken lokale
HTTP-simulaties. Een installatieproef op Homey blijft nodig vóór publicatie.
Athom heeft deze specifieke HomeFlux-uitbreiding nog niet gecertificeerd.

De infovensters kunnen via Instellingen tussen vier hoeken worden verwisseld.
De lijnen volgen deze indeling. De achtergrondfoto wordt niet aangepast.
De huis–batterijlijn kan naar het batterijvenster worden verlengd; zie LAYOUT.md.
Niets is gepusht of gepubliceerd.
