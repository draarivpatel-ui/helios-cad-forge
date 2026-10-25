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
  assert.equal(Math.round(gDefault.daylightHours * 10), 149);

  const spurDefault = E.computeSpurMetrics({ module: 1.5, teeth: 24 });
  const spur145 = E.computeSpurMetrics({ module: 1.5, teeth: 24, pressureAngle: 14.5 });
  assert.equal(spurDefault.minTeethNoUndercut, 18);
  assert.equal(spur145.minTeethNoUndercut, 32);
  assert.ok(spur145.baseDiameter > spurDefault.baseDiameter);
});
