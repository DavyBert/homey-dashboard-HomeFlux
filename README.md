# HomeFlux

HomeFlux visualizes live household energy flows on Homey.

## Key features

- Live PV, battery, grid, home-consumption and EV charging flows
- Up to 10 PV sources, 10 batteries and 10 EV chargers
- Components disappear automatically when their configured count is 0
- Animated energy lines with configurable standby lines for PV, battery and grid
- Automatic day/evening backgrounds with weather scenes
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
- Added Homey App Store metadata for the GitHub source, issue tracker and Buy Me a Coffee homepage.
- Shortened `README.txt` for the Homey App Store and removed links/changelog-style release notes from it.
- Automatic day/night switching now uses Homey's configured timezone when determining the local date and fallback hour for sunrise/sunset calculation.

## Release/versioning policy

The HomeFlux app version follows the version that is actually published to Athom/Homey. During normal development the version in `.homeycompose/app.json` stays unchanged. Only bump the version when a new build is intentionally prepared for `homey app publish`; after publishing, commit/tag that exact version. GitHub release notes can be maintained here in `README.md` (and/or `CHANGELOG.md`), while `README.txt` remains a short App Store description without version history.

