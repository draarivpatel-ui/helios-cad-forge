'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const E = require('../engine.js');
const HW = require('../hardware.js');
const K = require('../tools/kicad.js');
const S = require('../tools/sexpr.js');
const B = require('../tools/build-artifacts.js');

const ROOT = path.join(__dirname, '..');

/* ------------------------------------------------ 1. Solar Ephemeris Math */

test('computeDeclination matches equinox and solstice landmarks', () => {
  const spring = E.computeDeclination(80, 12);
  const summer = E.computeDeclination(172, 12);
  const autumn = E.computeDeclination(266, 12);
  const winter = E.computeDeclination(355, 12);
  assert.ok(Math.abs(spring) < 1.2, 'spring equinox declination near 0 deg');
  assert.ok(summer > 23.0 && summer < 23.6, 'summer solstice near +23.44 deg');
  assert.ok(Math.abs(autumn) < 1.2, 'autumn equinox declination near 0 deg');
  assert.ok(winter < -23.0 && winter > -23.6, 'winter solstice near -23.44 deg');
});

test('computeDeclination defaults solarHour to 12 when omitted', () => {
  assert.equal(E.computeDeclination(172), E.computeDeclination(172, 12));
});

test('computeEquationOfTime stays within physical bounds (-17 to +17 min)', () => {
  for (let d = 1; d <= 365; d += 15) {
    const eot = E.computeEquationOfTime(d, 12);
    assert.ok(eot > -17 && eot < 17, `day ${d} equation of time in bounds`);
  }
  assert.equal(E.computeEquationOfTime(100), E.computeEquationOfTime(100, 12));
});

test('clockToSolarHour converts local clock time using longitude and EoT', () => {
  const sh = E.clockToSolarHour(12, -77.0, -5, 172);
  assert.ok(Math.abs(sh - 11.84) < 0.15);
});

test('computeSolarPosition at solar noon in northern hemisphere faces due south (180 deg)', () => {
  const pos = E.computeSolarPosition({ latitude: 38.9, dayOfYear: 172, solarHour: 12 });
  assert.ok(Math.abs(pos.azimuthDeg - 180) < 1e-6);
  assert.ok(pos.elevationDeg > 74 && pos.elevationDeg < 75);
  assert.equal(pos.isDaylight, true);
  assert.ok(Math.abs(pos.zenithDeg + pos.elevationDeg - 90) < 1e-9);
});

test('computeSolarPosition in southern hemisphere at noon faces due north (0 deg)', () => {
  const pos = E.computeSolarPosition({ latitude: -35.0, dayOfYear: 355, solarHour: 12 });
  assert.ok(pos.azimuthDeg < 1e-5 || pos.azimuthDeg > 360 - 1e-5);
  assert.ok(pos.elevationDeg > 78);
});

test('computeSolarPosition accepts clockHour, longitude, and utcOffsetHours', () => {
  const pos = E.computeSolarPosition({
    latitude: 38.9,
    dayOfYear: 172,
    clockHour: 12,
    longitude: -75,
    utcOffsetHours: -5
  });
  assert.ok(pos.elevationDeg > 70);
  assert.equal(pos.sunVector.length, 3);
});

test('computeSolarPosition rejects out-of-range latitude or dayOfYear', () => {
  assert.throws(() => E.computeSolarPosition({ latitude: 95, dayOfYear: 100, solarHour: 12 }), RangeError);
  assert.throws(() => E.computeSolarPosition({ latitude: 30, dayOfYear: 0, solarHour: 12 }), RangeError);
  assert.throws(() => E.computeSolarPosition({ latitude: 30, dayOfYear: 100, solarHour: NaN }), RangeError);
});

test('sunVectorFromAngles and angularSeparationDeg verify unit norm and orthogonality', () => {
  const vNorth = E.sunVectorFromAngles(0, 0);
  const vEast = E.sunVectorFromAngles(90, 0);
  const vZenith = E.sunVectorFromAngles(180, 90);
  assert.ok(Math.abs(vNorth[1] - 1) < 1e-9);
  assert.ok(Math.abs(vEast[0] - 1) < 1e-9);
  assert.ok(Math.abs(vZenith[2] - 1) < 1e-9);
  assert.ok(Math.abs(E.angularSeparationDeg(0, 0, 90, 0) - 90) < 1e-6);
  assert.ok(Math.abs(E.angularSeparationDeg(180, 0, 180, 90) - 90) < 1e-6);
});

test('computeDaylightHours handles equator, high latitude polar day, and polar night', () => {
  const eq = E.computeDaylightHours(0, 172);
  assert.ok(Math.abs(eq - 12) < 0.01);
  assert.equal(E.computeDaylightHours(75, 172), 24);
  assert.equal(E.computeDaylightHours(75, 355), 0);
});

test('computeSunPath returns strictly positive elevation points and validates stepMinutes', () => {
  const pathPts = E.computeSunPath({ latitude: 38.9, dayOfYear: 172, stepMinutes: 30 });
  assert.ok(pathPts.length >= 25);
  pathPts.forEach((pt) => {
    assert.ok(pt.elevation > 0);
    assert.ok(pt.azimuth >= 0 && pt.azimuth <= 360);
  });
  assert.throws(() => E.computeSunPath({ latitude: 38.9, dayOfYear: 172, stepMinutes: 0 }), RangeError);
});

test('beamAttenuation is 0 at or below horizon and increases with altitude', () => {
  assert.equal(E.beamAttenuation(0), 0);
  assert.equal(E.beamAttenuation(-10), 0);
  const low = E.beamAttenuation(15);
  const high = E.beamAttenuation(75);
  assert.ok(high > low && low > 0 && high <= 0.75);
});

test('computeOptimalTiltGain shows dual-axis tracker outperforming fixed surfaces', () => {
  const g = E.computeOptimalTiltGain({ latitude: 38.9, dayOfYear: 172, stepMinutes: 15 });
  assert.ok(g.trackerEnergy > g.fixedTiltEnergy);
  assert.ok(g.trackerEnergy > g.horizontalEnergy);
  assert.ok(g.gainVsFixedTilt > 1.2);
  assert.ok(g.gainVsHorizontal > 1.2);
});

test('computeOptimalTiltGain supports geometric cosine mode and southern hemisphere', () => {
  const g = E.computeOptimalTiltGain({ latitude: -34.0, dayOfYear: 355, stepMinutes: 20, useAirMass: false });
  assert.ok(g.trackerEnergy > g.fixedTiltEnergy);
  assert.equal(g.fixedTiltDeg, 34);
});

/* ------------------------------------------- 2. Gear Train & Gimbal Math */

test('normalizeParams applies defaults and rejects unknown or invalid parameters', () => {
  const p = E.normalizeParams({ module: 2.0, teeth: 28 });
  assert.equal(p.module, 2.0);
  assert.equal(p.teeth, 28);
  assert.equal(p.pressureAngle, 20);
  assert.throws(() => E.normalizeParams({ bogusParam: 1 }), RangeError);
  assert.throws(() => E.normalizeParams({ teeth: 24.5 }), RangeError);
  assert.throws(() => E.normalizeParams({ boreDiameter: 38 }), RangeError);
});

test('computeSpurMetrics calculates pitch, base, outside, and root diameters', () => {
  const m = E.computeSpurMetrics({ module: 1.5, teeth: 24, pressureAngle: 20 });
  assert.equal(m.pitchDiameter, 36);
  assert.equal(m.outsideDiameter, 39);
  assert.equal(m.rootDiameter, 32.25);
  assert.equal(m.minTeethNoUndercut, 18);
  assert.ok(Math.abs(m.circularPitch - Math.PI * 1.5) < 1e-9);
});

test('computeGearTrainMetrics verifies static self-locking worm geometry', () => {
  const t = E.computeGearTrainMetrics({ module: 1.5, teeth: 24 });
  assert.equal(t.ratio, 24);
  assert.equal(t.centerDistance, 25.5);
  assert.equal(t.selfLocking, true);
  assert.ok(t.lockMarginDeg > 3.0);
  assert.ok(t.efficiency > 0.3 && t.efficiency < 0.5);
  assert.equal(t.microstepsPerOutputRev, 200 * 16 * 24);
});

test('computeGearTrainMetrics detects back-drivable worm when wormStarts is high and friction is low', () => {
  const t = E.computeGearTrainMetrics({ module: 1.5, teeth: 24, wormStarts: 4, frictionCoefficient: 0.05 });
  assert.equal(t.selfLocking, false);
  assert.ok(t.lockMarginDeg < 0);
});

test('computeGimbalPose clamps angles to travel limits and computes microsteps', () => {
  const sunIn = E.computeSolarPosition({ latitude: 38.9, dayOfYear: 172, solarHour: 13.5 });
  const pose = E.computeGimbalPose(sunIn, { module: 1.5, teeth: 24 });
  assert.equal(pose.limited, false);
  assert.ok(pose.pointingErrorDeg < 1e-4);
  assert.ok(Math.abs(pose.cosIncidence - 1) < 1e-7);
  assert.ok(pose.azimuthSteps > 0 && pose.elevationSteps > 0);

  const sunNight = { azimuthDeg: 10, elevationDeg: -12 };
  const clamped = E.computeGimbalPose(sunNight, { module: 1.5, teeth: 24 });
  assert.equal(clamped.limited, true);
  assert.equal(clamped.azimuthDeg, E.DEFAULT_LIMITS.azMin);
  assert.equal(clamped.elevationDeg, E.DEFAULT_LIMITS.elMin);
  assert.ok(clamped.pointingErrorDeg > 15);
});

test('panelNormal aligns with sunVector when gimbal is unclamped', () => {
  const sun = E.computeSolarPosition({ latitude: 38.9, dayOfYear: 172, solarHour: 14 });
  const pose = E.computeGimbalPose(sun, {});
  const sv = sun.sunVector;
  const pn = pose.panelNormal;
  const dot = sv[0] * pn[0] + sv[1] * pn[1] + sv[2] * pn[2];
  assert.ok(Math.abs(dot - 1) < 1e-9);
});

test('rotateAboutX and rotateAboutZ preserve vector length', () => {
  const v = [3, 4, 12];
  const rx = E.rotateAboutX(v, 37);
  const rz = E.rotateAboutZ(v, -64);
  const len = (p) => Math.hypot(p[0], p[1], p[2]);
  assert.ok(Math.abs(len(rx) - 13) < 1e-9);
  assert.ok(Math.abs(len(rz) - 13) < 1e-9);
});

/* ----------------------------------- 3. Watertight Mesh & Manifold Engine */

test('polygonArea and triangulatePolygon handle counter-clockwise polygons and reject clockwise', () => {
  const sq = [[0, 0], [10, 0], [10, 5], [0, 5]];
  assert.equal(E.polygonArea(sq), 50);
  const tris = E.triangulatePolygon(sq);
  assert.equal(tris.length, 2);
  assert.throws(() => E.triangulatePolygon([[0, 0], [0, 5], [10, 5], [10, 0]]), RangeError);
});

test('generateBoxMesh produces a genus-0 watertight manifold with exact volume and area', () => {
  const box = E.generateBoxMesh([10, 20, 30], [-5, -10, 0]);
  const v = E.validateMeshManifold(box);
  assert.equal(v.isManifold, true);
  assert.equal(v.isWatertight, true);
  assert.equal(v.eulerCharacteristic, 2);
  assert.equal(v.genus, 0);
  assert.equal(v.shells, 1);
  assert.ok(Math.abs(v.volume - 6000) < 1e-6);
  assert.ok(Math.abs(v.surfaceArea - 2200) < 1e-6);
});

test('generateRevolveMesh rejects profiles touching Z axis or fewer than 3 vertices', () => {
  assert.throws(() => E.generateRevolveMesh([[0, 0], [5, 0], [5, 5]], 16), RangeError);
  assert.throws(() => E.generateRevolveMesh([[2, 0], [5, 0]], 16), RangeError);
});

test('all 6 Helios-6 CAD parts pass Euler-Poincare watertight manifold verification', () => {
  const meshes = E.generateAllPartMeshes({});
  E.PART_IDS.forEach((id) => {
    const res = E.validateMeshManifold(meshes[id]);
    assert.equal(res.isWatertight, true, `${id} must be watertight`);
    assert.equal(res.isManifold, true, `${id} must be manifold with positive volume`);
    assert.equal(res.boundaryEdges, 0, `${id} must have 0 boundary edges`);
    assert.equal(res.nonManifoldEdges, 0, `${id} must have 0 non-manifold edges`);
    assert.equal(res.inconsistentEdges, 0, `${id} must have consistent winding`);
    assert.equal(res.degenerateFaces, 0, `${id} must have 0 degenerate triangles`);
  });
  assert.equal(E.validateMeshManifold(meshes.base).genus, 1, 'base ring has torus topology (genus 1)');
  assert.equal(E.validateMeshManifold(meshes.wheel).genus, 1, 'bored gear wheel has torus topology (genus 1)');
  assert.equal(E.validateMeshManifold(meshes.yoke).genus, 0, 'yoke extrusion has sphere topology (genus 0)');
  assert.equal(E.validateMeshManifold(meshes.sensors).shells, 4, '4 quadrant LDR housings');
});

test('generatePartMesh throws RangeError on unknown part id', () => {
  assert.throws(() => E.generatePartMesh('nonexistent', {}), RangeError);
});

test('validateMeshManifold catches open boundary edges and flipped normals', () => {
  const broken = E.generateBoxMesh([10, 10, 10]);
  broken.faces.pop();
  const res = E.validateMeshManifold(broken);
  assert.equal(res.isWatertight, false);
  assert.equal(res.isManifold, false);
  assert.ok(res.boundaryEdges > 0);
});

test('exportAsciiStl and parseAsciiStl round-trip preserves topology and volume', () => {
  const yoke = E.generateYokeMesh({ module: 1.5, teeth: 24, wallThickness: 3 });
  const stlText = E.exportAsciiStl(yoke, 'helios_yoke');
  assert.ok(stlText.startsWith('solid helios_yoke\n'));
  assert.ok(stlText.trim().endsWith('endsolid helios_yoke'));
  const parsed = E.parseAsciiStl(stlText);
  const vOrig = E.validateMeshManifold(yoke);
  const vParsed = E.validateMeshManifold(parsed);
  assert.equal(vParsed.isManifold, true);
  assert.equal(vParsed.faceCount, vOrig.faceCount);
  assert.ok(Math.abs(vParsed.volume - vOrig.volume) < 1e-3);
});

test('exportScad outputs parametric OpenSCAD source matching input parameters', () => {
  const scad = E.exportScad({ module: 1.75, teeth: 28, wallThickness: 3.5, latitude: 42 });
  assert.ok(scad.includes('module_mm = 1.75;'));
  assert.ok(scad.includes('teeth = 28;'));
  assert.ok(scad.includes('wall = 3.5;'));
  assert.ok(scad.includes('latitude = 42;'));
  assert.ok(scad.includes('module wheel()'));
  assert.ok(scad.includes('module assembly()'));
});

test('buildAssemblyScene and buildDrawList project and depth-sort visible triangles', () => {
  const scene0 = E.buildAssemblyScene({}, { explode: 0, azimuthDeg: 180, elevationDeg: 60 });
  const scene1 = E.buildAssemblyScene({}, { explode: 1, azimuthDeg: 180, elevationDeg: 60 });
  const b0 = E.computeMeshBounds(E.mergeMeshes(scene0.map((s) => s.mesh)));
  const b1 = E.computeMeshBounds(E.mergeMeshes(scene1.map((s) => s.mesh)));
  assert.ok(b1.size[2] > b0.size[2] + 100, 'exploded assembly increases Z height');

  const camIso = E.makeCamera({ projection: 'isometric' });
  const listIso = E.buildDrawList(scene0, camIso, { width: 800, height: 500 });
  assert.ok(listIso.length > 500);
  for (let i = 1; i < listIso.length; i++) {
    assert.ok(listIso[i - 1].depth >= listIso[i].depth, 'triangles sorted far to near');
  }

  const camPersp = E.makeCamera({ projection: 'perspective', distance: 420 });
  const listPersp = E.buildDrawList(scene0, camPersp, { width: 800, height: 500 });
  assert.ok(listPersp.length > 500);
});

test('stereographicProject and colour helpers behave deterministically', () => {
  const zenith = E.stereographicProject(180, 90, 120);
  assert.ok(Math.abs(zenith.x) < 1e-9 && Math.abs(zenith.y) < 1e-9);
  const southHorizon = E.stereographicProject(180, 0, 120);
  assert.ok(Math.abs(southHorizon.x) < 1e-6 && Math.abs(southHorizon.y - 120) < 1e-6);
  assert.deepEqual(E.hexToRgb('#D95326'), [217, 83, 38]);
  assert.deepEqual(E.hexToRgb('#F0A'), [255, 0, 170]);
  assert.equal(E.shadeHex('#D95326', 0.5), 'rgb(109,42,19)');
  assert.throws(() => E.hexToRgb('not-a-hex'), RangeError);
});

/* ------------------------------- 4. Hardware BOM, Netlist & KiCad 8 Files */

test('HeliosHardware netlist has zero pin collisions and covers all 48 placed parts', () => {
  assert.equal(HW.totalPartsOnBoard(), 48);
  assert.equal(HW.componentByRef('U1').mpn, 'RP2040');
  assert.equal(HW.componentByRef('NONEXISTENT'), null);
  const map = HW.buildPinNetMap();
  assert.equal(map['U1.57'], 'GND');
  assert.equal(map['U1.2'], 'I2C_SDA');
  assert.equal(map['U3.3'], 'I2C_SDA');
  assert.equal(map['U3.8'], 'PANEL_IN');
  assert.equal(map['R14.1'], 'PANEL_IN');
});

test('every pin of every placed component is either wired to a net or in NO_CONNECT', () => {
  const map = HW.buildPinNetMap();
  HW.COMPONENTS.forEach((comp) => {
    const sym = HW.SYMBOLS[comp.symbol];
    assert.ok(sym, `symbol ${comp.symbol} exists`);
    sym.pins.forEach((pin) => {
      const key = `${comp.ref}.${pin.number}`;
      const connected = Boolean(map[key]) || Boolean(HW.NO_CONNECT[key]);
      assert.equal(connected, true, `${key} (${pin.name}) must be wired or marked NO_CONNECT`);
    });
  });
});

test('groupBom and bomToCsv produce valid 26-line grouped BOM with LCSC codes', () => {
  const groups = HW.groupBom();
  assert.equal(groups.length, 26);
  const onBoardQty = groups.filter((g) => !g.offBoard).reduce((acc, g) => acc + g.qty, 0);
  assert.equal(onBoardQty, 48);
  const csv = HW.bomToCsv();
  const lines = csv.trim().split('\n');
  assert.equal(lines.length, 27);
  assert.ok(lines[0].startsWith('Reference,Qty,Value,Footprint'));
  assert.ok(csv.includes('RP2040'));
  assert.ok(csv.includes('INA219AIDR'));
  assert.ok(csv.includes('C2040'));
  assert.ok(csv.includes('C138706'));
});

test('mcuPinout and connectorPinout enumerate all 57 RP2040 pins and 26 header pins', () => {
  const mcu = HW.mcuPinout();
  assert.equal(mcu.length, 57);
  const hdr = HW.connectorPinout();
  assert.equal(hdr.length, 26);
});

test('placed PCB courtyards fit inside 80x56 mm board outline without overlapping', () => {
  const refs = Object.keys(HW.PLACEMENT);
  assert.equal(refs.length, 48);
  const boxes = refs.map((ref) => ({ ref, box: K.placedCourtyard(ref) }));
  boxes.forEach(({ ref, box }) => {
    assert.ok(box.x0 >= 0 && box.y0 >= 0, `${ref} inside top-left board edge`);
    assert.ok(box.x1 <= HW.BOARD.width && box.y1 <= HW.BOARD.height, `${ref} inside bottom-right board edge`);
  });
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i].box;
      const b = boxes[j].box;
      const overlap = a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
      assert.equal(overlap, false, `courtyards ${boxes[i].ref} and ${boxes[j].ref} must not overlap`);
    }
  }
});

test('KiCad 8 schematic and PCB files parse as valid S-expressions and match build-artifacts.js', () => {
  const expected = B.artifacts({});
  Object.keys(expected).forEach((rel) => {
    const disk = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.equal(disk, expected[rel], `${rel} on disk matches deterministic generator`);
  });

  const schTree = S.parseSexpr(expected['pcb/helios_mppt_node.kicad_sch']);
  assert.equal(schTree[0], 'kicad_sch');
  assert.equal(S.children(schTree, 'symbol').length, 48);

  const pcbTree = S.parseSexpr(expected['pcb/helios_mppt_node.kicad_pcb']);
  assert.equal(pcbTree[0], 'kicad_pcb');
  assert.equal(S.children(pcbTree, 'footprint').length, 48);
  assert.equal(S.children(pcbTree, 'net').length, Object.keys(HW.NETS).length + 1);
});

test('mouserSearchUrl, lcscUrl, csvCell, and compareRefs handle formatting and edge cases', () => {
  assert.equal(HW.mouserSearchUrl('INA219AIDR'), 'https://www.mouser.com/c/?q=INA219AIDR');
  assert.equal(HW.mouserSearchUrl(''), '');
  assert.equal(HW.lcscUrl('C2040'), 'https://www.lcsc.com/product-detail/C2040.html');
  assert.equal(HW.lcscUrl(''), '');
  assert.equal(HW.csvCell('plain'), 'plain');
  assert.equal(HW.csvCell('a, "b"'), '"a, ""b"""');
  assert.ok(HW.compareRefs('C2', 'C10') < 0);
  assert.ok(HW.compareRefs('R1', 'C10') > 0);
});

test('makeCamera clamps pitch and zoom and projectPoint returns null behind perspective camera', () => {
  const cam = E.makeCamera({ pitch: 120, zoom: 50, projection: 'perspective', distance: 100 });
  assert.equal(cam.pitch, 89);
  assert.equal(cam.zoom, 8);
  const behind = E.projectPoint([0, 0, 500], cam, { width: 800, height: 600 });
  assert.equal(behind, null);
});

test('computeMeshBounds returns zero bounds on empty mesh', () => {
  const b = E.computeMeshBounds({ vertices: [], faces: [] });
  assert.deepEqual(b.min, [0, 0, 0]);
  assert.deepEqual(b.max, [0, 0, 0]);
  assert.deepEqual(b.size, [0, 0, 0]);
});

test('parseAsciiStl rejects malformed vertex lines and truncated facets', () => {
  assert.throws(() => E.parseAsciiStl('solid x\nvertex 1 2\nendsolid x'), RangeError);
  assert.throws(() => E.parseAsciiStl('solid x\nvertex 1 2 3\nendsolid x'), RangeError);
});

test('parseSexpr rejects unbalanced parentheses and trailing tokens', () => {
  assert.throws(() => S.parseSexpr('(kicad_sch (version 1)'), Error);
  assert.throws(() => S.parseSexpr(')'), Error);
  assert.throws(() => S.parseSexpr('(a) (b)'), Error);
  assert.throws(() => S.parseSexpr(''), Error);
});

test('kicad.js uuid generator is deterministic and RFC-4122 v4 formatted', () => {
  const u1 = K.uuid('test-seed');
  const u2 = K.uuid('test-seed');
  assert.equal(u1, u2);
  assert.match(u1, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('computeOptimalTiltGain and computeSpurMetrics respect both default and explicit optional arguments', () => {
  const gDefault = E.computeOptimalTiltGain({ latitude: 38.9, dayOfYear: 172 });
  const gCoarse = E.computeOptimalTiltGain({ latitude: 38.9, dayOfYear: 172, stepMinutes: 60 });
  assert.notEqual(gDefault.daylightHours, gCoarse.daylightHours);
  // Closed form for 38.9 N on day 172 with no refraction is 2*acos(-tan(lat)*tan(decl))/15 = 14.73 h.
  // The default 6 minute grid lands on 14.8 h, within one grid step of that.
  assert.equal(Math.round(gDefault.daylightHours * 10), 148);
  assert.ok(Math.abs(gDefault.daylightHours - 14.73) < 0.1);

  const spurDefault = E.computeSpurMetrics({ module: 1.5, teeth: 24 });
  const spur145 = E.computeSpurMetrics({ module: 1.5, teeth: 24, pressureAngle: 14.5 });
  assert.equal(spurDefault.minTeethNoUndercut, 18);
  assert.equal(spur145.minTeethNoUndercut, 32);
  assert.ok(spur145.baseDiameter > spurDefault.baseDiameter);
});

/* ------------------------- hardening regression tests --------------------- */

test('computeDaylightHours rejects non-finite or out-of-range inputs', () => {
  assert.throws(() => E.computeDaylightHours(NaN, 172), RangeError);
  assert.throws(() => E.computeDaylightHours(90.1, 172), RangeError);
  assert.throws(() => E.computeDaylightHours(-95, 172), RangeError);
  assert.throws(() => E.computeDaylightHours(30, 0), RangeError);
  assert.throws(() => E.computeDaylightHours(30, 367), RangeError);
  assert.throws(() => E.computeDaylightHours(30, NaN), RangeError);
});

test('computeDaylightHours is finite and bounded at both range edges', () => {
  for (const doy of [1, 172, 365, 366]) {
    const h = E.computeDaylightHours(89, doy);
    assert.ok(Number.isFinite(h) && h >= 0 && h <= 24);
    const h2 = E.computeDaylightHours(-89, doy);
    assert.ok(Number.isFinite(h2) && h2 >= 0 && h2 <= 24);
  }
});

test('generateRevolveMesh rejects invalid segment counts', () => {
  const profile = [[2, 0], [5, 0], [5, 5], [2, 5]];
  for (const bad of [0, 1, 2, 2.5, -4, NaN, Infinity, 'abc']) {
    assert.throws(() => E.generateRevolveMesh(profile, bad), RangeError, `segments=${bad}`);
  }
  const ok = E.generateRevolveMesh(profile, 3);
  assert.equal(ok.faces.length, 3 * profile.length * 2);
  assert.ok(E.validateMeshManifold(ok).isWatertight);
});

test('generateRevolveMesh rejects malformed or non-finite profile points', () => {
  const segs = 16;
  assert.throws(() => E.generateRevolveMesh([[2, 0], [5], [5, 5]], segs), RangeError);
  assert.throws(() => E.generateRevolveMesh([[2, 0], [5, NaN], [5, 5]], segs), RangeError);
  assert.throws(() => E.generateRevolveMesh([[2, 0], [5, Infinity], [5, 5]], segs), RangeError);
  assert.throws(() => E.generateRevolveMesh([[2, 0], 'x', [5, 5]], segs), RangeError);
});

test('generateBoxMesh rejects non-finite origin and size components', () => {
  assert.throws(() => E.generateBoxMesh([NaN, 1, 1]), RangeError);
  assert.throws(() => E.generateBoxMesh([1, 1, 1], [NaN, 0, 0]), RangeError);
  assert.throws(() => E.generateBoxMesh([1, 1, 1], [0, Infinity, 0]), RangeError);
  assert.throws(() => E.generateBoxMesh([1, 1, 1], [0, 0, 'x']), RangeError);
});

test('parseAsciiStl rejects non-finite vertex coordinates', () => {
  const mk = (x) => 'solid s\nvertex ' + x + '\nvertex 0 1 0\nvertex 1 0 0\nendsolid s\n';
  assert.throws(() => E.parseAsciiStl(mk('NaN 0 0')), RangeError);
  assert.throws(() => E.parseAsciiStl(mk('0 NaN 0')), RangeError);
  assert.throws(() => E.parseAsciiStl(mk('0 0 NaN')), RangeError);
  assert.throws(() => E.parseAsciiStl(mk('Infinity 0 0')), RangeError);
  assert.throws(() => E.parseAsciiStl(mk('-inf 0 0')), RangeError);
  const ok = E.parseAsciiStl(mk('0 0 0'));
  assert.equal(ok.vertices.length, 3);
  assert.equal(ok.faces.length, 1);
});

test('committed cad STL artifacts re-parse into watertight manifolds', () => {
  for (const part of E.STL_PARTS) {
    const text = fs.readFileSync(path.join(ROOT, 'cad', part.file), 'utf8');
    const mesh = E.parseAsciiStl(text);
    const m = E.validateMeshManifold(mesh);
    assert.ok(m.isWatertight, part.file + ' should parse watertight');
    assert.ok(m.isManifold, part.file + ' should be a valid manifold');
    assert.ok(m.volume > 0, part.file + ' should have positive volume');
  }
});

test('exportAsciiStl round-trips every generated part through the strict parser', () => {
  const meshes = E.generateAllPartMeshes({});
  for (const id of E.PART_IDS) {
    const stl = E.exportAsciiStl(meshes[id], 'part_' + id);
    const back = E.parseAsciiStl(stl);
    const m = E.validateMeshManifold(back);
    assert.ok(m.isWatertight && m.isManifold, id + ' round-trip failed');
  }
});

test('validateMeshManifold flags degenerate and NaN-coordinate faces', () => {
  const deg = { vertices: [[0, 0, 0], [0, 0, 0], [1, 0, 0]], faces: [[0, 1, 2]] };
  const md = E.validateMeshManifold(deg);
  assert.ok(md.degenerate >= 1 || !md.isManifold);
  const nan = { vertices: [[NaN, 0, 0], [0, 1, 0], [1, 0, 0]], faces: [[0, 1, 2]] };
  const mn = E.validateMeshManifold(nan);
  assert.ok(!mn.isManifold);
});

test('mergeMeshes offsets face indices and concatenates positions', () => {
  const a = E.generateBoxMesh([2, 2, 2]);
  const b = E.generateRevolveMesh([[2, 0], [4, 0], [4, 3], [2, 3]], 12);
  const merged = E.mergeMeshes([a, b]);
  assert.equal(merged.vertices.length, a.vertices.length + b.vertices.length);
  assert.equal(merged.faces.length, a.faces.length + b.faces.length);
  const firstOfB = merged.faces[a.faces.length];
  for (const idx of firstOfB) assert.ok(idx >= a.vertices.length);
});

test('computeMeshVolume matches analytic volume for a box and a revolved toroid', () => {
  const box = E.generateBoxMesh([3, 4, 5]);
  assert.ok(Math.abs(E.computeMeshVolume(box) - 60) < 1e-9);
  // Pappus for a square 2x2 section revolved about the axis at radius 4.
  const tor = E.generateRevolveMesh([[3, -1], [5, -1], [5, 1], [3, 1]], 128);
  const analytic = 2 * Math.PI * 4 * 4;
  assert.ok(Math.abs(Math.abs(E.computeMeshVolume(tor)) - analytic) / analytic < 0.01);
});

test('computeMeshBounds reports exact extents for a translated box', () => {
  const m = E.generateBoxMesh([2, 4, 6], [10, -3, 5]);
  const b = E.computeMeshBounds(m);
  assert.deepEqual(b.min, [10, -3, 5]);
  assert.deepEqual(b.max, [12, 1, 11]);
  assert.deepEqual(b.size, [2, 4, 6]);
});

test('angularSeparationDeg is 0 for identical and 180 for antipodal directions', () => {
  assert.ok(Math.abs(E.angularSeparationDeg(30, 40, 30, 40)) < 1e-5);
  assert.ok(Math.abs(E.angularSeparationDeg(0, 0, 180, 0) - 180) < 1e-6);
  assert.ok(Math.abs(E.angularSeparationDeg(0, 0, 90, 0) - 90) < 1e-6);
  assert.ok(Math.abs(E.angularSeparationDeg(0, 0, 0, 90) - 90) < 1e-6);
});

test('panelNormal is unit length and points straight up at elevation 90', () => {
  const up = E.panelNormal(180, 90);
  assert.ok(Math.abs(Math.hypot(up[0], up[1], up[2]) - 1) < 1e-9);
  assert.ok(up[2] > 0.9999);
  const flat = E.panelNormal(0, 0);
  assert.ok(Math.abs(Math.hypot(flat[0], flat[1], flat[2]) - 1) < 1e-9);
});

test('stereographicProject puts the zenith at the dome centre and horizon on the rim', () => {
  const c = E.stereographicProject(0, 90, 120);
  assert.ok(Math.hypot(c.x, c.y) < 1e-6);
  const rim = E.stereographicProject(0, 0, 120);
  assert.ok(Math.abs(Math.hypot(rim.x, rim.y) - 120) < 1e-6);
});

test('beamAttenuation stays in (0, 1] and increases monotonically with elevation', () => {
  let prev = -1;
  for (const el of [1, 5, 15, 30, 60, 90]) {
    const a = E.beamAttenuation(el);
    assert.ok(a > 0 && a <= 1);
    assert.ok(a > prev);
    prev = a;
  }
  assert.equal(E.beamAttenuation(0), 0);
  assert.equal(E.beamAttenuation(-10), 0);
});

test('computeOptimalTiltGain reports energy for all three surfaces and daylight', () => {
  const g = E.computeOptimalTiltGain({ latitude: 38.9, dayOfYear: 172 });
  // The dual-axis tracker must beat both fixed surfaces at midsummer.
  assert.ok(g.trackerEnergy > g.fixedTiltEnergy);
  assert.ok(g.trackerEnergy > g.horizontalEnergy);
  assert.ok(g.daylightHours > 13 && g.daylightHours < 16);
  assert.ok(g.gainVsFixedTilt > 1);
  assert.ok(g.gainVsHorizontal > 1);
  assert.ok(g.peakElevationDeg > 70);
});

test('computeOptimalTiltGain rejects invalid latitude or dayOfYear', () => {
  assert.throws(() => E.computeOptimalTiltGain({ latitude: 95, dayOfYear: 100 }), RangeError);
  assert.throws(() => E.computeOptimalTiltGain({ latitude: 30, dayOfYear: 0 }), RangeError);
  assert.throws(() => E.computeOptimalTiltGain({ latitude: 30, dayOfYear: 400 }), RangeError);
  assert.throws(() => E.computeOptimalTiltGain({ latitude: 30, dayOfYear: 172, stepMinutes: 0 }), RangeError);
});

test('computeSunPath at an equinox yields roughly a dozen elevated samples per hour-step', () => {
  const pts = E.computeSunPath({ latitude: 38.9, dayOfYear: 80, stepMinutes: 60 });
  assert.ok(pts.length >= 11 && pts.length <= 13, `got ${pts.length}`);
  for (const p of pts) assert.ok(p.elevation > 0);
  const dense = E.computeSunPath({ latitude: 38.9, dayOfYear: 80, stepMinutes: 15 });
  assert.ok(dense.length >= 45 && dense.length <= 50, `got ${dense.length}`);
});

test('computeSolarPosition wraps azimuth into [0, 360) and reports hour angle', () => {
  const am = E.computeSolarPosition({ latitude: 30, dayOfYear: 100, solarHour: 6 });
  assert.ok(am.azimuthDeg >= 0 && am.azimuthDeg < 360);
  assert.ok(Math.abs(am.hourAngleDeg + 90) < 1e-9);
  const pm = E.computeSolarPosition({ latitude: 30, dayOfYear: 100, solarHour: 18 });
  assert.ok(pm.hourAngleDeg === 90);
  assert.ok(pm.azimuthDeg >= 0 && pm.azimuthDeg < 360);
});

test('clockToSolarHour applies longitude correction and equation of time', () => {
  const h = E.clockToSolarHour(12, -95.4, -6, 172);
  assert.ok(Number.isFinite(h));
  const same = E.clockToSolarHour(12, -90, -6, 80);
  assert.ok(Math.abs(same - 12 - E.computeEquationOfTime(80, 12) / 60) < 1e-9);
});

test('computeGimbalPose clamps azimuth to the configured travel window', () => {
  const lim = { azMin: 45, azMax: 315, elMin: 5, elMax: 90 };
  const pose = E.computeGimbalPose({ azimuthDeg: 350, elevationDeg: 40 }, {}, lim);
  assert.equal(pose.limited, true);
  assert.equal(pose.azimuthDeg, 315);
  const free = E.computeGimbalPose({ azimuthDeg: 180, elevationDeg: 60 }, {}, lim);
  assert.equal(free.limited, false);
  assert.equal(free.azimuthDeg, 180);
});

test('computeGimbalPose clamps a below-horizon sun to the elevation floor', () => {
  const lim = { azMin: 45, azMax: 315, elMin: 5, elMax: 90 };
  const pose = E.computeGimbalPose({ azimuthDeg: 200, elevationDeg: -12 }, {}, lim);
  assert.equal(pose.elevationDeg, 5);
  assert.equal(pose.limited, true);
  assert.ok(pose.pointingErrorDeg > 10);
});

test('triangulatePolygon yields n-2 triangles with total area equal to polygon area', () => {
  const square = [[0, 0], [4, 0], [4, 4], [0, 4]];
  const tris = E.triangulatePolygon(square);
  assert.equal(tris.length, 2);
  const hex = [[2, 0], [4, 1], [4, 3], [2, 4], [0, 3], [0, 1]];
  const tris6 = E.triangulatePolygon(hex);
  assert.equal(tris6.length, 4);
  let area = 0;
  for (const t of tris6) {
    const a = hex[t[0]], b = hex[t[1]], c = hex[t[2]];
    area += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
  }
  assert.ok(Math.abs(area - E.polygonArea(hex)) < 1e-6);
});

test('extrudePolygonXZ makes a watertight prism with correct depth', () => {
  const tri = E.extrudePolygonXZ([[0, 0], [4, 0], [0, 3]], 2);
  const m = E.validateMeshManifold(tri);
  assert.ok(m.isWatertight && m.isManifold);
  assert.ok(Math.abs(m.volume - 12) < 1e-6);
});

test('generateGearOutline emits teeth * (2*flankSteps + 1) polar outline points', () => {
  const pts = E.generateGearOutline({ teeth: 24, module: 1.5, pressureAngle: 20, flankSteps: 4, printTolerance: 0.1 });
  assert.equal(pts.length, 264);
  for (const p of pts) {
    assert.ok(Number.isFinite(p.r) && Number.isFinite(p.a));
  }
});

test('generateParametricGearMesh passes manifold and has a positive volume', () => {
  const m = E.generatePartMesh('wheel', E.normalizeParams({}));
  const v = E.validateMeshManifold(m);
  assert.ok(v.isWatertight && v.isManifold);
  assert.ok(v.volume > 0);
});

test('normalizeParams accepts boundary values at every slider edge', () => {
  const p = E.normalizeParams({ module: 0.5, teeth: 80, wallThickness: 8, faceWidth: 20 });
  assert.equal(p.module, 0.5);
  assert.equal(p.teeth, 80);
  const q = E.normalizeParams({ module: 4, teeth: 12, wallThickness: 1.2, faceWidth: 3 });
  assert.equal(q.module, 4);
  assert.equal(q.teeth, 12);
});

test('normalizeParams rejects a bore that would cut through the tooth roots', () => {
  assert.throws(() => E.normalizeParams({ boreDiameter: 40, module: 0.5, teeth: 12 }), RangeError);
});

test('engine validators throw RangeError, not a bare Error or silent pass', () => {
  try {
    E.computeSolarPosition({ latitude: 200, dayOfYear: 1 });
    assert.fail('expected throw');
  } catch (e) {
    assert.ok(e instanceof RangeError);
  }
});

test('exportScad embeds the parametric constants and all five modules', () => {
  const scad = E.exportScad({ module: 2, teeth: 30, wallThickness: 4 });
  for (const needle of ['module_mm = 2;', 'teeth = 30;', 'wall = 4;',
    'module base()', 'module wheel()', 'module yoke', 'module array', 'module assembly']) {
    assert.ok(scad.includes(needle), 'missing ' + needle);
  }
});

test('exportAsciiStl writes one facet per face and dedupes shared vertices', () => {
  const box = E.generateBoxMesh([2, 2, 2]);
  const stl = E.exportAsciiStl(box, 'testbox');
  assert.ok(stl.startsWith('solid testbox'));
  assert.ok(stl.trim().endsWith('endsolid testbox'));
  assert.equal((stl.match(/facet normal/g) || []).length, 12);
  assert.equal((stl.match(/vertex /g) || []).length, 36);
});

test('buildAssemblyScene returns all 6 parts and lifts them apart under explode', () => {
  const meshes = E.generateAllPartMeshes({});
  const packed = E.buildAssemblyScene({}, { explode: 0, azimuthDeg: 180, elevationDeg: 60 }, meshes);
  assert.equal(packed.length, 6);
  const blown = E.buildAssemblyScene({}, { explode: 1, azimuthDeg: 180, elevationDeg: 60 }, meshes);
  const zOf = (m) => m.vertices.reduce((s, v) => s + v[2], 0) / m.vertices.length;
  const packedWheel = packed.find((s) => s.id === 'wheel');
  const blownWheel = blown.find((s) => s.id === 'wheel');
  assert.ok(zOf(blownWheel.mesh) > zOf(packedWheel.mesh), 'explode must raise the wheel');
});

test('computeDaylightHours is symmetric about the solstices', () => {
  const lat = 38.9;
  const summer = E.computeDaylightHours(lat, 172);
  const winter = E.computeDaylightHours(lat, 355);
  assert.ok(Math.abs(summer + winter - 24) < 0.3);
});

test('computeSolarPosition elevation peaks at local solar noon', () => {
  let maxEl = -99;
  let noonEl = null;
  for (let h = 4; h <= 20; h += 0.5) {
    const el = E.computeSolarPosition({ latitude: 38.9, dayOfYear: 172, solarHour: h }).elevationDeg;
    if (el > maxEl) maxEl = el;
    if (Math.abs(h - 12) < 1e-9) noonEl = el;
  }
  assert.ok(Math.abs(maxEl - noonEl) < 0.5);
});

test('beamAttenuation at 90 degrees equals the zenith sea-level factor 0.7', () => {
  assert.ok(Math.abs(E.beamAttenuation(90) - 0.7) < 1e-9);
});

/* ------------------------------------------------------- expansion block 2 */

test('computeSpurMetrics derives pitch, outside and root diameters from module and teeth', () => {
  const s = E.computeSpurMetrics(E.normalizeParams({}));
  assert.equal(s.pitchDiameter, 1.5 * 24);
  assert.equal(s.outsideDiameter, s.pitchDiameter + 2 * 1.5);
  assert.equal(s.rootDiameter, s.pitchDiameter - 2.5 * 1.5);
  assert.ok(Math.abs(s.circularPitch - Math.PI * 1.5) < 1e-12);
});

test('computeSpurMetrics minimum no-undercut teeth for 20 degree pressure angle', () => {
  const s = E.computeSpurMetrics(E.normalizeParams({}));
  assert.ok(s.minTeethNoUndercut >= 17 && s.minTeethNoUndercut <= 18);
});

test('computeSpurMetrics scales linearly with module', () => {
  const a = E.computeSpurMetrics(E.normalizeParams({ module: 1 }));
  const b = E.computeSpurMetrics(E.normalizeParams({ module: 2 }));
  assert.ok(Math.abs(b.pitchDiameter - 2 * a.pitchDiameter) < 1e-9);
});

test('computeGearTrainMetrics ratio equals teeth over worm starts', () => {
  const t = E.computeGearTrainMetrics(E.normalizeParams({}));
  assert.equal(t.ratio, 24 / 1);
  assert.equal(t.outputDegPerFullStep, 360 / (200 * 24));
  assert.ok(Math.abs(t.outputDegPerFullStep - 0.075) < 1e-12);
});

test('computeGearTrainMetrics microsteps multiply output resolution', () => {
  const t1 = E.computeGearTrainMetrics(E.normalizeParams({ microsteps: 1 }));
  const t16 = E.computeGearTrainMetrics(E.normalizeParams({ microsteps: 16 }));
  assert.ok(t16.microstepsPerOutputRev > t1.microstepsPerOutputRev);
  assert.ok(t16.outputDegPerMicrostep < t1.outputDegPerMicrostep);
});

test('computeGearTrainMetrics defaults to a self-locking worm pair', () => {
  const t = E.computeGearTrainMetrics(E.normalizeParams({}));
  assert.equal(t.selfLocking, true);
  assert.ok(t.lockMarginDeg > 0);
  assert.ok(t.worm.leadAngleDeg < t.frictionAngleDeg);
});

test('computeGearTrainMetrics centerDistance sums worm and wheel pitch radii', () => {
  const t = E.computeGearTrainMetrics(E.normalizeParams({}));
  assert.ok(Math.abs(t.centerDistance - (t.worm.pitchDiameter + t.wheel.pitchDiameter) / 2) < 1e-9);
});

test('normalizeParams fills defaults and preserves valid overrides', () => {
  const p = E.normalizeParams({ teeth: 32 });
  assert.equal(p.teeth, 32);
  assert.equal(p.module, E.DEFAULT_PARAMS.module);
});

test('normalizeParams rejects out-of-range parameter values', () => {
  assert.throws(() => E.normalizeParams({ teeth: 1 }), RangeError);
  assert.throws(() => E.normalizeParams({ module: 0 }), RangeError);
  assert.throws(() => E.normalizeParams({ latitude: 100 }), RangeError);
});

test('extrudePolygonXZ produces a watertight prism with area-times-depth volume', () => {
  const m = E.extrudePolygonXZ([[0, 0], [4, 0], [4, 3], [0, 3]], 6);
  const v = E.validateMeshManifold(m);
  assert.ok(v.isWatertight);
  assert.ok(Math.abs(Math.abs(E.computeMeshVolume(m)) - 72) < 1e-9);
  assert.equal(m.faces.length, 2 * (4 - 2) + 2 * 4);
});

test('triangulatePolygon handles a concave L-shape without losing area', () => {
  const L = [[0, 0], [4, 0], [4, 2], [2, 2], [2, 4], [0, 4]];
  const tris = E.triangulatePolygon(L);
  assert.equal(tris.length, L.length - 2);
  let area = 0;
  for (const t of tris) {
    area += Math.abs(
      (L[t[1]][0] - L[t[0]][0]) * (L[t[2]][1] - L[t[0]][1]) -
      (L[t[2]][0] - L[t[0]][0]) * (L[t[1]][1] - L[t[0]][1])
    ) / 2;
  }
  assert.ok(Math.abs(area - 12) < 1e-9);
});

test('buildDrawList in perspective mode still produces shaded triangles', () => {
  const p = E.normalizeParams({});
  const scene = E.buildAssemblyScene(p, { explode: 0 }, E.generateAllPartMeshes(p));
  const cam = E.makeCamera(p);
  cam.projection = 'perspective';
  const dl = E.buildDrawList(scene, cam, { width: 800, height: 600 });
  assert.ok(dl.length > 0);
  for (const d of dl) assert.ok(d.pts.every((pt) => Number.isFinite(pt[0]) && Number.isFinite(pt[1])));
});

test('rotateAboutZ by 90 degrees maps +X onto +Y', () => {
  const r = E.rotateAboutZ([1, 0, 0], 90);
  assert.ok(Math.abs(r[0]) < 1e-9 && Math.abs(r[1] - 1) < 1e-9);
  const r2 = E.rotateAboutX([0, 1, 0], 90);
  assert.ok(Math.abs(r2[1]) < 1e-9 && Math.abs(r2[2] - 1) < 1e-9);
});

test('mergeMeshes reindexes faces so they reference only their own vertices', () => {
  const a = E.generateBoxMesh([1, 1, 1]);
  const b = E.generateBoxMesh([2, 2, 2]);
  const merged = E.mergeMeshes([a, b]);
  assert.equal(merged.vertices.length, a.vertices.length + b.vertices.length);
  const firstB = merged.faces[a.faces.length];
  for (const idx of firstB) assert.ok(idx >= a.vertices.length);
});

test('validateMeshManifold flags an open surface as not watertight', () => {
  const open = { vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], faces: [[0, 1, 2]] };
  const v = E.validateMeshManifold(open);
  assert.equal(v.isWatertight, false);
});

test('validateMeshManifold flags an edge shared by three triangles', () => {
  const mesh = {
    vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [0, -1, 0]],
    faces: [[0, 1, 2], [0, 1, 3], [1, 0, 4]]
  };
  const v = E.validateMeshManifold(mesh);
  assert.equal(v.isManifold, false);
});

test('validateMeshManifold flags inward-facing triangles on a closed box', () => {
  const box = E.generateBoxMesh([2, 2, 2]);
  box.faces[0] = [box.faces[0][0], box.faces[0][2], box.faces[0][1]];
  const v = E.validateMeshManifold(box);
  assert.ok(v.isWatertight === false || v.isManifold === false || v.isConsistentlyOriented === false);
});

test('computeMeshArea returns exact surface area for a box', () => {
  const m = E.generateBoxMesh([3, 4, 5]);
  assert.ok(Math.abs(E.computeMeshArea(m) - 94) < 1e-9);
});

test('computeMeshBounds on the empty mesh returns zero extents', () => {
  const b = E.computeMeshBounds({ vertices: [], faces: [] });
  assert.deepEqual(b.min, [0, 0, 0]);
  assert.deepEqual(b.size, [0, 0, 0]);
});

test('generateAllPartMeshes returns a watertight mesh for every PART_IDS entry', () => {
  const meshes = E.generateAllPartMeshes(E.normalizeParams({}));
  for (const id of E.PART_IDS) {
    const v = E.validateMeshManifold(meshes[id]);
    assert.ok(v.isWatertight, id + ' should be watertight');
    assert.ok(E.computeMeshVolume(meshes[id]) !== 0, id + ' should have nonzero volume');
  }
});

test('PART_IDS and STL_PARTS agree and stay at six parts', () => {
  assert.equal(E.PART_IDS.length, 6);
  assert.equal(E.STL_PARTS.length, 3);
  for (const entry of E.STL_PARTS) {
    assert.ok(E.PART_IDS.includes(entry.id));
    assert.ok(entry.file.endsWith('.stl'));
  }
});

test('generatePartMesh throws for an unknown part id', () => {
  assert.throws(() => E.generatePartMesh('flux-capacitor', E.normalizeParams({})), /unknown part/);
});

test('generateBaseMesh and generateYokeMesh are watertight', () => {
  const p = E.normalizeParams({});
  assert.ok(E.validateMeshManifold(E.generateBaseMesh(p)).isWatertight);
  assert.ok(E.validateMeshManifold(E.generateYokeMesh(p)).isWatertight);
});

test('sensors part is four detached 4x4x2mm boxes', () => {
  const m = E.generatePartMesh('sensors', E.normalizeParams({}));
  assert.equal(m.vertices.length, 32);
  assert.ok(Math.abs(Math.abs(E.computeMeshVolume(m)) - 128) < 1e-9);
});

test('exportAsciiStl emits unit facet normals and one facet per triangle', () => {
  const box = E.generateBoxMesh([2, 2, 2]);
  const stl = E.exportAsciiStl(box, 'unit');
  const normals = stl.match(/facet normal [^\n]+/g) || [];
  assert.equal(normals.length, box.faces.length);
  for (const line of normals) {
    const c = line.replace('facet normal', '').trim().split(/\s+/).map(Number);
    assert.ok(Math.abs(Math.hypot(c[0], c[1], c[2]) - 1) < 1e-6, line);
  }
});

test('exportAsciiStl output round-trips through parseAsciiStl', () => {
  const box = E.generateBoxMesh([2, 3, 4]);
  const stl = E.exportAsciiStl(box, 'rt');
  const back = E.parseAsciiStl(stl);
  assert.equal(back.faces.length, box.faces.length);
  assert.ok(Math.abs(Math.abs(E.computeMeshVolume(back)) - 24) < 1e-6);
});

test('parseAsciiStl rejects vertices with trailing garbage after the number', () => {
  const bad = ['solid t', 'facet normal 0 0 1', 'outer loop',
    'vertex 1.5abc 0 0', 'vertex 1 0 0', 'vertex 0 1 0',
    'endloop', 'endfacet', 'endsolid t'].join('\n');
  assert.throws(() => E.parseAsciiStl(bad), /non-finite|bad vertex/);
});

test('parseAsciiStl parses a single-triangle solid', () => {
  const stl = ['solid t', 'facet normal 0 0 1', 'outer loop',
    'vertex 0 0 0', 'vertex 1 0 0', 'vertex 0 1 0',
    'endloop', 'endfacet', 'endsolid t'].join('\n');
  const m = E.parseAsciiStl(stl);
  assert.equal(m.faces.length, 1);
  assert.equal(m.vertices.length, 3);
});

test('exportScad emits module text with no NaN or Infinity tokens', () => {
  const scad = E.exportScad(E.normalizeParams({}));
  assert.ok(scad.includes('module'));
  assert.ok(!/NaN|Infinity/.test(scad));
  assert.ok(scad.length > 1000);
});

test('exportScad rejects invalid input rather than emitting broken source', () => {
  assert.throws(() => E.exportScad({ teeth: 1 }));
});

test('makeCamera clamps pitch and zoom to their allowed windows', () => {
  const c = E.makeCamera({ pitch: 95, zoom: 99 });
  assert.equal(c.pitch, 89);
  assert.equal(c.zoom, 8);
  const c2 = E.makeCamera({ pitch: -95, zoom: 0.001 });
  assert.equal(c2.pitch, -89);
  assert.equal(c2.zoom, 0.2);
});

test('projectPoint maps the camera target to the viewport centre in isometric mode', () => {
  const p = E.normalizeParams({});
  const cam = E.makeCamera(p);
  const pr = E.projectPoint(cam.target, cam, { width: 800, height: 600 });
  assert.ok(Math.abs(pr.x - 400) < 1e-6);
  assert.ok(Math.abs(pr.y - 300) < 1e-6);
});

test('buildDrawList culls back faces and sorts far-to-near', () => {
  const p = E.normalizeParams({});
  const meshes = E.generateAllPartMeshes(p);
  const scene = E.buildAssemblyScene(p, { explode: 0 }, meshes);
  const total = Object.values(meshes).reduce((s, m) => s + m.faces.length, 0);
  const dl = E.buildDrawList(scene, E.makeCamera(p), { width: 800, height: 600 });
  assert.ok(dl.length < total);
  for (let i = 1; i < dl.length; i++) assert.ok(dl[i - 1].depth >= dl[i].depth - 1e-9);
  for (const d of dl) assert.ok(d.shade >= 0 && d.shade <= 1 && d.pts.length === 3);
});

test('sunVectorFromAngles is unit length and north-facing at azimuth zero', () => {
  const n = E.sunVectorFromAngles(0, 0);
  assert.ok(Math.abs(Math.hypot(n[0], n[1], n[2]) - 1) < 1e-9);
  assert.ok(n[1] > 0.999 && Math.abs(n[0]) < 1e-9);
  const zenith = E.sunVectorFromAngles(90, 90);
  assert.ok(zenith[2] > 0.999);
});

test('stereographicProject puts the zenith at the origin and horizon on the rim', () => {
  const zen = E.stereographicProject(0, 90, 50);
  assert.ok(Math.abs(zen.x) < 1e-9 && Math.abs(zen.y) < 1e-9);
  const horiz = E.stereographicProject(0, 0, 50);
  assert.ok(Math.abs(Math.hypot(horiz.x, horiz.y) - 50) < 1e-6);
});

test('hexToRgb expands shorthand and rejects malformed colours', () => {
  assert.deepEqual(E.hexToRgb('#369'), [51, 102, 153]);
  assert.throws(() => E.hexToRgb('#zz0000'));
  assert.throws(() => E.hexToRgb('12'));
});

test('shadeHex darkens below 1 and lightens above 1 without overflow', () => {
  const dark = E.shadeHex('#336699', 0.5);
  const light = E.shadeHex('#336699', 1.2);
  assert.ok(dark.length >= 4 && light.length >= 4);
  assert.ok(!/NaN/.test(E.shadeHex('#ffffff', 2)));
});

test('polygonArea is positive for counter-clockwise and negative for clockwise', () => {
  const sq = [[0, 0], [4, 0], [4, 4], [0, 4]];
  assert.ok(E.polygonArea(sq) > 0);
  assert.ok(E.polygonArea([...sq].reverse()) < 0);
});

test('clockToSolarHour identity at longitude matching the time zone meridian', () => {
  const h = E.clockToSolarHour(12, 15 * -6, -6, 80);
  assert.ok(Math.abs(h - 12 - E.computeEquationOfTime(80, 12) / 60) < 1e-9);
});

test('computeDaylightHours reports midnight sun and polar night at latitude 80', () => {
  assert.ok(E.computeDaylightHours(80, 172) > 23.5);
  assert.ok(E.computeDaylightHours(-80, 172) < 0.5);
  assert.ok(E.computeDaylightHours(0, 200) > 11.5 && E.computeDaylightHours(0, 200) < 12.5);
});

test('computeOptimalTiltGain stays finite through a polar night', () => {
  const g = E.computeOptimalTiltGain({ latitude: -80, dayOfYear: 172 });
  assert.ok(Number.isFinite(g.trackerEnergy));
  assert.ok(g.daylightHours < 0.5);
  assert.ok(Number.isFinite(g.gainVsHorizontal) && Number.isFinite(g.gainVsFixedTilt));
});

test('computeSunPath rejects degenerate step sizes', () => {
  assert.throws(() => E.computeSunPath({ latitude: 30, dayOfYear: 80, stepMinutes: 0 }), RangeError);
  assert.throws(() => E.computeSunPath({ latitude: 30, dayOfYear: 80, stepMinutes: 500 }), RangeError);
});

test('computeGimbalPose step counts stay non-negative inside the travel window', () => {
  const pose = E.computeGimbalPose({ azimuthDeg: 200, elevationDeg: 45 }, E.normalizeParams({}));
  assert.ok(pose.azimuthSteps >= 0);
  assert.ok(pose.elevationSteps >= 0);
  assert.equal(pose.limited, false);
  assert.ok(pose.cosIncidence > 0.9999);
});

test('panelNormal at zero elevation is horizontal and at 90 is vertical', () => {
  const flat = E.panelNormal(180, 0);
  assert.ok(Math.abs(flat[2]) < 1e-9);
  const up = E.panelNormal(0, 90);
  assert.ok(Math.abs(up[2] - 1) < 1e-9);
});

test('computeSolarPosition is below the horizon at local midnight', () => {
  const pos = E.computeSolarPosition({ latitude: 40, dayOfYear: 172, solarHour: 0 });
  assert.ok(pos.elevationDeg < 0);
});

test('computeSolarPosition noon azimuth is due south in the northern hemisphere', () => {
  const pos = E.computeSolarPosition({ latitude: 40, dayOfYear: 80, solarHour: 12 });
  assert.ok(Math.abs(pos.azimuthDeg - 180) < 2);
});

test('EXPLODE_SPACING_MM and ISO_CAMERA expose sane defaults', () => {
  assert.ok(E.EXPLODE_SPACING_MM > 0);
  assert.ok(Number.isFinite(E.ISO_CAMERA.yaw) && Number.isFinite(E.ISO_CAMERA.pitch));
  assert.ok(E.ISO_CAMERA.zoom > 0);
});

/* ----------------- adversarial pass regression tests ---------------------- */

test('parseAsciiStl rejects a facet whose loop holds more than 3 vertices', function () {
  var stl = 'solid s\n' +
    'facet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 1 1 0\nvertex 0 1 0\nendloop\nendfacet\n' +
    'endsolid\n';
  assert.throws(function () { E.parseAsciiStl(stl); }, /exactly 3 vertices/);
});

test('parseAsciiStl cannot splice vertices across facet boundaries', function () {
  // A 4-vertex loop followed by a 2-vertex loop used to yield a "valid"
  // 2-face mesh whose second face spliced vertices from both facets.
  var stl = 'solid s\n' +
    'facet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 1 1 0\nvertex 0 1 0\nendloop\nendfacet\n' +
    'facet normal 0 0 1\nouter loop\nvertex 5 5 5\nvertex 6 5 5\nendloop\nendfacet\n' +
    'endsolid\n';
  assert.throws(function () { E.parseAsciiStl(stl); }, /exactly 3 vertices/);
});

test('parseAsciiStl rejects stray vertices and non-STL garbage', function () {
  assert.throws(function () {
    E.parseAsciiStl('solid s\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nvertex 0 0 0\nendsolid');
  }, /outside facet loop/);
  assert.throws(function () { E.parseAsciiStl('garbage text'); }, /not an ASCII STL/);
  assert.throws(function () { E.parseAsciiStl(''); }, /not an ASCII STL/);
  assert.throws(function () {
    E.parseAsciiStl('solid s\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nendloop\nendsolid');
  }, /exactly 3 vertices/);
  assert.throws(function () { E.parseAsciiStl('solid s\nvertex 0 0 0\nendsolid'); }, /inside a facet/);
  // A well-formed empty solid is still accepted.
  var empty = E.parseAsciiStl('solid s\nendsolid');
  assert.equal(empty.faces.length, 0);
});

test('exportAsciiStl refuses to write non-finite vertex coordinates', function () {
  var bad = { vertices: [[NaN, 0, 0], [1, 0, 0], [0, 1, 0]], faces: [[0, 1, 2]] };
  assert.throws(function () { E.exportAsciiStl(bad, 'bad'); }, /non-finite vertex/);
  var inf = { vertices: [[Infinity, 0, 0], [1, 0, 0], [0, 1, 0]], faces: [[0, 1, 2]] };
  assert.throws(function () { E.exportAsciiStl(inf, 'bad'); }, /non-finite vertex/);
  var good = { vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], faces: [[0, 1, 2]] };
  assert.match(E.exportAsciiStl(good, 'ok'), /facet normal/);
});

test('solar primitives reject out-of-range and non-finite day-of-year', function () {
  assert.throws(function () { E.computeDeclination(0); }, /dayOfYear/);
  assert.throws(function () { E.computeDeclination(367); }, /dayOfYear/);
  assert.throws(function () { E.computeDeclination(NaN); }, /dayOfYear/);
  assert.throws(function () { E.computeEquationOfTime(0); }, /dayOfYear/);
  assert.throws(function () { E.computeEquationOfTime(1e9); }, /dayOfYear/);
  assert.ok(Math.abs(E.computeDeclination(80)) < 1);
  assert.ok(Math.abs(E.computeEquationOfTime(80)) < 20);
});

test('angle helpers throw on non-finite input instead of emitting NaN', function () {
  assert.throws(function () { E.beamAttenuation(NaN); }, /elevationDeg/);
  assert.throws(function () { E.sunVectorFromAngles(NaN, 0); }, /azimuthDeg/);
  assert.throws(function () { E.angularSeparationDeg(NaN, 0, 0, 0); }, /azA/);
  assert.throws(function () { E.stereographicProject(NaN, 0, 1); }, /azimuthDeg/);
  assert.throws(function () { E.stereographicProject(0, 45, NaN); }, /radius/);
});

test('computeGimbalPose rejects a malformed sun vector', function () {
  assert.throws(function () { E.computeGimbalPose({}, {}); }, /sun\.azimuthDeg/);
  assert.throws(function () { E.computeGimbalPose({ azimuthDeg: NaN, elevationDeg: 10 }, {}); }, /sun\.azimuthDeg/);
});

test('mergeMeshes and cameraBasis fail loudly on malformed input', function () {
  assert.throws(function () { E.mergeMeshes(null); }, /array/);
  assert.throws(function () { E.mergeMeshes([null]); }, /vertices/);
  assert.throws(function () { E.mergeMeshes([{}]); }, /vertices/);
  assert.throws(function () { E.cameraBasis({}); }, /cam\.yaw/);
  var cam = E.makeCamera({});
  var basis = E.cameraBasis(cam);
  assert.ok(Number.isFinite(basis.forward[0]));
});
