# Helios-6 Engineering & Verification Notes

## 1. Scope and Hardware Disclosure

Helios-6 was designed as a self-contained hardware and CAD engineering submission combining mechanical design (`cad/`), electrical design (`pcb/` and `bom/`), and an interactive browser workbench (`index.html`, `engine.js`, `hardware.js`, `app.js`).

In the interest of full engineering transparency:

1. **OpenSCAD and STL Geometry Verification:**
   * All committed `.stl` meshes (`cad/helios_base.stl`, `cad/helios_worm_gear.stl`, `cad/helios_yoke.stl`) and `cad/helios_gimbal.scad` are generated deterministically from the same analytical equations in `engine.js`.
   * Using `tools/verify-scad.mjs` with `openscad-wasm-prebuilt`, `cad/helios_gimbal.scad` was compiled to STL through the real OpenSCAD CSG kernel and compared against the procedural meshes from `engine.js`. Across `base`, `wheel`, `yoke`, and `array`, relative volume error is below `0.002%` (`0.0000%` on `base`, `yoke`, and `array`; `0.0017%` on the 24-tooth involute `wheel`) and bounding-box dimensions match within `0.001 mm`.
   * The azimuth wheel uses an extruded 2D involute spur profile (`generateParametricGearMesh`), which is a standard 3D-printable approximation of a worm wheel (no throated enveloping helix).

2. **KiCad 8 Schematic and PCB Files:**
   * `pcb/helios_mppt_node.kicad_sch` (version `20231120`) and `pcb/helios_mppt_node.kicad_pcb` (version `20240108`) are generated deterministically by `tools/kicad.js` using pad and courtyard geometries extracted from the official KiCad 8 footprint libraries (`tools/footprints.json`).
   * Pin numbers and electrical types for `U1` (`RP2040` QFN-56), `U2` (`W25Q16JVSSIQ` SOIC-8), `U3` (`INA219AIDR` SOIC-8), and `U4` (`AP2112K-3.3` SOT-23-5) were verified against official KiCad symbol definitions and manufacturer datasheets, and LCSC part numbers (`C2040`, `C82317`, `C138706`, `C51118`, etc.) were checked against LCSC catalog records.
   * The `.kicad_pcb` file defines the 80 x 56 mm `Edge.Cuts` board outline, all 48 non-overlapping component footprints on `F.Cu`, the full 40-net netlist assignment on every pad, and the `B.Cu` ground zone polygon, but it does not contain routed copper traces (`segment` elements) and has not been opened or DRC-checked inside the desktop KiCad GUI.

3. **Physical Fabrication Status:**
   * This repository is a complete digital hardware and software design package; physical 3D printing and PCB assembly have not been performed yet.

## 2. Mathematical Summary

* **Solar Position:** Spencer (1971) Fourier series for solar declination $\delta$ and equation of time $\text{EoT}$ as a function of fractional year $\gamma = \frac{2\pi}{365}(N - 1 + \frac{t - 12}{24})$.
* **Worm Self-Locking Criterion:** Static self-locking holds when the worm lead angle $\lambda = \arctan(z_1 / q)$ is strictly smaller than the effective friction angle $\phi_s = \arctan(\mu / \cos\alpha)$. With $z_1 = 1$, diameter quotient $q = 10$, pressure angle $\alpha = 20^\circ$, and $\mu = 0.15$, $\lambda = 5.71^\circ < \phi_s = 9.07^\circ$, yielding a $+3.36^\circ$ static lock margin.
* **Euler-Poincare Topology Check:** Every generated mesh is verified for edge manifoldness (each undirected edge shared by exactly 2 triangles traversed in opposite directions), zero degenerate triangles, positive signed volume $V = \frac{1}{6}\sum (v_0 \times v_1) \cdot v_2$, and Euler characteristic $V - E + F = 2S - 2g$.
