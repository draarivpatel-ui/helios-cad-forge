// Renders cad/helios_gimbal.scad with the OpenSCAD WebAssembly build and
// compares volume and bounding box with the meshes from engine.js.
//
// Not part of `npm test` because it needs an extra package:
//   npm install --no-save openscad-wasm-prebuilt
//   node tools/verify-scad.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOpenSCAD } from 'openscad-wasm-prebuilt';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const E = require('../engine.js');
const scad = fs.readFileSync(path.join(here, '..', 'cad', 'helios_gimbal.scad'), 'utf8');

async function render(defines) {
  const logs = [];
  const o = await createOpenSCAD({ print: (s) => logs.push(s), printErr: (s) => logs.push(s) });
  const inst = o.getInstance();
  inst.FS.writeFile('/in.scad', scad);
  const args = ['/in.scad', '-o', '/out.stl'];
  Object.keys(defines).forEach((k) => { args.push('-D', k + '=' + defines[k]); });
  try {
    inst.callMain(args);
  } catch (e) {
    // OpenSCAD exits through an exception in the wasm runtime; the file is still written.
  }
  const text = inst.FS.readFile('/out.stl', { encoding: 'utf8' });
  return { mesh: E.parseAsciiStl(text), logs };
}

const cases = [
  { name: 'base', defines: { part: '"base"' }, parts: ['base'] },
  { name: 'wheel', defines: { part: '"wheel"' }, parts: ['wheel'] },
  { name: 'yoke (pivot_bore=0)', defines: { part: '"yoke"', pivot_bore: '0' }, parts: ['yoke'] },
  { name: 'array', defines: { part: '"array"' }, parts: ['panel', 'pcb', 'sensors'] }
];

let failed = 0;
for (const c of cases) {
  const { mesh, logs } = await render(c.defines);
  const js = E.mergeMeshes(c.parts.map((id) => E.generatePartMesh(id, {})));
  const vOpen = E.computeMeshVolume(mesh);
  const vJs = E.computeMeshVolume(js);
  const bOpen = E.computeMeshBounds(mesh);
  const bJs = E.computeMeshBounds(js);
  const volErr = Math.abs(vOpen - vJs) / vJs;
  const sizeErr = Math.max(...bOpen.size.map((s, i) => Math.abs(s - bJs.size[i])));
  const ok = volErr < 2e-3 && sizeErr < 0.05;
  if (!ok) { failed += 1; }
  console.log((ok ? 'PASS ' : 'FAIL ') + c.name + ': openscad volume ' + vOpen.toFixed(2) + ' mm3, engine volume ' +
    vJs.toFixed(2) + ' mm3, relative error ' + (volErr * 100).toFixed(4) + '%, largest bounding-box size difference ' +
    sizeErr.toFixed(4) + ' mm');
  const warn = logs.filter((l) => /WARNING|ERROR/.test(l));
  if (warn.length) { console.log('  openscad messages: ' + warn.join(' | ')); }
}

for (const pose of [{ explode: 0.5, azimuth: 200, elevation: 50 }, { explode: 0, azimuth: 90, elevation: 30 }]) {
  const full = await render({
    part: '"assembly"', explode: String(pose.explode), azimuth: String(pose.azimuth), elevation: String(pose.elevation), pivot_bore: '0'
  });
  const scene = E.buildAssemblyScene({}, { explode: pose.explode, azimuthDeg: pose.azimuth, elevationDeg: pose.elevation });
  const js = E.mergeMeshes(scene.map((s) => s.mesh));
  const bOpen = E.computeMeshBounds(full.mesh);
  const bJs = E.computeMeshBounds(js);
  const diff = Math.max(
    ...bOpen.min.map((v, i) => Math.abs(v - bJs.min[i])),
    ...bOpen.max.map((v, i) => Math.abs(v - bJs.max[i]))
  );
  const ok = diff < 0.05;
  if (!ok) { failed += 1; }
  console.log((ok ? 'PASS ' : 'FAIL ') + 'assembly pose ' + JSON.stringify(pose) + ': largest bounding-box corner difference ' +
    diff.toFixed(4) + ' mm (' + E.validateMeshManifold(full.mesh).faceCount + ' triangles from OpenSCAD)');
}
process.exit(failed ? 1 : 0);
