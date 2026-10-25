'use strict';
/**
 * Regenerates every committed hardware artifact from engine.js and
 * hardware.js: STL meshes, the OpenSCAD source, the KiCad files and the BOM.
 * Usage: node tools/build-artifacts.js
 * The tests re-run these generators and compare against the committed files,
 * so a stale artifact fails the suite.
 */
const fs = require('node:fs');
const path = require('node:path');
const E = require('../engine.js');
const HW = require('../hardware.js');
const K = require('./kicad.js');

const ROOT = path.join(__dirname, '..');

function artifacts(params) {
  const files = {};
  E.STL_PARTS.forEach((part) => {
    files['cad/' + part.file] = E.exportAsciiStl(E.generatePartMesh(part.id, params), part.solid);
  });
  files['cad/helios_gimbal.scad'] = E.exportScad(params);
  files['pcb/' + K.PROJECT + '.kicad_sch'] = K.generateSchematic();
  files['pcb/' + K.PROJECT + '.kicad_pcb'] = K.generatePcb();
  files['pcb/' + K.PROJECT + '.kicad_pro'] = K.generateProject();
  files['bom/bom.csv'] = HW.bomToCsv();
  return files;
}

function main() {
  const files = artifacts({});
  Object.keys(files).forEach((rel) => {
    const full = path.join(ROOT, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, files[rel]);
    process.stdout.write('wrote ' + rel + ' (' + files[rel].length + ' bytes)\n');
  });
}

if (require.main === module) {
  main();
}

module.exports = { artifacts };
