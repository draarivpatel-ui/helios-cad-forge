# Helios-6 Parametric Solar Tracker & KiCad Telemetry Node

**Live CAD & EDA Workbench:** [https://aariv.me/helios-cad-forge/](https://aariv.me/helios-cad-forge/)

**Reference Design Note.** This repository provides a complete parametric CAD, KiCad schematic/PCB, BOM, and browser simulator reference design for a dual-axis solar tracker. Physical boards have not yet been fabricated or assembled.

Helios-6 is a parametric dual-axis solar tracker gimbal, OpenSCAD + watertight STL mesh generator, Spencer (1971) solar ephemeris calculator, and KiCad 8 RP2040 + INA219 telemetry node. The project pairs committed mechanical and electrical hardware artifacts (`cad/`, `pcb/`, `bom/`) with a zero-dependency in-browser CAD and EDA studio (`index.html`, `styles.css`, `engine.js`, `hardware.js`, `helios-lab.js`, `app.js`).

## Repository Architecture

```text
helios-cad-forge/
├── index.html                    # Dieter Rams / Mitutoyo blueprint light-mode CAD & EDA studio
├── styles.css                    # Drafting vellum (#F5F3EC) and anodized panel (#EAE6DA) stylesheet
├── engine.js                     # UMD solar position, worm-gear kinematics, watertight STL & OpenSCAD engine
├── hardware.js                   # UMD LCSC bill of materials, RP2040 + INA219 netlist & 80x56 mm PCB placement
├── helios-lab.js                 # UMD 5-regime yield comparator, worm self-locking sweep, SHA-256 brief & #hc= codec
├── app.js                        # Interactive 3D canvas viewport, stereographic sun-path & PCB inspector
├── cad/
│   ├── helios_gimbal.scad        # Parametric OpenSCAD source for the 6-body gimbal assembly
│   ├── helios_base.stl           # Watertight ASCII STL for the cylindrical stator base (genus 1)
│   ├── helios_worm_gear.stl      # Watertight ASCII STL for the 24-tooth involute worm wheel (genus 1)
│   └── helios_yoke.stl           # Watertight ASCII STL for the elevation U-yoke (genus 0)
├── pcb/
│   ├── helios_mppt_node.kicad_pro # KiCad 8 project configuration
│   ├── helios_mppt_node.kicad_sch # KiCad 8 schematic (48 placed symbols, full net labels & no-connects)
│   └── helios_mppt_node.kicad_pcb # KiCad 8 2-layer 80x56 mm PCB (48 non-overlapping footprints + GND zone)
├── bom/
│   └── bom.csv                   # 26-line grouped BOM (48 on-board parts + off-board steppers/LDRs/panel)
├── tools/
│   ├── build-artifacts.js        # Deterministic generator for cad/, pcb/, and bom/
│   ├── kicad.js                  # KiCad 8 S-expression schematic and PCB builder
│   ├── footprints.json           # Pad and courtyard geometry extracted from official KiCad 8 footprints
│   ├── sexpr.js                  # S-expression tokenizer and tree parser for test verification
│   └── verify-scad.mjs           # OpenSCAD WebAssembly volume and bounding-box parity verifier
└── tests/
    ├── engine.test.js            # Unit tests for solar math, gear kinematics, manifold topology & KiCad files
    ├── helios-lab.test.js        # Lab tests: SHA-256 vectors, codec fuzzing, yield parity, exports & audits
    └── dom-smoke.test.js         # DOM smoke tests for the interactive 3D workbench, lab UI & anti-slop hygiene
```

## Core Engineering Capabilities

### 1. Spencer (1971) Solar Ephemeris & Meinel Clear-Sky Yield
* Computes fractional year, solar declination ($\delta$), equation of time (EoT), solar hour angle ($\omega$), solar zenith/elevation, and clockwise azimuth from true north.
* Integrates daily clear-sky beam irradiance using the Meinel air-mass attenuation model ($I_b = I_0 \cdot 0.7^{AM^{0.678}}$) to compare dual-axis tracking against fixed latitude tilt and horizontal surfaces.
* Renders an interactive polar stereographic sky dome with summer solstice (Day 172), equinox (Day 80), winter solstice (Day 355), and active day trajectories.

### 2. Self-Locking Worm-Gear Kinematics & Watertight Mesh Synthesis
* Synthesizes true involute tooth flanks ($\alpha = 20^\circ$ pressure angle, configurable module $m$ and tooth count $z$) with print-tolerance backlash compensation.
* Evaluates worm lead angle ($\lambda = \arctan(z_1 m / d_1)$) against static friction angle ($\phi_s = \arctan(\mu / \cos\alpha)$) to verify static self-locking under wind load without holding current.
* Builds 6 closed triangle meshes (`base`, `wheel`, `yoke`, `panel`, `pcb`, `sensors`) and validates every body with an Euler-Poincare manifold checker ($V - E + F = 2S - 2g$, zero boundary edges, zero non-manifold edges, consistent outward triangle winding).

### 3. RP2040 + INA219 Telemetry Node & Verified LCSC BOM
* Despite the `mppt` in the file names, the board has no MPPT converter. The INA219 measures panel current (across the `R14` shunt) and bus voltage; it does not track the maximum power point.
* Captures a 48-component on-board circuit (`U1` RP2040 QFN-56, `U2` W25Q16JVSSIQ QSPI flash, `U3` INA219AIDR high-side I2C current/voltage monitor, `U4` AP2112K-3.3 LDO, `Y1` 12 MHz crystal, `J1` USB-C, `R14` 0.1 ohm 1206 current shunt, quadrant LDR dividers `R9..R12`, and headers `J2..J8`).
* The 21 LCSC part numbers in `bom/bom.csv` were each matched to their manufacturer part number on lcsc.com on 2026-10-25. The BOM has no prices or total cost line yet.
* Every pin of all 48 placed components is verified against official KiCad 8 symbol definitions and either assigned to one of 40 named nets or explicitly documented in `NO_CONNECT`.
* All 48 footprint courtyards are placed on an 80 x 56 mm 2-layer board and verified by automated tests to lie strictly inside `Edge.Cuts` with zero courtyard overlaps.

### 4. Solar Yield & Kinematics Lab (`helios-lab.js`)
* Compares 5 tracking regimes (`horizontal`, `fixed-lat-tilt`, `single-axis-ew`, `single-axis-ns`, `dual-axis-helios`) across 12 Klein representative days, verified against full 365-day integration, with benchmark rows at 0 / 29.6 / 40.7 / 55.7 deg latitude plus the live workbench latitude.
* Sweeps the worm self-locking boundary `phi_s(mu) = arctan(mu / cos alpha)` over 5 material pairs plus a custom `mu` in `[0.05, 0.40]`, reporting the strict `lambda < phi_s` verdict, locking margin, and static holding efficiency.
* Re-runs the live Euler-Poincare audit on all 6 gimbal bodies and the 48-part PCB check, then stamps a pure-JS FIPS 180-4 SHA-256 digest into JSON, formula-safe CSV, and Markdown engineering briefs so one tamper-evident fingerprint appears identically on the page and in every export.
* Round-trips latitude, day-of-year, tracking regime, worm material/`mu`, and gear teeth/module through a fail-closed `#hc=` bookmark hash that rejects malformed payloads and prototype-pollution keys.
* Includes an in-page deterministic self-test runner (18 checks: SHA-256 known-answer vectors, declination landmarks, ordering invariants, worm boundary exactness, manifold chi, CSV escaping, tamper detection, and codec round-trip).

## Verification & Local Commands

Requires Node.js 18+ (zero `npm` runtime dependencies):

```bash
# Run the 445-test unit, lab, and DOM smoke suite
npm test

# Deterministically regenerate all STL, OpenSCAD, KiCad 8, and BOM artifacts
npm run build
```

To run the optional OpenSCAD WebAssembly geometry parity check (`tools/verify-scad.mjs`):

```bash
npm install --no-save openscad-wasm-prebuilt
node tools/verify-scad.mjs
```

See [NOTES.md](NOTES.md) for full engineering notes and verification disclosures.

## License

Released under the [MIT License](LICENSE).
