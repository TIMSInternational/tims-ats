# Proctoring browser smoke

Run after `pnpm install`:

```bash
python3 tests/browser/proctoring/smoke.py
```

Requires Python Playwright and its Chromium browser. The test starts a loopback
HTTP server, serves the checked-in MediaPipe WASM and BlazeFace model, launches
Chromium with a fake camera, performs a real `detectForVideo` inference, checks
camera stream cleanup, and exercises fullscreen. It only verifies that the
`getDisplayMedia` browser API exists; it deliberately does not capture a real
screen. No candidate media or personal data is used or uploaded.

To also check a running local Next app's static assets, security headers, and
unauthenticated assessment redirect:

```bash
PROCTORING_APP_ORIGIN=http://127.0.0.1:3100 \
PROCTORING_TEST_ORG_SLUG=agroverde \
python3 tests/browser/proctoring/smoke.py
```

The origin is restricted to loopback. Set `PROCTORING_TEST_ORG_SLUG` to a known
local test organization; omit it if no test organization is provisioned. The
test does not automate an authenticated candidate or reviewer journey. That
requires a disposable assessment assignment plus test-account storage state
and should be run separately against an isolated beta environment. At minimum
that journey must verify consent, camera/screen preflight, assessment start,
signal upload and human review, completion, restart/recovery, tenant isolation,
and media-track cleanup. Face-count findings are unverified client observations
and must never automatically fail a candidate.
