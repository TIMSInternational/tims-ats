// LOCAL E2E ONLY (preloaded with `--require` into the suite API process this harness starts).
//
// The suite's webhook transport refuses any target that resolves to a private or loopback
// address (the F1 SSRF guard in apps/api/src/utils/safe-image-fetch.ts, used by
// src/v1/events/runtime.ts at subscription creation and at every delivery). In this local run the
// ATS receiver is on https://localhost, so this preload swaps that module for one whose
// isBlockedAddress lets exactly 127.0.0.1 and ::1 through and delegates every other address to the
// real guard. Nothing else changes: https only, no redirects, the real signing and delivery code.
// The production code is untouched; this file is never loaded outside this harness.
'use strict';
const Module = require('node:module');
const dns = require('node:dns');
const path = require('node:path');

const TARGET = `${path.sep}apps${path.sep}api${path.sep}src${path.sep}utils${path.sep}safe-image-fetch.ts`;
const SHIM_ID = __filename + '#shim';
let real = null;
let shim = null;

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function buildShim(realExports) {
  real = realExports;
  const isBlockedAddress = (address) => (LOOPBACK.has(address) ? false : real.isBlockedAddress(address));
  const systemResolveAll = (hostname, options, callback) => dns.lookup(hostname, options, callback);
  const createGuardedLookup =
    (resolveAll = systemResolveAll) =>
    (hostname, options, callback) => {
      resolveAll(hostname, { ...options, all: true }, (err, addresses) => {
        if (err) return callback(err, '', 0);
        if (!addresses || addresses.length === 0) return callback(new real.ImageFetchError('dns_no_address'), '', 0);
        if (addresses.some((a) => isBlockedAddress(a.address)))
          return callback(new real.UnsafeImageUrlError('blocked_address'), '', 0);
        if (options.all) return callback(null, addresses);
        return callback(null, addresses[0].address, addresses[0].family);
      });
    };
  return { ...real, isBlockedAddress, createGuardedLookup };
}

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  const resolved = origResolve.call(this, request, parent, ...rest);
  if (resolved.endsWith(TARGET) && !(parent && parent.id === SHIM_ID)) {
    if (!shim) {
      const m = new Module(SHIM_ID, parent);
      m.filename = SHIM_ID;
      m.paths = parent ? parent.paths : [];
      // Load the real module with this shim module as the parent (so this hook passes it through).
      const realExports = Module._load(resolved, m, false);
      shim = buildShim(realExports);
      Module._cache[SHIM_ID] = Object.assign(m, { loaded: true, exports: shim });
      process.stderr.write(
        '[assessments-cross] webhook loopback shim active (127.0.0.1/::1 allowed for local delivery)\n',
      );
    }
    return SHIM_ID;
  }
  return resolved;
};
