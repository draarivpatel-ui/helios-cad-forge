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

test('Copy .SCAD reports a refused clipboard write instead of throwing or claiming success', async () => {
  const { doc, elementsById } = createWorkbenchDom();
  App.initWorkbench(doc, E, HW);
  const btn = elementsById['btn-copy-scad'];
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const restore = () => { if (saved) Object.defineProperty(globalThis, 'navigator', saved); else delete globalThis.navigator; };
  try {
    let written = null;
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: (t) => { written = t; return Promise.resolve(); } } } });
    btn.click();
    await new Promise((r) => setImmediate(r));
    assert.ok(written && written.includes('module_mm'), 'the SCAD source was written');
    assert.equal(btn.textContent, 'Copied .SCAD');
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: () => Promise.reject(new Error('denied')) } } });
    btn.click();
    await new Promise((r) => setImmediate(r));
    assert.equal(btn.textContent, 'Copy blocked, use the download button');
  } finally {
    restore();
  }
});

/* --------------------------- 5. Keyboard & WCAG contracts ----------------- */

test('sunpath hour ticks are keyboard-focusable buttons with labels', () => {
  const { doc, elementsById } = createWorkbenchDom();
  App.initWorkbench(doc, E, HW);
  const markup = elementsById['sunpath-svg'].innerHTML;
  const ticks = markup.match(/class="sun-hour-tick"/g) || [];
  assert.ok(ticks.length > 0);
  const groups = markup.split('<g class="sun-hour-tick"').slice(1);
  for (const g of groups) {
    const head = g.slice(0, g.indexOf('>'));
    assert.ok(head.includes('tabindex="0"'), 'hour tick missing tabindex');
    assert.ok(head.includes('role="button"'), 'hour tick missing role');
    assert.ok(head.includes('aria-label="Set solar hour'), 'hour tick missing aria-label');
  }
});

test('Enter and Space on a sunpath tick set the solar hour', () => {
  const { doc, elementsById } = createWorkbenchDom();
  const wb = App.initWorkbench(doc, E, HW);
  const tick = { getAttribute: (n) => (n === 'data-hour' ? '14' : null) };
  elementsById['sunpath-svg'].dispatchEvent('keydown', { key: 'Enter', target: tick });
  assert.equal(wb.state.solarHour, 14);
  const tick2 = { getAttribute: (n) => (n === 'data-hour' ? '9' : null) };
  elementsById['sunpath-svg'].dispatchEvent('keydown', { key: ' ', target: tick2 });
  assert.equal(wb.state.solarHour, 9);
  const tick3 = { getAttribute: (n) => (n === 'data-hour' ? '7' : null) };
  elementsById['sunpath-svg'].dispatchEvent('keydown', { key: 'x', target: tick3 });
  assert.equal(wb.state.solarHour, 9, 'non-activation keys must not fire');
});

test('PCB footprints are keyboard-focusable buttons and Enter selects them', () => {
  const { doc, elementsById } = createWorkbenchDom();
  const wb = App.initWorkbench(doc, E, HW);
  const markup = elementsById['pcb-svg'].innerHTML;
  const groups = markup.split('<g class="pcb-fp"').slice(1);
  assert.ok(groups.length >= 40);
  for (const g of groups) {
    const head = g.slice(0, g.indexOf('>'));
    assert.ok(head.includes('tabindex="0"'), 'footprint missing tabindex');
    assert.ok(head.includes('role="button"'), 'footprint missing role');
    assert.ok(head.includes('aria-label="Select component'), 'footprint missing aria-label');
  }
  const fp = { getAttribute: (n) => (n === 'data-ref' ? 'U2' : null) };
  elementsById['pcb-svg'].dispatchEvent('keydown', { key: 'Enter', target: fp });
  assert.equal(wb.state.selectedPcbRef, 'U2');
});

test('canvas arrow keys orbit the camera and plus/minus keys zoom', () => {
  const { doc, elementsById } = createWorkbenchDom();
  const wb = App.initWorkbench(doc, E, HW);
  const canvas = elementsById['cad-viewport'];
  const yaw0 = wb.state.camera.yaw;
  canvas.dispatchEvent('keydown', { key: 'ArrowLeft' });
  assert.equal(wb.state.camera.yaw, (yaw0 + 6) % 360);
  canvas.dispatchEvent('keydown', { key: 'ArrowRight' });
  assert.equal(wb.state.camera.yaw, yaw0);
  const pitch0 = wb.state.camera.pitch;
  canvas.dispatchEvent('keydown', { key: 'ArrowUp' });
  assert.equal(wb.state.camera.pitch, Math.max(-85, Math.min(85, pitch0 - 4)));
  const zoom0 = wb.state.camera.zoom;
  canvas.dispatchEvent('keydown', { key: '+' });
  assert.ok(wb.state.camera.zoom > zoom0);
  canvas.dispatchEvent('keydown', { key: '-' });
  assert.ok(wb.state.camera.zoom < zoom0 * 1.08, 'minus key zooms back out');
  canvas.dispatchEvent('keydown', { key: 'x' });
  const zoomX = wb.state.camera.zoom;
  canvas.dispatchEvent('keydown', { key: 'x' });
  assert.equal(wb.state.camera.zoom, zoomX, 'unbound keys ignored');
});

test('hud-manifold-detail reports live validator counts and status', () => {
  const { doc, elementsById } = createWorkbenchDom();
  App.initWorkbench(doc, E, HW);
  const text = elementsById['hud-manifold-detail'].textContent;
  assert.match(text, /^V=\d+ E=\d+ F=\d+ \(6\/6 Closed Manifold\)$/);
});

test('hud-manifold-detail has a real failure branch in source, not a hardcoded claim', () => {
  const src = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  assert.ok(src.includes('manifold check failed'), 'no failure branch for the HUD manifold line');
  assert.ok(src.includes('mf.allWatertight ?'), 'HUD text must derive from the validator result');
});

test('index.html declares a restrictive Content-Security-Policy meta', () => {
  const m = htmlSource.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/);
  assert.ok(m, 'CSP meta missing');
  const csp = m[1];
  for (const d of ["default-src 'self'", "script-src 'self'", "object-src 'none'", "base-uri 'none'"]) {
    assert.ok(csp.includes(d), 'CSP missing directive ' + d);
  }
});

test('index.html has no inline event handlers or javascript: URLs', () => {
  assert.equal(/\son(click|input|change|keydown|keyup|load|error|submit)=/i.test(htmlSource), false);
  assert.equal(/javascript:/i.test(htmlSource), false);
});

test('canvas, skip link and focus-visible styles satisfy WCAG 2.4.7 and 2.1.1', () => {
  assert.ok(/<canvas[^>]+tabindex="0"/.test(htmlSource), 'canvas must be focusable');
  assert.ok(htmlSource.includes('aria-label="Interactive 3D CAD viewport'));
  assert.ok(htmlSource.includes('class="skip-link"'));
  assert.ok(htmlSource.includes('id="main-workbench"'), 'skip-link target must exist');
  assert.ok(cssSource.includes(':focus-visible'), 'focus-visible rules required');
  assert.ok(cssSource.includes('.sun-hour-tick:focus-visible'), 'tick focus style required');
  assert.ok(cssSource.includes('.pcb-fp:focus-visible'), 'footprint focus style required');
});

test('single-character canvas keys are only bound to the focused canvas (WCAG 2.1.4)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  assert.equal(/window\.addEventListener\('keydown'/.test(src), false, 'global keydown would violate 2.1.4');
  assert.equal(/document\.addEventListener\('keydown'/.test(src), false, 'global keydown would violate 2.1.4');
});

test('no scroll-behavior smooth anywhere in shipped styles or markup', () => {
  for (const rel of ['styles.css', 'index.html']) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.equal(/scroll-behavior\s*:\s*smooth/.test(text), false, rel + ' has smooth scroll');
  }
});

test('titles stand alone: no eyebrow above, no tagline below', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.equal(/class="[^"]*(subtitle|tagline|kicker|eyebrow|lede|deck)[^"]*"/i.test(html), false,
    'found subtitle/tagline/kicker markup under a title');
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  assert.equal(/\.(subtitle|tagline|kicker|eyebrow|lede|deck)\b/i.test(css), false,
    'found subtitle/tagline styles in stylesheet');
});

test('every shipped text file is free of em/en dashes and AI-tool mentions', () => {
  const exts = new Set(['.html', '.css', '.js', '.md', '.csv', '.txt', '.scad', '.kicad_sch', '.kicad_pcb', '.kicad_pro']);
  const aiRe = /\b(claude|openai|anthropic|chatgpt|copilot|codeium|tabnine|deepseek|mistral|llama|gemini|devin|windsurf)\b|generated by (an? )?(ai|llm|model)|ai-generated/i;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name.startsWith('.')) continue;
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(p); continue; }
      if (!exts.has(path.extname(entry.name).toLowerCase())) continue;
      const text = fs.readFileSync(p, 'utf8');
      const rel = path.relative(ROOT, p);
      assert.equal(/[\u2013\u2014]/.test(text), false, rel + ' has a forbidden dash');
      // The scanner file necessarily contains the term list itself.
      if (rel !== path.join('tests', 'dom-smoke.test.js')) {
        assert.equal(aiRe.test(text), false, rel + ' mentions an AI tool');
      }
    }
  };
  walk(ROOT);
});

test('sunpath hour tick count matches elevated daylight samples', () => {
  const { doc, elementsById } = createWorkbenchDom();
  App.initWorkbench(doc, E, HW);
  const markup = elementsById['sunpath-svg'].innerHTML;
  const ticks = markup.match(/class="sun-hour-tick"/g) || [];
  let expected = 0;
  for (let h = 5; h <= 19; h += 1) {
    if (E.computeSolarPosition({ latitude: 38.9, dayOfYear: 172, solarHour: h }).elevationDeg > 0) expected += 1;
  }
  assert.equal(ticks.length, expected);
});

test('pcb footprint count matches the number of placed components', () => {
  const { doc, elementsById } = createWorkbenchDom();
  App.initWorkbench(doc, E, HW);
  const fps = (elementsById['pcb-svg'].innerHTML.match(/class="pcb-fp"/g) || []).length;
  assert.equal(fps, Object.keys(HW.PLACEMENT).length);
});

test('banner and telemetry readouts are populated with finite formatted values', () => {
  const { doc, elementsById } = createWorkbenchDom();
  App.initWorkbench(doc, E, HW);
  assert.match(elementsById['banner-gain'].textContent, /^\+\d+\.\d% vs fixed tilt$/);
  assert.match(elementsById['sky-daylight-hours'].textContent, /^\d+\.\d{2} h daylight$/);
  assert.match(elementsById['viewport-pose-readout'].textContent, /^Az \d+\.\d deg \/ El \d+\.\d deg$/);
  assert.match(elementsById['met-bounds'].textContent, /^\d+\.\d x \d+\.\d x \d+\.\d mm$/);
  assert.match(elementsById['energy-val-tracker'].textContent, /^\d+\.\d{2} kWh\/m2$/);
});

/* --------------------------------------------------- 5. Lab section DOM */

const L = require('../helios-lab.js');

test('index.html ships the lab section hidden with every required id', () => {
  const required = [
    'lab-section', 'lab-title', 'lab-digest-badge', 'lab-lat-out', 'lab-latitude',
    'lab-yield-tbody', 'lab-bench-tbody', 'lab-yield-note', 'lab-month-readout',
    'lab-yield-svg', 'lab-yield-legend', 'lab-worm-readout', 'lab-material',
    'lab-custom-mu-group', 'lab-mu', 'lab-mu-out', 'lab-worm-svg', 'lab-worm-legend',
    'lab-audit-tally', 'lab-audit-grid', 'lab-digest', 'lab-verify-out',
    'lab-export-json', 'lab-export-csv', 'lab-export-md', 'lab-copy-link',
    'lab-verify', 'lab-tamper', 'lab-test-tally', 'lab-run-tests', 'lab-test-list'
  ];
  required.forEach((id) => {
    assert.ok(htmlSource.includes(`id="${id}"`), `missing #${id}`);
  });
  assert.ok(/id="lab-section"[^>]*\shidden/.test(htmlSource), 'lab section must start hidden');
});

test('helios-lab.js loads before app.js in the script order', () => {
  const iLab = htmlSource.indexOf('src="helios-lab.js"');
  const iApp = htmlSource.indexOf('src="app.js"');
  const iEng = htmlSource.indexOf('src="engine.js"');
  assert.ok(iEng >= 0 && iLab > iEng && iApp > iLab, 'script order must be engine, hardware, lab, app');
});

test('lab section contains no external urls, images, fonts or scripts', () => {
  const start = htmlSource.indexOf('id="lab-section"');
  const end = htmlSource.indexOf('</main>', start);
  const seg = htmlSource.slice(start, end);
  assert.equal(/(https?:)?\/\//.test(seg), false, 'external url in lab markup');
  assert.equal(/<img|<link|@import/.test(seg), false, 'external asset in lab markup');
});

test('initLab returns null gracefully without a lab section or module', () => {
  const { doc } = createWorkbenchDom();
  const wb = App.initWorkbench(doc, E, HW);
  assert.equal(App.initLab(null, E, HW, L, wb), null);
  assert.equal(App.initLab(doc, E, HW, null, wb), null);
  const emptyDoc = { getElementById: () => null };
  assert.equal(App.initLab(emptyDoc, E, HW, L, wb), null);
});

test('initLab renders comparator, benchmark, audit and digest on first paint', () => {
  const { doc, elementsById } = createWorkbenchDom();
  const wb = App.initWorkbench(doc, E, HW);
  const lab = App.initLab(doc, E, HW, L, wb);
  assert.ok(lab);
  const tbody = elementsById['lab-yield-tbody'].innerHTML;
  L.REGIME_IDS.forEach((id) => {
    assert.ok(tbody.includes(`data-regime="${id}"`), `missing row ${id}`);
  });
  assert.equal((tbody.match(/<tr /g) || []).length, 5);
  assert.equal((elementsById['lab-bench-tbody'].innerHTML.match(/<tr>/g) || []).length, 4);
  assert.equal((elementsById['lab-audit-grid'].innerHTML.match(/lab-audit-cell/g) || []).length, 7);
  assert.match(elementsById['lab-digest'].textContent, /^sha256: [0-9a-f]{64}$/);
  assert.match(elementsById['lab-digest-badge'].textContent, /^sha256: [0-9a-f]{18}\.\.\.$/);
});

test('lab yield svg draws five regime curves and twelve month ticks', () => {
  const { doc, elementsById } = createWorkbenchDom();
  const wb = App.initWorkbench(doc, E, HW);
  App.initLab(doc, E, HW, L, wb);
  const svg = elementsById['lab-yield-svg'].innerHTML;
  assert.equal((svg.match(/<path /g) || []).length, 5);
  assert.equal((svg.match(/data-month="/g) || []).length, 12);
  ['#D95326', '#235789', '#656B70', '#B87D14', '#1B6B53'].forEach((c) => {
    assert.ok(svg.includes(c), `missing curve color ${c}`);
  });
});

test('lab worm svg draws friction curve, lead line, boundary and material ticks', () => {
  const { doc, elementsById } = createWorkbenchDom();
  const wb = App.initWorkbench(doc, E, HW);
  App.initLab(doc, E, HW, L, wb);
  const svg = elementsById['lab-worm-svg'].innerHTML;
  assert.ok(svg.includes('stroke="#1B6B53"'), 'phi curve missing');
  assert.ok(svg.includes('stroke="#235789"'), 'lambda line missing');
  assert.equal((svg.match(/data-material="/g) || []).length, 5);
  assert.ok(svg.includes('mu*='), 'boundary label missing');
  L.MATERIAL_IDS.forEach((id) => {
    assert.ok(svg.includes(`data-material="${id}"`), `missing marker ${id}`);
  });
});

test('lab state methods drive the same code path as delegated clicks', () => {
  const { doc, elementsById } = createWorkbenchDom();
  const wb = App.initWorkbench(doc, E, HW);
  const lab = App.initLab(doc, E, HW, L, wb);
  lab.selectRegime('single-axis-ns');
  assert.equal(lab.state.regime, 'single-axis-ns');
  assert.ok(elementsById['lab-yield-tbody'].innerHTML.includes('data-regime="single-axis-ns" class="is-highlighted"'));
  lab.selectRegime('not-a-regime');
  assert.equal(lab.state.regime, 'single-axis-ns', 'invalid regime ignored');
  lab.selectMonth(5);
  assert.match(elementsById['lab-month-readout'].textContent, /^Jun day 162/);
  lab.selectMonth(5);
  assert.equal(elementsById['lab-month-readout'].textContent, 'all 12 Klein days');
  lab.setMaterial('hardened-steel');
  assert.match(elementsById['lab-worm-readout'].textContent, /back-drivable/);
  lab.setMaterial('unobtanium');
  assert.equal(lab.state.material, 'hardened-steel');
});

test('custom material reveals the mu slider and updates the brief state', () => {
  const { doc, elementsById } = createWorkbenchDom();
  const wb = App.initWorkbench(doc, E, HW);
  const lab = App.initLab(doc, E, HW, L, wb);
  assert.equal(elementsById['lab-custom-mu-group'].classList.contains('hidden'), true);
  lab.setMaterial('custom');
  lab.setCustomMu(0.33);
  assert.equal(elementsById['lab-custom-mu-group'].classList.contains('hidden'), false);
  assert.equal(elementsById['lab-mu-out'].textContent, 'mu = 0.33');
  const hs = lab.currentHashState();
  assert.equal(hs.mat, 'custom');
  assert.equal(hs.mu, 0.33);
  lab.setCustomMu(9);
  assert.equal(lab.state.customMu, 0.4, 'mu clamps to sweep max');
});

test('verify, tamper and self-test runner report through lab-verify-out and tally', () => {
  const { doc, elementsById } = createWorkbenchDom();
  const wb = App.initWorkbench(doc, E, HW);
  const lab = App.initLab(doc, E, HW, L, wb);
  const v = lab.verifyDigest();
  assert.equal(v.ok, true);
  assert.equal(elementsById['lab-verify-out'].classList.contains('ok'), true);
  const t = lab.tamperDemo();
  assert.equal(t.ok, false);
  assert.equal(elementsById['lab-verify-out'].classList.contains('bad'), true);
  const res = lab.runSelfTests();
  assert.equal(res.passed, res.total);
  assert.equal(res.total, 18);
  assert.equal(elementsById['lab-test-tally'].textContent, '18/18 passing');
  const items = elementsById['lab-test-list'].innerHTML.match(/<li>/g) || [];
  assert.equal(items.length, 18);
  assert.equal((elementsById['lab-test-list'].innerHTML.match(/st-fail/g) || []).length, 0);
});

test('lab digest is identical across display, badge and all three exporters', () => {
  const { doc, elementsById } = createWorkbenchDom();
  const wb = App.initWorkbench(doc, E, HW);
  const lab = App.initLab(doc, E, HW, L, wb);
  const shown = /^sha256: ([0-9a-f]{64})$/.exec(elementsById['lab-digest'].textContent)[1];
  const stamped = lab.stamped();
  assert.equal(stamped.digest, shown);
  assert.ok(elementsById['lab-digest-badge'].textContent.includes(shown.slice(0, 18)));
  assert.ok(L.briefToJson(stamped).includes(shown));
  assert.ok(L.briefToCsv(stamped).includes(shown));
  assert.ok(L.briefToMarkdown(stamped).includes(shown));
});

test('applyHash restores every encoded field into workbench and lab state', () => {
  const { doc, elementsById } = createWorkbenchDom();
  const wb = App.initWorkbench(doc, E, HW);
  const lab = App.initLab(doc, E, HW, L, wb);
  const hash = L.encodeHashState({ lat: -45.5, day: 355, reg: 'single-axis-ew', mat: 'custom', mu: 0.4, teeth: 30, mod: 2.0 });
  const ok = lab.applyHash('#' + hash);
  assert.equal(ok, true);
  assert.equal(wb.state.latitude, -45.5);
  assert.equal(wb.state.dayOfYear, 355);
  assert.equal(wb.state.teeth, 30);
  assert.equal(wb.state.module, 2.0);
  assert.equal(lab.state.regime, 'single-axis-ew');
  assert.equal(lab.state.material, 'custom');
  assert.equal(lab.state.customMu, 0.4);
  assert.equal(elementsById['slider-latitude'].value, '-45.5');
  assert.equal(elementsById['slider-day'].value, '355');
  assert.equal(elementsById['slider-teeth'].value, '30');
  assert.equal(elementsById['slider-module'].value, '2');
  assert.equal(elementsById['lab-latitude'].value, 'workbench');
  assert.equal(elementsById['lab-material'].value, 'custom');
  assert.equal(elementsById['lab-mu'].value, '0.4');
});

test('applyHash fails closed on malformed, hostile or out-of-range payloads', () => {
  const { doc, elementsById } = createWorkbenchDom();
  const wb = App.initWorkbench(doc, E, HW);
  const lab = App.initLab(doc, E, HW, L, wb);
  const before = wb.state.latitude;
  ['#hc=', '#hc=AAAA', '#hc=****', '#xx=QQ', '#hc=' + L.b64urlEncode('{bad'),
   '#hc=' + L.b64urlEncode('{"lat":200}'),
   '#hc=' + L.b64urlEncode('{"__proto__":{"x":1}}')].forEach((h, i) => {
    assert.equal(lab.applyHash(h), false, `hash ${i}`);
  });
  assert.equal(wb.state.latitude, before, 'state untouched by hostile hashes');
  assert.equal(lab.applyHash(''), false);
  assert.equal(lab.applyHash('#'), false);
  assert.equal(lab.applyHash(null), false);
});

test('workbench updates propagate into the lab through the refresh listener', () => {
  const { doc, elementsById } = createWorkbenchDom();
  const wb = App.initWorkbench(doc, E, HW);
  const lab = App.initLab(doc, E, HW, L, wb);
  const d1 = lab.stamped().digest;
  wb.state.teeth = 28;
  wb.state.module = 2.0;
  wb.updateAll();
  const d2 = lab.stamped().digest;
  assert.notEqual(d1, d2, 'digest must change when gear state changes');
  const hs = lab.currentHashState();
  assert.equal(hs.teeth, 28);
  assert.equal(hs.mod, 2);
  assert.match(elementsById['lab-worm-readout'].textContent, /lambda \d+\.\d{2} deg/);
});

test('lab CSS carries no external fonts, images or smooth scrolling', () => {
  const labCss = cssSource.slice(cssSource.indexOf('Lab section'));
  assert.ok(labCss.length > 100, 'lab css block missing');
  assert.equal(/(https?:)?\/\//.test(labCss), false);
  assert.equal(/scroll-behavior/.test(labCss), false);
  assert.equal(/@font-face|url\(/.test(labCss), false);
});
