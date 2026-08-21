# HomeFlux

HomeFlux visualizes live household energy flows on Homey.

## Key features

- Live PV, battery, grid, home-consumption and EV charging flows
- Up to 10 PV sources, 10 batteries and 10 EV chargers
- Components disappear automatically when their configured count is 0
- Animated energy lines with configurable standby lines for PV, battery and grid
- Day/night backgrounds controlled by user-defined local hours or total PV production
- Manual period and weather selection for testing
- Overlay colour: Automatic, Light or Dark
- Optional battery value from approximately 24 hours ago
- Configurable labels, units, transparency and refresh interval
- Extra Homey capabilities as tiles below the illustration
- Dutch and English interface

## Backgrounds

Day scenes are bright and use no house lighting. Evening scenes use an early-evening look with warm interior lights. Energy-flow lines are drawn dynamically by the widget.

## Configuration

Open the HomeFlux app settings in Homey and map the capabilities for your installation.

## Support HomeFlux

If HomeFlux is useful to you and you would like to support its development, you can [buy me a coffee](https://buymeacoffee.com/davybert). Donations are completely optional.

## Why `homey:manager:api` is required

HomeFlux is an Energy app that visualizes values from energy-related devices already installed in Homey, such as solar inverters, home batteries, grid meters and EV chargers. Because these sources can come from many different Homey apps and expose different capabilities, HomeFlux cannot declare one fixed set of devices in advance.

The `homey:manager:api` permission is used locally to discover available devices/capabilities and Logic variables when the user opens source selection, read the initial value of configured sources, and create realtime subscriptions for only those configured sources. During normal runtime HomeFlux keeps a compact cache updated by those realtime events. HomeFlux does not use this permission to control devices or send Homey data to an external HomeFlux service.

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

