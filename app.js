/*
 * Helios-6 interactive CAD & KiCad workbench controller.
 * Connects HeliosEngine (engine.js) and HeliosHardware (hardware.js) to the DOM.
 * Zero external runtime dependencies.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.HeliosApp = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PART_COLORS = {
    base: '#8C857B',
    wheel: '#D95326',
    yoke: '#4E5D6C',
    panel: '#23496D',
    pcb: '#1B6B53',
    sensors: '#C88A1B'
  };

  var PRESETS = {
    'dc-solstice': {
      module: 1.5,
      teeth: 24,
      wallThickness: 3.0,
      latitude: 38.9,
      dayOfYear: 172,
      solarHour: 13.5,
      explode: 0.22
    },
    'equinox-noon': {
      module: 1.5,
      teeth: 24,
      wallThickness: 3.0,
      latitude: 0.0,
      dayOfYear: 80,
      solarHour: 12.0,
      explode: 0.0
    },
    'nordic-summer': {
      module: 1.25,
      teeth: 28,
      wallThickness: 3.5,
      latitude: 65.0,
      dayOfYear: 172,
      solarHour: 15.0,
      explode: 0.35
    },
    'heavy-gear': {
      module: 2.0,
      teeth: 30,
      wallThickness: 4.5,
      latitude: 38.9,
      dayOfYear: 172,
      solarHour: 10.5,
      explode: 0.45
    }
  };

  var MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  function dayOfYearToLabel(doy) {
    var d = Math.max(1, Math.min(365, Math.round(doy)));
    var m = 0;
    while (m < 11 && d > MONTH_DAYS[m]) {
      d -= MONTH_DAYS[m];
      m += 1;
    }
    return 'Day ' + Math.round(doy) + ' (' + MONTH_NAMES[m] + ' ' + d + ')';
  }

  function solarHourToClockLabel(sh) {
    var totalMinutes = Math.round(sh * 60);
    var hh = Math.floor(totalMinutes / 60);
    var mm = Math.abs(totalMinutes % 60);
    var hhStr = (hh < 10 ? '0' : '') + hh;
    var mmStr = (mm < 10 ? '0' : '') + mm;
    return hhStr + ':' + mmStr + ' (' + sh.toFixed(2) + ' h)';
  }

  function formatInt(n) {
    return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function triggerBlobDownload(filename, content, mimeType) {
    if (typeof document === 'undefined') {
      return;
    }
    var blob = new Blob([content], { type: mimeType || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 500);
  }

  function initWorkbench(doc, E, HW) {
    if (!doc || !E || !HW) {
      return null;
    }

    var state = {
      module: 1.5,
      teeth: 24,
      wallThickness: 3.0,
      latitude: 38.9,
      dayOfYear: 172,
      solarHour: 13.5,
      explode: 0.22,
      partFilter: 'all',
      renderMode: 'hybrid',
      activeTab: 'bom',
      searchQuery: '',
      selectedPcbRef: 'U1',
      playingSun: false,
      playTimer: null,
      camera: E.makeCamera({
        yaw: 42,
        pitch: 32,
        zoom: 1.08,
        projection: 'isometric',
        target: [0, 0, 42]
      }),
      cachedGeometryKey: '',
      cachedMeshes: null,
      cachedManifold: null
    };

    function getParams() {
      return {
        module: state.module,
        teeth: state.teeth,
        wallThickness: state.wallThickness,
        latitude: state.latitude
      };
    }

    function ensureMeshes() {
      var key = [state.module, state.teeth, state.wallThickness].join('|');
      if (state.cachedGeometryKey !== key || !state.cachedMeshes) {
        var params = getParams();
        state.cachedMeshes = E.generateAllPartMeshes(params);
        var manifoldByPart = {};
        var totalV = 0;
        var totalE = 0;
        var totalF = 0;
        var allWatertight = true;
        E.PART_IDS.forEach(function (id) {
          var m = E.validateMeshManifold(state.cachedMeshes[id]);
          manifoldByPart[id] = m;
          totalV += m.vertexCount;
          totalE += m.edgeCount;
          totalF += m.faceCount;
          if (!m.isManifold) {
            allWatertight = false;
          }
        });
        state.cachedManifold = {
          byPart: manifoldByPart,
          totalV: totalV,
          totalE: totalE,
          totalF: totalF,
          allWatertight: allWatertight
        };
        state.cachedGeometryKey = key;
      }
      return state.cachedMeshes;
    }

    function setText(id, text) {
      var el = doc.getElementById(id);
      if (el) {
        el.textContent = text;
      }
    }

    /* ---------------------------------------------------- 3D Canvas Drawing */

    function renderCadViewport(sun, pose, layout, train) {
      var canvas = doc.getElementById('cad-viewport');
      if (!canvas || typeof canvas.getContext !== 'function') {
        return;
      }
      var ctx = canvas.getContext('2d');
      if (!ctx) {
        return;
      }

      var rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { width: 760, height: 490 };
      var cssW = rect.width > 50 ? rect.width : 760;
      var cssH = rect.height > 50 ? rect.height : 490;
      var dpr = (typeof window !== 'undefined' && window.devicePixelRatio) ? Math.min(window.devicePixelRatio, 2) : 1;
      var targetW = Math.round(cssW * dpr);
      var targetH = Math.round(cssH * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }

      ctx.save();
      ctx.scale(dpr, dpr);
      var viewport = { width: cssW, height: cssH };

      // Clear drafting background
      ctx.fillStyle = '#EFECE3';
      ctx.fillRect(0, 0, cssW, cssH);

      var basis = E.cameraBasis(state.camera);

      // Draw Z=0 ground reference grid (-70 to +70 mm)
      ctx.lineWidth = 0.75;
      for (var g = -70; g <= 70; g += 10) {
        var major = (g % 30 === 0);
        ctx.strokeStyle = major ? 'rgba(20, 22, 24, 0.16)' : 'rgba(20, 22, 24, 0.07)';
        var p1 = E.projectPoint([g, -70, 0], state.camera, viewport, basis);
        var p2 = E.projectPoint([g, 70, 0], state.camera, viewport, basis);
        if (p1 && p2) {
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
        }
        var q1 = E.projectPoint([-70, g, 0], state.camera, viewport, basis);
        var q2 = E.projectPoint([70, g, 0], state.camera, viewport, basis);
        if (q1 && q2) {
          ctx.beginPath();
          ctx.moveTo(q1.x, q1.y);
          ctx.lineTo(q2.x, q2.y);
          ctx.stroke();
        }
      }

      // World coordinate triad at (-68, -68, 0)
      var triadOrigin = [-68, -68, 0];
      var pOrig = E.projectPoint(triadOrigin, state.camera, viewport, basis);
      var axes = [
        { end: [-46, -68, 0], color: '#D95326', label: '+X (E)' },
        { end: [-68, -46, 0], color: '#1B6B53', label: '+Y (N)' },
        { end: [-68, -68, 22], color: '#235789', label: '+Z' }
      ];
      if (pOrig) {
        ctx.font = '600 10px "IBM Plex Mono", monospace';
        axes.forEach(function (ax) {
          var pe = E.projectPoint(ax.end, state.camera, viewport, basis);
          if (pe) {
            ctx.strokeStyle = ax.color;
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.moveTo(pOrig.x, pOrig.y);
            ctx.lineTo(pe.x, pe.y);
            ctx.stroke();
            ctx.fillStyle = ax.color;
            var labelW = ctx.measureText ? ctx.measureText(ax.label).width : 36;
            var lx = pe.x + 4;
            if (lx + labelW > cssW - 6) {
              lx = pe.x - labelW - 4;
            }
            lx = Math.max(6, lx);
            ctx.fillText(ax.label, lx, Math.max(12, Math.min(cssH - 6, pe.y + 3)));
          }
        });
      }

      // Exploded assembly datum centerline when explode > 0
      var topZ = layout.pivotWorldZ + 3 * state.explode * E.EXPLODE_SPACING_MM + 18;
      if (state.explode > 0.01) {
        var cBot = E.projectPoint([0, 0, 0], state.camera, viewport, basis);
        var cTop = E.projectPoint([0, 0, topZ], state.camera, viewport, basis);
        if (cBot && cTop) {
          ctx.save();
          ctx.setLineDash([4, 4]);
          ctx.strokeStyle = '#D95326';
          ctx.lineWidth = 1.1;
          ctx.beginPath();
          ctx.moveTo(cBot.x, cBot.y);
          ctx.lineTo(cTop.x, cTop.y);
          ctx.stroke();
          ctx.restore();
        }
      }

      // Build and filter scene
      var meshes = ensureMeshes();
      var fullScene = E.buildAssemblyScene(
        getParams(),
        { explode: state.explode, azimuthDeg: pose.azimuthDeg, elevationDeg: pose.elevationDeg },
        meshes
      );
      var filteredScene = fullScene.filter(function (part) {
        if (state.partFilter === 'all') {
          return true;
        }
        if (state.partFilter === 'array') {
          return part.id === 'panel' || part.id === 'pcb' || part.id === 'sensors';
        }
        return part.id === state.partFilter;
      });

      var drawList = E.buildDrawList(filteredScene, state.camera, viewport);

      // Draw triangles according to renderMode
      drawList.forEach(function (tri) {
        var baseHex = PART_COLORS[tri.part] || '#8C857B';
        ctx.beginPath();
        ctx.moveTo(tri.pts[0][0], tri.pts[0][1]);
        ctx.lineTo(tri.pts[1][0], tri.pts[1][1]);
        ctx.lineTo(tri.pts[2][0], tri.pts[2][1]);
        ctx.closePath();

        if (state.renderMode !== 'wireframe') {
          ctx.fillStyle = E.shadeHex(baseHex, tri.shade);
          ctx.fill();
        }
        if (state.renderMode === 'wireframe') {
          ctx.strokeStyle = baseHex;
          ctx.lineWidth = 0.65;
          ctx.stroke();
        } else if (state.renderMode === 'hybrid') {
          ctx.strokeStyle = 'rgba(20, 22, 24, 0.22)';
          ctx.lineWidth = 0.45;
          ctx.stroke();
        }
      });

      // Draw pitch circle callout around the worm wheel
      if (state.partFilter === 'all' || state.partFilter === 'wheel') {
        var wheelZ = layout.wheel.z + state.explode * E.EXPLODE_SPACING_MM + layout.wheel.faceWidth / 2;
        var pitchR = train.wheel.pitchDiameter / 2;
        ctx.save();
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = '#235789';
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        var started = false;
        for (var a = 0; a <= 64; a++) {
          var rad = (a / 64) * Math.PI * 2;
          var pt = E.projectPoint([pitchR * Math.cos(rad), pitchR * Math.sin(rad), wheelZ], state.camera, viewport, basis);
          if (pt) {
            if (!started) {
              ctx.moveTo(pt.x, pt.y);
              started = true;
            } else {
              ctx.lineTo(pt.x, pt.y);
            }
          }
        }
        ctx.stroke();
        ctx.restore();
      }

      // Draw incident sun vector ray into the solar array pivot
      var arrayPivotZ = layout.pivotWorldZ + 3 * state.explode * E.EXPLODE_SPACING_MM;
      var sv = sun.sunVector;
      // Pull the sun marker in until it clears the readout cards along the top edge.
      var rayLen = 62;
      var rayStart = [sv[0] * rayLen, sv[1] * rayLen, arrayPivotZ + sv[2] * rayLen];
      var rayEnd = [sv[0] * 14, sv[1] * 14, arrayPivotZ + sv[2] * 14];
      var pSun0 = E.projectPoint(rayStart, state.camera, viewport, basis);
      while (pSun0 && rayLen > 30 && (pSun0.y < (cssW < 500 ? 104 : 64) || pSun0.x < 60 || pSun0.x > cssW - 70)) {
        rayLen -= 4;
        rayStart = [sv[0] * rayLen, sv[1] * rayLen, arrayPivotZ + sv[2] * rayLen];
        pSun0 = E.projectPoint(rayStart, state.camera, viewport, basis);
      }
      var pSun1 = E.projectPoint(rayEnd, state.camera, viewport, basis);
      if (pSun0 && pSun1) {
        ctx.strokeStyle = sun.isDaylight ? '#D95326' : '#656B70';
        ctx.lineWidth = 2.0;
        ctx.beginPath();
        ctx.moveTo(pSun0.x, pSun0.y);
        ctx.lineTo(pSun1.x, pSun1.y);
        ctx.stroke();

        ctx.fillStyle = sun.isDaylight ? '#D95326' : '#656B70';
        ctx.beginPath();
        ctx.arc(pSun0.x, pSun0.y, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = '600 10px "IBM Plex Mono", monospace';
        ctx.fillText('SUN RAY', pSun0.x + 7, pSun0.y + 3);
      }

      ctx.restore();
    }

    /* ---------------------------------------- Stereographic Sky Dome SVG */

    function renderSunPathSvg(sun, pose) {
      var svg = doc.getElementById('sunpath-svg');
      if (!svg) {
        return;
      }
      var R = 132;
      var parts = [];

      // Sky dome background disc
      parts.push('<circle cx="0" cy="0" r="' + R + '" fill="#F5F3EC" stroke="#141618" stroke-width="1.3"/>');

      // Altitude concentric circles: 15, 30, 45, 60, 75 deg
      [15, 30, 45, 60, 75].forEach(function (alt) {
        var r = E.stereographicProject(0, alt, R);
        var rad = Math.abs(r.y);
        parts.push('<circle cx="0" cy="0" r="' + rad.toFixed(2) + '" fill="none" stroke="rgba(20,22,24,0.14)" stroke-dasharray="2,2" stroke-width="0.8"/>');
        parts.push('<text x="3" y="' + (-rad + 9).toFixed(1) + '" fill="#656B70" font-family="IBM Plex Mono, monospace" font-size="7.5">' + alt + '°</text>');
      });

      // Azimuth spokes every 30 deg
      for (var az = 0; az < 360; az += 30) {
        var edge = E.stereographicProject(az, 0, R);
        var major = (az % 90 === 0);
        parts.push('<line x1="0" y1="0" x2="' + edge.x.toFixed(2) + '" y2="' + edge.y.toFixed(2) + '" stroke="' +
          (major ? 'rgba(20,22,24,0.24)' : 'rgba(20,22,24,0.1)') + '" stroke-width="' + (major ? '1' : '0.6') + '"/>');
      }

      // Cardinal labels
      var cardinals = [
        { label: 'N 0°', x: 0, y: -R - 8, anchor: 'middle' },
        { label: 'E 90°', x: R + 6, y: 3, anchor: 'start' },
        { label: 'S 180°', x: 0, y: R + 13, anchor: 'middle' },
        { label: 'W 270°', x: -R - 6, y: 3, anchor: 'end' }
      ];
      cardinals.forEach(function (c) {
        parts.push('<text x="' + c.x + '" y="' + c.y + '" text-anchor="' + c.anchor + '" fill="#141618" font-family="IBM Plex Mono, monospace" font-weight="600" font-size="9">' + c.label + '</text>');
      });

      function buildPathAttr(doy) {
        var pts = E.computeSunPath({ latitude: state.latitude, dayOfYear: doy, stepMinutes: 10 });
        if (!pts.length) {
          return '';
        }
        return pts.map(function (pt, idx) {
          var p = E.stereographicProject(pt.azimuth, pt.elevation, R);
          return (idx === 0 ? 'M' : 'L') + p.x.toFixed(2) + ',' + p.y.toFixed(2);
        }).join(' ');
      }

      // Reference seasonal arcs
      var refArcs = [
        { doy: 172, color: '#B87D14', dash: '3,2' },
        { doy: 80, color: '#1B6B53', dash: '3,2' },
        { doy: 355, color: '#235789', dash: '3,2' }
      ];
      refArcs.forEach(function (arc) {
        var d = buildPathAttr(arc.doy);
        if (d) {
          parts.push('<path d="' + d + '" fill="none" stroke="' + arc.color + '" stroke-width="1.2" stroke-dasharray="' + arc.dash + '" opacity="0.75"/>');
        }
      });

      // Active day sun path
      var activeD = buildPathAttr(state.dayOfYear);
      if (activeD) {
        parts.push('<path d="' + activeD + '" fill="none" stroke="#D95326" stroke-width="2.4"/>');
      }

      // Hourly markers along the active day path (clickable)
      for (var h = 5; h <= 19; h += 1) {
        var hPos = E.computeSolarPosition({ latitude: state.latitude, dayOfYear: state.dayOfYear, solarHour: h });
        if (hPos.elevationDeg > 0) {
          var hp = E.stereographicProject(hPos.azimuthDeg, hPos.elevationDeg, R);
          parts.push('<g class="sun-hour-tick" data-hour="' + h + '" style="cursor:pointer;">');
          parts.push('<title>' + h + ':00 solar time, azimuth ' + hPos.azimuthDeg.toFixed(0) + '°, elevation ' + hPos.elevationDeg.toFixed(0) + '°</title>');
          parts.push('<circle cx="' + hp.x.toFixed(2) + '" cy="' + hp.y.toFixed(2) + '" r="3.4" fill="#F5F3EC" stroke="#D95326" stroke-width="1.3"/>');
          if (h % 2 === 0) {
            // Push the label away from the dome centre, or toward it when the tick sits on the rim.
            var hr = Math.sqrt(hp.x * hp.x + hp.y * hp.y) || 1;
            var push = hr < R * 0.8 ? 12 : -12;
            var lx = hp.x + (hp.x / hr) * push;
            var ly = hp.y + (hp.y / hr) * push + 2.5;
            parts.push('<text x="' + lx.toFixed(1) + '" y="' + ly.toFixed(1) + '" text-anchor="middle" fill="#141618" stroke="#F5F3EC" stroke-width="2.6" paint-order="stroke" font-family="IBM Plex Mono, monospace" font-size="8">' + h + 'h</text>');
          }
          parts.push('</g>');
        }
      }

      // Gimbal clamped target reticle
      var gPt = E.stereographicProject(pose.azimuthDeg, pose.elevationDeg, R);
      parts.push('<circle cx="' + gPt.x.toFixed(2) + '" cy="' + gPt.y.toFixed(2) + '" r="7.5" fill="none" stroke="#1B6B53" stroke-width="1.5"/>');

      // Current sun position marker
      if (sun.elevationDeg >= -5) {
        var clampedEl = Math.max(0, sun.elevationDeg);
        var sPt = E.stereographicProject(sun.azimuthDeg, clampedEl, R);
        parts.push('<circle cx="' + sPt.x.toFixed(2) + '" cy="' + sPt.y.toFixed(2) + '" r="5" fill="#D95326" stroke="#F5F3EC" stroke-width="1.5"/>');
      }

      svg.innerHTML = parts.join('');
    }

    /* ------------------------------------------ 2-Layer PCB Placement Map */

    function renderPcbSvg() {
      var svg = doc.getElementById('pcb-svg');
      if (!svg) {
        return;
      }
      var b = HW.BOARD;
      var out = [];

      // Solder-mask green board substrate with mounting holes and silkscreen grid
      out.push('<rect x="0" y="0" width="' + b.width + '" height="' + b.height + '" rx="2.2" fill="#1B6B53" stroke="#141618" stroke-width="0.6"/>');
      out.push('<rect x="1.2" y="1.2" width="' + (b.width - 2.4) + '" height="' + (b.height - 2.4) + '" rx="1.5" fill="none" stroke="rgba(245,243,236,0.28)" stroke-dasharray="1.5,1.5" stroke-width="0.3"/>');

      // Corner M3 mounting holes
      [[3.5, 3.5], [b.width - 3.5, 3.5], [3.5, b.height - 3.5], [b.width - 3.5, b.height - 3.5]].forEach(function (mh) {
        out.push('<circle cx="' + mh[0] + '" cy="' + mh[1] + '" r="1.6" fill="#F5F3EC" stroke="#D99B26" stroke-width="0.6"/>');
      });

      // Dimension callouts outside board outline
      out.push('<text x="' + (b.width / 2) + '" y="-1.4" text-anchor="middle" fill="#3B4045" font-family="IBM Plex Mono, monospace" font-size="2.3">80.0 mm Edge.Cuts (2-Layer FR4, 1.6 mm)</text>');

      // Footprint boxes by category
      HW.COMPONENTS.forEach(function (comp) {
        var pos = HW.PLACEMENT[comp.ref];
        if (!pos) {
          return;
        }
        var x = pos[0];
        var y = pos[1];
        var w = 3.0;
        var h = 1.8;
        var fill = '#C88A1B';
        if (comp.ref === 'U1') { w = 7.4; h = 7.4; fill = '#141618'; }
        else if (comp.ref === 'U2' || comp.ref === 'U3') { w = 5.4; h = 5.4; fill = '#141618'; }
        else if (comp.ref === 'U4' || comp.ref === 'Y1') { w = 3.4; h = 2.8; fill = '#2A2E33'; }
        else if (comp.ref === 'J1') { w = 9.0; h = 7.2; fill = '#8C857B'; }
        else if (comp.ref.charAt(0) === 'J') { w = 3.2; h = 8.5; fill = '#B87D14'; }
        else if (comp.ref.indexOf('SW') === 0) { w = 5.0; h = 5.0; fill = '#4E5D6C'; }
        else if (comp.ref === 'R14') { w = 3.6; h = 2.0; fill = '#D95326'; }

        var selected = (state.selectedPcbRef === comp.ref);
        var stroke = selected ? '#D95326' : '#F5F3EC';
        var sw = selected ? '0.65' : '0.28';

        out.push('<g class="pcb-fp" data-ref="' + comp.ref + '" style="cursor:pointer;">');
        out.push('<rect x="' + (x - w / 2).toFixed(2) + '" y="' + (y - h / 2).toFixed(2) + '" width="' + w.toFixed(2) + '" height="' + h.toFixed(2) +
          '" rx="0.4" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + sw + '"/>');
        out.push('<text x="' + x.toFixed(2) + '" y="' + (y + 0.55).toFixed(2) + '" text-anchor="middle" fill="#F5F3EC" font-family="IBM Plex Mono, monospace" font-weight="600" font-size="' +
          (w > 4.5 ? '1.85' : '1.35') + '">' + comp.ref + '</text>');
        out.push('</g>');
      });

      svg.innerHTML = out.join('');
    }

    function updateSelectedPcbCard() {
      var comp = HW.componentByRef(state.selectedPcbRef) || HW.COMPONENTS[0];
      if (!comp) {
        return;
      }
      var pos = HW.PLACEMENT[comp.ref] || [0, 0, 0];
      var pinMap = HW.buildPinNetMap();
      var nets = [];
      Object.keys(pinMap).forEach(function (ep) {
        if (ep.indexOf(comp.ref + '.') === 0) {
          var net = pinMap[ep];
          if (nets.indexOf(net) === -1) {
            nets.push(net);
          }
        }
      });
      setText('pcb-sel-title', comp.ref + ' / ' + comp.value + ' (' + comp.manufacturer + ' ' + comp.mpn + ', LCSC ' + comp.lcsc + ')');
      setText('pcb-sel-desc', comp.description + '. Placed at (' + pos[0].toFixed(1) + ', ' + pos[1].toFixed(1) + ') mm on F.Cu (' + comp.footprint + ').');
      setText('pcb-sel-nets', 'Connected nets (' + nets.length + '): ' + (nets.length ? nets.join(', ') : 'None'));
    }

    /* ------------------------------------------- BOM & Pinout Tables */

    function escapeHtml(text) {
      return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function renderBomAndPinoutTables() {
      var q = state.searchQuery.trim().toLowerCase();
      var bomTbody = doc.getElementById('bom-tbody');
      if (bomTbody) {
        var lines = HW.groupBom();
        var rowsHtml = [];
        lines.forEach(function (line) {
          var refText = line.refs.join(', ');
          var hay = [refText, line.value, line.manufacturer, line.mpn, line.lcsc, line.description].join(' ').toLowerCase();
          if (q && hay.indexOf(q) === -1) {
            return;
          }
          var isHighlighted = line.refs.indexOf(state.selectedPcbRef) >= 0;
          var lcscCell = line.lcsc
            ? '<a href="' + HW.lcscUrl(line.lcsc) + '" target="_blank" rel="noopener noreferrer">' + line.lcsc + '</a>'
            : '<span class="mono">off-board</span>';
          var mouserCell = line.mpn
            ? '<a href="' + HW.mouserSearchUrl(line.mpn) + '" target="_blank" rel="noopener noreferrer">Search</a>'
            : '<span class="mono">n/a</span>';
          rowsHtml.push(
            '<tr class="' + (isHighlighted ? 'is-highlighted' : '') + '" data-refs="' + line.refs.join(' ') + '">' +
              '<td class="mono"><strong>' + refText + '</strong></td>' +
              '<td class="mono">' + line.qty + '</td>' +
              '<td class="mono">' + line.value + '</td>' +
              '<td>' + (line.manufacturer ? line.manufacturer + ' ' : '') + '<span class="mono">' + (line.mpn || 'generic') + '</span></td>' +
              '<td class="mono">' + lcscCell + '</td>' +
              '<td>' + mouserCell + '</td>' +
              '<td>' + line.description + '</td>' +
            '</tr>'
          );
        });
        if (!rowsHtml.length) {
          rowsHtml.push('<tr class="empty-row"><td colspan="7">No BOM line matches &ldquo;' + escapeHtml(q) + '&rdquo;. Try a reference like U1 or C2, a value like 100nF, or an LCSC number.</td></tr>');
        }
        bomTbody.innerHTML = rowsHtml.join('');
      }

      var pinTbody = doc.getElementById('pinout-tbody');
      if (pinTbody) {
        var mcu = HW.mcuPinout().map(function (p) {
          return { refPin: 'U1.' + p.pin, name: p.name, net: p.net || 'NC', note: p.note };
        });
        var hdr = HW.connectorPinout().map(function (c) {
          return {
            refPin: c.ref + '.' + c.pin,
            name: 'Pin ' + c.pin,
            net: c.net || 'NC',
            note: HW.SIGNAL_NOTES[c.net] || 'Header terminal'
          };
        });
        var allPins = mcu.concat(hdr);
        var pinHtml = [];
        allPins.forEach(function (row) {
          var hay = [row.refPin, row.name, row.net, row.note].join(' ').toLowerCase();
          if (q && hay.indexOf(q) === -1) {
            return;
          }
          pinHtml.push(
            '<tr>' +
              '<td class="mono"><strong>' + row.refPin + '</strong></td>' +
              '<td class="mono">' + row.name + '</td>' +
              '<td class="mono">' + row.net + '</td>' +
              '<td>' + row.note + '</td>' +
            '</tr>'
          );
        });
        if (!pinHtml.length) {
          pinHtml.push('<tr class="empty-row"><td colspan="4">No pin matches &ldquo;' + escapeHtml(q) + '&rdquo;. Try a pin like U1.GPIO4 or a net like STEP_AZ.</td></tr>');
        }
        pinTbody.innerHTML = pinHtml.join('');
      }
    }

    /* ---------------------------------------------------- Master Update */

    function updateAll() {
      var params = getParams();
      var meshes = ensureMeshes();
      var mf = state.cachedManifold;

      var sun = E.computeSolarPosition({
        latitude: state.latitude,
        dayOfYear: state.dayOfYear,
        solarHour: state.solarHour
      });
      var pose = E.computeGimbalPose(sun, params);
      var train = E.computeGearTrainMetrics(params);
      var layout = E.computeAssemblyLayout(params);
      var gain = E.computeOptimalTiltGain({
        latitude: state.latitude,
        dayOfYear: state.dayOfYear,
        stepMinutes: 10
      });

      // Update slider readouts
      setText('out-explode', Math.round(state.explode * 100) + '%');
      setText('explode-mm-label', (state.explode * E.EXPLODE_SPACING_MM).toFixed(1) + ' mm / stage');
      setText('out-module', state.module.toFixed(2) + ' mm');
      setText('out-teeth', state.teeth + ' teeth');
      setText('out-wall', state.wallThickness.toFixed(2) + ' mm');
      var latDir = state.latitude >= 0 ? 'N' : 'S';
      setText('out-latitude', Math.abs(state.latitude).toFixed(1) + ' deg ' + latDir);
      setText('out-day', dayOfYearToLabel(state.dayOfYear));
      setText('out-hour', solarHourToClockLabel(state.solarHour));

      // Update stack triangle counts
      var arrayTris = mf.byPart.panel.faceCount + mf.byPart.pcb.faceCount + mf.byPart.sensors.faceCount;
      setText('stack-faces-all', formatInt(mf.totalF) + ' tris');
      setText('stack-faces-base', formatInt(mf.byPart.base.faceCount) + ' tris');
      setText('stack-faces-wheel', formatInt(mf.byPart.wheel.faceCount) + ' tris');
      setText('stack-faces-yoke', formatInt(mf.byPart.yoke.faceCount) + ' tris');
      setText('stack-faces-array', formatInt(arrayTris) + ' tris');

      // Update header & banner stats
      setText('manifold-badge-text', mf.allWatertight ? 'Manifold: 6/6 Watertight' : 'Manifold Warning');
      setText('banner-ratio', train.ratio + ':1 (' + (train.selfLocking ? '+' : '') + train.lockMarginDeg.toFixed(2) + ' deg lock)');
      var pctGain = gain.fixedTiltEnergy > 0 ? ((gain.gainVsFixedTilt - 1) * 100) : 0;
      setText('banner-gain', '+' + pctGain.toFixed(1) + '% vs fixed tilt');
      setText('banner-bom-count', HW.totalPartsOnBoard() + ' SMD/THT parts (80x56\u00a0mm)');

      // Update viewport HUD & metrology cells
      setText('viewport-pose-readout', 'Az ' + pose.azimuthDeg.toFixed(1) + ' deg / El ' + pose.elevationDeg.toFixed(1) + ' deg');
      setText('hud-dimensions', 'Pitch Dia: ' + train.wheel.pitchDiameter.toFixed(2) + ' mm | OD: ' + train.wheel.outsideDiameter.toFixed(2) + ' mm | Bore: ' + (layout.wheel.boreRadius * 2).toFixed(2) + ' mm');
      setText('hud-camera', 'Yaw ' + Math.round(state.camera.yaw) + ' deg / Pitch ' + Math.round(state.camera.pitch) + ' deg / Zoom ' + state.camera.zoom.toFixed(2) + 'x');
      setText('hud-manifold-detail', 'V=' + mf.totalV + ' E=' + mf.totalE + ' F=' + mf.totalF + ' (6/6 Closed Manifold)');

      setText('met-pitch-od', train.wheel.pitchDiameter.toFixed(2) + ' / ' + train.wheel.outsideDiameter.toFixed(2) + ' mm');
      setText('met-root-backlash', 'Root ' + train.wheel.rootDiameter.toFixed(2) + ' mm | Backlash ' + train.backlash.toFixed(3) + ' mm');
      setText('met-lead-friction', train.worm.leadAngleDeg.toFixed(2) + ' deg vs ' + train.frictionAngleDeg.toFixed(2) + ' deg');
      setText('met-lock-status', (train.selfLocking ? 'Self-locking' : 'Back-drivable') + ' (margin ' + (train.lockMarginDeg >= 0 ? '+' : '') + train.lockMarginDeg.toFixed(2) + ' deg, eff ' + (train.efficiency * 100).toFixed(1) + '%)');
      setText('met-step-res', train.outputDegPerMicrostep.toFixed(5) + ' deg / ustep');
      setText('met-step-counts', 'Az: ' + formatInt(pose.azimuthSteps) + ' steps | El: ' + formatInt(pose.elevationSteps) + ' steps');

      var vBase = mf.byPart.base.volume / 1000;
      var vWheel = mf.byPart.wheel.volume / 1000;
      var vYoke = mf.byPart.yoke.volume / 1000;
      var vTotal = vBase + vWheel + vYoke;
      setText('met-volumes', vTotal.toFixed(2) + ' cm3 printed PLA');
      setText('met-volumes-split', 'Base ' + vBase.toFixed(1) + ' / Gear ' + vWheel.toFixed(1) + ' / Yoke ' + vYoke.toFixed(1) + ' cm3');

      var fullScene = E.buildAssemblyScene(params, { explode: state.explode, azimuthDeg: pose.azimuthDeg, elevationDeg: pose.elevationDeg }, meshes);
      var merged = E.mergeMeshes(fullScene.map(function (s) { return s.mesh; }));
      var bnd = E.computeMeshBounds(merged);
      setText('met-bounds', bnd.size[0].toFixed(1) + ' x ' + bnd.size[1].toFixed(1) + ' x ' + bnd.size[2].toFixed(1) + ' mm');
      setText('met-center-dist', 'Worm center distance: ' + train.centerDistance.toFixed(2) + ' mm');

      setText('met-incidence', 'cos(theta) = ' + pose.cosIncidence.toFixed(4));
      setText('met-pointing-err', 'Pointing error: ' + pose.pointingErrorDeg.toFixed(2) + ' deg (' + (pose.limited ? 'travel limit clamped' : 'within travel') + ')');

      // Update right column solar & irradiance telemetry
      var declSign = sun.declinationDeg >= 0 ? '+' : '';
      setText('sky-declination-badge', 'decl = ' + declSign + sun.declinationDeg.toFixed(2) + ' deg');
      var daylightH = E.computeDaylightHours(state.latitude, state.dayOfYear);
      setText('sky-daylight-hours', daylightH.toFixed(2) + ' h daylight');

      setText('energy-val-tracker', gain.trackerEnergy.toFixed(2) + ' kWh/m2');
      setText('energy-label-fixed', 'Fixed Latitude Tilt (' + gain.fixedTiltDeg.toFixed(1) + ' deg)');
      setText('energy-val-fixed', gain.fixedTiltEnergy.toFixed(2) + ' kWh/m2');
      setText('energy-val-horiz', gain.horizontalEnergy.toFixed(2) + ' kWh/m2');

      var maxE = Math.max(0.01, gain.trackerEnergy, gain.fixedTiltEnergy, gain.horizontalEnergy);
      var barT = doc.getElementById('energy-bar-tracker');
      var barF = doc.getElementById('energy-bar-fixed');
      var barH = doc.getElementById('energy-bar-horiz');
      if (barT) { barT.style.width = Math.min(100, (gain.trackerEnergy / maxE) * 100).toFixed(1) + '%'; }
      if (barF) { barF.style.width = Math.min(100, (gain.fixedTiltEnergy / maxE) * 100).toFixed(1) + '%'; }
      if (barH) { barH.style.width = Math.min(100, (gain.horizontalEnergy / maxE) * 100).toFixed(1) + '%'; }

      var eotSign = sun.equationOfTimeMin >= 0 ? '+' : '';
      setText('sky-eot', eotSign + sun.equationOfTimeMin.toFixed(2) + ' min');
      setText('sky-airmass', E.beamAttenuation(sun.elevationDeg).toFixed(3) + ' beam factor');
      setText('sky-peak-alt', gain.peakElevationDeg.toFixed(2) + ' deg');

      // Update live OpenSCAD code view
      var scadPre = doc.getElementById('scad-code-view');
      if (scadPre) {
        scadPre.textContent = E.exportScad(params);
      }

      renderCadViewport(sun, pose, layout, train);
      renderSunPathSvg(sun, pose);
    }

    function syncSlidersFromState() {
      var map = {
        'slider-explode': state.explode,
        'slider-module': state.module,
        'slider-teeth': state.teeth,
        'slider-wall': state.wallThickness,
        'slider-latitude': state.latitude,
        'slider-day': state.dayOfYear,
        'slider-hour': state.solarHour
      };
      Object.keys(map).forEach(function (id) {
        var input = doc.getElementById(id);
        if (input) {
          input.value = String(map[id]);
        }
      });
    }

    /* -------------------------------------------------- Event Listeners */

    function bindEvents() {
      function bindSlider(id, prop, isInt) {
        var el = doc.getElementById(id);
        if (!el) {
          return;
        }
        el.addEventListener('input', function () {
          var v = isInt ? parseInt(el.value, 10) : parseFloat(el.value);
          if (!isNaN(v)) {
            state[prop] = v;
            updateAll();
          }
        });
      }

      bindSlider('slider-explode', 'explode', false);
      bindSlider('slider-module', 'module', false);
      bindSlider('slider-teeth', 'teeth', true);
      bindSlider('slider-wall', 'wallThickness', false);
      bindSlider('slider-latitude', 'latitude', false);
      bindSlider('slider-day', 'dayOfYear', true);
      bindSlider('slider-hour', 'solarHour', false);

      // Presets
      var presetBtns = doc.querySelectorAll('[data-preset]');
      Array.prototype.forEach.call(presetBtns, function (btn) {
        btn.addEventListener('click', function () {
          var key = btn.getAttribute('data-preset');
          var p = PRESETS[key];
          if (!p) {
            return;
          }
          Array.prototype.forEach.call(presetBtns, function (b) { b.classList.remove('is-active'); });
          btn.classList.add('is-active');
          Object.keys(p).forEach(function (k) { state[k] = p[k]; });
          syncSlidersFromState();
          updateAll();
        });
      });

      var resetBtn = doc.getElementById('btn-reset-params');
      if (resetBtn) {
        resetBtn.addEventListener('click', function () {
          var d = PRESETS['dc-solstice'];
          Object.keys(d).forEach(function (k) { state[k] = d[k]; });
          state.partFilter = 'all';
          syncSlidersFromState();
          updateAll();
        });
      }

      // Stack filter nodes
      var stackNodes = doc.querySelectorAll('[data-part-filter]');
      Array.prototype.forEach.call(stackNodes, function (node) {
        node.addEventListener('click', function () {
          state.partFilter = node.getAttribute('data-part-filter') || 'all';
          Array.prototype.forEach.call(stackNodes, function (n) { n.classList.remove('is-selected'); });
          node.classList.add('is-selected');
          updateAll();
        });
      });

      // Projection buttons
      var projBtns = doc.querySelectorAll('[data-proj]');
      Array.prototype.forEach.call(projBtns, function (btn) {
        btn.addEventListener('click', function () {
          state.camera.projection = btn.getAttribute('data-proj');
          Array.prototype.forEach.call(projBtns, function (b) { b.classList.remove('is-active'); });
          btn.classList.add('is-active');
          updateAll();
        });
      });

      // Render mode buttons
      var renderBtns = doc.querySelectorAll('[data-render]');
      Array.prototype.forEach.call(renderBtns, function (btn) {
        btn.addEventListener('click', function () {
          state.renderMode = btn.getAttribute('data-render');
          Array.prototype.forEach.call(renderBtns, function (b) { b.classList.remove('is-active'); });
          btn.classList.add('is-active');
          updateAll();
        });
      });

      // Camera orientation buttons
      var camIso = doc.getElementById('btn-cam-iso');
      if (camIso) {
        camIso.addEventListener('click', function () {
          state.camera.yaw = 42;
          state.camera.pitch = 32;
          state.camera.zoom = 1.08;
          updateAll();
        });
      }
      var camTop = doc.getElementById('btn-cam-top');
      if (camTop) {
        camTop.addEventListener('click', function () {
          state.camera.yaw = 0;
          state.camera.pitch = 88;
          updateAll();
        });
      }
      var camFront = doc.getElementById('btn-cam-front');
      if (camFront) {
        camFront.addEventListener('click', function () {
          state.camera.yaw = 0;
          state.camera.pitch = 8;
          updateAll();
        });
      }
      var zoomIn = doc.getElementById('btn-cam-zoom-in');
      if (zoomIn) {
        zoomIn.addEventListener('click', function () {
          state.camera.zoom = Math.min(4.0, state.camera.zoom * 1.18);
          updateAll();
        });
      }
      var zoomOut = doc.getElementById('btn-cam-zoom-out');
      if (zoomOut) {
        zoomOut.addEventListener('click', function () {
          state.camera.zoom = Math.max(0.4, state.camera.zoom / 1.18);
          updateAll();
        });
      }

      // Orbit drag & wheel zoom on CAD viewport
      var canvas = doc.getElementById('cad-viewport');
      if (canvas) {
        var dragging = false;
        var lastX = 0;
        var lastY = 0;
        canvas.addEventListener('pointerdown', function (ev) {
          dragging = true;
          lastX = ev.clientX;
          lastY = ev.clientY;
          if (canvas.setPointerCapture && ev.pointerId !== undefined) {
            try { canvas.setPointerCapture(ev.pointerId); } catch (e) {}
          }
        });
        canvas.addEventListener('pointermove', function (ev) {
          if (!dragging) {
            return;
          }
          var dx = ev.clientX - lastX;
          var dy = ev.clientY - lastY;
          lastX = ev.clientX;
          lastY = ev.clientY;
          state.camera.yaw = (state.camera.yaw - dx * 0.45) % 360;
          state.camera.pitch = Math.max(-85, Math.min(85, state.camera.pitch + dy * 0.45));
          updateAll();
        });
        var stopDrag = function () { dragging = false; };
        canvas.addEventListener('pointerup', stopDrag);
        canvas.addEventListener('pointercancel', stopDrag);
        canvas.addEventListener('keydown', function (ev) {
          var handled = true;
          if (ev.key === 'ArrowLeft') {
            state.camera.yaw = (state.camera.yaw + 6) % 360;
          } else if (ev.key === 'ArrowRight') {
            state.camera.yaw = (state.camera.yaw - 6) % 360;
          } else if (ev.key === 'ArrowUp') {
            state.camera.pitch = Math.max(-85, Math.min(85, state.camera.pitch - 4));
          } else if (ev.key === 'ArrowDown') {
            state.camera.pitch = Math.max(-85, Math.min(85, state.camera.pitch + 4));
          } else if (ev.key === '+' || ev.key === '=') {
            state.camera.zoom = Math.max(0.4, Math.min(4.0, state.camera.zoom * 1.08));
          } else if (ev.key === '-' || ev.key === '_') {
            state.camera.zoom = Math.max(0.4, Math.min(4.0, state.camera.zoom * 0.92));
          } else {
            handled = false;
          }
          if (handled) {
            ev.preventDefault();
            updateAll();
          }
        });
        canvas.addEventListener('wheel', function (ev) {
          ev.preventDefault();
          var factor = ev.deltaY < 0 ? 1.08 : 0.92;
          state.camera.zoom = Math.max(0.4, Math.min(4.0, state.camera.zoom * factor));
          updateAll();
        }, { passive: false });
      }

      // Sweep day animation toggle
      var playBtn = doc.getElementById('btn-play-sun');
      if (playBtn) {
        playBtn.addEventListener('click', function () {
          state.playingSun = !state.playingSun;
          playBtn.textContent = state.playingSun ? 'Pause Sweep' : 'Sweep Day';
          playBtn.classList.toggle('is-active', state.playingSun);
          if (state.playingSun) {
            state.playTimer = setInterval(function () {
              state.solarHour += 0.15;
              if (state.solarHour > 19.0) {
                state.solarHour = 5.0;
              }
              syncSlidersFromState();
              updateAll();
            }, 90);
          } else if (state.playTimer) {
            clearInterval(state.playTimer);
            state.playTimer = null;
          }
        });
      }

      // Click on sunpath hour tick
      var sunSvg = doc.getElementById('sunpath-svg');
      if (sunSvg) {
        sunSvg.addEventListener('click', function (ev) {
          var target = ev.target;
          while (target && target !== sunSvg) {
            if (target.getAttribute && target.getAttribute('data-hour')) {
              var h = parseFloat(target.getAttribute('data-hour'));
              if (!isNaN(h)) {
                state.solarHour = h;
                syncSlidersFromState();
                updateAll();
              }
              return;
            }
            target = target.parentNode;
          }
        });
      }

      // Click on PCB footprint
      var pcbSvg = doc.getElementById('pcb-svg');
      if (pcbSvg) {
        pcbSvg.addEventListener('click', function (ev) {
          var target = ev.target;
          while (target && target !== pcbSvg) {
            if (target.getAttribute && target.getAttribute('data-ref')) {
              state.selectedPcbRef = target.getAttribute('data-ref');
              renderPcbSvg();
              updateSelectedPcbCard();
              renderBomAndPinoutTables();
              return;
            }
            target = target.parentNode;
          }
        });
      }

      // Inspector tabs
      var tabBtns = doc.querySelectorAll('[data-tab]');
      Array.prototype.forEach.call(tabBtns, function (btn) {
        btn.addEventListener('click', function () {
          var tab = btn.getAttribute('data-tab');
          state.activeTab = tab;
          Array.prototype.forEach.call(tabBtns, function (b) {
            var active = (b === btn);
            b.classList.toggle('is-active', active);
            b.setAttribute('aria-selected', active ? 'true' : 'false');
          });
          ['bom', 'pinout', 'scad'].forEach(function (t) {
            var panel = doc.getElementById('tab-panel-' + t);
            if (panel) {
              panel.classList.toggle('hidden', t !== tab);
            }
          });
        });
      });

      // Search input for BOM & Pinout
      var searchInput = doc.getElementById('inspector-search');
      if (searchInput) {
        searchInput.addEventListener('input', function () {
          state.searchQuery = searchInput.value || '';
          renderBomAndPinoutTables();
        });
      }

      // Copy SCAD button
      var copyScadBtn = doc.getElementById('btn-copy-scad');
      if (copyScadBtn) {
        copyScadBtn.addEventListener('click', function () {
          var code = E.exportScad(getParams());
          function show(label) {
            copyScadBtn.textContent = label;
            setTimeout(function () {
              copyScadBtn.textContent = 'Copy .SCAD to Clipboard';
            }, 1400);
          }
          // Only say "Copied" once the browser confirms it; a refused write used to throw uncaught.
          if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
            return Promise.resolve()
              .then(function () { return navigator.clipboard.writeText(code); })
              .then(function () { show('Copied .SCAD'); }, function () { show('Copy blocked, use the download button'); });
          }
          show('Copy blocked, use the download button');
          return Promise.resolve();
        });
      }

      // One-click hardware artifact download buttons
      var dlScad = doc.getElementById('btn-dl-scad');
      if (dlScad) {
        dlScad.addEventListener('click', function () {
          triggerBlobDownload('helios_gimbal.scad', E.exportScad(getParams()), 'text/plain;charset=utf-8');
        });
      }
      var dlGear = doc.getElementById('btn-dl-stl-gear');
      if (dlGear) {
        dlGear.addEventListener('click', function () {
          var meshes = ensureMeshes();
          triggerBlobDownload('helios_worm_gear.stl', E.exportAsciiStl(meshes.wheel, 'helios_worm_gear'), 'model/stl');
        });
      }
      var dlBase = doc.getElementById('btn-dl-stl-base');
      if (dlBase) {
        dlBase.addEventListener('click', function () {
          var meshes = ensureMeshes();
          triggerBlobDownload('helios_base.stl', E.exportAsciiStl(meshes.base, 'helios_base'), 'model/stl');
        });
      }
      var dlYoke = doc.getElementById('btn-dl-stl-yoke');
      if (dlYoke) {
        dlYoke.addEventListener('click', function () {
          var meshes = ensureMeshes();
          triggerBlobDownload('helios_yoke.stl', E.exportAsciiStl(meshes.yoke, 'helios_yoke'), 'model/stl');
        });
      }
      var dlBom = doc.getElementById('btn-dl-bom');
      if (dlBom) {
        dlBom.addEventListener('click', function () {
          triggerBlobDownload('bom.csv', HW.bomToCsv(), 'text/csv;charset=utf-8');
        });
      }
    }

    syncSlidersFromState();
    renderPcbSvg();
    updateSelectedPcbCard();
    renderBomAndPinoutTables();
    bindEvents();
    updateAll();

    return {
      state: state,
      updateAll: updateAll,
      renderBomAndPinoutTables: renderBomAndPinoutTables,
      dayOfYearToLabel: dayOfYearToLabel,
      solarHourToClockLabel: solarHourToClockLabel
    };
  }

  if (typeof window !== 'undefined' && typeof document !== 'undefined' && window.HeliosEngine && window.HeliosHardware) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        window.heliosWorkbench = initWorkbench(document, window.HeliosEngine, window.HeliosHardware);
      });
    } else {
      window.heliosWorkbench = initWorkbench(document, window.HeliosEngine, window.HeliosHardware);
    }
  }

  return {
    PART_COLORS: PART_COLORS,
    PRESETS: PRESETS,
    dayOfYearToLabel: dayOfYearToLabel,
    solarHourToClockLabel: solarHourToClockLabel,
    initWorkbench: initWorkbench
  };
}));
