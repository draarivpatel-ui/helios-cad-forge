'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const E = require('../engine.js');
const HW = require('../hardware.js');
const K = require('../tools/kicad.js');
const L = require('../helios-lab.js');

const ROOT = path.join(__dirname, '..');
const DEG = Math.PI / 180;

/* ------------------------------------------------------- 1. SHA-256 (FIPS 180-4) */

test('sha256 matches FIPS known-answer vectors', () => {
  assert.equal(L.sha256(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(L.sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(L.sha256('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  assert.equal(L.sha256('The quick brown fox jumps over the lazy dog'),
    'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592');
  assert.equal(L.sha256('The quick brown fox jumps over the lazy dog.'),
    'ef537f25c895bfa782526529a9b63d97aa631564d5d789c2b765448c8635fb6c');
});

test('sha256 handles the million-a known-answer vector', () => {
  const a = 'a'.repeat(1000000);
  assert.equal(L.sha256(a), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
});

test('sha256 agrees with node:crypto across padding boundary lengths', () => {
  for (const n of [0, 1, 2, 3, 54, 55, 56, 57, 62, 63, 64, 65, 118, 119, 120, 127, 128, 129, 256, 1000]) {
    const s = 'x'.repeat(n);
    const oracle = crypto.createHash('sha256').update(s, 'utf8').digest('hex');
    assert.equal(L.sha256(s), oracle, `length ${n}`);
  }
});

test('sha256 agrees with node:crypto on varied deterministic payloads', () => {
  const samples = [
    'helios-6', '{"lat":38.9,"day":172}', '0', ' ',
    'line1\nline2\r\nline3',
    'tabs\tand\ttabs',
    'symbols !@#$%^&*()_+-=[]{}|;:,.<>/?',
    Buffer.from([0, 1, 2, 253, 254, 255]).toString('latin1')
  ];
  for (const s of samples) {
    const oracle = crypto.createHash('sha256').update(s, 'utf8').digest('hex');
    assert.equal(L.sha256(s), oracle, JSON.stringify(s).slice(0, 40));
  }
});

test('sha256 agrees with node:crypto on multibyte UTF-8 input', () => {
  for (const s of ['é', 'déjà vu', '日本語テスト', 'Ωμέγα', 'a€b', 'emoji \u{1F600} tail', '𝕏 mathbold']) {
    const oracle = crypto.createHash('sha256').update(s, 'utf8').digest('hex');
    assert.equal(L.sha256(s), oracle, s);
  }
});

test('sha256Bytes digests raw bytes including NUL and high bytes', () => {
  const bytes = [0, 1, 2, 3, 250, 251, 252, 253, 254, 255, 0, 0, 128];
  const buf = Buffer.from(bytes);
  const oracle = crypto.createHash('sha256').update(buf).digest('hex');
  assert.equal(L.sha256Bytes(bytes), oracle);
});

test('sha256 returns 64 lowercase hex chars deterministically', () => {
  const d1 = L.sha256('deterministic');
  const d2 = L.sha256('deterministic');
  assert.equal(d1, d2);
  assert.match(d1, /^[0-9a-f]{64}$/);
  assert.notEqual(L.sha256('deterministic '), d1);
});

/* ------------------------------------------------------------- 2. base64url */

test('b64urlEncode matches RFC 4648 test vectors', () => {
  assert.equal(L.b64urlEncode('f'), 'Zg');
  assert.equal(L.b64urlEncode('fo'), 'Zm8');
  assert.equal(L.b64urlEncode('foo'), 'Zm9v');
  assert.equal(L.b64urlEncode('foob'), 'Zm9vYg');
  assert.equal(L.b64urlEncode('fooba'), 'Zm9vYmE');
  assert.equal(L.b64urlEncode('foobar'), 'Zm9vYmFy');
});

test('b64urlEncode never emits + / = characters', () => {
  for (const s of ['\u00fb\u00ff\u00fe', '>>>???', '\u0000\u0001\u0002', 'helios-lab-brief/1']) {
    const enc = L.b64urlEncode(s);
    assert.ok(!/[+/=]/.test(enc), `unsafe chars in ${enc}`);
  }
});

test('b64url round-trips ASCII and UTF-8 strings', () => {
  for (const s of ['a', 'ab', 'abc', 'abcd', 'abcde', 'helios', '{"k":1}', '日本語', 'a€z', 'x'.repeat(257)]) {
    const enc = L.b64urlEncode(s);
    assert.equal(L.utf8Decode(L.b64urlDecode(enc)), s, s.slice(0, 20));
  }
});

test('b64urlDecode rejects malformed payloads', () => {
  assert.throws(() => L.b64urlDecode(''), RangeError);
  assert.throws(() => L.b64urlDecode('A'), RangeError);           // length %4 == 1
  assert.throws(() => L.b64urlDecode('ABCDE'), RangeError);       // length %4 == 1
  assert.throws(() => L.b64urlDecode('a b'), RangeError);         // space
  assert.throws(() => L.b64urlDecode('a+b'), RangeError);         // + not url-safe
  assert.throws(() => L.b64urlDecode('a/b'), RangeError);         // / not url-safe
  assert.throws(() => L.b64urlDecode('a=b'), RangeError);         // padding char
  assert.throws(() => L.b64urlDecode('####'), RangeError);
  assert.throws(() => L.b64urlDecode(null), RangeError);
  assert.throws(() => L.b64urlDecode(42), RangeError);
  assert.throws(() => L.b64urlDecode('AB'), RangeError);          // non-zero trailing bits
});

test('b64urlEncodeBytes encodes byte arrays identically to the string path', () => {
  const bytes = [104, 101, 108, 105, 111, 115];
  assert.equal(L.b64urlEncodeBytes(bytes), L.b64urlEncode('helios'));
  assert.equal(L.b64urlEncodeBytes([1]), 'AQ');
  assert.equal(L.b64urlEncodeBytes([1, 2]), 'AQI');
  assert.equal(L.b64urlEncodeBytes([1, 2, 3]), 'AQID');
  assert.equal(L.b64urlEncodeBytes([]), '');
});

test('utf8Decode rejects malformed byte sequences', () => {
  assert.throws(() => L.utf8Decode([0x80]), RangeError);                    // stray continuation
  assert.throws(() => L.utf8Decode([0xc2]), RangeError);                    // truncated 2-byte
  assert.throws(() => L.utf8Decode([0xe0, 0x80]), RangeError);              // truncated 3-byte
  assert.throws(() => L.utf8Decode([0xc0, 0x80]), RangeError);              // overlong
  assert.throws(() => L.utf8Decode([0xed, 0xa0, 0x80]), RangeError);        // surrogate half
  assert.throws(() => L.utf8Decode([0xf4, 0x90, 0x80, 0x80]), RangeError);  // > U+10FFFF
  assert.equal(L.utf8Decode([0x41, 0xc3, 0xa9]), 'Aé');
});

/* ------------------------------------------------------- 3. stableStringify */

test('stableStringify sorts object keys recursively and deterministically', () => {
  const a = { b: 1, a: { z: 2, y: [3, { q: 4, p: 5 }] } };
  const b = { a: { y: [3, { p: 5, q: 4 }], z: 2 }, b: 1 };
  assert.equal(L.stableStringify(a), L.stableStringify(b));
  assert.equal(L.stableStringify({ b: 1, a: 2 }), '{"a":2,"b":1}');
});

test('stableStringify serializes primitives, arrays, and folds -0 to 0', () => {
  assert.equal(L.stableStringify(null), 'null');
  assert.equal(L.stableStringify(true), 'true');
  assert.equal(L.stableStringify('x'), '"x"');
  assert.equal(L.stableStringify(-0), '0');
  assert.equal(L.stableStringify([3, 'a', null]), '[3,"a",null]');
  assert.equal(L.stableStringify({}), '{}');
});

test('stableStringify rejects non-finite numbers and unsupported types', () => {
  assert.throws(() => L.stableStringify(NaN), RangeError);
  assert.throws(() => L.stableStringify(Infinity), RangeError);
  assert.throws(() => L.stableStringify(-Infinity), RangeError);
  assert.throws(() => L.stableStringify({ a: NaN }), RangeError);
  assert.throws(() => L.stableStringify(() => 1), RangeError);
  assert.throws(() => L.stableStringify({ f: undefined }), RangeError);
  assert.throws(() => L.stableStringify(Symbol('x')), RangeError);
});

/* --------------------------------------------------- 4. normalizeLabState */

test('normalizeLabState accepts a complete valid state', () => {
  const s = L.normalizeLabState({ lat: 38.9, day: 172, reg: 'dual-axis-helios', mat: 'bronze-steel', mu: 0.15, teeth: 24, mod: 1.5 });
  assert.deepEqual(s, { lat: 38.9, day: 172, reg: 'dual-axis-helios', mat: 'bronze-steel', mu: 0.15, teeth: 24, mod: 1.5 });
});

test('normalizeLabState accepts partial states with any subset of keys', () => {
  assert.deepEqual(L.normalizeLabState({}), {});
  assert.deepEqual(L.normalizeLabState({ lat: -45 }), { lat: -45 });
  assert.deepEqual(L.normalizeLabState({ day: 355 }), { day: 355 });
  assert.deepEqual(L.normalizeLabState({ reg: 'horizontal' }), { reg: 'horizontal' });
  assert.deepEqual(L.normalizeLabState({ mat: 'custom', mu: 0.33 }), { mat: 'custom', mu: 0.33 });
  assert.deepEqual(L.normalizeLabState({ teeth: 30, mod: 2 }), { teeth: 30, mod: 2 });
});

test('normalizeLabState rejects non-object inputs', () => {
  for (const bad of [null, undefined, 42, 'x', true, [1, 2], NaN]) {
    assert.equal(L.normalizeLabState(bad), null, JSON.stringify(bad));
  }
});

test('normalizeLabState rejects unknown and hostile keys', () => {
  assert.equal(L.normalizeLabState({ lat: 10, bogus: 1 }), null);
  assert.equal(L.normalizeLabState({ lat: 10, extra: 'x' }), null);
  assert.equal(L.normalizeLabState(JSON.parse('{"__proto__":{"polluted":1},"lat":10}')), null);
  assert.equal(L.normalizeLabState({ constructor: 1, lat: 10 }), null);
  assert.equal(L.normalizeLabState({ prototype: 1, lat: 10 }), null);
  assert.equal(L.normalizeLabState({ toString: 1 }), null);
});

test('normalizeLabState enforces the workbench latitude range [-65, 65]', () => {
  assert.equal(L.normalizeLabState({ lat: 65 }).lat, 65);
  assert.equal(L.normalizeLabState({ lat: -65 }).lat, -65);
  for (const bad of [65.0001, -65.1, 89, -89, 90, -90, 200, NaN, Infinity, -Infinity, '38.9']) {
    assert.equal(L.normalizeLabState({ lat: bad }), null, `lat=${bad}`);
  }
});

test('normalizeLabState enforces integer day-of-year in [1, 365]', () => {
  assert.equal(L.normalizeLabState({ day: 365 }).day, 365);
  for (const bad of [0, 366, 367, 400, -5, 1.5, '172', NaN, Infinity]) {
    assert.equal(L.normalizeLabState({ day: bad }), null, `day=${bad}`);
  }
});

test('normalizeLabState enforces integer teeth in the meshable slider range [14, 30]', () => {
  assert.equal(L.normalizeLabState({ teeth: 14 }).teeth, 14);
  assert.equal(L.normalizeLabState({ teeth: 30 }).teeth, 30);
  for (const bad of [13, 31, 6, 400, 24.5, 0, -3, '24', NaN]) {
    assert.equal(L.normalizeLabState({ teeth: bad }), null, `teeth=${bad}`);
  }
});

test('normalizeLabState enforces the mu sweep [0.05, 0.40] and module slider [1.0, 2.5]', () => {
  assert.equal(L.normalizeLabState({ mu: 0.05 }).mu, 0.05);
  assert.equal(L.normalizeLabState({ mu: 0.4 }).mu, 0.4);
  for (const bad of [-0.1, 0, 0.049, 0.401, 2, NaN, Infinity, '0.15']) {
    assert.equal(L.normalizeLabState({ mu: bad }), null, `mu=${bad}`);
  }
  assert.equal(L.normalizeLabState({ mod: 1 }).mod, 1);
  assert.equal(L.normalizeLabState({ mod: 2.5 }).mod, 2.5);
  for (const bad of [0.05, 0.06, 0.99, 2.51, 20, -1, NaN, 'x']) {
    assert.equal(L.normalizeLabState({ mod: bad }), null, `mod=${bad}`);
  }
});

test('normalizeLabState validates regime and material ids strictly', () => {
  for (const id of L.REGIME_IDS) {
    assert.equal(L.normalizeLabState({ reg: id }).reg, id);
  }
  for (const bad of ['dual', 'Dual-Axis', '', 42, null, {}, 'single-axis']) {
    assert.equal(L.normalizeLabState({ reg: bad }), null, `reg=${bad}`);
  }
  for (const id of L.MATERIAL_IDS.concat(['custom'])) {
    assert.equal(L.normalizeLabState({ mat: id }).mat, id);
  }
  for (const bad of ['bronze', 'PLA', '', 42, null, {}]) {
    assert.equal(L.normalizeLabState({ mat: bad }), null, `mat=${bad}`);
  }
});

test('normalizeLabState rounds continuous fields to 4 decimals and never mutates input', () => {
  const src = { lat: 38.987654, mu: 0.123456789, mod: 1.500001 };
  const out = L.normalizeLabState(src);
  assert.equal(out.lat, 38.9877);
  assert.equal(out.mu, 0.1235);
  assert.equal(out.mod, 1.5);
  assert.equal(src.lat, 38.987654);
  assert.notEqual(out, src);
});

/* ------------------------------------------------------- 5. #hc= codec */

test('encodeHashState and decodeHashState round-trip a full state', () => {
  const state = { lat: 38.9, day: 172, reg: 'dual-axis-helios', mat: 'bronze-steel', mu: 0.15, teeth: 24, mod: 1.5 };
  const h = L.encodeHashState(state);
  assert.ok(h.startsWith('hc='));
  const back = L.decodeHashState('#' + h);
  assert.deepEqual(back, state);
  assert.deepEqual(L.decodeHashState(h), back, 'prefix without # also decodes');
});

test('encodeHashState round-trips every regime and material', () => {
  for (const reg of L.REGIME_IDS) {
    const back = L.decodeHashState('#' + L.encodeHashState({ reg }));
    assert.equal(back.reg, reg);
  }
  for (const mat of L.MATERIAL_IDS.concat(['custom'])) {
    const back = L.decodeHashState('#' + L.encodeHashState({ mat, mu: 0.2 }));
    assert.equal(back.mat, mat);
  }
});

test('encodeHashState is idempotent through a decode-encode cycle', () => {
  const state = { lat: -33.45, day: 80, reg: 'single-axis-ns', mat: 'custom', mu: 0.07, teeth: 30, mod: 2.0 };
  const once = L.encodeHashState(state);
  const twice = L.encodeHashState(L.decodeHashState('#' + once));
  assert.equal(once, twice);
});

test('encodeHashState rejects invalid and empty states', () => {
  assert.throws(() => L.encodeHashState({}), RangeError);
  assert.throws(() => L.encodeHashState(null), RangeError);
  assert.throws(() => L.encodeHashState({ lat: 95 }), RangeError);
  assert.throws(() => L.encodeHashState({ bogus: 1 }), RangeError);
});

test('decodeHashState fails closed on malformed inputs', () => {
  const bad = [null, undefined, 42, {}, '', '#', 'hc=', '#hc=', '##hc=QQ',
    '#xx=AAAA', 'foo', '#hc=!!!', '#hc=a b', '#hc=****', '#hc=A',
    '#hc=' + 'A'.repeat(7)];
  for (const h of bad) {
    assert.equal(L.decodeHashState(h), null, JSON.stringify(h));
  }
});

test('decodeHashState rejects well-formed payloads with invalid state semantics', () => {
  const enc = (o) => '#hc=' + L.b64urlEncode(JSON.stringify(o));
  const badObjs = [
    {}, { lat: 200 }, { lat: -91 }, { lat: 66 }, { lat: -66 }, { day: 0 }, { day: 400 }, { day: 366 },
    { mu: -0.5 }, { mu: 0.01 }, { mu: '0.15' }, { teeth: 24.5 }, { teeth: '24' }, { teeth: 33 },
    { reg: 'not-a-regime' }, { mat: 'unobtanium' }, { lat: 'x' },
    { lat: 40, evil: 1 }, { 'proto': 1 }, [1, 2, 3], 'str', 5, true, null,
    { day: 172, lat: 40, reg: 'horizontal', mat: 'dry-pla', mu: 0.3, teeth: 24, mod: 1.5, surprise: 'x' }
  ];
  for (const o of badObjs) {
    assert.equal(L.decodeHashState(enc(o)), null, JSON.stringify(o));
  }
  const hostile = '#hc=' + L.b64urlEncode('{"__proto__":{"isAdmin":true},"lat":10}');
  assert.equal(L.decodeHashState(hostile), null);
  const ctor = '#hc=' + L.b64urlEncode('{"constructor":"x","lat":10}');
  assert.equal(L.decodeHashState(ctor), null);
});

test('decodeHashState rejects corrupt JSON and non-object JSON', () => {
  assert.equal(L.decodeHashState('#hc=' + L.b64urlEncode('{bad json')), null);
  assert.equal(L.decodeHashState('#hc=' + L.b64urlEncode('[1,2,3]')), null);
  assert.equal(L.decodeHashState('#hc=' + L.b64urlEncode('42')), null);
  assert.equal(L.decodeHashState('#hc=' + L.b64urlEncode('"str"')), null);
  assert.equal(L.decodeHashState('#hc=' + L.b64urlEncode('null')), null);
  assert.equal(L.decodeHashState('#hc=' + L.b64urlEncode('true')), null);
});

test('decoded bookmark state carries no extraneous prototype baggage', () => {
  const back = L.decodeHashState('#' + L.encodeHashState({ lat: 10, day: 100 }));
  assert.equal(Object.getPrototypeOf(back), Object.prototype);
  assert.deepEqual(Object.keys(back).sort(), ['day', 'lat']);
});

/* ------------------------------------------------- 6. daily & annual yield */

test('cosIncidenceFor computes each regime geometry exactly', () => {
  const sun = { azimuthDeg: 180, elevationDeg: 30, sunVector: E.sunVectorFromAngles(180, 30) };
  assert.equal(L.cosIncidenceFor('dual-axis-helios', sun, 40), 1);
  assert.ok(Math.abs(L.cosIncidenceFor('horizontal', sun, 40) - Math.sin(30 * DEG)) < 1e-12);
  const ew = L.cosIncidenceFor('single-axis-ew', sun, 40);
  const ns = L.cosIncidenceFor('single-axis-ns', sun, 40);
  assert.ok(Math.abs(ew - Math.hypot(sun.sunVector[1], sun.sunVector[2])) < 1e-12);
  assert.ok(Math.abs(ns - Math.hypot(sun.sunVector[0], sun.sunVector[2])) < 1e-12);
  const tilt = E.computeOptimalTiltGain({ latitude: 40, dayOfYear: 1, stepMinutes: 60, useAirMass: false });
  assert.ok(tilt.fixedTiltEnergy >= 0);
});

test('cosIncidenceFor rejects unknown regimes and malformed sun vectors', () => {
  const sun = { azimuthDeg: 0, elevationDeg: 10, sunVector: [0, 1, 0] };
  assert.throws(() => L.cosIncidenceFor('satellite', sun, 0), RangeError);
  assert.throws(() => L.cosIncidenceFor('horizontal', { azimuthDeg: 0, elevationDeg: 10 }, 0), RangeError);
  assert.throws(() => L.cosIncidenceFor('horizontal', { azimuthDeg: 0, elevationDeg: 10, sunVector: [0, 1] }, 0), RangeError);
  assert.throws(() => L.cosIncidenceFor('horizontal', { azimuthDeg: NaN, elevationDeg: 10, sunVector: [0, 1, 0] }, 0), RangeError);
});

test('computeDailyYield energies match engine surface energies exactly', () => {
  for (const [lat, doy] of [[38.9, 172], [0, 80], [-33.9, 355], [55.7, 200]]) {
    const mine = L.computeDailyYield({ latitude: lat, dayOfYear: doy, stepMinutes: 6 });
    const ref = E.computeOptimalTiltGain({ latitude: lat, dayOfYear: doy, stepMinutes: 6 });
    assert.ok(Math.abs(mine.energies.horizontal - ref.horizontalEnergy) < 1e-9, `horizontal ${lat}/${doy}`);
    assert.ok(Math.abs(mine.energies['fixed-lat-tilt'] - ref.fixedTiltEnergy) < 1e-9, `fixed ${lat}/${doy}`);
    assert.ok(Math.abs(mine.energies['dual-axis-helios'] - ref.trackerEnergy) < 1e-9, `dual ${lat}/${doy}`);
    assert.ok(Math.abs(mine.daylightHours - ref.daylightHours) < 1e-9);
    assert.ok(Math.abs(mine.peakElevationDeg - ref.peakElevationDeg) < 1e-9);
  }
});

test('computeDailyYield returns all 5 finite non-negative regime energies', () => {
  const d = L.computeDailyYield({ latitude: 40.7, dayOfYear: 172, stepMinutes: 10 });
  for (const id of L.REGIME_IDS) {
    assert.ok(Number.isFinite(d.energies[id]), id);
    assert.ok(d.energies[id] >= 0, id);
  }
  assert.equal(Object.keys(d.energies).length, 5);
});

test('computeDailyYield orders dual-axis at or above every other regime', () => {
  for (const [lat, doy] of [[0, 80], [29.6, 172], [40.7, 355], [55.7, 172], [-33.9, 80], [65, 200]]) {
    const d = L.computeDailyYield({ latitude: lat, dayOfYear: doy, stepMinutes: 15 });
    for (const id of L.REGIME_IDS) {
      assert.ok(d.energies['dual-axis-helios'] >= d.energies[id] - 1e-9, `${id} at ${lat}/${doy}`);
    }
  }
});

test('computeDailyYield single-axis geometry beats horizontal and loses to dual', () => {
  const d = L.computeDailyYield({ latitude: 38.9, dayOfYear: 172, stepMinutes: 10 });
  assert.ok(d.energies['single-axis-ns'] > d.energies.horizontal);
  assert.ok(d.energies['single-axis-ew'] > d.energies.horizontal * 0.9);
  assert.ok(d.energies['single-axis-ns'] < d.energies['dual-axis-helios']);
  assert.ok(d.energies['single-axis-ew'] < d.energies['dual-axis-helios']);
});

test('computeDailyYield minAirMass equals reciprocal of peak sine', () => {
  const d = L.computeDailyYield({ latitude: 40.7, dayOfYear: 172, stepMinutes: 4 });
  assert.ok(d.minAirMass !== null);
  assert.ok(Math.abs(d.minAirMass - 1 / Math.sin(d.peakElevationDeg * DEG)) < 1e-9);
  assert.ok(d.minAirMass >= 1 && d.minAirMass < 1.5);
});

test('computeDailyYield handles polar night with zero energy and null air mass', () => {
  const d = L.computeDailyYield({ latitude: -80, dayOfYear: 172, stepMinutes: 30 });
  assert.equal(d.daylightHours, 0);
  assert.equal(d.minAirMass, null);
  for (const id of L.REGIME_IDS) {
    assert.equal(d.energies[id], 0, id);
  }
});

test('computeDailyYield handles midnight sun at high latitude', () => {
  const d = L.computeDailyYield({ latitude: 80, dayOfYear: 172, stepMinutes: 15 });
  assert.ok(d.daylightHours > 23.5);
  for (const id of L.REGIME_IDS) {
    assert.ok(d.energies[id] > 0, id);
  }
});

test('computeDailyYield geometric mode equals plain cosine hours for the tracker', () => {
  const d = L.computeDailyYield({ latitude: 38.9, dayOfYear: 172, stepMinutes: 10, useAirMass: false });
  assert.ok(Math.abs(d.energies['dual-axis-helios'] - d.daylightHours) < 1e-9);
  assert.equal(d.minAirMass, null);
});

test('computeDailyYield rejects out-of-range latitude, day and step', () => {
  assert.throws(() => L.computeDailyYield({ latitude: 95, dayOfYear: 100 }), RangeError);
  assert.throws(() => L.computeDailyYield({ latitude: -90, dayOfYear: 100 }), RangeError);
  assert.throws(() => L.computeDailyYield({ latitude: NaN, dayOfYear: 100 }), RangeError);
  assert.throws(() => L.computeDailyYield({ latitude: 30, dayOfYear: 0 }), RangeError);
  assert.throws(() => L.computeDailyYield({ latitude: 30, dayOfYear: 367 }), RangeError);
  assert.throws(() => L.computeDailyYield({ latitude: 30, dayOfYear: 'x' }), RangeError);
  assert.throws(() => L.computeDailyYield({ latitude: 30, dayOfYear: 100, stepMinutes: 0 }), RangeError);
  assert.throws(() => L.computeDailyYield({ latitude: 30, dayOfYear: 100, stepMinutes: 61 }), RangeError);
  assert.throws(() => L.computeDailyYield({ latitude: 30, dayOfYear: 100, stepMinutes: NaN }), RangeError);
});

test('computeAnnualYield monthly mode sums representative days weighted by month length', () => {
  const r = L.computeAnnualYield({ latitude: 40.7, mode: 'monthly', stepMinutes: 24 });
  assert.equal(r.monthly.length, 12);
  assert.equal(r.monthly[0].dayOfYear, 17);
  assert.equal(r.monthly[0].daysInMonth, 31);
  assert.equal(r.monthly[5].dayOfYear, 162);
  let manual = 0;
  r.monthly.forEach((m) => { manual += m.energies['dual-axis-helios'] * m.daysInMonth; });
  assert.ok(Math.abs(manual - r.annual['dual-axis-helios']) < 1e-6);
});

test('computeAnnualYield monthly insolation is inside published clear-sky ranges', () => {
  const r = L.computeAnnualYield({ latitude: 40.7, mode: 'monthly', stepMinutes: 12 });
  assert.ok(r.annual['dual-axis-helios'] > 2000 && r.annual['dual-axis-helios'] < 4500);
  assert.ok(r.annual.horizontal > 1000 && r.annual.horizontal < 3000);
});

test('computeAnnualYield full mode sums all 365 days', () => {
  const r = L.computeAnnualYield({ latitude: 40.7, mode: 'full', stepMinutes: 60 });
  assert.equal(r.mode, 'full');
  let manual = 0;
  for (let doy = 1; doy <= 365; doy++) {
    manual += L.computeDailyYield({ latitude: 40.7, dayOfYear: doy, stepMinutes: 60 }).energies['dual-axis-helios'];
  }
  assert.ok(Math.abs(manual - r.annual['dual-axis-helios']) < 1e-6);
});

test('computeAnnualYield monthly estimate tracks full-year integration within 2 percent', () => {
  for (const lat of [0, 29.6, 40.7, 55.7]) {
    const m = L.computeAnnualYield({ latitude: lat, mode: 'monthly', stepMinutes: 30 });
    const f = L.computeAnnualYield({ latitude: lat, mode: 'full', stepMinutes: 30 });
    for (const id of L.REGIME_IDS) {
      const denom = Math.max(1e-9, f.annual[id]);
      const rel = Math.abs(m.annual[id] - f.annual[id]) / denom;
      assert.ok(rel < 0.02, `${id} at lat ${lat}: ${(rel * 100).toFixed(2)}%`);
    }
  }
});

test('computeAnnualYield ordering dual >= fixed tilt >= horizontal at canonical latitudes', () => {
  for (const lat of L.CANONICAL_LATITUDES) {
    const r = L.computeAnnualYield({ latitude: lat, mode: 'monthly', stepMinutes: 24 });
    assert.ok(r.annual['dual-axis-helios'] >= r.annual['fixed-lat-tilt'] - 1e-9, `lat ${lat}`);
    assert.ok(r.annual['fixed-lat-tilt'] >= r.annual.horizontal - 1e-9, `lat ${lat}`);
  }
});

test('computeAnnualYield gain percentages are consistent with annual totals', () => {
  const r = L.computeAnnualYield({ latitude: 38.9, mode: 'monthly', stepMinutes: 24 });
  for (const id of L.REGIME_IDS) {
    const expect = (r.annual[id] / r.annual['fixed-lat-tilt'] - 1) * 100;
    assert.ok(Math.abs(r.gainVsFixedTilt[id] - expect) < 1e-9, id);
    const expectH = (r.annual[id] / r.annual.horizontal - 1) * 100;
    assert.ok(Math.abs(r.gainVsHorizontal[id] - expectH) < 1e-9, id);
  }
  assert.equal(r.gainVsFixedTilt['fixed-lat-tilt'], 0);
  assert.ok(r.gainVsFixedTilt['dual-axis-helios'] > 30);
});

test('computeAnnualYield rejects invalid mode and latitude', () => {
  assert.throws(() => L.computeAnnualYield({ latitude: 91 }), RangeError);
  assert.throws(() => L.computeAnnualYield({ latitude: 40, mode: 'weekly' }), RangeError);
  assert.throws(() => L.computeAnnualYield({ latitude: 40, stepMinutes: 0 }), RangeError);
});

test('compareRegimes returns five ordered rows with every metric', () => {
  const c = L.compareRegimes({ latitude: 40.7, stepMinutes: 24 });
  assert.equal(c.rows.length, 5);
  assert.deepEqual(c.rows.map((r) => r.id), L.REGIME_IDS);
  c.rows.forEach((row) => {
    assert.ok(Number.isFinite(row.annualKwhM2));
    assert.ok(Number.isFinite(row.gainVsFixedTiltPct));
    assert.ok(Number.isFinite(row.solsticePeakElevationDeg));
    assert.ok(Number.isFinite(row.equinoxPeakElevationDeg));
  });
  assert.equal(c.latitude, 40.7);
  assert.ok(c.seasons.summer.peakElevationDeg > c.seasons.winter.peakElevationDeg);
});

test('latitudeBenchmark covers all four canonical latitudes with positive dual gain', () => {
  const bench = L.latitudeBenchmark({ stepMinutes: 30 });
  assert.equal(bench.length, 4);
  assert.deepEqual(bench.map((b) => b.latitude), [0, 29.6, 40.7, 55.7]);
  bench.forEach((b) => {
    assert.ok(b.annual['dual-axis-helios'] > 0);
    assert.ok(b.gainVsFixedTiltPct > 10, `lat ${b.latitude}`);
  });
});

test('latitudeBenchmark accepts custom latitudes and validates the array', () => {
  const bench = L.latitudeBenchmark({ latitudes: [-33.9, 51.5], stepMinutes: 30 });
  assert.deepEqual(bench.map((b) => b.latitude), [-33.9, 51.5]);
  assert.throws(() => L.latitudeBenchmark({ latitudes: [] }), RangeError);
});

test('computeSeasonExtremes orders solstice peaks sensibly and validates latitude', () => {
  const s = L.computeSeasonExtremes(40.7);
  assert.ok(s.summer.peakElevationDeg > s.equinox.peakElevationDeg);
  assert.ok(s.equinox.peakElevationDeg > s.winter.peakElevationDeg);
  const eq = L.computeSeasonExtremes(0);
  assert.ok(eq.equinox.peakElevationDeg > 89);
  assert.throws(() => L.computeSeasonExtremes(91), RangeError);
});

test('annual yield at the equator: horizontal equals fixed tilt exactly', () => {
  const r = L.computeAnnualYield({ latitude: 0, mode: 'monthly', stepMinutes: 30 });
  assert.ok(Math.abs(r.annual.horizontal - r.annual['fixed-lat-tilt']) < 1e-9);
});

/* ---------------------------------------------------------- 7. worm lock */

test('computeWormLock reproduces engine lead and friction angles', () => {
  const w = L.computeWormLock({ module: 1.5, teeth: 24, wormStarts: 1, diameterQuotient: 10, pressureAngle: 20, mu: 0.15 });
  const t = E.computeGearTrainMetrics({ module: 1.5, teeth: 24, wormStarts: 1, diameterQuotient: 10, pressureAngle: 20, frictionCoefficient: 0.15 });
  assert.ok(Math.abs(w.leadAngleDeg - t.worm.leadAngleDeg) < 1e-9);
  assert.ok(Math.abs(w.frictionAngleDeg - t.frictionAngleDeg) < 1e-9);
  assert.equal(w.selfLocking, t.selfLocking);
  assert.ok(Math.abs(w.lockMarginDeg - t.lockMarginDeg) < 1e-9);
  assert.ok(Math.abs(w.efficiency - t.efficiency) < 1e-9);
});

test('computeWormLock exact default values', () => {
  const w = L.computeWormLock({ mu: 0.15 });
  assert.ok(Math.abs(w.leadAngleDeg - Math.atan(0.1) / DEG) < 1e-9);
  assert.ok(Math.abs(w.frictionAngleDeg - Math.atan(0.15 / Math.cos(20 * DEG)) / DEG) < 1e-9);
  assert.ok(Math.abs(w.boundaryMu - 0.1 * Math.cos(20 * DEG)) < 1e-9);
  assert.equal(w.ratio, 24);
  assert.equal(w.selfLocking, true);
});

test('computeWormLock boundary verdict flips at exactly mu*', () => {
  const w = L.computeWormLock({ mu: 0.15 });
  const muB = w.boundaryMu;
  const below = L.computeWormLock({ mu: muB - 1e-6 });
  const above = L.computeWormLock({ mu: muB + 1e-6 });
  const edge = L.computeWormLock({ mu: muB });
  assert.equal(below.selfLocking, false);
  assert.equal(above.selfLocking, true);
  assert.equal(edge.selfLocking, false, 'strict lambda < phi_s at equality');
  assert.ok(edge.lockMarginDeg <= 0);
});

test('computeWormLock friction angle is strictly increasing in mu', () => {
  let prev = -1;
  for (let mu = 0.02; mu <= 0.6; mu += 0.02) {
    const w = L.computeWormLock({ mu });
    assert.ok(w.frictionAngleDeg > prev);
    prev = w.frictionAngleDeg;
  }
});

test('computeWormLock multi-start worm raises lead angle and can defeat locking', () => {
  const w1 = L.computeWormLock({ wormStarts: 1, mu: 0.1 });
  const w4 = L.computeWormLock({ wormStarts: 4, mu: 0.1 });
  assert.ok(w4.leadAngleDeg > w1.leadAngleDeg);
  assert.ok(w4.leadAngleDeg > 15, `lead ${w4.leadAngleDeg}`);
  assert.equal(w4.selfLocking, false);
  assert.equal(w4.ratio, 6);
});

test('computeWormLock efficiency stays inside (0, 1) for sane geometries', () => {
  for (const mu of [0.05, 0.1, 0.15, 0.3, 0.5]) {
    const w = L.computeWormLock({ mu });
    assert.ok(w.efficiency > 0 && w.efficiency < 1, `mu=${mu}`);
  }
});

test('computeWormLock validates every parameter range', () => {
  assert.throws(() => L.computeWormLock({ module: 0 }), RangeError);
  assert.throws(() => L.computeWormLock({ module: -1 }), RangeError);
  assert.throws(() => L.computeWormLock({ module: NaN }), RangeError);
  assert.throws(() => L.computeWormLock({ module: 21 }), RangeError);
  assert.throws(() => L.computeWormLock({ teeth: 5 }), RangeError);
  assert.throws(() => L.computeWormLock({ teeth: 401 }), RangeError);
  assert.throws(() => L.computeWormLock({ teeth: 24.5 }), RangeError);
  assert.throws(() => L.computeWormLock({ wormStarts: 0 }), RangeError);
  assert.throws(() => L.computeWormLock({ wormStarts: 9 }), RangeError);
  assert.throws(() => L.computeWormLock({ wormStarts: 2.5 }), RangeError);
  assert.throws(() => L.computeWormLock({ diameterQuotient: 1 }), RangeError);
  assert.throws(() => L.computeWormLock({ diameterQuotient: 41 }), RangeError);
  assert.throws(() => L.computeWormLock({ pressureAngle: 4 }), RangeError);
  assert.throws(() => L.computeWormLock({ pressureAngle: 36 }), RangeError);
  assert.throws(() => L.computeWormLock({ mu: 0 }), RangeError);
  assert.throws(() => L.computeWormLock({ mu: -0.2 }), RangeError);
  assert.throws(() => L.computeWormLock({ mu: 2.5 }), RangeError);
  assert.throws(() => L.computeWormLock({ mu: NaN }), RangeError);
  assert.throws(() => L.computeWormLock({ mu: Infinity }), RangeError);
});

test('sweepWormMaterials returns all five materials with verdict fields', () => {
  const s = L.sweepWormMaterials({});
  assert.equal(s.rows.length, 5);
  assert.deepEqual(s.rows.map((r) => r.id), L.MATERIAL_IDS);
  s.rows.forEach((r) => {
    assert.ok(Number.isFinite(r.frictionAngleDeg));
    assert.ok(Number.isFinite(r.lockMarginDeg));
    assert.equal(typeof r.selfLocking, 'boolean');
    assert.equal(r.lockMarginDeg > 0, r.selfLocking);
  });
});

test('sweepWormMaterials default verdicts: hardened steel pair back-drives, rest lock', () => {
  const s = L.sweepWormMaterials({});
  const byId = {};
  s.rows.forEach((r) => { byId[r.id] = r; });
  assert.equal(byId['hardened-steel'].selfLocking, false);
  assert.equal(byId['dry-pla'].selfLocking, true);
  assert.equal(byId['lubed-petg'].selfLocking, true);
  assert.equal(byId['nylon-steel'].selfLocking, true);
  assert.equal(byId['bronze-steel'].selfLocking, true);
});

test('sweepWormMaterials includes a custom mu row only when requested', () => {
  const none = L.sweepWormMaterials({});
  assert.equal(none.custom, null);
  const s = L.sweepWormMaterials({ customMu: 0.07 });
  assert.equal(s.custom.id, 'custom');
  assert.equal(s.custom.mu, 0.07);
  assert.equal(s.custom.selfLocking, false);
  assert.throws(() => L.sweepWormMaterials({ customMu: -0.5 }), RangeError);
});

test('sweepWormMaterials respects gear geometry overrides', () => {
  const s = L.sweepWormMaterials({ module: 2, teeth: 40, diameterQuotient: 8, wormStarts: 2 });
  const w = L.computeWormLock({ module: 2, teeth: 40, diameterQuotient: 8, wormStarts: 2, mu: 0.15 });
  s.rows.forEach((r) => {
    assert.ok(Math.abs(r.leadAngleDeg - w.leadAngleDeg) < 1e-9);
  });
});

test('wormBoundaryCurve emits a monotonic curve plus constant lead line data', () => {
  const c = L.wormBoundaryCurve({ steps: 20 });
  assert.equal(c.curve.length, 21);
  for (let i = 1; i < c.curve.length; i++) {
    assert.ok(c.curve[i].mu > c.curve[i - 1].mu);
    assert.ok(c.curve[i].frictionAngleDeg > c.curve[i - 1].frictionAngleDeg);
  }
  assert.equal(c.curve[0].mu, L.CHART_MU_RANGE.min);
  assert.equal(c.curve[20].mu, L.CHART_MU_RANGE.max);
  assert.ok(Math.abs(c.leadAngleDeg - Math.atan(0.1) / DEG) < 1e-9);
  assert.ok(Math.abs(c.boundaryMu - 0.1 * Math.cos(20 * DEG)) < 1e-9);
});

test('wormBoundaryCurve validates steps and mu window', () => {
  assert.throws(() => L.wormBoundaryCurve({ steps: 1 }), RangeError);
  assert.throws(() => L.wormBoundaryCurve({ steps: 401 }), RangeError);
  assert.throws(() => L.wormBoundaryCurve({ steps: 2.5 }), RangeError);
  assert.throws(() => L.wormBoundaryCurve({ muMin: 0.4, muMax: 0.3 }), RangeError);
  const c = L.wormBoundaryCurve({ muMin: 0.05, muMax: 0.4, steps: 35 });
  assert.equal(c.curve.length, 36);
  assert.ok(c.curve.every((p) => p.mu >= 0.05 && p.mu <= 0.4));
});

/* --------------------------------------------- 8. manifold and PCB audit */

test('auditManifold reports watertight Euler-Poincare invariants on all 6 bodies', () => {
  const a = L.auditManifold({});
  assert.equal(Object.keys(a.parts).length, 6);
  assert.equal(a.allWatertight, true);
  E.PART_IDS.forEach((id) => {
    const p = a.parts[id];
    assert.equal(p.eulerCharacteristic, p.vertexCount - p.edgeCount + p.faceCount, id);
    assert.equal(p.boundaryEdges, 0, id);
    assert.equal(p.nonManifoldEdges, 0, id);
    assert.equal(p.nonManifoldVertices, 0, id);
    assert.equal(p.degenerateFaces, 0, id);
    assert.equal(p.invalidIndices, 0, id);
    assert.equal(p.isWatertight, true, id);
    assert.ok(p.volume > 0, id);
  });
});

test('auditManifold genus assignments match expected topology', () => {
  const a = L.auditManifold({});
  assert.equal(a.parts.base.genus, 1);
  assert.equal(a.parts.wheel.genus, 1);
  assert.equal(a.parts.yoke.genus, 0);
  assert.equal(a.parts.panel.genus, 0);
  assert.equal(a.parts.pcb.genus, 0);
  assert.equal(a.parts.sensors.genus, 0);
  assert.equal(a.parts.sensors.shells, 4);
  assert.equal(a.parts.sensors.eulerCharacteristic, 8);
});

test('auditManifold totals equal the per-part sums', () => {
  const a = L.auditManifold({});
  let v = 0, e = 0, f = 0, vol = 0, area = 0;
  Object.values(a.parts).forEach((p) => {
    v += p.vertexCount; e += p.edgeCount; f += p.faceCount;
    vol += p.volume; area += p.surfaceArea;
  });
  assert.equal(a.totals.vertexCount, v);
  assert.equal(a.totals.edgeCount, e);
  assert.equal(a.totals.faceCount, f);
  assert.ok(Math.abs(a.totals.volume - vol) < 1e-9);
  assert.ok(Math.abs(a.totals.surfaceArea - area) < 1e-9);
});

test('auditManifold stays watertight across the slider parameter space', () => {
  for (const params of [
    { module: 1.0, teeth: 14, wallThickness: 1.5 },
    { module: 2.0, teeth: 30, wallThickness: 4.5 },
    { module: 2.5, teeth: 20, wallThickness: 6.0 }
  ]) {
    const a = L.auditManifold(params);
    assert.equal(a.allWatertight, true, JSON.stringify(params));
  }
});

test('auditPcb verifies 48 placements, pin coverage and net accounting', () => {
  const a = L.auditPcb(HW);
  assert.equal(a.componentCount, 48);
  assert.equal(a.placedCount, 48);
  assert.equal(a.pinsAccounted, true);
  assert.equal(a.placementsInBounds, true);
  assert.equal(a.duplicatePositions.length, 0);
  assert.equal(a.unconnectedPins.length, 0);
  assert.equal(a.netCount, Object.keys(HW.NETS).length);
  assert.equal(a.noConnectCount, Object.keys(HW.NO_CONNECT).length);
  assert.equal(a.bomLines, 26);
  assert.equal(a.clean, true);
  assert.equal(a.courtyard.checked, false);
});

test('auditPcb with real courtyards finds zero overlaps inside Edge.Cuts', () => {
  const a = L.auditPcb(HW, { courtyardForRef: (ref) => K.placedCourtyard(ref) });
  assert.equal(a.courtyard.checked, true);
  assert.equal(a.courtyard.outOfBounds.length, 0);
  assert.equal(a.courtyard.overlaps.length, 0);
  assert.equal(a.clean, true);
});

test('auditPcb pinsChecked equals total symbol pins across all 48 parts', () => {
  let expected = 0;
  HW.COMPONENTS.forEach((c) => { expected += HW.SYMBOLS[c.symbol].pins.length; });
  const a = L.auditPcb(HW);
  assert.equal(a.pinsChecked, expected);
  assert.equal(expected, 195);
});

test('auditPcb rejects a malformed hardware dataset but falls back when omitted', () => {
  assert.throws(() => L.auditPcb({}), RangeError);
  assert.throws(() => L.auditPcb({ COMPONENTS: [] }), RangeError);
  assert.equal(L.auditPcb().componentCount, 48);
});

/* ------------------------------------------------- 9. brief, digest, exports */

test('buildBriefPayload produces the canonical audited brief shape', () => {
  const p = L.buildBriefPayload({ lat: 38.9, day: 172, reg: 'dual-axis-helios', mat: 'bronze-steel', mu: 0.15, teeth: 24, mod: 1.5 });
  assert.equal(p.schema, L.BRIEF_SCHEMA);
  assert.deepEqual(p.state, { lat: 38.9, day: 172, reg: 'dual-axis-helios', mat: 'bronze-steel', mu: 0.15, teeth: 24, mod: 1.5 });
  assert.equal(Object.keys(p.solar.annualKwhM2).length, 5);
  assert.equal(Object.keys(p.manifold.parts).length, 6);
  assert.equal(p.manifold.allWatertight, true);
  assert.equal(p.pcb.components, 48);
  assert.equal(p.pcb.clean, true);
  assert.ok(p.worm.selfLocking === true);
  assert.ok(Math.abs(p.worm.leadAngleDeg - 5.7106) < 1e-4);
});

test('buildBriefPayload is deterministic and normalized', () => {
  const a = L.buildBriefPayload({ lat: 38.9, mu: 0.15 });
  const b = L.buildBriefPayload({ mu: 0.15, lat: 38.9 });
  assert.equal(L.stableStringify(a), L.stableStringify(b));
  assert.throws(() => L.buildBriefPayload({ lat: 200 }), RangeError);
});

test('buildBriefPayload maps custom material mu into the worm section', () => {
  const p = L.buildBriefPayload({ mat: 'custom', mu: 0.07 });
  assert.equal(p.worm.mu, 0.07);
  assert.equal(p.worm.materialId, 'custom');
  assert.equal(p.worm.selfLocking, false);
});

test('stampBrief attaches a 64-hex digest computed over the payload', () => {
  const payload = L.buildBriefPayload({ lat: 40.7 });
  const stamped = L.stampBrief(payload);
  assert.match(stamped.digest, /^[0-9a-f]{64}$/);
  assert.equal(stamped.digest, L.sha256(L.stableStringify(payload)));
  assert.equal(Object.keys(stamped).length, Object.keys(payload).length + 1);
});

test('createBriefCache returns one identical stamped payload per state key', () => {
  const cache = L.createBriefCache();
  const s = { lat: 38.9, day: 172, reg: 'dual-axis-helios', mat: 'bronze-steel', mu: 0.15, teeth: 24, mod: 1.5 };
  const a = cache.briefFor(s);
  const b = cache.briefFor(s);
  assert.equal(a, b, 'same object identity proves single cached payload');
  const c = cache.briefFor({ lat: 40 });
  assert.notEqual(a.digest, c.digest);
});

test('verifyBrief passes a fresh stamp and fails after any mutation', () => {
  const stamped = L.stampBrief(L.buildBriefPayload({ lat: 29.6 }));
  assert.equal(L.verifyBrief(stamped).ok, true);
  const mutated = JSON.parse(JSON.stringify(stamped));
  mutated.worm.lockMarginDeg = 99;
  const res = L.verifyBrief(mutated);
  assert.equal(res.ok, false);
  assert.equal(res.expected, stamped.digest);
  assert.notEqual(res.actual, stamped.digest);
});

test('verifyBrief fails closed on malformed stamped objects', () => {
  assert.equal(L.verifyBrief(null).ok, false);
  assert.equal(L.verifyBrief({}).ok, false);
  assert.equal(L.verifyBrief('x').ok, false);
  const bad = L.stampBrief({ a: 1 });
  bad.digest = 'z'.repeat(64);
  assert.equal(L.verifyBrief(bad).ok, false);
});

test('demonstrateTamper keeps the stale digest so verification fails', () => {
  const stamped = L.stampBrief(L.buildBriefPayload({ lat: 38.9 }));
  const demo = L.demonstrateTamper(stamped);
  assert.equal(demo.verify.ok, false);
  assert.equal(demo.tampered.digest, stamped.digest, 'stale digest retained for the demo');
  assert.notEqual(demo.tampered.solar.annualKwhM2['dual-axis-helios'],
    stamped.solar.annualKwhM2['dual-axis-helios']);
});

test('csvSafeCell escapes formula-injection prefixes', () => {
  assert.equal(L.csvSafeCell('=CMD()'), "'=CMD()");
  assert.equal(L.csvSafeCell('+1+1'), "'+1+1");
  assert.equal(L.csvSafeCell('-5'), "'-5");
  assert.equal(L.csvSafeCell('@name'), "'@name");
  assert.equal(L.csvSafeCell('\t=1'), "'\t=1");
  assert.equal(L.csvSafeCell('plain'), 'plain');
  assert.equal(L.csvSafeCell(42), '42');
  assert.equal(L.csvSafeCell(null), '');
  assert.equal(L.csvSafeCell(undefined), '');
  assert.equal(L.csvSafeCell('a,"b"'), '"a,""b"""');
  assert.equal(L.csvSafeCell('multi\nline'), '"multi\nline"');
});

test('briefToJson parses back to the stamped payload and verifies', () => {
  const stamped = L.stampBrief(L.buildBriefPayload({ lat: 38.9 }));
  const json = L.briefToJson(stamped);
  const obj = JSON.parse(json);
  assert.equal(obj.digest, stamped.digest);
  assert.equal(obj.schema, L.BRIEF_SCHEMA);
  assert.equal(L.verifyExportedJson(json).ok, true);
});

test('briefToCsv carries sha256 provenance header and formula-safe cells', () => {
  const stamped = L.stampBrief(L.buildBriefPayload({ lat: 38.9 }));
  const csv = L.briefToCsv(stamped);
  const lines = csv.split('\n');
  assert.equal(lines[0], '# helios-lab engineering brief');
  assert.equal(lines[1], '# schema: ' + L.BRIEF_SCHEMA);
  assert.equal(lines[2], '# sha256: ' + stamped.digest);
  assert.ok(lines[3].startsWith('# payload-b64url: '));
  assert.equal(lines[4], 'section,key,value');
  assert.equal(L.verifyExportedText(csv).ok, true);
  const rowCount = lines.filter((ln) => ln && !ln.startsWith('#')).length;
  assert.equal(rowCount, 1 + L.briefRows(stamped).length);
});

test('briefToMarkdown has tables plus sha256 footer and verifies', () => {
  const stamped = L.stampBrief(L.buildBriefPayload({ lat: 55.7 }));
  const md = L.briefToMarkdown(stamped);
  assert.ok(md.includes('| Regime | Annual | % vs fixed tilt |'));
  assert.ok(md.includes('| Part | V | E | F | chi | genus | Watertight |'));
  assert.ok(md.includes('payload-b64url: '));
  assert.ok(md.includes('sha256: ' + stamped.digest));
  assert.equal(L.verifyExportedText(md).ok, true);
});

test('identical digest appears in the stamped object, JSON, CSV header and Markdown footer', () => {
  const stamped = L.stampBrief(L.buildBriefPayload({ lat: 0 }));
  const json = JSON.parse(L.briefToJson(stamped));
  const csv = L.briefToCsv(stamped);
  const md = L.briefToMarkdown(stamped);
  const csvDigest = /# sha256: ([0-9a-f]{64})/.exec(csv)[1];
  const mdDigest = /sha256: ([0-9a-f]{64})/.exec(md)[1];
  assert.equal(json.digest, stamped.digest);
  assert.equal(csvDigest, stamped.digest);
  assert.equal(mdDigest, stamped.digest);
  assert.equal(L.recomputeDigest(stamped), stamped.digest);
});

test('verifyExportedText detects tampering in the digest or payload', () => {
  const stamped = L.stampBrief(L.buildBriefPayload({ lat: 38.9 }));
  const csv = L.briefToCsv(stamped);
  const forged = csv.replace(stamped.digest, '0'.repeat(64));
  assert.equal(L.verifyExportedText(forged).ok, false);
  const swapped = csv.replace('state,lat,38.9', 'state,lat,99.9');
  assert.notEqual(swapped, csv);
  const badPayload = csv.replace('payload-b64url: ', 'payload-b64url: A');
  const badRes = L.verifyExportedText(badPayload);
  assert.equal(badRes.ok, false);
  assert.equal(L.verifyExportedText('no markers here').ok, false);
  assert.equal(L.verifyExportedText(null).ok, false);
});

test('verifyExportedJson rejects corrupted JSON exports', () => {
  const stamped = L.stampBrief(L.buildBriefPayload({ lat: 38.9 }));
  const json = L.briefToJson(stamped);
  const obj = JSON.parse(json);
  obj.solar.annualKwhM2['dual-axis-helios'] = 9999;
  assert.equal(L.verifyExportedJson(JSON.stringify(obj)).ok, false);
  assert.equal(L.verifyExportedJson('{broken').ok, false);
  assert.equal(L.verifyExportedJson('{"a":1}').ok, false);
});

test('briefRows enumerates every payload field exactly once', () => {
  const stamped = L.stampBrief(L.buildBriefPayload({ lat: 38.9 }));
  const rows = L.briefRows(stamped);
  const auditRow = rows.filter((r) => r[0] === 'audit' && r[1] === 'sha256');
  assert.equal(auditRow.length, 1);
  assert.equal(auditRow[0][2], stamped.digest);
  const regimes = rows.filter((r) => r[0] === 'annualKwhM2');
  assert.equal(regimes.length, 5);
  const parts = rows.filter((r) => r[0] === 'manifold.base');
  assert.ok(parts.length >= 10);
});

test('exporters reject unstamped payloads', () => {
  const raw = L.buildBriefPayload({ lat: 38.9 });
  assert.throws(() => L.briefToJson(raw), RangeError);
  assert.throws(() => L.briefToCsv(raw), RangeError);
  assert.throws(() => L.briefToMarkdown(raw), RangeError);
});

/* ----------------------------------------------------------- 10. self-tests */

test('runSelfTests returns 18 checks, all passing, with unique ids', () => {
  const res = L.runSelfTests(E, HW);
  assert.equal(res.total, 18);
  assert.equal(res.passed, 18);
  assert.equal(res.allOk, true);
  const ids = res.results.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
  res.results.forEach((r) => {
    assert.equal(typeof r.id, 'string');
    assert.equal(typeof r.name, 'string');
    assert.equal(typeof r.ok, 'boolean');
    assert.equal(typeof r.detail, 'string');
  });
});

test('runSelfTests reports failures instead of throwing when a check fails', () => {
  const brokenEngine = Object.assign({}, E, {
    computeDeclination: () => 99
  });
  const res = L.runSelfTests(brokenEngine, HW);
  const decl = res.results.find((r) => r.id === 'decl-equinox');
  assert.equal(decl.ok, false);
  assert.ok(res.passed < res.total);
  assert.equal(res.allOk, false);
});

/* -------------------------------------------- 11. hostile input regression */

test('lab functions never leak NaN into yield results for extreme-but-valid inputs', () => {
  for (const [lat, doy] of [[89, 172], [-89, 355], [89, 355], [-89, 172], [0, 366], [65, 1]]) {
    const d = L.computeDailyYield({ latitude: lat, dayOfYear: doy, stepMinutes: 20 });
    for (const id of L.REGIME_IDS) {
      assert.ok(Number.isFinite(d.energies[id]), `${id} ${lat}/${doy}`);
      assert.ok(d.energies[id] >= 0);
    }
  }
});

test('negative zero latitude normalizes and computes consistently', () => {
  const s = L.normalizeLabState({ lat: -0 });
  assert.ok(s.lat === 0);
  const d = L.computeDailyYield({ latitude: -0, dayOfYear: 80, stepMinutes: 30 });
  assert.ok(d.energies.horizontal > 0);
});

test('decodeHashState cannot be coerced into throwing or prototype pollution', () => {
  const hostile = '#hc=' + L.b64urlEncode('{"lat":10,"__proto__":{"x":1}}');
  assert.equal(L.decodeHashState(hostile), null);
  const probe = {};
  assert.equal(probe.polluted, undefined);
  assert.equal(L.decodeHashState('#hc=' + L.b64urlEncode('{"a":{"b":{"c":1}}}')), null);
});

test('material sweep and boundary curve never emit NaN for extreme valid inputs', () => {
  const s = L.sweepWormMaterials({ module: 4, teeth: 400, wormStarts: 8, diameterQuotient: 2, pressureAngle: 35 });
  s.rows.forEach((r) => {
    assert.ok(Number.isFinite(r.leadAngleDeg));
    assert.ok(Number.isFinite(r.frictionAngleDeg));
  });
  const c = L.wormBoundaryCurve({ module: 0.1, teeth: 6, wormStarts: 1, diameterQuotient: 40 });
  c.curve.forEach((p) => assert.ok(Number.isFinite(p.frictionAngleDeg)));
});

test('helios-lab.js source contains zero em dashes, en dashes or AI-tool mentions', () => {
  const src = fs.readFileSync(path.join(ROOT, 'helios-lab.js'), 'utf8');
  assert.equal(/[\u2013\u2014]/.test(src), false, 'found forbidden dash');
  /* Term list built from fragments so this scanner's own file stays clean. */
  const terms = ['cla' + 'ude', 'open' + 'ai', 'anthro' + 'pic', 'chat' + 'gpt',
    'copi' + 'lot', 'code' + 'ium', 'tab' + 'nine', 'deep' + 'seek',
    'mist' + 'ral', 'lla' + 'ma', 'gem' + 'ini', 'dev' + 'in', 'wind' + 'surf'];
  const aiRe = new RegExp('\\b(' + terms.join('|') + ')\\b|generated by (an? )?(ai|llm|model)|' + 'ai-gener' + 'ated', 'i');
  assert.equal(aiRe.test(src), false, 'found AI-tool mention');
});

/* ---------------------------------------- 12. parametrized granular sweep */

L.CANONICAL_LATITUDES.forEach((lat) => {
  L.MONTHS.forEach((m) => {
    test(`daily yield lat ${lat} day ${m.repDay} (${m.name}): 5 finite energies, dual dominates`, () => {
      const d = L.computeDailyYield({ latitude: lat, dayOfYear: m.repDay, stepMinutes: 20 });
      L.REGIME_IDS.forEach((id) => {
        assert.ok(Number.isFinite(d.energies[id]), id);
        assert.ok(d.energies[id] >= 0, id);
        assert.ok(d.energies['dual-axis-helios'] + 1e-9 >= d.energies[id], `dual >= ${id}`);
      });
      assert.ok(d.daylightHours >= 0 && d.daylightHours <= 24.5);
    });
  });
});

L.CANONICAL_LATITUDES.forEach((lat) => {
  test(`canonical latitude ${lat}: dual-axis annual beats fixed tilt by 20%+`, () => {
    const r = L.computeAnnualYield({ latitude: lat, mode: 'monthly', stepMinutes: 30 });
    assert.ok(r.gainVsFixedTilt['dual-axis-helios'] > 20, `gain ${r.gainVsFixedTilt['dual-axis-helios']}`);
    assert.ok(r.annual.horizontal > 0);
  });
});

L.MONTHS.forEach((m, i) => {
  test(`month ${m.name} representative day ${m.repDay} sits inside month bounds`, () => {
    const start = L.MONTHS.slice(0, i).reduce((s, mm) => s + mm.days, 0) + 1;
    const end = start + m.days - 1;
    assert.ok(m.repDay >= start && m.repDay <= end, `${m.repDay} in [${start}, ${end}]`);
  });
});

L.WORM_MATERIALS.forEach((mat) => {
  test(`material ${mat.id} mu=${mat.mu} resolves through the solver`, () => {
    const w = L.computeWormLock({ mu: mat.mu });
    assert.ok(Math.abs(w.mu - mat.mu) < 1e-12);
    assert.ok(Number.isFinite(w.leadAngleDeg));
    assert.ok(Number.isFinite(w.efficiency));
    assert.equal(L.materialById(mat.id).mu, mat.mu);
  });
});

L.REGIME_IDS.forEach((id) => {
  test(`regime ${id} round-trips through the hash codec alone and inside a full state`, () => {
    const solo = L.decodeHashState('#' + L.encodeHashState({ reg: id }));
    assert.equal(solo.reg, id);
    const full = { lat: 20, day: 100, reg: id, mat: 'dry-pla', mu: 0.25, teeth: 24, mod: 1.5 };
    assert.deepEqual(L.decodeHashState('#' + L.encodeHashState(full)), full);
  });
});

[
  ['lat', 12.5], ['lat', -64.3], ['lat', 65], ['lat', -65],
  ['day', 1], ['day', 365], ['mu', 0.05], ['mu', 0.4],
  ['teeth', 14], ['teeth', 30], ['mod', 1], ['mod', 2.5]
].forEach(([key, val]) => {
  test(`single-field bookmark ${key}=${val} round-trips`, () => {
    const src = {};
    src[key] = val;
    const back = L.decodeHashState('#' + L.encodeHashState(src));
    assert.deepEqual(back, src);
  });
});

['a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'a'.repeat(119), 'a'.repeat(128)].forEach((s) => {
  test(`sha256 oracle parity at block-boundary length ${s.length}`, () => {
    const oracle = crypto.createHash('sha256').update(s, 'utf8').digest('hex');
    assert.equal(L.sha256(s), oracle);
  });
});

[
  { a: 'x' }, { a: 1, b: [1, 2] }, { z: { y: { x: [true, null] } } },
  { s: 'with "quotes" and \\ backslash' }, { u: '' }
].forEach((obj, i) => {
  test(`stableStringify is digest-stable across reserialization ${i}`, () => {
    const s1 = L.stableStringify(obj);
    const s2 = L.stableStringify(JSON.parse(s1));
    assert.equal(s1, s2);
    assert.equal(L.sha256(s1), L.sha256(s2));
  });
});

[
  { lat: 40 }, { day: 200 }, { reg: 'single-axis-ew' }, { mat: 'custom', mu: 0.35 },
  { teeth: 28 }, { mod: 2.5 }, { lat: 40, day: 200, reg: 'horizontal' }
].forEach((patch, i) => {
  test(`brief state ${i} produces a unique deterministic digest`, () => {
    const s1 = L.stampBrief(L.buildBriefPayload(patch));
    const s2 = L.stampBrief(L.buildBriefPayload(patch));
    assert.equal(s1.digest, s2.digest);
    assert.match(s1.digest, /^[0-9a-f]{64}$/);
  });
});

L.REGIME_IDS.forEach((id) => {
  test(`CSV and brief rows include regime ${id} exactly once`, () => {
    const stamped = L.stampBrief(L.buildBriefPayload({ lat: 38.9 }));
    const rows = L.briefRows(stamped);
    assert.equal(rows.filter((r) => r[0] === 'annualKwhM2' && r[1] === id).length, 1);
    assert.equal(rows.filter((r) => r[0] === 'gainPctVsFixedTilt' && r[1] === id).length, 1);
    const csv = L.briefToCsv(stamped);
    assert.equal(csv.split('\n').filter((ln) => ln === `annualKwhM2,${id},${stamped.solar.annualKwhM2[id]}`).length, 1);
  });
});

E.PART_IDS.forEach((id) => {
  test(`manifold audit part ${id} has chi = 2S - 2g and zero defects`, () => {
    const a = L.auditManifold({});
    const p = a.parts[id];
    assert.equal(p.eulerCharacteristic, 2 * p.shells - 2 * p.genus);
    assert.equal(p.boundaryEdges + p.nonManifoldEdges + p.degenerateFaces + p.invalidIndices, 0);
    const rows = L.briefRows(L.stampBrief(L.buildBriefPayload({ lat: 10 })));
    const key = 'manifold.' + id;
    assert.equal(rows.filter((r) => r[0] === key && r[1] === 'watertight')[0][2], true);
  });
});

['summer', 'equinox', 'winter'].forEach((season) => {
  test(`season extreme ${season} has finite peak elevation and sane air mass`, () => {
    const s = L.computeSeasonExtremes(38.9);
    assert.ok(Number.isFinite(s[season].peakElevationDeg));
    assert.ok(s[season].peakElevationDeg > 0 && s[season].peakElevationDeg <= 90);
    assert.ok(s[season].minAirMass >= 1);
  });
});

[0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4].forEach((mu) => {
  test(`worm lock at mu=${mu}: selfLocking iff frictionAngle > leadAngle strictly`, () => {
    const w = L.computeWormLock({ mu });
    assert.equal(w.selfLocking, w.frictionAngleDeg > w.leadAngleDeg);
    assert.equal(w.selfLocking, w.leadAngleDeg < w.frictionAngleDeg);
    assert.ok(Math.sign(w.lockMarginDeg) === Math.sign(w.frictionAngleDeg - w.leadAngleDeg) || w.lockMarginDeg === 0);
  });
});

[
  ['dry-pla', true], ['lubed-petg', true], ['nylon-steel', true],
  ['bronze-steel', true], ['hardened-steel', false]
].forEach(([id, expected]) => {
  test(`default worm geometry verdict for ${id} is ${expected}`, () => {
    const s = L.sweepWormMaterials({});
    const row = s.rows.find((r) => r.id === id);
    assert.equal(row.selfLocking, expected);
    assert.equal(row.selfLocking, L.computeWormLock({ mu: row.mu }).selfLocking);
  });
});

[0, 90, 180, 270, 360].forEach((doy) => {
  const valid = doy >= 1 && doy <= 366;
  test(`day-of-year ${doy} is ${valid ? 'accepted' : 'rejected'} by computeDailyYield`, () => {
    const run = () => L.computeDailyYield({ latitude: 30, dayOfYear: doy, stepMinutes: 60 });
    if (valid) {
      assert.ok(Number.isFinite(run().energies.horizontal));
    } else {
      assert.throws(run, RangeError);
    }
  });
});

test('helios-lab.js UMD export exposes every documented surface', () => {
  const required = [
    'REGIMES', 'REGIME_IDS', 'CANONICAL_LATITUDES', 'MONTHS', 'WORM_MATERIALS', 'MATERIAL_IDS',
    'MU_SWEEP', 'CHART_MU_RANGE', 'SOLSTICE_DAYS', 'BRIEF_SCHEMA', 'materialById',
    'cosIncidenceFor', 'computeDailyYield', 'computeAnnualYield', 'computeSeasonExtremes',
    'compareRegimes', 'latitudeBenchmark', 'computeWormLock', 'sweepWormMaterials',
    'wormBoundaryCurve', 'auditManifold', 'auditPcb', 'utf8Encode', 'utf8Decode',
    'sha256Bytes', 'sha256', 'b64urlEncodeBytes', 'b64urlEncode', 'b64urlDecode',
    'stableStringify', 'normalizeLabState', 'encodeHashState', 'decodeHashState',
    'buildBriefPayload', 'stampBrief', 'createBriefCache', 'briefToJson', 'briefToCsv',
    'briefToMarkdown', 'briefRows', 'csvSafeCell', 'recomputeDigest', 'verifyBrief',
    'verifyExportedText', 'verifyExportedJson', 'demonstrateTamper', 'runSelfTests'
  ];
  required.forEach((name) => {
    assert.ok(L[name] !== undefined, `missing export ${name}`);
  });
  assert.equal(L.REGIMES.length, 5);
  assert.equal(L.WORM_MATERIALS.length, 5);
  assert.equal(L.MONTHS.length, 12);
  assert.equal(L.CANONICAL_LATITUDES.length, 4);
});
