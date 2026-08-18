# Changelog

## Current development

- Added 0-10 PV, battery and EV charger support.
- Added optional 24-hour battery comparison.
- Replaced baked-in energy lines with dynamic flow lines.
- Added configurable standby lines.
- Added refreshed line-free day and early-evening backgrounds.
- Added overlay colour setting: Automatic, Light or Dark.
- Removed fixed Light, Dark and Custom Image background modes.

## v0.8.2

- Reworked stale-source fallback logic so the widget refresh interval no longer determines when a source is considered stale.
- Sources are now considered genuinely stale only after 1800 seconds (30 minutes) without a completed refresh; realtime changes are still handled immediately on the next widget request.

## v0.8.0

- Refined the solar and grid energy-flow line geometry and aligned their connection height at the home card.
- Added App Store source, issue-tracker and homepage metadata.
- Shortened the Homey App Store README.
