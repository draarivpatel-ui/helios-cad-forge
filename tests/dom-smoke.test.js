'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const E = require('../engine.js');
const HW = require('../hardware.js');
const App = require('../app.js');

const ROOT = path.join(__dirname, '..');
const htmlSource = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const cssSource = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

/**
 * Lightweight zero-dependency DOM harness that parses elements with id,
 * data-preset, data-part-filter, data-proj, data-render, and data-tab from
 * index.html and records 2D canvas drawing operations for verification.
 */
function createWorkbenchDom() {
  const elementsById = {};
  const allElements = [];
  const canvasStats = {
    fills: 0,
    strokes: 0,
    fillColors: [],
    strokeColors: [],
    texts: [],
    arcs: 0,
    dashedLines: 0
  };

  function makeClassList(initial) {
    const set = new Set((initial || '').split(/\s+/).filter(Boolean));
    return {
      add: (c) => set.add(c),
      remove: (c) => set.delete(c),
      toggle: (c, force) => {
        if (force === undefined) {
          if (set.has(c)) { set.delete(c); return false; }
          set.add(c); return true;
        }
        if (force) { set.add(c); } else { set.delete(c); }
        return Boolean(force);
      },
      contains: (c) => set.has(c)
    };
  }

  function makeElement(tag, attrs) {
    const listeners = {};
    let currentDash = [];
    const el = {
      tagName: tag.toUpperCase(),
      id: attrs.id || '',
      value: attrs.value || '',
      textContent: '',
      innerHTML: '',
      style: { width: '' },
      attrs: Object.assign({}, attrs),
      classList: makeClassList(attrs.class || ''),
      parentNode: null,
      getAttribute: (name) => (el.attrs[name] !== undefined ? el.attrs[name] : null),
      setAttribute: (name, val) => { el.attrs[name] = String(val); },
      addEventListener: (type, fn) => {
        if (!listeners[type]) { listeners[type] = []; }
        listeners[type].push(fn);
      },
      dispatchEvent: (type, evObj) => {
        const list = listeners[type] || [];
        list.forEach((fn) => fn(Object.assign({ target: el, preventDefault: () => {} }, evObj)));
      },
      click: () => el.dispatchEvent('click', {})
    };

    if (el.id === 'cad-viewport') {
      el.width = 760;
      el.height = 490;
      el.getBoundingClientRect = () => ({ width: 760, height: 490 });
      el.getContext = (kind) => {
        if (kind !== '2d') { return null; }
        const ctx = {
          fillStyle: '#000',
          strokeStyle: '#000',
          lineWidth: 1,
          font: '',
          save: () => {},
          restore: () => { currentDash = []; },
          scale: () => {},
          fillRect: () => {},
          beginPath: () => {},
          moveTo: () => {},
          lineTo: () => {},
          closePath: () => {},
          setLineDash: (d) => {
            currentDash = d || [];
            if (currentDash.length > 0) { canvasStats.dashedLines += 1; }
          },
          fill: () => {
            canvasStats.fills += 1;
            canvasStats.fillColors.push(ctx.fillStyle);
          },
          stroke: () => {
            canvasStats.strokes += 1;
            canvasStats.strokeColors.push(ctx.strokeStyle);
          },
          arc: () => { canvasStats.arcs += 1; },
          fillText: (t) => { canvasStats.texts.push(t); }
        };
        return ctx;
      };
    }

    if (el.id) {
      elementsById[el.id] = el;
    }
    allElements.push(el);
    return el;
  }

  const tagRegex = /<([a-zA-Z0-9]+)\s+([^>]+)>/g;
  let m;
  while ((m = tagRegex.exec(htmlSource)) !== null) {
    const tag = m[1];
    const attrStr = m[2];
    const attrs = {};
    const attrRegex = /([a-zA-Z0-9_-]+)="([^"]*)"/g;
    let am;
    while ((am = attrRegex.exec(attrStr)) !== null) {
      attrs[am[1]] = am[2];
    }
    if (attrs.id || attrs['data-preset'] || attrs['data-part-filter'] ||
        attrs['data-proj'] || attrs['data-render'] || attrs['data-tab']) {
      makeElement(tag, attrs);
    }
  }

  const doc = {
    getElementById: (id) => elementsById[id] || null,
    querySelectorAll: (selector) => {
      const attrMatch = /^\[([a-zA-Z0-9_-]+)\]$/.exec(selector);
      if (attrMatch) {
        const key = attrMatch[1];
        return allElements.filter((el) => el.attrs[key] !== undefined);
      }
      return [];
    },
    createElement: (tag) => makeElement(tag, {}),
    body: {
      appendChild: () => {},
      removeChild: () => {}
    }
  };

  return { doc, elementsById, allElements, canvasStats };
}

/* ------------------------------------------- 1. HTML & CSS Structural Tests */

test('index.html has valid DOCTYPE, title, and links styles.css, engine.js, hardware.js, app.js', () => {
  assert.ok(htmlSource.startsWith('<!DOCTYPE html>'));
  assert.ok(htmlSource.includes('<title>Helios-6 Parametric Solar Tracker &amp; KiCad Telemetry Node</title>'));
  assert.ok(htmlSource.includes('href="styles.css"'));
  assert.ok(htmlSource.includes('src="engine.js"'));
  assert.ok(htmlSource.includes('src="hardware.js"'));
  assert.ok(htmlSource.includes('src="app.js"'));
});

test('styles.css locks Dieter Rams / Mitutoyo drafting vellum light mode palette tokens', () => {
  assert.ok(cssSource.includes('--bg-vellum: #F5F3EC'));
  assert.ok(cssSource.includes('--bg-panel: #EAE6DA'));
  assert.ok(cssSource.includes('--ink-primary: #141618'));
  assert.ok(cssSource.includes('--accent-orange: #D95326'));
  assert.ok(cssSource.includes('--accent-green: #1B6B53'));
  assert.ok(cssSource.includes('tabular-nums'));
});

test('index.html includes all 7 parametric sliders and associated <output> readouts', () => {
  const sliders = [
    'slider-explode',
    'slider-module',
    'slider-teeth',
    'slider-wall',
    'slider-latitude',
    'slider-day',
    'slider-hour'
  ];
  sliders.forEach((id) => {
    assert.ok(htmlSource.includes(`id="${id}"`), `missing slider ${id}`);
  });
  const outputs = [
    'out-explode',
    'out-module',
    'out-teeth',
    'out-wall',
    'out-latitude',
    'out-day',
    'out-hour'
  ];
  outputs.forEach((id) => {
    assert.ok(htmlSource.includes(`id="${id}"`), `missing output ${id}`);
  });
});

test('every slider range in index.html produces valid manifold geometry in engine.js', () => {
  for (const mod of [1.0, 1.5, 2.0, 2.5]) {
    for (const teeth of [14, 20, 24, 30]) {
      for (const wall of [1.5, 3.0, 6.0]) {
        const meshes = E.generateAllPartMeshes({ module: mod, teeth, wallThickness: wall });
        assert.equal(E.validateMeshManifold(meshes.wheel).isManifold, true);
        assert.equal(E.validateMeshManifold(meshes.base).isManifold, true);
        assert.equal(E.validateMeshManifold(meshes.yoke).isManifold, true);
      }
    }
  }
});

test('index.html includes one-click download buttons and links for .SCAD, .STL, .kicad_sch, .kicad_pcb, and BOM .CSV', () => {
  assert.ok(htmlSource.includes('id="btn-dl-scad"'));
  assert.ok(htmlSource.includes('id="btn-dl-stl-gear"'));
  assert.ok(htmlSource.includes('id="btn-dl-stl-base"'));
  assert.ok(htmlSource.includes('id="btn-dl-stl-yoke"'));
  assert.ok(htmlSource.includes('href="pcb/helios_mppt_node.kicad_sch"'));
  assert.ok(htmlSource.includes('href="pcb/helios_mppt_node.kicad_pcb"'));
  assert.ok(htmlSource.includes('id="btn-dl-bom"'));
});

test('index.html includes 3D CAD canvas, stereographic sun-path SVG, and 2-layer PCB SVG', () => {
  assert.ok(htmlSource.includes('id="cad-viewport"'));
  assert.ok(htmlSource.includes('id="sunpath-svg"'));
  assert.ok(htmlSource.includes('id="pcb-svg"'));
  assert.ok(htmlSource.includes('id="bom-tbody"'));
  assert.ok(htmlSource.includes('id="pinout-tbody"'));
  assert.ok(htmlSource.includes('id="scad-code-view"'));
});

/* ------------------------------------------- 2. App Helper Unit Tests */

test('dayOfYearToLabel formats month and day accurately across all 12 months', () => {
  assert.equal(App.dayOfYearToLabel(1), 'Day 1 (Jan 1)');
  assert.equal(App.dayOfYearToLabel(31), 'Day 31 (Jan 31)');
  assert.equal(App.dayOfYearToLabel(32), 'Day 32 (Feb 1)');
  assert.equal(App.dayOfYearToLabel(59), 'Day 59 (Feb 28)');
  assert.equal(App.dayOfYearToLabel(60), 'Day 60 (Mar 1)');
  assert.equal(App.dayOfYearToLabel(80), 'Day 80 (Mar 21)');
  assert.equal(App.dayOfYearToLabel(91), 'Day 91 (Apr 1)');
  assert.equal(App.dayOfYearToLabel(121), 'Day 121 (May 1)');
  assert.equal(App.dayOfYearToLabel(172), 'Day 172 (Jun 21)');
  assert.equal(App.dayOfYearToLabel(182), 'Day 182 (Jul 1)');
  assert.equal(App.dayOfYearToLabel(213), 'Day 213 (Aug 1)');
  assert.equal(App.dayOfYearToLabel(244), 'Day 244 (Sep 1)');
  assert.equal(App.dayOfYearToLabel(274), 'Day 274 (Oct 1)');
  assert.equal(App.dayOfYearToLabel(305), 'Day 305 (Nov 1)');
  assert.equal(App.dayOfYearToLabel(355), 'Day 355 (Dec 21)');
  assert.equal(App.dayOfYearToLabel(365), 'Day 365 (Dec 31)');
});

test('solarHourToClockLabel formats fractional hours with zero-padded HH:MM', () => {
  assert.equal(App.solarHourToClockLabel(5.0), '05:00 (5.00 h)');
  assert.equal(App.solarHourToClockLabel(9.25), '09:15 (9.25 h)');
  assert.equal(App.solarHourToClockLabel(13.5), '13:30 (13.50 h)');
  assert.equal(App.solarHourToClockLabel(18.75), '18:45 (18.75 h)');
});

test('initWorkbench returns null when missing required arguments', () => {
  assert.equal(App.initWorkbench(null, E, HW), null);
  assert.equal(App.initWorkbench({}, null, HW), null);
  assert.equal(App.initWorkbench({}, E, null), null);
});

test('PART_COLORS and PRESETS export all 6 part colours and 4 presets', () => {
  assert.equal(Object.keys(App.PART_COLORS).length, 6);
  assert.equal(Object.keys(App.PRESETS).length, 4);
  assert.equal(App.PART_COLORS.wheel, '#D95326');
  assert.equal(App.PART_COLORS.pcb, '#1B6B53');
});

/* ----------------------------------- 3. Interactive Workbench DOM Tests */

test('initWorkbench populates default readouts, 3D canvas, sun-path SVG, PCB SVG, and BOM table', () => {
  const { doc, elementsById, canvasStats } = createWorkbenchDom();
  const wb = App.initWorkbench(doc, E, HW);
  assert.ok(wb);
  assert.equal(elementsById['out-module'].textContent, '1.50 mm');
  assert.equal(elementsById['out-teeth'].textContent, '24 teeth');
  assert.equal(elementsById['out-wall'].textContent, '3.00 mm');
  assert.equal(elementsById['out-latitude'].textContent, '38.9 deg N');
  assert.equal(elementsById['out-day'].textContent, 'Day 172 (Jun 21)');
  assert.equal(elementsById['out-hour'].textContent, '13:30 (13.50 h)');
  assert.equal(elementsById['manifold-badge-text'].textContent, 'Manifold: 6/6 Watertight');
  assert.ok(canvasStats.fills > 500, 'canvas rendered shaded triangles');
  assert.ok(canvasStats.strokes > 500, 'canvas rendered hybrid wireframe edges');
  assert.ok(elementsById['sunpath-svg'].innerHTML.includes('<path d="M'));
  assert.ok(elementsById['pcb-svg'].innerHTML.includes('data-ref="U1"'));
  assert.ok(elementsById['bom-tbody'].innerHTML.includes('RP2040'));
  assert.ok(elementsById['pinout-tbody'].innerHTML.includes('U1.57'));
  assert.ok(elementsById['scad-code-view'].textContent.includes('module_mm = 1.5;'));
});

test('adjusting parametric gear sliders updates pitch diameter, ratio, and OpenSCAD code', () => {
  const { doc, elementsById } = createWorkbenchDom();
  App.initWorkbench(doc, E, HW);

  elementsById['slider-module'].value = '2.0';
  elementsById['slider-module'].dispatchEvent('input', {});
  assert.equal(elementsById['out-module'].textContent, '2.00 mm');
  assert.ok(elementsById['met-pitch-od'].textContent.startsWith('48.00 / 52.00 mm'));

  elementsById['slider-teeth'].value = '30';
  elementsById['slider-teeth'].dispatchEvent('input', {});
  assert.equal(elementsById['out-teeth'].textContent, '30 teeth');
  assert.ok(elementsById['banner-ratio'].textContent.startsWith('30:1'));
  assert.ok(elementsById['scad-code-view'].textContent.includes('teeth = 30;'));

  elementsById['slider-wall'].value = '4.5';
  elementsById['slider-wall'].dispatchEvent('input', {});
  assert.equal(elementsById['out-wall'].textContent, '4.50 mm');
  assert.ok(elementsById['scad-code-view'].textContent.includes('wall = 4.5;'));
});

test('adjusting solar ephemeris sliders updates southern hemisphere label, declination, and pose', () => {
  const { doc, elementsById } = createWorkbenchDom();
  App.initWorkbench(doc, E, HW);

  elementsById['slider-latitude'].value = '-33.9';
  elementsById['slider-latitude'].dispatchEvent('input', {});
  assert.equal(elementsById['out-latitude'].textContent, '33.9 deg S');

  elementsById['slider-day'].value = '355';
  elementsById['slider-day'].dispatchEvent('input', {});
  assert.equal(elementsById['out-day'].textContent, 'Day 355 (Dec 21)');
  assert.ok(elementsById['sky-declination-badge'].textContent.includes('-23.4'));

  elementsById['slider-hour'].value = '10.0';
  elementsById['slider-hour'].dispatchEvent('input', {});
  assert.equal(elementsById['out-hour'].textContent, '10:00 (10.00 h)');
});

test('exploded assembly slider updates stage offset and draws centerline only when explode > 0', () => {
  const { doc, elementsById, canvasStats } = createWorkbenchDom();
  App.initWorkbench(doc, E, HW);

  elementsById['slider-explode'].value = '0';
  canvasStats.dashedLines = 0;
  elementsById['slider-explode'].dispatchEvent('input', {});
  assert.equal(elementsById['out-explode'].textContent, '0%');
  const dashesAtZero = canvasStats.dashedLines;

  elementsById['slider-explode'].value = '0.8';
  canvasStats.dashedLines = 0;
  elementsById['slider-explode'].dispatchEvent('input', {});
  assert.equal(elementsById['out-explode'].textContent, '80%');
  assert.equal(elementsById['explode-mm-label'].textContent, '36.0 mm / stage');
  assert.equal(canvasStats.dashedLines, dashesAtZero + 1, 'exploded datum line adds 1 dashed line');
});

test('part filter buttons isolate individual CAD parts and array subassembly', () => {
  const { doc, allElements, canvasStats } = createWorkbenchDom();
  App.initWorkbench(doc, E, HW);

  const filterButtons = allElements.filter((el) => el.attrs['data-part-filter']);
  assert.equal(filterButtons.length, 5);

  const fullFills = canvasStats.fills;
  const yokeBtn = filterButtons.find((b) => b.attrs['data-part-filter'] === 'yoke');
  canvasStats.fills = 0;
  yokeBtn.click();
  const yokeFills = canvasStats.fills;
  assert.ok(yokeFills > 5 && yokeFills < 40, 'yoke filter renders only yoke triangles');
  assert.ok(yokeFills < fullFills);

  const arrayBtn = filterButtons.find((b) => b.attrs['data-part-filter'] === 'array');
  canvasStats.fills = 0;
  arrayBtn.click();
  const arrayFills = canvasStats.fills;
  assert.ok(arrayFills > yokeFills && arrayFills < 80, 'array filter renders panel + pcb + 4 sensors');

  const baseBtn = filterButtons.find((b) => b.attrs['data-part-filter'] === 'base');
  canvasStats.fills = 0;
  baseBtn.click();
  assert.ok(canvasStats.fills > 200, 'base filter renders revolved base mesh');

  const wheelBtn = filterButtons.find((b) => b.attrs['data-part-filter'] === 'wheel');
  canvasStats.fills = 0;
  wheelBtn.click();
  assert.ok(canvasStats.fills > 400, 'wheel filter renders involute worm gear mesh');
});

test('render mode buttons switch between hybrid, wireframe, and solid shading', () => {
  const { doc, elementsById, canvasStats } = createWorkbenchDom();
  App.initWorkbench(doc, E, HW);

  canvasStats.fills = 0;
  canvasStats.strokes = 0;
  elementsById['btn-render-wire'].click();
  assert.equal(canvasStats.fills, 1, 'wireframe mode only fills the sun ray marker dot');
  assert.ok(canvasStats.strokes > 500, 'wireframe mode strokes every visible triangle');

  canvasStats.fills = 0;
  canvasStats.strokes = 0;
  elementsById['btn-render-solid'].click();
  assert.ok(canvasStats.fills > 500, 'solid mode fills every visible triangle');
  assert.ok(canvasStats.strokes < 50, 'solid mode skips triangle edge wireframe strokes');

  canvasStats.fills = 0;
  canvasStats.strokes = 0;
  elementsById['btn-render-hybrid'].click();
  assert.ok(canvasStats.fills > 500 && canvasStats.strokes > 500);
});

test('projection and camera preset buttons update camera state and HUD readout', () => {
  const { doc, elementsById } = createWorkbenchDom();
  const wb = App.initWorkbench(doc, E, HW);

  elementsById['btn-proj-persp'].click();
  assert.equal(wb.state.camera.projection, 'perspective');

  elementsById['btn-proj-iso'].click();
  assert.equal(wb.state.camera.projection, 'isometric');

  elementsById['btn-cam-top'].click();
  assert.equal(wb.state.camera.pitch, 88);
  assert.ok(elementsById['hud-camera'].textContent.includes('Pitch 88 deg'));

  elementsById['btn-cam-front'].click();
  assert.equal(wb.state.camera.pitch, 8);

  const zBefore = wb.state.camera.zoom;
  elementsById['btn-cam-zoom-in'].click();
  assert.ok(wb.state.camera.zoom > zBefore);
  elementsById['btn-cam-zoom-out'].click();
  assert.ok(Math.abs(wb.state.camera.zoom - zBefore) < 1e-6);

  elementsById['btn-cam-iso'].click();
  assert.equal(wb.state.camera.yaw, 42);
  assert.equal(wb.state.camera.pitch, 32);
});

test('canvas pointer drag and wheel events orbit and zoom camera', () => {
  const { doc, elementsById } = createWorkbenchDom();
  const wb = App.initWorkbench(doc, E, HW);

  const canvas = elementsById['cad-viewport'];
  const yaw0 = wb.state.camera.yaw;
  canvas.dispatchEvent('pointerdown', { clientX: 100, clientY: 100, pointerId: 1 });
  canvas.dispatchEvent('pointermove', { clientX: 140, clientY: 120 });
  canvas.dispatchEvent('pointerup', {});
  assert.notEqual(wb.state.camera.yaw, yaw0);

  const zoom0 = wb.state.camera.zoom;
  canvas.dispatchEvent('wheel', { deltaY: -100 });
  assert.ok(wb.state.camera.zoom > zoom0);
});

test('preset buttons and Reset Defaults apply expected configurations', () => {
  const { doc, elementsById, allElements } = createWorkbenchDom();
  const wb = App.initWorkbench(doc, E, HW);

  const presetBtns = allElements.filter((el) => el.attrs['data-preset']);
  const heavyBtn = presetBtns.find((b) => b.attrs['data-preset'] === 'heavy-gear');
  heavyBtn.click();
  assert.equal(wb.state.module, 2.0);
  assert.equal(wb.state.teeth, 30);

  const nordicBtn = presetBtns.find((b) => b.attrs['data-preset'] === 'nordic-summer');
  nordicBtn.click();
  assert.equal(wb.state.latitude, 65.0);
  assert.equal(wb.state.teeth, 28);

  const eqBtn = presetBtns.find((b) => b.attrs['data-preset'] === 'equinox-noon');
  eqBtn.click();
  assert.equal(wb.state.latitude, 0.0);
  assert.equal(wb.state.dayOfYear, 80);

  elementsById['btn-reset-params'].click();
  assert.equal(wb.state.module, 1.5);
  assert.equal(wb.state.teeth, 24);
});

test('inspector search input filters BOM and pinout rows accurately', () => {
  const { doc, elementsById } = createWorkbenchDom();
  App.initWorkbench(doc, E, HW);

  elementsById['inspector-search'].value = 'INA219';
  elementsById['inspector-search'].dispatchEvent('input', {});
  assert.ok(elementsById['bom-tbody'].innerHTML.includes('INA219AIDR'));
  assert.ok(!elementsById['bom-tbody'].innerHTML.includes('W25Q16JV'));

  elementsById['inspector-search'].value = 'STEP_AZ';
  elementsById['inspector-search'].dispatchEvent('input', {});
  assert.ok(elementsById['pinout-tbody'].innerHTML.includes('STEP_AZ'));
  assert.ok(!elementsById['pinout-tbody'].innerHTML.includes('USB_DP'));
});

test('inspector tab buttons switch visibility between BOM, Pinout, and OpenSCAD panels', () => {
  const { doc, elementsById } = createWorkbenchDom();
  App.initWorkbench(doc, E, HW);

  elementsById['tab-btn-pinout'].click();
  assert.equal(elementsById['tab-panel-pinout'].classList.contains('hidden'), false);
  assert.equal(elementsById['tab-panel-bom'].classList.contains('hidden'), true);

  elementsById['tab-btn-scad'].click();
  assert.equal(elementsById['tab-panel-scad'].classList.contains('hidden'), false);
  assert.equal(elementsById['tab-panel-pinout'].classList.contains('hidden'), true);

  elementsById['tab-btn-bom'].click();
  assert.equal(elementsById['tab-panel-bom'].classList.contains('hidden'), false);
});

test('clicking a PCB footprint or sunpath hour tick updates state and inspector readouts', () => {
  const { doc, elementsById } = createWorkbenchDom();
  const wb = App.initWorkbench(doc, E, HW);

  const fakeFpTarget = {
    getAttribute: (name) => (name === 'data-ref' ? 'U3' : null),
    parentNode: elementsById['pcb-svg']
  };
  elementsById['pcb-svg'].dispatchEvent('click', { target: fakeFpTarget });
  assert.equal(wb.state.selectedPcbRef, 'U3');
  assert.ok(elementsById['pcb-sel-title'].textContent.includes('INA219AIDR'));

  const fakeHourTarget = {
    getAttribute: (name) => (name === 'data-hour' ? '10' : null),
    parentNode: elementsById['sunpath-svg']
  };
  elementsById['sunpath-svg'].dispatchEvent('click', { target: fakeHourTarget });
  assert.equal(wb.state.solarHour, 10);
});

test('Sweep Day button toggles play state cleanly', () => {
  const { doc, elementsById } = createWorkbenchDom();
  const wb = App.initWorkbench(doc, E, HW);

  elementsById['btn-play-sun'].click();
  assert.equal(wb.state.playingSun, true);
  assert.equal(elementsById['btn-play-sun'].textContent, 'Pause Sweep');

  elementsById['btn-play-sun'].click();
  assert.equal(wb.state.playingSun, false);
  assert.equal(elementsById['btn-play-sun'].textContent, 'Sweep Day');
});

/* ------------------------------------------- 4. Anti-Slop & Hygiene Gate */

test('repository source files contain zero em-dashes or en-dashes', () => {
  const files = ['index.html', 'styles.css', 'app.js', 'engine.js', 'hardware.js'];
  files.forEach((rel) => {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.equal(text.includes('\u2014'), false, `${rel} must not contain em-dash`);
    assert.equal(text.includes('\u2013'), false, `${rel} must not contain en-dash`);
  });
});

test('package.json has zero runtime dependencies and no devDependencies', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.deepEqual(pkg.dependencies, {});
  assert.equal(pkg.devDependencies, undefined);
});
