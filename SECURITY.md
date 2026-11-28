# Security policy

## Reporting a vulnerability

Use the private GitHub Security Advisory form at [Report a vulnerability](https://github.com/draarivpatel-ui/helios-cad-forge/security/advisories/new). Do not open a public issue, pull request or discussion with exploit details.

Never include a live secret, token, cookie, private key, victim hostname or proprietary payload in a report. Use synthetic values and redacted transcripts.

## Supported versions

| Version | Status |
| --- | --- |
| latest `main` | Supported |

Security fixes are applied to the latest state of the default branch.

## Scope

This policy covers the static Helios CAD Forge browser application, parametric solar-tracker CAD artifacts, KiCad telemetry-node files, generated exports and browser persistence.

In scope:

- A cross-site scripting or HTML injection path through CAD state, hardware data, share links, imported text or generated output.
- A serialization, codec or export flaw that bypasses validation, corrupts another design, or executes attacker-controlled code.
- A generated CSV, Markdown, OpenSCAD, STL or KiCad export flaw that makes output execute a formula or script when opened.
- A browser-storage or offline-runtime flaw that serves attacker-controlled application code across an update.
- A validation failure that misrepresents a safety-critical mechanical, electrical or solar-yield calculation as verified.

Out of scope:

- Browser vulnerabilities, operating system compromise or physical access to the machine.
- Damage caused by modified copies of the static application that do not come from this repository.
- Documented approximation limits of engineering or geometry models, unless a report shows a specific validation or output integrity failure.

## Coordinated disclosure

- Acknowledgment: within 3 business days.
- Initial triage: within 14 calendar days.
- Fix or mitigation target: within 90 calendar days for confirmed reports.
- Coordinated public disclosure: up to 90 days by default, adjusted by mutual agreement when exploitation or user risk requires a different date.
