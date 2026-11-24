/*
 * Helios-6 audit lab: 5-regime annual clear-sky yield comparator, worm-gear
 * self-locking margin sweep, 6-body manifold and 48-part PCB verification,
 * pure-JS FIPS 180-4 SHA-256 audited brief exports, a strict #hc= bookmark
 * codec, and a deterministic in-page self-test runner.
 *
 * UMD module. Browser global: window.HeliosLab. Node: require('./helios-lab.js').
 * No dependencies beyond HeliosEngine (and optionally HeliosHardware), which
 * are injected through the factory so the same code runs in both hosts.
 * Units: millimetres, degrees, and kWh/m^2 of panel per day or year.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./engine.js'), require('./hardware.js'));
  } else {
    root.HeliosLab = factory(root.HeliosEngine, root.HeliosHardware);
  }
}(typeof self !== 'undefined' ? self : this, function (E, HW) {
  'use strict';

  var DEG = Math.PI / 180;
  var SOLAR_CONSTANT_KW_M2 = 1.353;

  /* ------------------------------------------------------------- catalogues */

  var REGIMES = Object.freeze([
    Object.freeze({ id: 'horizontal', label: 'Fixed Horizontal Surface', short: 'Horizontal' }),
    Object.freeze({ id: 'fixed-lat-tilt', label: 'Fixed Latitude Tilt', short: 'Fixed Tilt' }),
    Object.freeze({ id: 'single-axis-ew', label: 'Single-Axis, East-West Axis', short: '1-Axis E-W' }),
    Object.freeze({ id: 'single-axis-ns', label: 'Single-Axis, North-South Axis', short: '1-Axis N-S' }),
    Object.freeze({ id: 'dual-axis-helios', label: 'Dual-Axis Tracker (Helios-6)', short: 'Dual-Axis' })
  ]);

  var REGIME_IDS = Object.freeze(REGIMES.map(function (r) { return r.id; }));

  var CANONICAL_LATITUDES = Object.freeze([0, 29.6, 40.7, 55.7]);

  /* Klein (1977) recommended average days: the day of each month whose solar
   * declination is closest to the month's mean declination. */
  var MONTHS = Object.freeze([
    Object.freeze({ name: 'Jan', days: 31, repDay: 17 }),
    Object.freeze({ name: 'Feb', days: 28, repDay: 47 }),
    Object.freeze({ name: 'Mar', days: 31, repDay: 75 }),
    Object.freeze({ name: 'Apr', days: 30, repDay: 105 }),
    Object.freeze({ name: 'May', days: 31, repDay: 135 }),
    Object.freeze({ name: 'Jun', days: 30, repDay: 162 }),
    Object.freeze({ name: 'Jul', days: 31, repDay: 198 }),
    Object.freeze({ name: 'Aug', days: 31, repDay: 229 }),
    Object.freeze({ name: 'Sep', days: 30, repDay: 258 }),
    Object.freeze({ name: 'Oct', days: 31, repDay: 288 }),
    Object.freeze({ name: 'Nov', days: 30, repDay: 318 }),
    Object.freeze({ name: 'Dec', days: 31, repDay: 344 })
  ]);

  /* Static friction coefficients (approximate handbook values for the worm
   * pair in dry or lightly lubricated contact). Sweep range 0.05..0.40. */
  var WORM_MATERIALS = Object.freeze([
    Object.freeze({ id: 'dry-pla', label: 'PLA worm on steel pin, dry', mu: 0.25 }),
    Object.freeze({ id: 'lubed-petg', label: 'PETG worm on steel pin, PTFE lube', mu: 0.10 }),
    Object.freeze({ id: 'nylon-steel', label: 'Nylon worm on steel pin, dry', mu: 0.30 }),
    Object.freeze({ id: 'bronze-steel', label: 'Bronze worm on steel pin, oiled', mu: 0.15 }),
    Object.freeze({ id: 'hardened-steel', label: 'Hardened steel pair, greased', mu: 0.08 })
  ]);

  var MATERIAL_IDS = Object.freeze(WORM_MATERIALS.map(function (m) { return m.id; }));

  var MU_SWEEP = Object.freeze({ min: 0.05, max: 0.40 });
  var CHART_MU_RANGE = Object.freeze({ min: 0.0, max: 0.45 });

  var SOLSTICE_DAYS = Object.freeze({
    summer: 172,
    equinox: 80,
    winter: 355
  });

  /* ---------------------------------------------------------------- helpers */

  function fail(message) {
    throw new RangeError(message);
  }

  function clamp(value, lo, hi) {
    return Math.min(hi, Math.max(lo, value));
  }

  function requireFinite(name, value) {
    if (typeof value !== 'number' || !isFinite(value)) {
      fail(name + ' must be a finite number');
    }
    return value;
  }

  function requireRange(name, value, lo, hi) {
    requireFinite(name, value);
    if (value < lo || value > hi) {
      fail(name + ' must be between ' + lo + ' and ' + hi + ' (got ' + value + ')');
    }
    return value;
  }

  function roundTo(value, decimals) {
    var f = Math.pow(10, decimals);
    var r = Math.round(value * f) / f;
    return r === 0 ? 0 : r;
  }

  function materialById(id) {
    for (var i = 0; i < WORM_MATERIALS.length; i++) {
      if (WORM_MATERIALS[i].id === id) {
        return WORM_MATERIALS[i];
      }
    }
    return null;
  }

  /* --------------------------------------------------- solar yield per day */

  /**
   * Cosine of the incidence angle between the sun vector and each tracking
   * regime's best achievable panel normal.
   * - horizontal: panel normal is +Z, cos = sin(el).
   * - fixed-lat-tilt: fixed tilt |lat| facing the equator (engine formula).
   * - single-axis-ew: rotation axis lies east-west, so the normal is pinned
   *   to the meridian plane; best cos = sqrt(1 - sx^2).
   * - single-axis-ns: rotation axis lies north-south, normal pinned to the
   *   east-west vertical plane; best cos = sqrt(1 - sy^2).
   * - dual-axis-helios: normal equals the sun vector, cos = 1.
   */
  function cosIncidenceFor(regimeId, sun, latitude) {
    var sv = sun && sun.sunVector;
    if (!sun || !Array.isArray(sv) || sv.length !== 3) {
      fail('sun.sunVector must be a [x, y, z] vector');
    }
    requireFinite('sun.azimuthDeg', sun.azimuthDeg);
    requireFinite('sun.elevationDeg', sun.elevationDeg);
    var sx = sv[0];
    var sy = sv[1];
    var sz = sv[2];
    var el = sun.elevationDeg * DEG;
    var tilt;
    var panelAzimuth;
    var cosFixed;
    switch (regimeId) {
      case 'horizontal':
        return Math.max(0, sz);
      case 'fixed-lat-tilt':
        tilt = Math.abs(latitude) * DEG;
        panelAzimuth = latitude >= 0 ? 180 : 0;
        cosFixed = Math.sin(el) * Math.cos(tilt) +
          Math.cos(el) * Math.sin(tilt) * Math.cos((sun.azimuthDeg - panelAzimuth) * DEG);
        return Math.max(0, cosFixed);
      case 'single-axis-ew':
        return Math.sqrt(Math.max(0, 1 - sx * sx));
      case 'single-axis-ns':
        return Math.sqrt(Math.max(0, 1 - sy * sy));
      case 'dual-axis-helios':
        return 1;
      default:
        fail('unknown tracking regime ' + regimeId);
        return 0;
    }
  }

  /**
   * Daily clear-sky beam energy for all 5 regimes, integrated on the same
   * midpoint grid as engine.computeOptimalTiltGain and sharing its Meinel
   * air-mass weighting. Energy is kWh/m^2 of panel (beam only).
   */
  function computeDailyYield(opts) {
    opts = opts || {};
    var latitude = requireRange('latitude', opts.latitude, -89, 89);
    var dayOfYear = requireRange('dayOfYear', opts.dayOfYear, 1, 366);
    var stepMinutes = opts.stepMinutes === undefined ? 6 : opts.stepMinutes;
    requireRange('stepMinutes', stepMinutes, 1, 60);
    var useAirMass = opts.useAirMass !== false;
    var dt = stepMinutes / 60;
    var steps = Math.round(24 / dt);
    var energies = {};
    var i;
    for (i = 0; i < REGIME_IDS.length; i++) {
      energies[REGIME_IDS[i]] = 0;
    }
    var daylight = 0;
    var peak = 0;
    var minAirMass = Infinity;
    for (i = 0; i < steps; i++) {
      var pos = E.computeSolarPosition({
        latitude: latitude,
        dayOfYear: dayOfYear,
        solarHour: (i + 0.5) * dt
      });
      if (pos.elevationDeg > 0) {
        var weight = useAirMass ? SOLAR_CONSTANT_KW_M2 * E.beamAttenuation(pos.elevationDeg) : 1;
        for (var r = 0; r < REGIME_IDS.length; r++) {
          energies[REGIME_IDS[r]] += weight * cosIncidenceFor(REGIME_IDS[r], pos, latitude) * dt;
        }
        daylight += dt;
        peak = Math.max(peak, pos.elevationDeg);
        if (useAirMass) {
          minAirMass = Math.min(minAirMass, Math.min(38, 1 / Math.sin(pos.elevationDeg * DEG)));
        }
      }
    }
    return {
      latitude: latitude,
      dayOfYear: dayOfYear,
      daylightHours: daylight,
      peakElevationDeg: peak,
      minAirMass: isFinite(minAirMass) ? minAirMass : null,
      energies: energies
    };
  }

  /**
   * Annual clear-sky insolation (kWh/m^2) per regime. mode 'monthly' integrates
   * the 12 Klein representative days and scales each by its month length;
   * mode 'full' integrates every one of the 365 days.
   */
  function computeAnnualYield(opts) {
    opts = opts || {};
    var latitude = requireRange('latitude', opts.latitude, -89, 89);
    var mode = opts.mode === undefined ? 'monthly' : opts.mode;
    if (mode !== 'monthly' && mode !== 'full') {
      fail('mode must be monthly or full');
    }
    var stepMinutes = opts.stepMinutes === undefined ? 10 : opts.stepMinutes;
    requireRange('stepMinutes', stepMinutes, 1, 60);
    var useAirMass = opts.useAirMass !== false;
    var annual = {};
    var monthly = [];
    var i;
    for (i = 0; i < REGIME_IDS.length; i++) {
      annual[REGIME_IDS[i]] = 0;
    }
    if (mode === 'monthly') {
      for (i = 0; i < MONTHS.length; i++) {
        var d = computeDailyYield({
          latitude: latitude,
          dayOfYear: MONTHS[i].repDay,
          stepMinutes: stepMinutes,
          useAirMass: useAirMass
        });
        var monthRow = {
          month: MONTHS[i].name,
          monthIndex: i,
          dayOfYear: MONTHS[i].repDay,
          daysInMonth: MONTHS[i].days,
          daylightHours: d.daylightHours,
          peakElevationDeg: d.peakElevationDeg,
          energies: d.energies
        };
        monthly.push(monthRow);
        REGIME_IDS.forEach(function (id) {
          annual[id] += d.energies[id] * MONTHS[i].days;
        });
      }
    } else {
      var perDay = {};
      for (i = 0; i < REGIME_IDS.length; i++) {
        perDay[REGIME_IDS[i]] = new Array(365);
      }
      for (var doy = 1; doy <= 365; doy++) {
        var dd = computeDailyYield({
          latitude: latitude,
          dayOfYear: doy,
          stepMinutes: stepMinutes,
          useAirMass: useAirMass
        });
        REGIME_IDS.forEach(function (id) {
          annual[id] += dd.energies[id];
          perDay[id][doy - 1] = dd.energies[id];
        });
      }
    }
    var fixed = annual['fixed-lat-tilt'];
    var gainVsFixedTilt = {};
    var gainVsHorizontal = {};
    REGIME_IDS.forEach(function (id) {
      gainVsFixedTilt[id] = fixed > 0 ? (annual[id] / fixed - 1) * 100 : 0;
      gainVsHorizontal[id] = annual.horizontal > 0 ? (annual[id] / annual.horizontal - 1) * 100 : 0;
    });
    return {
      latitude: latitude,
      mode: mode,
      stepMinutes: stepMinutes,
      annual: annual,
      gainVsFixedTilt: gainVsFixedTilt,
      gainVsHorizontal: gainVsHorizontal,
      monthly: monthly
    };
  }

  /** Peak elevation and minimum air mass on the two solstices and equinox. */
  function computeSeasonExtremes(latitude) {
    requireRange('latitude', latitude, -89, 89);
    var out = {};
    Object.keys(SOLSTICE_DAYS).forEach(function (key) {
      var d = computeDailyYield({
        latitude: latitude,
        dayOfYear: SOLSTICE_DAYS[key],
        stepMinutes: 6,
        useAirMass: true
      });
      out[key] = {
        dayOfYear: SOLSTICE_DAYS[key],
        peakElevationDeg: d.peakElevationDeg,
        minAirMass: d.minAirMass
      };
    });
    return out;
  }

  /**
   * The 5-regime annual comparator for one latitude plus, optionally, a
   * benchmark row per requested latitude. Returns the table rows the page
   * renders directly.
   */
  function compareRegimes(opts) {
    opts = opts || {};
    var res = computeAnnualYield(opts);
    var seasons = computeSeasonExtremes(res.latitude);
    var rows = REGIMES.map(function (regime) {
      return {
        id: regime.id,
        label: regime.label,
        annualKwhM2: res.annual[regime.id],
        gainVsFixedTiltPct: res.gainVsFixedTilt[regime.id],
        gainVsHorizontalPct: res.gainVsHorizontal[regime.id],
        solsticePeakElevationDeg: seasons.summer.peakElevationDeg,
        equinoxPeakElevationDeg: seasons.equinox.peakElevationDeg,
        minAirMass: seasons.summer.minAirMass
      };
    });
    return {
      latitude: res.latitude,
      mode: res.mode,
      stepMinutes: res.stepMinutes,
      rows: rows,
      annual: res.annual,
      monthly: res.monthly,
      seasons: seasons
    };
  }

  /** One benchmark row per latitude for the canonical latitude table. */
  function latitudeBenchmark(opts) {
    opts = opts || {};
    var lats = opts.latitudes || CANONICAL_LATITUDES.slice();
    if (!Array.isArray(lats) || lats.length === 0) {
      fail('latitudes must be a non-empty array');
    }
    var stepMinutes = opts.stepMinutes === undefined ? 12 : opts.stepMinutes;
    var mode = opts.mode === undefined ? 'monthly' : opts.mode;
    return lats.map(function (lat) {
      var res = computeAnnualYield({
        latitude: lat,
        mode: mode,
        stepMinutes: stepMinutes,
        useAirMass: opts.useAirMass
      });
      var seasons = computeSeasonExtremes(lat);
      return {
        latitude: lat,
        annual: res.annual,
        gainVsFixedTiltPct: res.gainVsFixedTilt['dual-axis-helios'],
        solsticePeakElevationDeg: seasons.summer.peakElevationDeg,
        minAirMass: seasons.summer.minAirMass
      };
    });
  }

  /* ------------------------------------------------------- worm self-lock */

  /**
   * Worm lead angle lambda = atan(z1*m / d1) versus the static friction
   * angle phi_s = atan(mu / cos(alpha)). Self-locking holds strictly when
   * lambda < phi_s. This mirrors engine.computeGearTrainMetrics but takes a
   * raw mu so arbitrary sweep values can be probed.
   */
  function computeWormLock(opts) {
    opts = opts || {};
    var m = opts.module === undefined ? 1.5 : opts.module;
    requireRange('module', m, 0.1, 20);
    var z1 = opts.wormStarts === undefined ? 1 : opts.wormStarts;
    requireRange('wormStarts', z1, 1, 8);
    if (Math.floor(z1) !== z1) {
      fail('wormStarts must be an integer');
    }
    var teeth = opts.teeth === undefined ? 24 : opts.teeth;
    requireRange('teeth', teeth, 6, 400);
    if (Math.floor(teeth) !== teeth) {
      fail('teeth must be an integer');
    }
    var q = opts.diameterQuotient === undefined ? 10 : opts.diameterQuotient;
    requireRange('diameterQuotient', q, 2, 40);
    var alphaDeg = opts.pressureAngle === undefined ? 20 : opts.pressureAngle;
    requireRange('pressureAngle', alphaDeg, 5, 35);
    var mu = opts.mu === undefined ? 0.15 : opts.mu;
    requireRange('mu', mu, 0.001, 2);
    var d1 = q * m;
    var leadAngle = Math.atan((z1 * m) / d1);
    var frictionAngle = Math.atan(mu / Math.cos(alphaDeg * DEG));
    var margin = frictionAngle - leadAngle;
    return {
      module: m,
      teeth: teeth,
      wormStarts: z1,
      diameterQuotient: q,
      pressureAngle: alphaDeg,
      mu: mu,
      ratio: teeth / z1,
      leadAngleDeg: leadAngle / DEG,
      frictionAngleDeg: frictionAngle / DEG,
      lockMarginDeg: margin / DEG,
      selfLocking: leadAngle < frictionAngle,
      efficiency: Math.tan(leadAngle) / Math.tan(leadAngle + frictionAngle),
      boundaryMu: Math.tan(leadAngle) * Math.cos(alphaDeg * DEG)
    };
  }

  /** Evaluate all 5 material pairs (plus an optional custom mu) at once. */
  function sweepWormMaterials(opts) {
    opts = opts || {};
    var rows = WORM_MATERIALS.map(function (mat) {
      var lock = computeWormLock({
        module: opts.module,
        teeth: opts.teeth,
        wormStarts: opts.wormStarts,
        diameterQuotient: opts.diameterQuotient,
        pressureAngle: opts.pressureAngle,
        mu: mat.mu
      });
      return {
        id: mat.id,
        label: mat.label,
        mu: mat.mu,
        leadAngleDeg: lock.leadAngleDeg,
        frictionAngleDeg: lock.frictionAngleDeg,
        lockMarginDeg: lock.lockMarginDeg,
        selfLocking: lock.selfLocking,
        efficiency: lock.efficiency
      };
    });
    var custom = null;
    if (opts.customMu !== undefined && opts.customMu !== null) {
      var mu = requireRange('customMu', opts.customMu, 0.001, 2);
      var l2 = computeWormLock({
        module: opts.module,
        teeth: opts.teeth,
        wormStarts: opts.wormStarts,
        diameterQuotient: opts.diameterQuotient,
        pressureAngle: opts.pressureAngle,
        mu: mu
      });
      custom = {
        id: 'custom',
        label: 'Custom friction coefficient',
        mu: mu,
        leadAngleDeg: l2.leadAngleDeg,
        frictionAngleDeg: l2.frictionAngleDeg,
        lockMarginDeg: l2.lockMarginDeg,
        selfLocking: l2.selfLocking,
        efficiency: l2.efficiency
      };
    }
    return { rows: rows, custom: custom, boundaryMu: computeWormLock(optsForLock(opts, 0.15)).boundaryMu };
  }

  function optsForLock(opts, mu) {
    return {
      module: opts.module,
      teeth: opts.teeth,
      wormStarts: opts.wormStarts,
      diameterQuotient: opts.diameterQuotient,
      pressureAngle: opts.pressureAngle,
      mu: mu
    };
  }

  /**
   * Friction angle curve phi_s(mu) for the boundary chart, the constant lead
   * angle line, and the boundary mu where the two intersect.
   */
  function wormBoundaryCurve(opts) {
    opts = opts || {};
    var muMin = opts.muMin === undefined ? CHART_MU_RANGE.min : opts.muMin;
    var muMax = opts.muMax === undefined ? CHART_MU_RANGE.max : opts.muMax;
    requireRange('muMin', muMin, 0, 2);
    requireRange('muMax', muMax, muMin + 0.001, 4);
    var steps = opts.steps === undefined ? 46 : opts.steps;
    if (Math.floor(steps) !== steps || steps < 2 || steps > 400) {
      fail('steps must be an integer between 2 and 400');
    }
    var lock = computeWormLock(optsForLock(opts, 0.15));
    var curve = [];
    for (var i = 0; i <= steps; i++) {
      var mu = muMin + ((muMax - muMin) * i) / steps;
      /* mu = 0 is a legal chart endpoint: atan(0) = 0 exactly, no solver call. */
      var phi = mu <= 0 ? 0 : computeWormLock(optsForLock(opts, mu)).frictionAngleDeg;
      curve.push({ mu: mu, frictionAngleDeg: phi });
    }
    return {
      curve: curve,
      leadAngleDeg: lock.leadAngleDeg,
      boundaryMu: lock.boundaryMu,
      muMin: muMin,
      muMax: muMax
    };
  }

  /* ------------------------------------------------ manifold and PCB audit */

  /**
   * Live Euler-Poincare audit over all 6 gimbal bodies: regenerates the
   * meshes with the current parameters and runs the engine manifold checker
   * on each. Sensors contributes 4 disjoint shells, so chi = 8 there.
   */
  function auditManifold(params) {
    var meshes = E.generateAllPartMeshes(params || {});
    var parts = {};
    var totals = { vertexCount: 0, edgeCount: 0, faceCount: 0, volume: 0, surfaceArea: 0 };
    var allWatertight = true;
    E.PART_IDS.forEach(function (id) {
      var v = E.validateMeshManifold(meshes[id]);
      parts[id] = {
        vertexCount: v.vertexCount,
        edgeCount: v.edgeCount,
        faceCount: v.faceCount,
        eulerCharacteristic: v.eulerCharacteristic,
        shells: v.shells,
        genus: v.genus,
        boundaryEdges: v.boundaryEdges,
        nonManifoldEdges: v.nonManifoldEdges,
        nonManifoldVertices: v.nonManifoldVertices,
        inconsistentEdges: v.inconsistentEdges,
        degenerateFaces: v.degenerateFaces,
        invalidIndices: v.invalidIndices,
        volume: v.volume,
        surfaceArea: v.surfaceArea,
        isWatertight: v.isWatertight,
        isManifold: v.isManifold
      };
      totals.vertexCount += v.vertexCount;
      totals.edgeCount += v.edgeCount;
      totals.faceCount += v.faceCount;
      totals.volume += v.volume;
      totals.surfaceArea += v.surfaceArea;
      if (!v.isWatertight || !v.isManifold) {
        allWatertight = false;
      }
    });
    return { parts: parts, totals: totals, allWatertight: allWatertight };
  }

  /**
   * 48-part PCB verification using only HeliosHardware data: placement
   * centroids inside Edge.Cuts, every symbol pin on a net or NO_CONNECT, and
   * no duplicate placements. When opts.courtyardForRef is supplied (the Node
   * test harness passes tools/kicad.js placedCourtyard) real courtyard
   * rectangles are checked for bounds and pairwise overlap too.
   */
  function auditPcb(hardware, opts) {
    var hw = hardware === undefined || hardware === null ? HW : hardware;
    if (!hw || !Array.isArray(hw.COMPONENTS) || !hw.PLACEMENT ||
        !hw.BOARD || !hw.SYMBOLS || !hw.NETS || !hw.NO_CONNECT ||
        typeof hw.buildPinNetMap !== 'function') {
      fail('a HeliosHardware-shaped dataset is required for the PCB audit');
    }
    opts = opts || {};
    var board = hw.BOARD;
    var refs = Object.keys(hw.PLACEMENT);
    var outOfBounds = [];
    var seenPos = {};
    var duplicatePositions = [];
    refs.forEach(function (ref) {
      var p = hw.PLACEMENT[ref];
      var okPos = Array.isArray(p) && p.length >= 2 &&
        isFinite(p[0]) && isFinite(p[1]) &&
        p[0] >= 0 && p[0] <= board.width && p[1] >= 0 && p[1] <= board.height;
      if (!okPos) {
        outOfBounds.push(ref);
      }
      var key = isFinite(p && p[0]) && isFinite(p && p[1]) ? p[0] + ',' + p[1] : 'invalid';
      if (seenPos[key]) {
        duplicatePositions.push([seenPos[key], ref]);
      } else {
        seenPos[key] = ref;
      }
    });
    var pinNet = hw.buildPinNetMap();
    var unconnected = [];
    var pinsChecked = 0;
    hw.COMPONENTS.forEach(function (comp) {
      var sym = hw.SYMBOLS[comp.symbol];
      if (!sym) {
        unconnected.push(comp.ref + ':missing-symbol');
        return;
      }
      sym.pins.forEach(function (pin) {
        pinsChecked += 1;
        var key = comp.ref + '.' + pin.number;
        if (!pinNet[key] && hw.NO_CONNECT[key] === undefined) {
          unconnected.push(key);
        }
      });
    });
    var courtyard = { checked: false, outOfBounds: [], overlaps: [] };
    if (typeof opts.courtyardForRef === 'function') {
      courtyard.checked = true;
      var boxes = refs.map(function (ref) {
        return { ref: ref, box: opts.courtyardForRef(ref) };
      });
      boxes.forEach(function (entry) {
        var b = entry.box;
        if (!(b.x0 >= 0 && b.y0 >= 0 && b.x1 <= board.width && b.y1 <= board.height)) {
          courtyard.outOfBounds.push(entry.ref);
        }
      });
      for (var i = 0; i < boxes.length; i++) {
        for (var j = i + 1; j < boxes.length; j++) {
          var a = boxes[i].box;
          var b2 = boxes[j].box;
          if (a.x0 < b2.x1 && a.x1 > b2.x0 && a.y0 < b2.y1 && a.y1 > b2.y0) {
            courtyard.overlaps.push([boxes[i].ref, boxes[j].ref]);
          }
        }
      }
    }
    var inBounds = outOfBounds.length === 0;
    var pinsAccounted = unconnected.length === 0;
    var clean = inBounds && pinsAccounted && duplicatePositions.length === 0 &&
      (!courtyard.checked || (courtyard.outOfBounds.length === 0 && courtyard.overlaps.length === 0));
    return {
      componentCount: hw.COMPONENTS.length,
      placedCount: refs.length,
      netCount: Object.keys(hw.NETS).length,
      noConnectCount: Object.keys(hw.NO_CONNECT).length,
      pinsChecked: pinsChecked,
      unconnectedPins: unconnected,
      pinsAccounted: pinsAccounted,
      placementsInBounds: inBounds,
      outOfBounds: outOfBounds,
      duplicatePositions: duplicatePositions,
      courtyard: courtyard,
      bomLines: hw.groupBom().length,
      clean: clean
    };
  }

  /* ------------------------------------------------- FIPS 180-4 SHA-256 */

  var SHA256_K = Object.freeze([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]);

  function utf8Encode(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var cp = str.codePointAt(i);
      if (cp > 0xffff) {
        i++;
      }
      if (cp < 0x80) {
        out.push(cp);
      } else if (cp < 0x800) {
        out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
      } else if (cp < 0x10000) {
        out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
      } else {
        out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f),
          0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
      }
    }
    return out;
  }

  /** SHA-256 digest of a byte array, as lowercase hex. */
  function sha256Bytes(bytes) {
    var bitLen = bytes.length * 8;
    var hi = Math.floor(bitLen / 0x200000000);
    var lo = bitLen % 0x200000000;
    var padded = bytes.slice();
    padded.push(0x80);
    while (padded.length % 64 !== 56) {
      padded.push(0);
    }
    padded.push((hi >>> 24) & 0xff, (hi >>> 16) & 0xff, (hi >>> 8) & 0xff, hi & 0xff);
    padded.push((lo >>> 24) & 0xff, (lo >>> 16) & 0xff, (lo >>> 8) & 0xff, lo & 0xff);
    var h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var w = new Array(64);
    var mask = 0xffffffff;
    function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
    for (var block = 0; block < padded.length; block += 64) {
      var i;
      for (i = 0; i < 16; i++) {
        var j = block + i * 4;
        w[i] = ((padded[j] << 24) | (padded[j + 1] << 16) | (padded[j + 2] << 8) | padded[j + 3]) >>> 0;
      }
      for (i = 16; i < 64; i++) {
        var s0 = (rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)) >>> 0;
        var s1 = (rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)) >>> 0;
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
      for (i = 0; i < 64; i++) {
        var S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
        var ch = ((e & f) ^ (~e & g)) >>> 0;
        var t1 = (hh + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
        var S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
        var maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
        var t2 = (S0 + maj) >>> 0;
        hh = g; g = f; f = e; e = (d + t1) >>> 0;
        d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
      h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
    }
    var hex = '';
    for (var k = 0; k < 8; k++) {
      var s = h[k] & mask;
      for (var sh = 28; sh >= 0; sh -= 4) {
        hex += '0123456789abcdef'[(s >>> sh) & 0xf];
      }
    }
    return hex;
  }

  /** SHA-256 of a JavaScript string encoded as UTF-8. */
  function sha256(text) {
    return sha256Bytes(utf8Encode(String(text)));
  }

  /* ---------------------------------------------------------- base64url */

  var B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

  function b64urlEncodeBytes(bytes) {
    var out = '';
    var i;
    for (i = 0; i + 3 <= bytes.length; i += 3) {
      var n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      out += B64_ALPHABET[(n >> 18) & 63] + B64_ALPHABET[(n >> 12) & 63] +
        B64_ALPHABET[(n >> 6) & 63] + B64_ALPHABET[n & 63];
    }
    var rem = bytes.length - i;
    if (rem === 1) {
      var n1 = bytes[i] << 16;
      out += B64_ALPHABET[(n1 >> 18) & 63] + B64_ALPHABET[(n1 >> 12) & 63];
    } else if (rem === 2) {
      var n2 = (bytes[i] << 16) | (bytes[i + 1] << 8);
      out += B64_ALPHABET[(n2 >> 18) & 63] + B64_ALPHABET[(n2 >> 12) & 63] + B64_ALPHABET[(n2 >> 6) & 63];
    }
    return out;
  }

  function b64urlEncode(text) {
    return b64urlEncodeBytes(utf8Encode(String(text)));
  }

  /** Strict decoder. Throws RangeError on any malformed input. */
  function b64urlDecode(text) {
    if (typeof text !== 'string' || !/^[A-Za-z0-9_-]+$/.test(text)) {
      fail('b64url payload must be non-empty base64url');
    }
    if (text.length % 4 === 1) {
      fail('b64url payload has an impossible length');
    }
    var bytes = [];
    var buffer = 0;
    var bits = 0;
    for (var i = 0; i < text.length; i++) {
      var v = B64_ALPHABET.indexOf(text[i]);
      if (v < 0) {
        fail('b64url payload has an invalid character');
      }
      buffer = (buffer << 6) | v;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        bytes.push((buffer >>> bits) & 0xff);
      }
    }
    // Any leftover bits must be zero padding, or the payload was tampered with.
    if (bits > 0 && (buffer & ((1 << bits) - 1)) !== 0) {
      fail('b64url payload has non-zero trailing bits');
    }
    return bytes;
  }

  /** Decode UTF-8 bytes back into a string; throws on malformed input. */
  function utf8Decode(bytes) {
    var out = '';
    var i = 0;
    while (i < bytes.length) {
      var b = bytes[i];
      var cp;
      var need;
      if (b < 0x80) {
        cp = b;
        need = 0;
      } else if ((b & 0xe0) === 0xc0) {
        cp = b & 0x1f;
        need = 1;
      } else if ((b & 0xf0) === 0xe0) {
        cp = b & 0x0f;
        need = 2;
      } else if ((b & 0xf8) === 0xf0) {
        cp = b & 0x07;
        need = 3;
      } else {
        fail('malformed UTF-8 byte sequence');
      }
      if (i + need >= bytes.length) {
        fail('truncated UTF-8 sequence');
      }
      for (var k = 1; k <= need; k++) {
        var cb = bytes[i + k];
        if ((cb & 0xc0) !== 0x80) {
          fail('malformed UTF-8 continuation byte');
        }
        cp = (cp << 6) | (cb & 0x3f);
      }
      if ((need === 1 && cp < 0x80) || (need === 2 && cp < 0x800) || (need === 3 && cp < 0x10000) ||
          cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
        fail('invalid UTF-8 code point');
      }
      out += String.fromCodePoint(cp);
      i += need + 1;
    }
    return out;
  }

  /* ------------------------------------------------ canonical serialization */

  /** Deterministic JSON: sorted keys, no undefined/functions, -0 folded to 0. */
  function stableStringify(value) {
    return stableStringifyInner(value, []);
  }
  function stableStringifyInner(value, active) {
    if (value === null || typeof value === 'number' || typeof value === 'boolean' ||
        typeof value === 'string') {
      if (typeof value === 'number') {
        if (!isFinite(value)) {
          fail('cannot serialize a non-finite number');
        }
        return JSON.stringify(value === 0 ? 0 : value);
      }
      return JSON.stringify(value);
    }
    if (typeof value === 'object') {
      if (active.indexOf(value) >= 0) {
        fail('cannot serialize a cyclic structure');
      }
      var nextActive = active.concat([value]);
      if (Array.isArray(value)) {
        return '[' + value.map(function (v) { return stableStringifyInner(v, nextActive); }).join(',') + ']';
      }
      var keys = Object.keys(value).sort();
      var parts = keys.map(function (k) {
        return JSON.stringify(k) + ':' + stableStringifyInner(value[k], nextActive);
      });
      return '{' + parts.join(',') + '}';
    }
    fail('cannot serialize value of type ' + typeof value);
    return '';
  }

  /* ---------------------------------------------------------- #hc= codec */

  var HASH_PREFIX = 'hc=';
  var STATE_KEYS = Object.freeze(['lat', 'day', 'reg', 'mat', 'mu', 'teeth', 'mod']);
  var FORBIDDEN_KEYS = Object.freeze(['__proto__', 'constructor', 'prototype']);

  /**
   * Normalize a candidate state object. Returns null for anything malformed:
   * non-objects, unknown or hostile keys, wrong types, or out-of-range values.
   */
  function normalizeLabState(input) {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      return null;
    }
    var keys = Object.keys(input);
    for (var i = 0; i < keys.length; i++) {
      if (FORBIDDEN_KEYS.indexOf(keys[i]) >= 0 || STATE_KEYS.indexOf(keys[i]) < 0) {
        return null;
      }
    }
    var out = {};
    function readNum(key, lo, hi, integer) {
      if (!Object.prototype.hasOwnProperty.call(input, key)) {
        return undefined;
      }
      var v = input[key];
      if (typeof v !== 'number' || !isFinite(v)) {
        return null;
      }
      if (integer && Math.floor(v) !== v) {
        return null;
      }
      if (v < lo || v > hi) {
        return null;
      }
      return v;
    }
    /* Bounds mirror the workbench sliders exactly so any decoded state can be
     * rebuilt: a wider bookmark would clamp on restore and break round-trip. */
    var lat = readNum('lat', -65, 65, false);
    var day = readNum('day', 1, 365, true);
    var mu = readNum('mu', MU_SWEEP.min, MU_SWEEP.max, false);
    var teeth = readNum('teeth', 14, 30, true);
    var mod = readNum('mod', 1.0, 2.5, false);
    if (lat === null || day === null || mu === null || teeth === null || mod === null) {
      return null;
    }
    if (lat !== undefined) { out.lat = roundTo(lat, 4); }
    if (day !== undefined) { out.day = day; }
    if (mu !== undefined) { out.mu = roundTo(mu, 4); }
    if (teeth !== undefined) { out.teeth = teeth; }
    if (mod !== undefined) { out.mod = roundTo(mod, 4); }
    if (Object.prototype.hasOwnProperty.call(input, 'reg')) {
      if (typeof input.reg !== 'string' || REGIME_IDS.indexOf(input.reg) < 0) {
        return null;
      }
      out.reg = input.reg;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'mat')) {
      var matOk = input.mat === 'custom' || MATERIAL_IDS.indexOf(input.mat) >= 0;
      if (typeof input.mat !== 'string' || !matOk) {
        return null;
      }
      out.mat = input.mat;
    }
    return out;
  }

  /** Encode a normalized state into the '#hc=' bookmark payload. */
  function encodeHashState(state) {
    var clean = normalizeLabState(state);
    if (clean === null) {
      fail('state failed normalization; cannot encode');
    }
    if (Object.keys(clean).length === 0) {
      fail('state is empty; nothing to encode');
    }
    return HASH_PREFIX + b64urlEncode(stableStringify(clean));
  }

  /**
   * Decode a '#hc=' bookmark. Fail-closed: any malformed or hostile input
   * returns null instead of throwing.
   */
  function decodeHashState(hash) {
    try {
      if (typeof hash !== 'string') {
        return null;
      }
      var h = hash.charAt(0) === '#' ? hash.slice(1) : hash;
      if (h.indexOf(HASH_PREFIX) !== 0) {
        return null;
      }
      var payload = h.slice(HASH_PREFIX.length);
      var bytes = b64urlDecode(payload);
      var text = utf8Decode(bytes);
      var obj = JSON.parse(text);
      var clean = normalizeLabState(obj);
      if (clean === null || Object.keys(clean).length === 0) {
        return null;
      }
      return clean;
    } catch (e) {
      return null;
    }
  }

  /* --------------------------------------------------- audited brief build */

  var BRIEF_SCHEMA = 'helios-lab-brief/1';
  var DIGEST_DECIMALS = 4;

  /**
   * The canonical engineering-brief payload for a normalized lab state. Every
   * number is rounded so the digest is identical across hosts. Fields:
   * bookmark state, 5-regime annual insolation, worm-lock verdict, the 6-body
   * manifold audit, and the PCB verification summary.
   */
  function buildBriefPayload(state, opts) {
    opts = opts || {};
    var clean = normalizeLabState(state);
    if (clean === null) {
      fail('brief state failed normalization');
    }
    var lat = clean.lat === undefined ? 38.9 : clean.lat;
    var mat = materialById(clean.mat || 'bronze-steel');
    var mu = clean.mu !== undefined ? clean.mu : (mat ? mat.mu : 0.15);
    var teeth = clean.teeth === undefined ? 24 : clean.teeth;
    var mod = clean.mod === undefined ? 1.5 : clean.mod;
    var gear = {
      module: mod,
      teeth: teeth,
      wormStarts: 1,
      diameterQuotient: 10,
      pressureAngle: 20,
      mu: mu
    };
    var yieldRes = computeAnnualYield({
      latitude: lat,
      mode: 'monthly',
      stepMinutes: 12,
      useAirMass: true
    });
    var seasons = computeSeasonExtremes(lat);
    var lock = computeWormLock(gear);
    var manifold = auditManifold({ module: mod, teeth: teeth });
    var pcb = HW ? auditPcb(HW, opts) : null;
    var annual = {};
    var gainPct = {};
    REGIME_IDS.forEach(function (id) {
      annual[id] = roundTo(yieldRes.annual[id], DIGEST_DECIMALS);
      gainPct[id] = roundTo(yieldRes.gainVsFixedTilt[id], DIGEST_DECIMALS);
    });
    var parts = {};
    E.PART_IDS.forEach(function (id) {
      var p = manifold.parts[id];
      parts[id] = {
        v: p.vertexCount,
        e: p.edgeCount,
        f: p.faceCount,
        chi: p.eulerCharacteristic,
        shells: p.shells,
        genus: p.genus,
        boundary: p.boundaryEdges,
        nonManifold: p.nonManifoldEdges + p.nonManifoldVertices,
        degenerate: p.degenerateFaces,
        volumeMm3: roundTo(p.volume, DIGEST_DECIMALS),
        areaMm2: roundTo(p.surfaceArea, DIGEST_DECIMALS),
        watertight: p.isWatertight
      };
    });
    return {
      schema: BRIEF_SCHEMA,
      state: clean,
      solar: {
        latitude: lat,
        annualKwhM2: annual,
        gainPctVsFixedTilt: gainPct,
        solsticePeakElevationDeg: roundTo(seasons.summer.peakElevationDeg, DIGEST_DECIMALS),
        equinoxPeakElevationDeg: roundTo(seasons.equinox.peakElevationDeg, DIGEST_DECIMALS),
        winterPeakElevationDeg: roundTo(seasons.winter.peakElevationDeg, DIGEST_DECIMALS),
        minAirMassSummer: seasons.summer.minAirMass === null ? null : roundTo(seasons.summer.minAirMass, DIGEST_DECIMALS),
        model: 'Spencer1971+Meinel clear-sky beam, 12 Klein representative days'
      },
      worm: {
        materialId: clean.mat || 'bronze-steel',
        mu: mu,
        module: mod,
        teeth: teeth,
        leadAngleDeg: roundTo(lock.leadAngleDeg, DIGEST_DECIMALS),
        frictionAngleDeg: roundTo(lock.frictionAngleDeg, DIGEST_DECIMALS),
        lockMarginDeg: roundTo(lock.lockMarginDeg, DIGEST_DECIMALS),
        selfLocking: lock.selfLocking,
        efficiency: roundTo(lock.efficiency, DIGEST_DECIMALS)
      },
      manifold: {
        allWatertight: manifold.allWatertight,
        totals: {
          v: manifold.totals.vertexCount,
          e: manifold.totals.edgeCount,
          f: manifold.totals.faceCount,
          volumeMm3: roundTo(manifold.totals.volume, DIGEST_DECIMALS),
          areaMm2: roundTo(manifold.totals.surfaceArea, DIGEST_DECIMALS)
        },
        parts: parts
      },
      pcb: pcb ? {
        components: pcb.componentCount,
        placed: pcb.placedCount,
        nets: pcb.netCount,
        noConnects: pcb.noConnectCount,
        pinsChecked: pcb.pinsChecked,
        pinsAccounted: pcb.pinsAccounted,
        placementsInBounds: pcb.placementsInBounds,
        courtyardChecked: pcb.courtyard.checked,
        courtyardOverlaps: pcb.courtyard.overlaps.length,
        bomLines: pcb.bomLines,
        clean: pcb.clean
      } : null
    };
  }

  /**
   * Stamp a payload with its SHA-256 digest. One digest-stamped object per
   * state key: the on-page fingerprint, JSON, CSV header and Markdown footer
   * all read this same field.
   */
  function stampBrief(payload) {
    var digest = sha256(stableStringify(payload));
    var stamped = {};
    Object.keys(payload).forEach(function (k) { stamped[k] = payload[k]; });
    stamped.digest = digest;
    return stamped;
  }

  /** Memoized stamped briefs keyed by encoded state, one payload per key. */
  function createBriefCache(opts) {
    var cache = {};
    return {
      briefFor: function (state, callOpts) {
        var clean = normalizeLabState(state);
        if (clean === null) {
          fail('brief state failed normalization');
        }
        var key = stableStringify(clean) + '|' + stableStringify(callOpts || opts || {});
        if (!Object.prototype.hasOwnProperty.call(cache, key)) {
          cache[key] = stampBrief(buildBriefPayload(clean, callOpts || opts));
        }
        return cache[key];
      }
    };
  }

  /* ------------------------------------------------------- brief exporters */

  function csvSafeCell(value) {
    var s = String(value === null || value === undefined ? '' : value);
    // Formula-injection guard: a cell that opens with = + - @ or a control
    // character gets a leading apostrophe so spreadsheet apps keep it text.
    if (/^[=+\-@\t\r]/.test(s)) {
      s = "'" + s;
    }
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /** Flatten a stamped brief into [section, key, value] CSV rows. */
  function briefRows(stamped) {
    var rows = [];
    rows.push(['state', 'schema', stamped.schema]);
    Object.keys(stamped.state).sort().forEach(function (k) {
      rows.push(['state', k, stamped.state[k]]);
    });
    REGIME_IDS.forEach(function (id) {
      rows.push(['annualKwhM2', id, stamped.solar.annualKwhM2[id]]);
      rows.push(['gainPctVsFixedTilt', id, stamped.solar.gainPctVsFixedTilt[id]]);
    });
    rows.push(['solar', 'solsticePeakElevationDeg', stamped.solar.solsticePeakElevationDeg]);
    rows.push(['solar', 'equinoxPeakElevationDeg', stamped.solar.equinoxPeakElevationDeg]);
    rows.push(['solar', 'winterPeakElevationDeg', stamped.solar.winterPeakElevationDeg]);
    rows.push(['solar', 'minAirMassSummer', stamped.solar.minAirMassSummer]);
    rows.push(['solar', 'model', stamped.solar.model]);
    Object.keys(stamped.worm).forEach(function (k) {
      rows.push(['worm', k, stamped.worm[k]]);
    });
    rows.push(['manifold', 'allWatertight', stamped.manifold.allWatertight]);
    Object.keys(stamped.manifold.totals).forEach(function (k) {
      rows.push(['manifold.totals', k, stamped.manifold.totals[k]]);
    });
    Object.keys(stamped.manifold.parts).forEach(function (id) {
      var p = stamped.manifold.parts[id];
      Object.keys(p).forEach(function (k) {
        rows.push(['manifold.' + id, k, p[k]]);
      });
    });
    if (stamped.pcb) {
      Object.keys(stamped.pcb).forEach(function (k) {
        rows.push(['pcb', k, stamped.pcb[k]]);
      });
    }
    rows.push(['audit', 'sha256', stamped.digest]);
    return rows;
  }

  function briefToJson(stamped) {
    if (!stamped || typeof stamped.digest !== 'string') {
      fail('stamped brief required');
    }
    return JSON.stringify(stamped, null, 2) + '\n';
  }

  function briefToCsv(stamped) {
    if (!stamped || typeof stamped.digest !== 'string') {
      fail('stamped brief required');
    }
    var payloadB64 = b64urlEncode(stableStringify(stripDigest(stamped)));
    var lines = [
      '# helios-lab engineering brief',
      '# schema: ' + stamped.schema,
      '# sha256: ' + stamped.digest,
      '# payload-b64url: ' + payloadB64,
      'section,key,value'
    ];
    briefRows(stamped).forEach(function (row) {
      lines.push(row.map(csvSafeCell).join(','));
    });
    return lines.join('\n') + '\n';
  }

  function briefToMarkdown(stamped) {
    if (!stamped || typeof stamped.digest !== 'string') {
      fail('stamped brief required');
    }
    var out = [];
    out.push('# Helios-6 Lab Engineering Brief');
    out.push('');
    out.push('| State | Value |');
    out.push('| --- | --- |');
    var stateLabels = {
      lat: 'Latitude (deg)', day: 'Day of year', reg: 'Tracking regime',
      mat: 'Worm material', mu: 'Friction coefficient', teeth: 'Wheel teeth', mod: 'Gear module (mm)'
    };
    Object.keys(stamped.state).sort().forEach(function (k) {
      out.push('| ' + (stateLabels[k] || k) + ' | ' + stamped.state[k] + ' |');
    });
    out.push('');
    out.push('## Annual clear-sky insolation (kWh/m^2)');
    out.push('');
    out.push('| Regime | Annual | % vs fixed tilt |');
    out.push('| --- | --- | --- |');
    REGIMES.forEach(function (r) {
      out.push('| ' + r.label + ' | ' + stamped.solar.annualKwhM2[r.id] + ' | ' +
        stamped.solar.gainPctVsFixedTilt[r.id] + ' |');
    });
    out.push('');
    out.push('## Worm-gear self-lock');
    out.push('');
    out.push('| Metric | Value |');
    out.push('| --- | --- |');
    out.push('| Lead angle (deg) | ' + stamped.worm.leadAngleDeg + ' |');
    out.push('| Friction angle (deg) | ' + stamped.worm.frictionAngleDeg + ' |');
    out.push('| Lock margin (deg) | ' + stamped.worm.lockMarginDeg + ' |');
    out.push('| Verdict | ' + (stamped.worm.selfLocking ? 'Self-locking' : 'Back-drivable') + ' |');
    out.push('| Static efficiency | ' + stamped.worm.efficiency + ' |');
    out.push('');
    out.push('## 6-body manifold audit');
    out.push('');
    out.push('| Part | V | E | F | chi | genus | Watertight |');
    out.push('| --- | --- | --- | --- | --- | --- | --- |');
    E.PART_IDS.forEach(function (id) {
      var p = stamped.manifold.parts[id];
      out.push('| ' + id + ' | ' + p.v + ' | ' + p.e + ' | ' + p.f + ' | ' + p.chi + ' | ' +
        p.genus + ' | ' + (p.watertight ? 'yes' : 'NO') + ' |');
    });
    out.push('');
    if (stamped.pcb) {
      out.push('## PCB verification');
      out.push('');
      out.push('| Check | Result |');
      out.push('| --- | --- |');
      out.push('| Components placed | ' + stamped.pcb.placed + ' |');
      out.push('| Nets | ' + stamped.pcb.nets + ' |');
      out.push('| Pins accounted | ' + stamped.pcb.pinsChecked + ' |');
      out.push('| Unconnected pins | ' + (stamped.pcb.pinsAccounted ? 0 : 'see unconnectedPins') + ' |');
      out.push('| Placements in Edge.Cuts | ' + (stamped.pcb.placementsInBounds ? 'all' : 'VIOLATION') + ' |');
      out.push('');
    }
    out.push('---');
    out.push('sha256: ' + stamped.digest);
    out.push('payload-b64url: ' + b64urlEncode(stableStringify(stripDigest(stamped))));
    return out.join('\n') + '\n';
  }

  function stripDigest(stamped) {
    var payload = {};
    Object.keys(stamped).forEach(function (k) {
      if (k !== 'digest') {
        payload[k] = stamped[k];
      }
    });
    return payload;
  }

  /** Recompute the SHA-256 of a stamped brief's payload portion. */
  function recomputeDigest(stamped) {
    if (!stamped || typeof stamped !== 'object') {
      fail('stamped brief required');
    }
    return sha256(stableStringify(stripDigest(stamped)));
  }

  /** Verify a stamped brief object carries its honest digest. */
  function verifyBrief(stamped) {
    var actual;
    try {
      actual = recomputeDigest(stamped);
    } catch (e) {
      return { ok: false, expected: stamped && stamped.digest ? stamped.digest : null, actual: null };
    }
    return {
      ok: actual === stamped.digest,
      expected: stamped.digest,
      actual: actual
    };
  }

  /**
   * Verify a JSON, CSV or Markdown export round-trips the same digest: the
   * embedded payload-b64url is decoded, re-serialized, and hashed.
   */
  function verifyExportedText(text) {
    if (typeof text !== 'string') {
      return { ok: false, expected: null, actual: null };
    }
    var digestMatch = /sha256:\s*([0-9a-f]{64})/.exec(text);
    var payloadMatch = /payload-b64url:\s*([A-Za-z0-9_-]+)/.exec(text);
    if (!digestMatch || !payloadMatch) {
      return { ok: false, expected: digestMatch ? digestMatch[1] : null, actual: null };
    }
    try {
      var payload = JSON.parse(utf8Decode(b64urlDecode(payloadMatch[1])));
      var actual = sha256(stableStringify(payload));
      return { ok: actual === digestMatch[1], expected: digestMatch[1], actual: actual };
    } catch (e) {
      return { ok: false, expected: digestMatch[1], actual: null };
    }
  }

  /** For JSON exports the payload is the file itself minus the digest field. */
  function verifyExportedJson(text) {
    try {
      var obj = JSON.parse(text);
      if (!obj || typeof obj.digest !== 'string') {
        return { ok: false, expected: null, actual: null };
      }
      var res = verifyBrief(obj);
      return res;
    } catch (e) {
      return { ok: false, expected: null, actual: null };
    }
  }

  /** Tamper demo: clone a stamped brief, perturb one number, keep the stale digest. */
  function demonstrateTamper(stamped) {
    if (!stamped || typeof stamped !== 'object') {
      fail('stamped brief required');
    }
    var clone = JSON.parse(JSON.stringify(stamped));
    if (clone.solar && clone.solar.annualKwhM2 &&
        typeof clone.solar.annualKwhM2['dual-axis-helios'] === 'number') {
      clone.solar.annualKwhM2['dual-axis-helios'] =
        roundTo(clone.solar.annualKwhM2['dual-axis-helios'] * 1.01 + 0.5, DIGEST_DECIMALS);
    } else {
      clone.tamperProbe = 'mutated';
    }
    return {
      tampered: clone,
      verify: verifyBrief(clone)
    };
  }

  /* -------------------------------------------------- in-page self tests */

  /**
   * 18 deterministic checks the page can run on demand. Each returns
   * {id, name, ok, detail}; the page renders the tally like 18/18.
   */
  function runSelfTests(engineOverride, hardwareOverride) {
    var eng = engineOverride || E;
    var hw = hardwareOverride === undefined ? HW : hardwareOverride;
    var results = [];
    function check(id, name, fn) {
      var ok = false;
      var detail = '';
      try {
        var r = fn();
        ok = r === undefined ? true : Boolean(r.ok);
        detail = r && r.detail !== undefined ? String(r.detail) : '';
      } catch (e) {
        ok = false;
        detail = String(e && e.message ? e.message : e);
      }
      results.push({ id: id, name: name, ok: ok, detail: detail });
    }

    check('sha256-abc', 'SHA-256 KAT "abc"', function () {
      var d = sha256('abc');
      return { ok: d === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', detail: d.slice(0, 16) + '...' };
    });
    check('sha256-empty', 'SHA-256 KAT empty string', function () {
      var d = sha256('');
      return { ok: d === 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', detail: d.slice(0, 16) + '...' };
    });
    check('sha256-fox', 'SHA-256 KAT quick brown fox', function () {
      var d = sha256('The quick brown fox jumps over the lazy dog');
      return { ok: d === 'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592', detail: d.slice(0, 16) + '...' };
    });
    check('decl-equinox', 'Equinox declination near 0 deg', function () {
      var d80 = Math.abs(eng.computeDeclination(80, 12));
      var d266 = Math.abs(eng.computeDeclination(266, 12));
      return { ok: d80 < 1.2 && d266 < 1.2, detail: 'd80=' + d80.toFixed(3) + ' d266=' + d266.toFixed(3) };
    });
    check('decl-solstice', 'Solstice declination near +/-23.44 deg', function () {
      var s = eng.computeDeclination(172, 12);
      var w = eng.computeDeclination(355, 12);
      return {
        ok: s > 23.0 && s < 23.6 && w < -23.0 && w > -23.6,
        detail: 'sum=' + s.toFixed(2) + ' win=' + w.toFixed(2)
      };
    });
    check('monotonic', 'dual >= fixed tilt >= horizontal (annual, 4 latitudes)', function () {
      var bad = '';
      CANONICAL_LATITUDES.forEach(function (lat) {
        var r = computeAnnualYield({ latitude: lat, mode: 'monthly', stepMinutes: 24 });
        var a = r.annual;
        if (!(a['dual-axis-helios'] >= a['fixed-lat-tilt'] - 1e-9 &&
              a['fixed-lat-tilt'] >= a.horizontal - 1e-9)) {
          bad += lat + ' ';
        }
      });
      return { ok: bad === '', detail: bad === '' ? 'ordered at 0, 29.6, 40.7, 55.7' : 'violation at ' + bad };
    });
    check('dual-supremum', 'dual-axis >= every other regime (annual)', function () {
      var bad = '';
      CANONICAL_LATITUDES.forEach(function (lat) {
        var r = computeAnnualYield({ latitude: lat, mode: 'monthly', stepMinutes: 24 });
        REGIME_IDS.forEach(function (id) {
          if (r.annual['dual-axis-helios'] < r.annual[id] - 1e-9) {
            bad += lat + ':' + id + ' ';
          }
        });
      });
      return { ok: bad === '', detail: bad === '' ? 'supremum holds' : 'violation at ' + bad };
    });
    check('worm-boundary', 'self-locking verdict flips exactly at boundary mu', function () {
      var base = { module: 1.5, teeth: 24, wormStarts: 1, diameterQuotient: 10, pressureAngle: 20 };
      var l0 = computeWormLock({ module: 1.5, teeth: 24, wormStarts: 1, diameterQuotient: 10, pressureAngle: 20, mu: 0.15 });
      var muB = l0.boundaryMu;
      var below = computeWormLock({ module: 1.5, teeth: 24, wormStarts: 1, diameterQuotient: 10, pressureAngle: 20, mu: muB * 0.995 });
      var above = computeWormLock({ module: 1.5, teeth: 24, wormStarts: 1, diameterQuotient: 10, pressureAngle: 20, mu: muB * 1.005 });
      var atEdge = computeWormLock({ module: 1.5, teeth: 24, wormStarts: 1, diameterQuotient: 10, pressureAngle: 20, mu: muB });
      var expected = Math.tan(l0.leadAngleDeg * DEG) * Math.cos(20 * DEG);
      return {
        ok: below.selfLocking === false && above.selfLocking === true && atEdge.selfLocking === false &&
            Math.abs(muB - expected) < 1e-9,
        detail: 'mu*=' + muB.toFixed(4)
      };
    });
    check('manifold-6', '6-body watertight Euler-Poincare audit', function () {
      var a = auditManifold({});
      var ok = a.allWatertight;
      Object.keys(a.parts).forEach(function (id) {
        var p = a.parts[id];
        if (!(p.eulerCharacteristic === p.vertexCount - p.edgeCount + p.faceCount)) {
          ok = false;
        }
      });
      return { ok: ok, detail: 'chi parts ' + (ok ? 'consistent' : 'BROKEN') };
    });
    check('pcb-48', '48-part PCB pin and placement audit', function () {
      if (!hw) {
        return { ok: false, detail: 'HeliosHardware missing' };
      }
      var a = auditPcb(hw);
      return {
        ok: a.componentCount === 48 && a.placedCount === 48 && a.pinsAccounted &&
            a.placementsInBounds && a.duplicatePositions.length === 0,
        detail: a.pinsChecked + ' pins, ' + a.netCount + ' nets'
      };
    });
    check('csv-formula', 'CSV formula-injection escaping', function () {
      var probe = csvSafeCell('=CMD()') + ',' + csvSafeCell('+SUM(1)') + ',' + csvSafeCell('@x') + ',' + csvSafeCell('-1');
      return { ok: probe === "'=CMD(),'+SUM(1),'@x,'-1", detail: probe };
    });
    check('tamper-detect', 'tamper detection catches a mutated payload', function () {
      var stamped = stampBrief({ schema: BRIEF_SCHEMA, probe: 1 });
      var demo = demonstrateTamper(stamped);
      return { ok: demo.verify.ok === false && verifyBrief(stamped).ok === true, detail: 'stale digest rejected' };
    });
    check('digest-parity', 'one digest across page, JSON, CSV and Markdown', function () {
      var stamped = stampBrief(buildBriefPayload({ lat: 38.9 }));
      var json = briefToJson(stamped);
      var csv = briefToCsv(stamped);
      var md = briefToMarkdown(stamped);
      var okJson = verifyExportedJson(json).ok;
      var okCsv = verifyExportedText(csv).ok;
      var okMd = verifyExportedText(md).ok;
      return { ok: okJson && okCsv && okMd && recomputeDigest(stamped) === stamped.digest, detail: 'digests equal' };
    });
    check('hc-roundtrip', '#hc= bookmark round-trip', function () {
      var state = { lat: 38.9, day: 172, reg: 'dual-axis-helios', mat: 'bronze-steel', mu: 0.15, teeth: 24, mod: 1.5 };
      var h = encodeHashState(state);
      var back = decodeHashState('#' + h);
      var same = back !== null && Object.keys(state).every(function (k) { return back[k] === state[k]; });
      return { ok: same && h.indexOf('hc=') === 0, detail: h.slice(0, 24) + '...' };
    });
    check('hc-hostile', '#hc= rejects malformed and hostile hashes', function () {
      var badOnes = [
        '#hc=***', '#hc=', '#xx=AAAA', 'not-a-hash', '#hc=!!!!',
        '#' + HASH_PREFIX + b64urlEncode('{"lat":200}'),
        '#' + HASH_PREFIX + b64urlEncode('{"__proto__":{"x":1},"lat":10}'),
        '#' + HASH_PREFIX + b64urlEncode('{"constructor":1}'),
        '#' + HASH_PREFIX + b64urlEncode('[1,2,3]'),
        '#' + HASH_PREFIX + b64urlEncode('{"lat":10,"bogus":1}')
      ];
      var rejected = badOnes.every(function (h) { return decodeHashState(h) === null; });
      return { ok: rejected, detail: badOnes.length + ' hostile inputs rejected' };
    });
    check('b64url', 'base64url codec round-trips and stays strict', function () {
      var samples = ['a', 'ab', 'abc', 'abcd', '{"lat":38.9,"day":172}'];
      var ok = true;
      for (var i = 0; i < samples.length; i++) {
        var enc = b64urlEncode(samples[i]);
        if (utf8Decode(b64urlDecode(enc)) !== samples[i]) {
          ok = false;
        }
      }
      try {
        b64urlDecode('A');
        ok = false;
      } catch (e) {}
      try {
        b64urlDecode('####');
        ok = false;
      } catch (e2) {}
      try {
        b64urlDecode('');
        ok = false;
      } catch (e3) {}
      return { ok: ok, detail: 'strict decode' };
    });
    check('yield-parity', 'monthly vs full-year integration parity', function () {
      var m = computeAnnualYield({ latitude: 40.7, mode: 'monthly', stepMinutes: 30 });
      var f = computeAnnualYield({ latitude: 40.7, mode: 'full', stepMinutes: 30 });
      var rel = Math.abs(m.annual['dual-axis-helios'] - f.annual['dual-axis-helios']) / f.annual['dual-axis-helios'];
      return { ok: rel < 0.02, detail: 'monthly within ' + (rel * 100).toFixed(2) + '% of full' };
    });
    check('engine-parity', 'regime energies match engine surface energies', function () {
      var lat = 38.9;
      var doy = 172;
      var mine = computeDailyYield({ latitude: lat, dayOfYear: doy, stepMinutes: 6 });
      var ref = eng.computeOptimalTiltGain({ latitude: lat, dayOfYear: doy, stepMinutes: 6 });
      var ok = Math.abs(mine.energies.horizontal - ref.horizontalEnergy) < 1e-9 &&
        Math.abs(mine.energies['fixed-lat-tilt'] - ref.fixedTiltEnergy) < 1e-9 &&
        Math.abs(mine.energies['dual-axis-helios'] - ref.trackerEnergy) < 1e-9;
      return { ok: ok, detail: 'horizontal/fixed/dual equal engine values' };
    });

    var passed = results.filter(function (r) { return r.ok; }).length;
    return { results: results, passed: passed, total: results.length, allOk: passed === results.length };
  }

  return {
    REGIMES: REGIMES,
    REGIME_IDS: REGIME_IDS,
    CANONICAL_LATITUDES: CANONICAL_LATITUDES,
    MONTHS: MONTHS,
    WORM_MATERIALS: WORM_MATERIALS,
    MATERIAL_IDS: MATERIAL_IDS,
    MU_SWEEP: MU_SWEEP,
    CHART_MU_RANGE: CHART_MU_RANGE,
    SOLSTICE_DAYS: SOLSTICE_DAYS,
    BRIEF_SCHEMA: BRIEF_SCHEMA,
    materialById: materialById,
    cosIncidenceFor: cosIncidenceFor,
    computeDailyYield: computeDailyYield,
    computeAnnualYield: computeAnnualYield,
    computeSeasonExtremes: computeSeasonExtremes,
    compareRegimes: compareRegimes,
    latitudeBenchmark: latitudeBenchmark,
    computeWormLock: computeWormLock,
    sweepWormMaterials: sweepWormMaterials,
    wormBoundaryCurve: wormBoundaryCurve,
    auditManifold: auditManifold,
    auditPcb: auditPcb,
    utf8Encode: utf8Encode,
    utf8Decode: utf8Decode,
    sha256Bytes: sha256Bytes,
    sha256: sha256,
    b64urlEncodeBytes: b64urlEncodeBytes,
    b64urlEncode: b64urlEncode,
    b64urlDecode: b64urlDecode,
    stableStringify: stableStringify,
    normalizeLabState: normalizeLabState,
    encodeHashState: encodeHashState,
    decodeHashState: decodeHashState,
    buildBriefPayload: buildBriefPayload,
    stampBrief: stampBrief,
    createBriefCache: createBriefCache,
    briefToJson: briefToJson,
    briefToCsv: briefToCsv,
    briefToMarkdown: briefToMarkdown,
    briefRows: briefRows,
    csvSafeCell: csvSafeCell,
    recomputeDigest: recomputeDigest,
    verifyBrief: verifyBrief,
    verifyExportedText: verifyExportedText,
    verifyExportedJson: verifyExportedJson,
    demonstrateTamper: demonstrateTamper,
    runSelfTests: runSelfTests
  };
}));
