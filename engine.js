/*
 * Helios-6 engine: solar position, worm-gear kinematics, procedural watertight
 * STL meshes, mesh validation, OpenSCAD export and projection math.
 *
 * UMD module. Browser global: window.HeliosEngine. Node: require('./engine.js').
 * No dependencies. Units: millimetres and degrees unless a name says otherwise.
 *
 * Coordinate convention: +Z up, +Y north, +X east. Azimuth is measured from
 * north, clockwise (east is 90).
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.HeliosEngine = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEG = Math.PI / 180;
  var TAU = 2 * Math.PI;
  var SOLAR_CONSTANT_KW_M2 = 1.353;
  var EXPLODE_SPACING_MM = 45;

  var DEFAULT_PARAMS = Object.freeze({
    module: 1.5,
    teeth: 24,
    wallThickness: 3,
    latitude: 38.9,
    faceWidth: 6,
    boreDiameter: 8,
    pressureAngle: 20,
    wormStarts: 1,
    diameterQuotient: 10,
    frictionCoefficient: 0.15,
    printTolerance: 0.1,
    stepsPerRev: 200,
    microsteps: 16,
    panelWidth: 48,
    panelDepth: 36,
    panelThickness: 3,
    flankSteps: 4,
    baseSegments: 96
  });

  var DEFAULT_LIMITS = Object.freeze({ azMin: 45, azMax: 315, elMin: 5, elMax: 90 });

  /* ---------------------------------------------------------------- helpers */

  function fail(message) {
    throw new RangeError(message);
  }

  function clamp(value, lo, hi) {
    return Math.min(hi, Math.max(lo, value));
  }

  function normalizeDegrees(deg) {
    var d = deg % 360;
    return d < 0 ? d + 360 : d;
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

  function requireInteger(name, value, lo, hi) {
    requireRange(name, value, lo, hi);
    if (Math.floor(value) !== value) {
      fail(name + ' must be an integer');
    }
    return value;
  }

  /* ------------------------------------------------------------ solar model */

  /** Spencer (1971) fractional year in radians. */
  function fractionalYear(dayOfYear, solarHour) {
    return (TAU / 365) * (dayOfYear - 1 + (solarHour - 12) / 24);
  }

  /** Equation of time in minutes (Spencer 1971). */
  function computeEquationOfTime(dayOfYear, solarHour) {
    var g = fractionalYear(dayOfYear, solarHour === undefined ? 12 : solarHour);
    return 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) -
      0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  }

  /** Solar declination in degrees (Spencer 1971). */
  function computeDeclination(dayOfYear, solarHour) {
    var g = fractionalYear(dayOfYear, solarHour === undefined ? 12 : solarHour);
    var rad = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) -
      0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) -
      0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
    return rad / DEG;
  }

  /** Clock time to apparent solar time, in hours. */
  function clockToSolarHour(clockHour, longitude, utcOffsetHours, dayOfYear) {
    var eot = computeEquationOfTime(dayOfYear, clockHour);
    return clockHour + (4 * (longitude - 15 * utcOffsetHours) + eot) / 60;
  }

  function sunVectorFromAngles(azimuthDeg, elevationDeg) {
    var az = azimuthDeg * DEG;
    var el = elevationDeg * DEG;
    return [Math.cos(el) * Math.sin(az), Math.cos(el) * Math.cos(az), Math.sin(el)];
  }

  /**
   * Sun position for a latitude, day of year and apparent solar hour.
   * Optional: pass clockHour, longitude and utcOffsetHours instead of solarHour.
   * Atmospheric refraction is not modelled.
   */
  function computeSolarPosition(opts) {
    var latitude = requireRange('latitude', opts.latitude, -89, 89);
    var dayOfYear = requireRange('dayOfYear', opts.dayOfYear, 1, 366);
    var solarHour;
    if (opts.solarHour !== undefined) {
      solarHour = requireFinite('solarHour', opts.solarHour);
    } else {
      requireFinite('clockHour', opts.clockHour);
      requireFinite('longitude', opts.longitude);
      requireFinite('utcOffsetHours', opts.utcOffsetHours);
      solarHour = clockToSolarHour(opts.clockHour, opts.longitude, opts.utcOffsetHours, dayOfYear);
    }
    var declinationDeg = computeDeclination(dayOfYear, solarHour);
    var eot = computeEquationOfTime(dayOfYear, solarHour);
    var hourAngleDeg = 15 * (solarHour - 12);
    var phi = latitude * DEG;
    var delta = declinationDeg * DEG;
    var omega = hourAngleDeg * DEG;
    var sinAlt = Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.cos(omega);
    var elevationDeg = Math.asin(clamp(sinAlt, -1, 1)) / DEG;
    var fromSouthWest = Math.atan2(
      Math.sin(omega) * Math.cos(delta),
      Math.cos(omega) * Math.sin(phi) * Math.cos(delta) - Math.sin(delta) * Math.cos(phi)
    ) / DEG;
    var azimuthDeg = normalizeDegrees(fromSouthWest + 180);
    return {
      declinationDeg: declinationDeg,
      equationOfTimeMin: eot,
      hourAngleDeg: hourAngleDeg,
      elevationDeg: elevationDeg,
      zenithDeg: 90 - elevationDeg,
      azimuthDeg: azimuthDeg,
      isDaylight: elevationDeg > 0,
      sunVector: sunVectorFromAngles(azimuthDeg, elevationDeg)
    };
  }

  /** Sunrise to sunset length in hours (0 for polar night, 24 for polar day). */
  function computeDaylightHours(latitude, dayOfYear) {
    var delta = computeDeclination(dayOfYear, 12) * DEG;
    var x = -Math.tan(latitude * DEG) * Math.tan(delta);
    if (x >= 1) {
      return 0;
    }
    if (x <= -1) {
      return 24;
    }
    return (2 * Math.acos(x) / DEG) / 15;
  }

  /** Daytime sun positions at a fixed interval (elevation above 0 only). */
  function computeSunPath(opts) {
    var step = opts.stepMinutes === undefined ? 15 : opts.stepMinutes;
    requireRange('stepMinutes', step, 1, 120);
    var points = [];
    var count = Math.round(1440 / step);
    for (var i = 0; i <= count; i++) {
      var hour = (i * step) / 60;
      var pos = computeSolarPosition({ latitude: opts.latitude, dayOfYear: opts.dayOfYear, solarHour: hour });
      if (pos.elevationDeg > 0) {
        points.push({ hour: hour, azimuth: pos.azimuthDeg, elevation: pos.elevationDeg });
      }
    }
    return points;
  }

  /** Meinel clear-sky beam factor, 0.7^(AM^0.678), AM capped at 38. */
  function beamAttenuation(elevationDeg) {
    if (elevationDeg <= 0) {
      return 0;
    }
    var airMass = Math.min(38, 1 / Math.sin(elevationDeg * DEG));
    return Math.pow(0.7, Math.pow(airMass, 0.678));
  }

  /**
   * Daily clear-sky beam energy on three surfaces for one day: a dual-axis
   * tracker, a fixed horizontal panel, and a fixed panel tilted at the
   * latitude facing the equator. Energy is in kWh per square metre of panel
   * (beam only, no diffuse light, no panel losses) when useAirMass is on,
   * otherwise it is plain geometric hours of cosine-weighted sun.
   */
  function computeOptimalTiltGain(opts) {
    var latitude = requireRange('latitude', opts.latitude, -89, 89);
    var dayOfYear = requireRange('dayOfYear', opts.dayOfYear, 1, 366);
    var stepMinutes = opts.stepMinutes === undefined ? 6 : opts.stepMinutes;
    requireRange('stepMinutes', stepMinutes, 1, 60);
    var useAirMass = opts.useAirMass !== false;
    var dt = stepMinutes / 60;
    var steps = Math.round(24 / dt);
    var tilt = Math.abs(latitude) * DEG;
    var panelAzimuth = latitude >= 0 ? 180 : 0;
    var tracker = 0;
    var horizontal = 0;
    var fixedTilt = 0;
    var daylight = 0;
    var peak = 0;
    for (var i = 0; i < steps; i++) {
      var pos = computeSolarPosition({ latitude: latitude, dayOfYear: dayOfYear, solarHour: (i + 0.5) * dt });
      if (pos.elevationDeg > 0) {
        var el = pos.elevationDeg * DEG;
        var weight = useAirMass ? SOLAR_CONSTANT_KW_M2 * beamAttenuation(pos.elevationDeg) : 1;
        var cosFixed = Math.sin(el) * Math.cos(tilt) +
          Math.cos(el) * Math.sin(tilt) * Math.cos((pos.azimuthDeg - panelAzimuth) * DEG);
        tracker += weight * dt;
        horizontal += weight * Math.sin(el) * dt;
        fixedTilt += weight * Math.max(0, cosFixed) * dt;
        daylight += dt;
        peak = Math.max(peak, pos.elevationDeg);
      }
    }
    return {
      latitude: latitude,
      dayOfYear: dayOfYear,
      daylightHours: daylight,
      peakElevationDeg: peak,
      trackerEnergy: tracker,
      horizontalEnergy: horizontal,
      fixedTiltEnergy: fixedTilt,
      fixedTiltDeg: Math.abs(latitude),
      gainVsHorizontal: horizontal > 0 ? tracker / horizontal : 0,
      gainVsFixedTilt: fixedTilt > 0 ? tracker / fixedTilt : 0
    };
  }

  /* ---------------------------------------------------------- vector helpers */

  function vecSub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function vecDot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function vecCross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  function vecLength(a) { return Math.sqrt(vecDot(a, a)); }
  function vecNormalize(a) {
    var len = vecLength(a);
    return len > 0 ? [a[0] / len, a[1] / len, a[2] / len] : [0, 0, 0];
  }

  function rotateAboutX(p, deg) {
    var c = Math.cos(deg * DEG);
    var s = Math.sin(deg * DEG);
    return [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c];
  }

  function rotateAboutZ(p, deg) {
    var c = Math.cos(deg * DEG);
    var s = Math.sin(deg * DEG);
    return [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]];
  }

  function angularSeparationDeg(azA, elA, azB, elB) {
    var d = vecDot(sunVectorFromAngles(azA, elA), sunVectorFromAngles(azB, elB));
    return Math.acos(clamp(d, -1, 1)) / DEG;
  }

  /* ------------------------------------------------------------------- gears */

  function involute(angleRad) {
    return Math.tan(angleRad) - angleRad;
  }

  function normalizeParams(input) {
    var p = {};
    var key;
    for (key in DEFAULT_PARAMS) {
      if (Object.prototype.hasOwnProperty.call(DEFAULT_PARAMS, key)) {
        p[key] = DEFAULT_PARAMS[key];
      }
    }
    if (input) {
      for (key in input) {
        if (Object.prototype.hasOwnProperty.call(input, key) && input[key] !== undefined) {
          if (!Object.prototype.hasOwnProperty.call(DEFAULT_PARAMS, key)) {
            fail('unknown parameter ' + key);
          }
          p[key] = input[key];
        }
      }
    }
    requireRange('module', p.module, 0.5, 4);
    requireInteger('teeth', p.teeth, 12, 80);
    requireRange('wallThickness', p.wallThickness, 1.2, 8);
    requireRange('latitude', p.latitude, -85, 85);
    requireRange('faceWidth', p.faceWidth, 3, 20);
    requireRange('boreDiameter', p.boreDiameter, 2, 40);
    requireRange('pressureAngle', p.pressureAngle, 14.5, 25);
    requireInteger('wormStarts', p.wormStarts, 1, 4);
    requireRange('diameterQuotient', p.diameterQuotient, 5, 20);
    requireRange('frictionCoefficient', p.frictionCoefficient, 0.01, 0.6);
    requireRange('printTolerance', p.printTolerance, 0, 0.6);
    requireInteger('stepsPerRev', p.stepsPerRev, 20, 800);
    requireInteger('microsteps', p.microsteps, 1, 256);
    requireRange('panelWidth', p.panelWidth, 20, 150);
    requireRange('panelDepth', p.panelDepth, 20, 150);
    requireRange('panelThickness', p.panelThickness, 1, 10);
    requireInteger('flankSteps', p.flankSteps, 2, 12);
    requireInteger('baseSegments', p.baseSegments, 24, 360);
    var g = gearGeometry(p);
    if (p.boreDiameter / 2 > g.rootRadius - 1.5) {
      fail('boreDiameter leaves less than 1.5 mm of rim under the tooth roots');
    }
    return p;
  }

  /** Spur-profile gear dimensions shared by the wheel mesh and the SCAD export. */
  function gearGeometry(p) {
    var alpha = p.pressureAngle * DEG;
    var pitchRadius = p.module * p.teeth / 2;
    var baseRadius = pitchRadius * Math.cos(alpha);
    var tipRadius = pitchRadius + p.module;
    var rootRadius = pitchRadius - 1.25 * p.module;
    var backlash = p.printTolerance + 0.04 * p.module;
    var halfPitchAngle = Math.PI / (2 * p.teeth) - backlash / (4 * pitchRadius);
    return {
      pitchRadius: pitchRadius,
      baseRadius: baseRadius,
      tipRadius: tipRadius,
      rootRadius: rootRadius,
      backlash: backlash,
      halfPitchAngle: halfPitchAngle,
      startRadius: Math.max(baseRadius, rootRadius),
      invAlpha: involute(alpha)
    };
  }

  function toothHalfAngle(g, r) {
    var ratio = Math.min(1, g.baseRadius / r);
    return g.halfPitchAngle + g.invAlpha - involute(Math.acos(ratio));
  }

  /** Spur gear metrics from module, tooth count and pressure angle. */
  function computeSpurMetrics(opts) {
    var m = requireRange('module', opts.module, 0.1, 20);
    var z = requireInteger('teeth', opts.teeth, 6, 400);
    var alphaDeg = opts.pressureAngle === undefined ? 20 : opts.pressureAngle;
    requireRange('pressureAngle', alphaDeg, 10, 30);
    var alpha = alphaDeg * DEG;
    var pitchDiameter = m * z;
    var sinA = Math.sin(alpha);
    return {
      module: m,
      teeth: z,
      pitchDiameter: pitchDiameter,
      baseDiameter: pitchDiameter * Math.cos(alpha),
      outsideDiameter: pitchDiameter + 2 * m,
      rootDiameter: pitchDiameter - 2.5 * m,
      circularPitch: Math.PI * m,
      minTeethNoUndercut: Math.ceil(2 / (sinA * sinA))
    };
  }

  /**
   * Worm drive metrics. Lead angle lambda = atan(z1 * m / d1). Friction angle
   * is atan(mu / cos(alpha)). Static self-locking needs lambda below it.
   */
  function computeGearTrainMetrics(input) {
    var p = normalizeParams(input);
    var m = p.module;
    var z1 = p.wormStarts;
    var z2 = p.teeth;
    var d1 = p.diameterQuotient * m;
    var d2 = m * z2;
    var alpha = p.pressureAngle * DEG;
    var leadAngle = Math.atan((z1 * m) / d1);
    var frictionAngle = Math.atan(p.frictionCoefficient / Math.cos(alpha));
    var ratio = z2 / z1;
    var g = gearGeometry(p);
    var microstepsPerOutputRev = p.stepsPerRev * p.microsteps * ratio;
    return {
      module: m,
      pressureAngle: p.pressureAngle,
      worm: {
        starts: z1,
        pitchDiameter: d1,
        outsideDiameter: d1 + 2 * m,
        rootDiameter: d1 - 2.5 * m,
        lead: Math.PI * m * z1,
        axialPitch: Math.PI * m,
        leadAngleDeg: leadAngle / DEG
      },
      wheel: {
        teeth: z2,
        pitchDiameter: d2,
        outsideDiameter: d2 + 2 * m,
        rootDiameter: d2 - 2.5 * m,
        faceWidth: p.faceWidth
      },
      centerDistance: (d1 + d2) / 2,
      ratio: ratio,
      backlash: g.backlash,
      frictionAngleDeg: frictionAngle / DEG,
      selfLocking: leadAngle < frictionAngle,
      lockMarginDeg: (frictionAngle - leadAngle) / DEG,
      efficiency: Math.tan(leadAngle) / Math.tan(leadAngle + frictionAngle),
      outputDegPerFullStep: 360 / (p.stepsPerRev * ratio),
      outputDegPerMicrostep: 360 / microstepsPerOutputRev,
      microstepsPerOutputRev: microstepsPerOutputRev
    };
  }

  /* ----------------------------------------------------------------- gimbal */

  /**
   * Convert a sun direction into a clamped gimbal pose and stepper counts.
   * Step counts are measured from the azimuth home limit and the elevation
   * home limit, using each axis's own gear ratio.
   */
  function computeGimbalPose(sun, input, limits) {
    var lim = limits || DEFAULT_LIMITS;
    var train = computeGearTrainMetrics(input);
    var azimuthDeg = clamp(sun.azimuthDeg, lim.azMin, lim.azMax);
    var elevationDeg = clamp(sun.elevationDeg, lim.elMin, lim.elMax);
    var errorDeg = angularSeparationDeg(sun.azimuthDeg, sun.elevationDeg, azimuthDeg, elevationDeg);
    return {
      azimuthDeg: azimuthDeg,
      elevationDeg: elevationDeg,
      limited: azimuthDeg !== sun.azimuthDeg || elevationDeg !== sun.elevationDeg,
      pointingErrorDeg: errorDeg,
      cosIncidence: Math.cos(errorDeg * DEG),
      azimuthSteps: Math.round((azimuthDeg - lim.azMin) / train.outputDegPerMicrostep),
      elevationSteps: Math.round((elevationDeg - lim.elMin) / train.outputDegPerMicrostep),
      panelNormal: panelNormal(azimuthDeg, elevationDeg)
    };
  }

  /** Panel normal after the gimbal rotates a flat (normal +Z) panel into pose. */
  function panelNormal(azimuthDeg, elevationDeg) {
    var n = rotateAboutX([0, 0, 1], -(90 - elevationDeg));
    return rotateAboutZ(n, -azimuthDeg);
  }

  /* --------------------------------------------------------- mesh primitives */

  function makeMesh(vertices, faces) {
    return { vertices: vertices, faces: faces };
  }

  /** Axis-aligned box with outward-facing triangles. */
  function generateBoxMesh(size, origin) {
    var o = origin || [0, 0, 0];
    var sx = requireRange('size.x', size[0], 0.01, 10000);
    var sy = requireRange('size.y', size[1], 0.01, 10000);
    var sz = requireRange('size.z', size[2], 0.01, 10000);
    var x0 = o[0], y0 = o[1], z0 = o[2];
    var x1 = x0 + sx, y1 = y0 + sy, z1 = z0 + sz;
    var v = [
      [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
      [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]
    ];
    var f = [
      [0, 2, 1], [0, 3, 2],
      [4, 5, 6], [4, 6, 7],
      [0, 1, 5], [0, 5, 4],
      [1, 2, 6], [1, 6, 5],
      [2, 3, 7], [2, 7, 6],
      [3, 0, 4], [3, 4, 7]
    ];
    return makeMesh(v, f);
  }

  /**
   * Revolve a closed profile of [radius, z] points around the Z axis. The
   * profile must run counter-clockwise in the (r, z) plane and stay off the
   * axis, which gives a torus-topology solid with outward normals.
   */
  function generateRevolveMesh(profile, segments) {
    var n = segments;
    var m = profile.length;
    if (m < 3) {
      fail('profile needs at least 3 points');
    }
    var vertices = [];
    var j;
    var i;
    for (j = 0; j < m; j++) {
      if (!(profile[j][0] > 0)) {
        fail('profile radius must stay above zero');
      }
      for (i = 0; i < n; i++) {
        var a = (TAU * i) / n;
        vertices.push([profile[j][0] * Math.cos(a), profile[j][0] * Math.sin(a), profile[j][1]]);
      }
    }
    var faces = [];
    for (j = 0; j < m; j++) {
      var jn = (j + 1) % m;
      for (i = 0; i < n; i++) {
        var inx = (i + 1) % n;
        var p00 = j * n + i;
        var p01 = j * n + inx;
        var p10 = jn * n + i;
        var p11 = jn * n + inx;
        faces.push([p00, p01, p11]);
        faces.push([p00, p11, p10]);
      }
    }
    return makeMesh(vertices, faces);
  }

  function polygonArea(poly) {
    var s = 0;
    for (var i = 0; i < poly.length; i++) {
      var j = (i + 1) % poly.length;
      s += poly[i][0] * poly[j][1] - poly[j][0] * poly[i][1];
    }
    return s / 2;
  }

  function pointInTriangle(p, a, b, c) {
    var d1 = (p[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - b[1]);
    var d2 = (p[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (p[1] - c[1]);
    var d3 = (p[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (p[1] - a[1]);
    var hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
    var hasPos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(hasNeg && hasPos);
  }

  /** Ear-clipping triangulation of a simple counter-clockwise polygon. */
  function triangulatePolygon(poly) {
    if (poly.length < 3) {
      fail('polygon needs at least 3 points');
    }
    if (polygonArea(poly) <= 0) {
      fail('polygon must be counter-clockwise');
    }
    var idx = [];
    var i;
    for (i = 0; i < poly.length; i++) {
      idx.push(i);
    }
    var tris = [];
    while (idx.length > 3) {
      var clipped = false;
      for (var k = 0; k < idx.length; k++) {
        var ia = idx[(k + idx.length - 1) % idx.length];
        var ib = idx[k];
        var ic = idx[(k + 1) % idx.length];
        var a = poly[ia], b = poly[ib], c = poly[ic];
        var cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        if (cross <= 1e-12) {
          continue;
        }
        var blocked = false;
        for (var q = 0; q < idx.length; q++) {
          var m = idx[q];
          if (m !== ia && m !== ib && m !== ic && pointInTriangle(poly[m], a, b, c)) {
            blocked = true;
            break;
          }
        }
        if (!blocked) {
          tris.push([ia, ib, ic]);
          idx.splice(k, 1);
          clipped = true;
          break;
        }
      }
      if (!clipped) {
        fail('triangulation failed: polygon is not simple');
      }
    }
    tris.push([idx[0], idx[1], idx[2]]);
    return tris;
  }

  /**
   * Extrude a counter-clockwise polygon given in (x, z) along +Y from 0 to
   * depth. Produces one shell with outward normals and genus 0.
   */
  function extrudePolygonXZ(poly, depth) {
    requireRange('depth', depth, 0.01, 10000);
    var n = poly.length;
    var vertices = [];
    var i;
    for (i = 0; i < n; i++) {
      vertices.push([poly[i][0], 0, poly[i][1]]);
    }
    for (i = 0; i < n; i++) {
      vertices.push([poly[i][0], depth, poly[i][1]]);
    }
    var faces = [];
    var tris = triangulatePolygon(poly);
    for (i = 0; i < tris.length; i++) {
      var t = tris[i];
      faces.push([t[0], t[1], t[2]]);
      faces.push([n + t[0], n + t[2], n + t[1]]);
    }
    for (i = 0; i < n; i++) {
      var j = (i + 1) % n;
      faces.push([i, n + i, n + j]);
      faces.push([i, n + j, j]);
    }
    return makeMesh(vertices, faces);
  }

  /* ------------------------------------------------------------ part meshes */

  /** Closed outline of an involute spur-profile wheel, counter-clockwise. */
  function generateGearOutline(input) {
    var p = normalizeParams(input);
    var g = gearGeometry(p);
    var steps = p.flankSteps;
    var z = p.teeth;
    var tipHalf = toothHalfAngle(g, g.tipRadius);
    if (tipHalf < 0.02) {
      fail('tooth is too pointed at the tip; use a larger tooth count or smaller backlash');
    }
    if (toothHalfAngle(g, g.startRadius) >= Math.PI / z - 1e-6) {
      fail('teeth overlap at the base circle');
    }
    var pts = [];
    for (var k = 0; k < z; k++) {
      var centre = (TAU * k) / z;
      var i;
      var r;
      for (i = 0; i <= steps; i++) {
        r = g.startRadius + ((g.tipRadius - g.startRadius) * i) / steps;
        pts.push({ r: r, a: centre - toothHalfAngle(g, r) });
      }
      for (i = steps; i >= 0; i--) {
        r = g.startRadius + ((g.tipRadius - g.startRadius) * i) / steps;
        pts.push({ r: r, a: centre + toothHalfAngle(g, r) });
      }
      pts.push({ r: g.rootRadius, a: centre + Math.PI / z });
    }
    return pts;
  }

  /**
   * Watertight spur-profile wheel with a bore. The tooth form is an involute
   * spur profile, which approximates a worm wheel (no throat or helix).
   */
  function generateParametricGearMesh(input) {
    var p = normalizeParams(input);
    var outline = generateGearOutline(p);
    var count = outline.length;
    var boreR = p.boreDiameter / 2;
    var w = p.faceWidth;
    var vertices = [];
    var i;
    for (i = 0; i < count; i++) {
      vertices.push([outline[i].r * Math.cos(outline[i].a), outline[i].r * Math.sin(outline[i].a), 0]);
    }
    for (i = 0; i < count; i++) {
      vertices.push([outline[i].r * Math.cos(outline[i].a), outline[i].r * Math.sin(outline[i].a), w]);
    }
    for (i = 0; i < count; i++) {
      vertices.push([boreR * Math.cos(outline[i].a), boreR * Math.sin(outline[i].a), 0]);
    }
    for (i = 0; i < count; i++) {
      vertices.push([boreR * Math.cos(outline[i].a), boreR * Math.sin(outline[i].a), w]);
    }
    var ob = 0;
    var ot = count;
    var bb = 2 * count;
    var bt = 3 * count;
    var faces = [];
    for (i = 0; i < count; i++) {
      var j = (i + 1) % count;
      faces.push([ot + i, ot + j, bt + j]);
      faces.push([ot + i, bt + j, bt + i]);
      faces.push([ob + i, bb + j, ob + j]);
      faces.push([ob + i, bb + i, bb + j]);
      faces.push([ob + i, ob + j, ot + j]);
      faces.push([ob + i, ot + j, ot + i]);
      faces.push([bb + i, bt + j, bb + j]);
      faces.push([bb + i, bt + i, bt + j]);
    }
    return makeMesh(vertices, faces);
  }

  /** Dimensions of every part and the assembly stack. */
  function computeAssemblyLayout(input) {
    var p = normalizeParams(input);
    var g = gearGeometry(p);
    var wall = p.wallThickness;
    var baseOuter = Math.max(g.tipRadius + wall + 2, 22);
    var baseHeight = 12 + 2 * wall;
    var armThickness = wall + 1.5;
    var gap = p.panelWidth + 2;
    var pivotZ = wall + p.panelDepth / 2 + 3;
    var yoke = {
      width: gap + 2 * armThickness,
      depth: 28,
      baseThickness: wall,
      armThickness: armThickness,
      gap: gap,
      pivotZ: pivotZ,
      height: pivotZ + 6,
      chamfer: Math.min(1.5, armThickness / 2)
    };
    var wheelZ = baseHeight + 1;
    var yokeZ = wheelZ + p.faceWidth;
    return {
      gear: g,
      base: {
        outerRadius: baseOuter,
        height: baseHeight,
        wall: wall,
        cableHoleRadius: 4,
        segments: p.baseSegments
      },
      wheel: { z: wheelZ, faceWidth: p.faceWidth, boreRadius: p.boreDiameter / 2 },
      yoke: yoke,
      yokeZ: yokeZ,
      pivotWorldZ: yokeZ + pivotZ,
      array: {
        width: p.panelWidth,
        depth: p.panelDepth,
        thickness: p.panelThickness,
        pcbWidth: Math.max(8, p.panelWidth - 8),
        pcbDepth: Math.max(8, p.panelDepth - 10),
        pcbThickness: 1.6
      }
    };
  }

  function baseProfile(layout) {
    var b = layout.base;
    return [
      [b.cableHoleRadius, 0],
      [b.outerRadius, 0],
      [b.outerRadius, b.height],
      [b.outerRadius - b.wall, b.height],
      [b.outerRadius - b.wall, b.wall],
      [b.cableHoleRadius, b.wall]
    ];
  }

  function generateBaseMesh(input) {
    var layout = computeAssemblyLayout(input);
    return generateRevolveMesh(baseProfile(layout), layout.base.segments);
  }

  function yokeOutline(layout) {
    var y = layout.yoke;
    var w = y.width;
    var h = y.height;
    var t = y.armThickness;
    var c = y.chamfer;
    return [
      [0, 0], [w, 0], [w, h - c], [w - c, h], [w - t, h], [w - t, y.baseThickness],
      [t, y.baseThickness], [t, h], [c, h], [0, h - c]
    ];
  }

  function generateYokeMesh(input) {
    var layout = computeAssemblyLayout(input);
    return extrudePolygonXZ(yokeOutline(layout), layout.yoke.depth);
  }

  var PART_IDS = ['base', 'wheel', 'yoke', 'panel', 'pcb', 'sensors'];

  var STL_PARTS = Object.freeze([
    { id: 'base', file: 'helios_base.stl', solid: 'helios_base' },
    { id: 'wheel', file: 'helios_worm_gear.stl', solid: 'helios_worm_gear' },
    { id: 'yoke', file: 'helios_yoke.stl', solid: 'helios_yoke' }
  ]);

  function mergeMeshes(meshes) {
    var vertices = [];
    var faces = [];
    meshes.forEach(function (mesh) {
      var offset = vertices.length;
      mesh.vertices.forEach(function (v) { vertices.push(v); });
      mesh.faces.forEach(function (f) { faces.push([f[0] + offset, f[1] + offset, f[2] + offset]); });
    });
    return makeMesh(vertices, faces);
  }

  /** Local-frame mesh of one part (before assembly placement). */
  function generatePartMesh(id, input) {
    var layout = computeAssemblyLayout(input);
    var a = layout.array;
    if (id === 'base') { return generateBaseMesh(input); }
    if (id === 'wheel') { return generateParametricGearMesh(input); }
    if (id === 'yoke') { return generateYokeMesh(input); }
    if (id === 'panel') {
      return generateBoxMesh([a.width, a.depth, a.thickness], [-a.width / 2, -a.depth / 2, -a.thickness / 2]);
    }
    if (id === 'pcb') {
      return generateBoxMesh([a.pcbWidth, a.pcbDepth, a.pcbThickness],
        [-a.pcbWidth / 2, -a.pcbDepth / 2, -a.thickness / 2 - a.pcbThickness]);
    }
    if (id === 'sensors') {
      var boxes = [];
      [-1, 1].forEach(function (sx) {
        [-1, 1].forEach(function (sy) {
          boxes.push(generateBoxMesh([4, 4, 2], [sx * (a.width / 2 - 6) - 2, sy * (a.depth / 2 - 6) - 2, a.thickness / 2]));
        });
      });
      return mergeMeshes(boxes);
    }
    fail('unknown part ' + id);
    return null;
  }

  /** Local-frame meshes for every part, keyed by part id. */
  function generateAllPartMeshes(input) {
    var meshes = {};
    PART_IDS.forEach(function (id) { meshes[id] = generatePartMesh(id, input); });
    return meshes;
  }

  function transformMesh(mesh, fn) {
    return makeMesh(mesh.vertices.map(fn), mesh.faces);
  }

  /**
   * Parts placed in the assembly. explode is 0..1. Azimuth rotates the wheel,
   * yoke and array about Z; elevation tilts the array about the yoke pivot.
   * Pass the result of generateAllPartMeshes as parts to skip regeneration.
   */
  function buildAssemblyScene(input, state, parts) {
    var layout = computeAssemblyLayout(input);
    var meshes = parts || generateAllPartMeshes(input);
    var explode = clamp(state && state.explode !== undefined ? state.explode : 0, 0, 1);
    var az = state && state.azimuthDeg !== undefined ? state.azimuthDeg : 180;
    var el = state && state.elevationDeg !== undefined ? state.elevationDeg : 60;
    var e = explode * EXPLODE_SPACING_MM;
    var yoke = layout.yoke;
    function spin(p) { return rotateAboutZ(p, -az); }
    var placers = {
      base: function (p) { return p; },
      wheel: function (p) { return spin([p[0], p[1], p[2] + layout.wheel.z + e]); },
      yoke: function (p) {
        return spin([p[0] - yoke.width / 2, p[1] - yoke.depth / 2, p[2] + layout.yokeZ + 2 * e]);
      },
      array: function (p) {
        var tilted = rotateAboutX(p, -(90 - el));
        return spin([tilted[0], tilted[1], tilted[2] + layout.pivotWorldZ + 3 * e]);
      }
    };
    return PART_IDS.map(function (id) {
      var group = id === 'panel' || id === 'pcb' || id === 'sensors' ? 'array' : id;
      return { id: id, mesh: transformMesh(meshes[id], placers[group]) };
    });
  }

  /* ---------------------------------------------------------- mesh analysis */

  function triangleArea(a, b, c) {
    return vecLength(vecCross(vecSub(b, a), vecSub(c, a))) / 2;
  }

  /** Signed volume, one sixth of the sum of (v1 x v2) . v3 over triangles. */
  function computeMeshVolume(mesh) {
    var total = 0;
    mesh.faces.forEach(function (f) {
      total += vecDot(vecCross(mesh.vertices[f[0]], mesh.vertices[f[1]]), mesh.vertices[f[2]]);
    });
    return total / 6;
  }

  function computeMeshArea(mesh) {
    var total = 0;
    mesh.faces.forEach(function (f) {
      total += triangleArea(mesh.vertices[f[0]], mesh.vertices[f[1]], mesh.vertices[f[2]]);
    });
    return total;
  }

  function computeMeshBounds(mesh) {
    if (mesh.vertices.length === 0) {
      return { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0] };
    }
    var min = [Infinity, Infinity, Infinity];
    var max = [-Infinity, -Infinity, -Infinity];
    mesh.vertices.forEach(function (v) {
      for (var k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], v[k]);
        max[k] = Math.max(max[k], v[k]);
      }
    });
    return { min: min, max: max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
  }

  /**
   * Euler-Poincare and edge-sharing validation. A mesh passes when every
   * undirected edge is shared by exactly two triangles that traverse it in
   * opposite directions, no triangle is degenerate and the signed volume is
   * positive. genus is derived from V - E + F = 2 * shells - 2 * genus.
   */
  function validateMeshManifold(mesh) {
    var edgeUse = {};
    var directed = {};
    var used = {};
    var degenerate = 0;
    var badIndex = 0;
    var parent = {};

    function find(x) {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]];
        x = parent[x];
      }
      return x;
    }
    function union(a, b) {
      var ra = find(a);
      var rb = find(b);
      if (ra !== rb) { parent[ra] = rb; }
    }

    mesh.faces.forEach(function (f) {
      var ok = true;
      for (var k = 0; k < 3; k++) {
        if (!(f[k] >= 0 && f[k] < mesh.vertices.length) || Math.floor(f[k]) !== f[k]) {
          ok = false;
        }
      }
      if (!ok) {
        badIndex++;
        return;
      }
      if (f[0] === f[1] || f[1] === f[2] || f[0] === f[2] ||
          triangleArea(mesh.vertices[f[0]], mesh.vertices[f[1]], mesh.vertices[f[2]]) < 1e-12) {
        degenerate++;
      }
      for (var e = 0; e < 3; e++) {
        var a = f[e];
        var b = f[(e + 1) % 3];
        used[a] = 1;
        used[b] = 1;
        if (parent[a] === undefined) { parent[a] = a; }
        if (parent[b] === undefined) { parent[b] = b; }
        union(a, b);
        var key = a < b ? a + ',' + b : b + ',' + a;
        edgeUse[key] = (edgeUse[key] || 0) + 1;
        var dkey = a + '>' + b;
        directed[dkey] = (directed[dkey] || 0) + 1;
      }
    });

    var boundaryEdges = 0;
    var nonManifoldEdges = 0;
    var edgeCount = 0;
    Object.keys(edgeUse).forEach(function (key) {
      edgeCount++;
      if (edgeUse[key] === 1) { boundaryEdges++; }
      if (edgeUse[key] > 2) { nonManifoldEdges++; }
    });
    var inconsistentEdges = 0;
    Object.keys(directed).forEach(function (key) {
      if (directed[key] > 1) { inconsistentEdges++; }
    });

    var roots = {};
    Object.keys(used).forEach(function (v) { roots[find(Number(v))] = 1; });
    var shells = Object.keys(roots).length;
    var vertexCount = Object.keys(used).length;
    var faceCount = mesh.faces.length;
    var euler = vertexCount - edgeCount + faceCount;
    var volume = computeMeshVolume(mesh);
    var closed = boundaryEdges === 0 && nonManifoldEdges === 0 && inconsistentEdges === 0 &&
      degenerate === 0 && badIndex === 0 && faceCount > 0;
    return {
      vertexCount: vertexCount,
      edgeCount: edgeCount,
      faceCount: faceCount,
      eulerCharacteristic: euler,
      shells: shells,
      genus: (2 * shells - euler) / 2,
      boundaryEdges: boundaryEdges,
      nonManifoldEdges: nonManifoldEdges,
      inconsistentEdges: inconsistentEdges,
      degenerateFaces: degenerate,
      invalidIndices: badIndex,
      volume: volume,
      surfaceArea: computeMeshArea(mesh),
      bounds: computeMeshBounds(mesh),
      isWatertight: closed,
      isManifold: closed && volume > 0
    };
  }

  /* ------------------------------------------------------------- STL / SCAD */

  function formatStlNumber(value) {
    var s = value.toFixed(6);
    return s === '-0.000000' ? '0.000000' : s;
  }

  function exportAsciiStl(mesh, name) {
    var lines = ['solid ' + (name || 'helios')];
    mesh.faces.forEach(function (f) {
      var a = mesh.vertices[f[0]];
      var b = mesh.vertices[f[1]];
      var c = mesh.vertices[f[2]];
      var n = vecNormalize(vecCross(vecSub(b, a), vecSub(c, a)));
      lines.push('  facet normal ' + n.map(formatStlNumber).join(' '));
      lines.push('    outer loop');
      [a, b, c].forEach(function (v) {
        lines.push('      vertex ' + v.map(formatStlNumber).join(' '));
      });
      lines.push('    endloop');
      lines.push('  endfacet');
    });
    lines.push('endsolid ' + (name || 'helios'));
    return lines.join('\n') + '\n';
  }

  /** Parse ASCII STL, welding vertices that print to the same coordinates. */
  function parseAsciiStl(text) {
    var vertices = [];
    var faces = [];
    var weld = {};
    var current = [];
    var lines = text.split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].trim();
      if (t.indexOf('vertex ') === 0) {
        var parts = t.split(/\s+/).slice(1);
        if (parts.length !== 3) {
          fail('bad vertex line ' + (i + 1));
        }
        var key = parts.map(function (s) { return formatStlNumber(parseFloat(s)); }).join(' ');
        if (weld[key] === undefined) {
          weld[key] = vertices.length;
          vertices.push(parts.map(parseFloat));
        }
        current.push(weld[key]);
        if (current.length === 3) {
          faces.push(current);
          current = [];
        }
      }
    }
    if (current.length !== 0) {
      fail('STL ended inside a facet');
    }
    return makeMesh(vertices, faces);
  }

  function scadNumber(value) {
    var s = Number(value.toFixed(6)).toString();
    return s;
  }

  /** Parametric OpenSCAD source whose defaults match the given parameters. */
  function exportScad(input) {
    var p = normalizeParams(input);
    var n = scadNumber;
    var out = [];
    out.push('// Helios-6 parametric gimbal. Generated by engine.js exportScad().');
    out.push('// Units: millimetres and degrees. Z is up, Y is north.');
    out.push('// Set part to base, wheel, yoke, array or assembly to render one body.');
    out.push('');
    out.push('module_mm = ' + n(p.module) + ';');
    out.push('teeth = ' + n(p.teeth) + ';');
    out.push('wall = ' + n(p.wallThickness) + ';');
    out.push('face_width = ' + n(p.faceWidth) + ';');
    out.push('bore_d = ' + n(p.boreDiameter) + ';');
    out.push('pressure_angle = ' + n(p.pressureAngle) + ';');
    out.push('print_tolerance = ' + n(p.printTolerance) + ';');
    out.push('panel_w = ' + n(p.panelWidth) + ';');
    out.push('panel_d = ' + n(p.panelDepth) + ';');
    out.push('panel_t = ' + n(p.panelThickness) + ';');
    out.push('flank_steps = ' + n(p.flankSteps) + ';');
    out.push('base_segments = ' + n(p.baseSegments) + ';');
    out.push('cable_hole_r = 4;');
    out.push('pivot_bore = 3;');
    out.push('latitude = ' + n(p.latitude) + ';');
    out.push('declination = 23.44;');
    out.push('explode = 0;');
    out.push('azimuth = 180;');
    out.push('elevation = 90 - abs(latitude - declination);');
    out.push('part = "assembly";');
    out.push('');
    out.push('// Gear geometry (spur-profile approximation of the worm wheel).');
    out.push('function inv(a) = tan(a) - a * PI / 180;');
    out.push('rp = module_mm * teeth / 2;');
    out.push('rb = rp * cos(pressure_angle);');
    out.push('ra = rp + module_mm;');
    out.push('rf = rp - 1.25 * module_mm;');
    out.push('backlash = print_tolerance + 0.04 * module_mm;');
    out.push('half_pitch = PI / (2 * teeth) - backlash / (4 * rp);');
    out.push('rs = max(rb, rf);');
    out.push('function half_angle(r) = half_pitch + inv(pressure_angle) - inv(acos(min(1, rb / r)));');
    out.push('function pt(r, a) = [r * cos(a * 180 / PI), r * sin(a * 180 / PI)];');
    out.push('function flank_r(i) = rs + (ra - rs) * i / flank_steps;');
    out.push('function tooth(k) = concat(');
    out.push('    [for (i = [0 : flank_steps]) pt(flank_r(i), 2 * PI * k / teeth - half_angle(flank_r(i)))],');
    out.push('    [for (i = [flank_steps : -1 : 0]) pt(flank_r(i), 2 * PI * k / teeth + half_angle(flank_r(i)))],');
    out.push('    [pt(rf, 2 * PI * k / teeth + PI / teeth)]');
    out.push(');');
    out.push('function gear_points() = [for (k = [0 : teeth - 1]) each tooth(k)];');
    out.push('');
    out.push('// Stack dimensions.');
    out.push('base_r = max(ra + wall + 2, 22);');
    out.push('base_h = 12 + 2 * wall;');
    out.push('t_arm = wall + 1.5;');
    out.push('yoke_gap = panel_w + 2;');
    out.push('yoke_w = yoke_gap + 2 * t_arm;');
    out.push('yoke_depth = 28;');
    out.push('z_pivot = wall + panel_d / 2 + 3;');
    out.push('yoke_h = z_pivot + 6;');
    out.push('chamfer = min(1.5, t_arm / 2);');
    out.push('wheel_z = base_h + 1;');
    out.push('yoke_z = wheel_z + face_width;');
    out.push('pcb_w = max(8, panel_w - 8);');
    out.push('pcb_d = max(8, panel_d - 10);');
    out.push('pcb_t = 1.6;');
    out.push('');
    out.push('module base() {');
    out.push('    rotate_extrude($fn = base_segments)');
    out.push('        polygon([[cable_hole_r, 0], [base_r, 0], [base_r, base_h],');
    out.push('                 [base_r - wall, base_h], [base_r - wall, wall], [cable_hole_r, wall]]);');
    out.push('}');
    out.push('');
    out.push('module wheel() {');
    out.push('    difference() {');
    out.push('        linear_extrude(height = face_width) polygon(gear_points());');
    out.push('        translate([0, 0, -1]) cylinder(d = bore_d, h = face_width + 2, $fn = 96);');
    out.push('    }');
    out.push('}');
    out.push('');
    out.push('module yoke_body() {');
    out.push('    translate([0, yoke_depth, 0]) rotate([90, 0, 0])');
    out.push('        linear_extrude(height = yoke_depth)');
    out.push('            polygon([[0, 0], [yoke_w, 0], [yoke_w, yoke_h - chamfer], [yoke_w - chamfer, yoke_h],');
    out.push('                     [yoke_w - t_arm, yoke_h], [yoke_w - t_arm, wall], [t_arm, wall],');
    out.push('                     [t_arm, yoke_h], [chamfer, yoke_h], [0, yoke_h - chamfer]]);');
    out.push('}');
    out.push('');
    out.push('module yoke() {');
    out.push('    difference() {');
    out.push('        yoke_body();');
    out.push('        if (pivot_bore > 0)');
    out.push('            translate([-1, yoke_depth / 2, z_pivot]) rotate([0, 90, 0])');
    out.push('                cylinder(d = pivot_bore, h = yoke_w + 2, $fn = 48);');
    out.push('    }');
    out.push('}');
    out.push('');
    out.push('module array() {');
    out.push('    translate([-panel_w / 2, -panel_d / 2, -panel_t / 2]) cube([panel_w, panel_d, panel_t]);');
    out.push('    translate([-pcb_w / 2, -pcb_d / 2, -panel_t / 2 - pcb_t]) cube([pcb_w, pcb_d, pcb_t]);');
    out.push('    for (sx = [-1, 1], sy = [-1, 1])');
    out.push('        translate([sx * (panel_w / 2 - 6) - 2, sy * (panel_d / 2 - 6) - 2, panel_t / 2]) cube([4, 4, 2]);');
    out.push('}');
    out.push('');
    out.push('module assembly() {');
    out.push('    e = explode * ' + EXPLODE_SPACING_MM + ';');
    out.push('    base();');
    out.push('    translate([0, 0, wheel_z + e]) rotate([0, 0, -azimuth]) wheel();');
    out.push('    translate([0, 0, yoke_z + 2 * e]) rotate([0, 0, -azimuth])');
    out.push('        translate([-yoke_w / 2, -yoke_depth / 2, 0]) yoke();');
    out.push('    translate([0, 0, yoke_z + z_pivot + 3 * e]) rotate([0, 0, -azimuth])');
    out.push('        rotate([-(90 - elevation), 0, 0]) array();');
    out.push('}');
    out.push('');
    out.push('if (part == "base") base();');
    out.push('else if (part == "wheel") wheel();');
    out.push('else if (part == "yoke") yoke();');
    out.push('else if (part == "array") array();');
    out.push('else assembly();');
    out.push('');
    return out.join('\n');
  }

  /* ----------------------------------------------------- projection and draw */

  var ISO_CAMERA = Object.freeze({
    yaw: 45, pitch: Math.atan(1 / Math.SQRT2) / DEG, zoom: 1, distance: 420, projection: 'isometric',
    target: [0, 0, 40]
  });

  function makeCamera(overrides) {
    var cam = {
      yaw: ISO_CAMERA.yaw,
      pitch: ISO_CAMERA.pitch,
      zoom: ISO_CAMERA.zoom,
      distance: ISO_CAMERA.distance,
      projection: ISO_CAMERA.projection,
      target: ISO_CAMERA.target.slice()
    };
    if (overrides) {
      Object.keys(overrides).forEach(function (k) { cam[k] = overrides[k]; });
    }
    cam.pitch = clamp(cam.pitch, -89, 89);
    cam.zoom = clamp(cam.zoom, 0.2, 8);
    return cam;
  }

  function cameraBasis(cam) {
    var yaw = cam.yaw * DEG;
    var pitch = cam.pitch * DEG;
    var toCamera = [Math.sin(yaw) * Math.cos(pitch), -Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch)];
    var forward = [-toCamera[0], -toCamera[1], -toCamera[2]];
    var right = vecNormalize(vecCross(forward, [0, 0, 1]));
    var up = vecCross(right, forward);
    return {
      right: right,
      up: up,
      forward: forward,
      toCamera: toCamera,
      position: [
        cam.target[0] + toCamera[0] * cam.distance,
        cam.target[1] + toCamera[1] * cam.distance,
        cam.target[2] + toCamera[2] * cam.distance
      ]
    };
  }

  function viewScale(cam, viewport) {
    return (cam.zoom * Math.min(viewport.width, viewport.height)) / 170;
  }

  /** Project one world point. Returns null when behind a perspective camera. */
  function projectPoint(point, cam, viewport, basis) {
    var b = basis || cameraBasis(cam);
    var rel = vecSub(point, cam.target);
    var x = vecDot(rel, b.right);
    var y = vecDot(rel, b.up);
    var depth = vecDot(rel, b.forward);
    var scale = viewScale(cam, viewport);
    var cx = viewport.width / 2;
    var cy = viewport.height / 2;
    if (cam.projection === 'perspective') {
      var zc = cam.distance + depth;
      if (zc < 10) {
        return null;
      }
      var k = (scale * cam.distance) / zc;
      return { x: cx + x * k, y: cy - y * k, depth: zc };
    }
    return { x: cx + x * scale, y: cy - y * scale, depth: depth };
  }

  var LIGHT_DIRECTION = vecNormalize([-0.45, -0.55, 0.75]);

  /** Back-face culled, depth-sorted (far first), Lambert-shaded triangles. */
  function buildDrawList(scene, cam, viewport) {
    var basis = cameraBasis(cam);
    var list = [];
    scene.forEach(function (part) {
      var mesh = part.mesh;
      var projected = mesh.vertices.map(function (v) { return projectPoint(v, cam, viewport, basis); });
      mesh.faces.forEach(function (f) {
        var a = mesh.vertices[f[0]];
        var b = mesh.vertices[f[1]];
        var c = mesh.vertices[f[2]];
        var pa = projected[f[0]];
        var pb = projected[f[1]];
        var pc = projected[f[2]];
        if (!pa || !pb || !pc) {
          return;
        }
        var n = vecNormalize(vecCross(vecSub(b, a), vecSub(c, a)));
        var centroid = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
        var view = cam.projection === 'perspective' ? vecNormalize(vecSub(basis.position, centroid)) : basis.toCamera;
        if (vecDot(n, view) <= 0) {
          return;
        }
        list.push({
          part: part.id,
          pts: [[pa.x, pa.y], [pb.x, pb.y], [pc.x, pc.y]],
          depth: (pa.depth + pb.depth + pc.depth) / 3,
          shade: 0.4 + 0.6 * Math.max(0, vecDot(n, LIGHT_DIRECTION))
        });
      });
    });
    list.sort(function (p, q) { return q.depth - p.depth; });
    return list;
  }

  /** Stereographic projection of the sky dome, horizon at radius R, north up. */
  function stereographicProject(azimuthDeg, elevationDeg, radius) {
    var r = radius * Math.tan(((90 - elevationDeg) * DEG) / 2);
    return { x: r * Math.sin(azimuthDeg * DEG), y: -r * Math.cos(azimuthDeg * DEG) };
  }

  function hexToRgb(hex) {
    var h = String(hex).replace('#', '');
    if (h.length === 3) {
      h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    }
    if (!/^[0-9a-fA-F]{6}$/.test(h)) {
      fail('bad hex colour ' + hex);
    }
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  /** Scale a hex colour toward black by factor (clamped to 0..1). */
  function shadeHex(hex, factor) {
    var rgb = hexToRgb(hex);
    var f = clamp(factor, 0, 1);
    return 'rgb(' + rgb.map(function (c) { return Math.round(c * f); }).join(',') + ')';
  }

  return {
    DEFAULT_PARAMS: DEFAULT_PARAMS,
    DEFAULT_LIMITS: DEFAULT_LIMITS,
    ISO_CAMERA: ISO_CAMERA,
    PART_IDS: PART_IDS,
    STL_PARTS: STL_PARTS,
    EXPLODE_SPACING_MM: EXPLODE_SPACING_MM,
    normalizeParams: normalizeParams,
    computeEquationOfTime: computeEquationOfTime,
    computeDeclination: computeDeclination,
    clockToSolarHour: clockToSolarHour,
    computeSolarPosition: computeSolarPosition,
    computeDaylightHours: computeDaylightHours,
    computeSunPath: computeSunPath,
    beamAttenuation: beamAttenuation,
    computeOptimalTiltGain: computeOptimalTiltGain,
    sunVectorFromAngles: sunVectorFromAngles,
    angularSeparationDeg: angularSeparationDeg,
    computeSpurMetrics: computeSpurMetrics,
    computeGearTrainMetrics: computeGearTrainMetrics,
    computeGimbalPose: computeGimbalPose,
    panelNormal: panelNormal,
    rotateAboutX: rotateAboutX,
    rotateAboutZ: rotateAboutZ,
    polygonArea: polygonArea,
    triangulatePolygon: triangulatePolygon,
    extrudePolygonXZ: extrudePolygonXZ,
    generateBoxMesh: generateBoxMesh,
    generateRevolveMesh: generateRevolveMesh,
    generateGearOutline: generateGearOutline,
    generateParametricGearMesh: generateParametricGearMesh,
    generateBaseMesh: generateBaseMesh,
    generateYokeMesh: generateYokeMesh,
    generatePartMesh: generatePartMesh,
    generateAllPartMeshes: generateAllPartMeshes,
    mergeMeshes: mergeMeshes,
    computeAssemblyLayout: computeAssemblyLayout,
    baseProfile: baseProfile,
    yokeOutline: yokeOutline,
    buildAssemblyScene: buildAssemblyScene,
    computeMeshVolume: computeMeshVolume,
    computeMeshArea: computeMeshArea,
    computeMeshBounds: computeMeshBounds,
    validateMeshManifold: validateMeshManifold,
    exportAsciiStl: exportAsciiStl,
    parseAsciiStl: parseAsciiStl,
    exportScad: exportScad,
    makeCamera: makeCamera,
    cameraBasis: cameraBasis,
    projectPoint: projectPoint,
    buildDrawList: buildDrawList,
    stereographicProject: stereographicProject,
    hexToRgb: hexToRgb,
    shadeHex: shadeHex
  };
}));
