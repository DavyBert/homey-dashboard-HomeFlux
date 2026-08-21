# Changelog

## Current development

- Added 0-10 PV, battery and EV charger support.
- Added optional 24-hour battery comparison.
- Replaced baked-in energy lines with dynamic flow lines.
- Added configurable standby lines.
- Added refreshed line-free day and early-evening backgrounds.
- Added overlay colour setting: Automatic, Light or Dark.
- Removed fixed Light, Dark and Custom Image background modes.

## v0.8.5
- Restored the optional Buy Me a Coffee link in HomeFlux settings and GitHub project metadata; the App Store homepage remains the HomeFlux GitHub project page.

- Lowered the battery energy-flow connection at the home card to keep it visually separated from the grid flow line.
- EV charger flow colour now follows battery direction when a battery is configured: green while charging and blue while discharging.
- When the battery is idle or no battery is configured, the EV charger flow colour follows the grid state/standby colour.
- Removed the obsolete `simple-dark.jpg` and `simple-light.jpg` widget backgrounds.
- Replaced sunrise/sunset geolocation calculations with a user-selectable day/night mode: configured local hours or PV production, with configured hours as fallback when PV is unavailable.
- Made day/night control a top-level background setting, so Realistic / automatic always follows the selected hours or PV mode; manual mode can still explicitly override the period.
- Updated the App Store homepage to the HomeFlux project page instead of a donation URL.
- Replaced Widget screenshots with simplified, text-free transparent Widget previews for App Store certification.
- Documented why the Energy app requires `homey:manager:api`: source discovery and realtime subscriptions for user-selected Homey devices/capabilities and Logic variables.

## v0.8.4

- Reworked live updates into true push for configured device capabilities: Homey capability events update the compact HomeFlux cache directly.
- Widgets perform one initial cache read and then receive shared `dashboard.updated` pushes instead of polling the app.
- Pushes are coalesced and limited by the configured refresh interval; unchanged dashboard snapshots are skipped.
- Only configured device capability instances are kept at runtime; broad ManagerDevices/device update listeners are not used.
- Full source discovery remains limited to the settings/source-selection screen.
- Removed local battery-history sampling and persistence; the optional 24-hour comparison uses Homey Insights only.

## v0.8.3

- Removed stale and fallback polling from normal runtime updates.
- The user-selected widget refresh interval now performs the actual live refresh of all configured sources.
- Only configured devices and Logic variables are reread; HomeFlux does not rescan the complete Homey device list.
- Initial app startup and dashboard saves still refresh all configured sources once.

## v0.8.2

- Reworked stale-source fallback logic so the widget refresh interval no longer determines when a source is considered stale.
- Sources are now considered genuinely stale only after 1800 seconds (30 minutes) without a completed refresh; realtime changes are still handled immediately on the next widget request.

## v0.8.0

- Refined the solar and grid energy-flow line geometry and aligned their connection height at the home card.
- Added App Store source, issue-tracker and homepage metadata.
- Shortened the Homey App Store README.
