"""Local, deterministic Chromium smoke test for the proctoring browser runtime.

Run: python3 tests/browser/proctoring/smoke.py

Requires Python Playwright and its Chromium browser. This serves only the
repository's self-hosted model/WASM assets on loopback. The browser uses a fake
camera and does not capture a person or upload image data.
"""

from __future__ import annotations

import os
import threading
import unittest
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright


REPO = Path(__file__).resolve().parents[3]
PUBLIC = REPO / "apps/web/public"
VISION_BUNDLE = REPO / "apps/web/node_modules/@mediapipe/tasks-vision/vision_bundle.mjs"

PAGE_HTML = b"""<!doctype html>
<html><head><meta charset="utf-8"><title>Proctoring browser smoke</title></head>
<body>
  <video id="camera" muted autoplay playsinline width="320" height="240"></video>
  <button id="fullscreen" onclick="document.documentElement.requestFullscreen()">Fullscreen</button>
</body></html>"""


class AssetHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PUBLIC), **kwargs)

    def do_GET(self):
        if self.path == "/":
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(PAGE_HTML)))
            self.end_headers()
            self.wfile.write(PAGE_HTML)
            return
        super().do_GET()

    def translate_path(self, path):
        if path == "/vision_bundle.mjs":
            return str(VISION_BUNDLE)
        return super().translate_path(path)

    def guess_type(self, path):
        if path.endswith(".mjs"):
            return "text/javascript"
        if path.endswith(".wasm"):
            return "application/wasm"
        return super().guess_type(path)

    def log_message(self, *_args):
        pass


class ProctoringBrowserSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not VISION_BUNDLE.is_file():
            raise RuntimeError("Run pnpm install before the browser smoke test")
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), AssetHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.origin = f"http://127.0.0.1:{cls.server.server_port}"
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(
            headless=True,
            args=["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
        )

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)

    def setUp(self):
        self.context = self.browser.new_context(permissions=["camera"])
        self.page = self.context.new_page()
        self.page.goto(self.origin, wait_until="load")

    def tearDown(self):
        self.context.close()

    def test_self_hosted_assets_and_real_model_inference_on_fake_camera(self):
        for path in [
            "/vision_bundle.mjs",
            "/proctoring/blaze_face_short_range.float16.v1.tflite",
            "/proctoring/wasm/vision_wasm_internal.js",
            "/proctoring/wasm/vision_wasm_internal.wasm",
            "/proctoring/wasm/vision_wasm_nosimd_internal.js",
            "/proctoring/wasm/vision_wasm_nosimd_internal.wasm",
        ]:
            response = self.page.request.get(self.origin + path)
            self.assertEqual(response.status, 200, path)

        result = self.page.evaluate(
            """async () => {
              const video = document.querySelector('#camera');
              const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
              video.srcObject = stream;
              await video.play();
              const { FaceDetector, FilesetResolver } = await import('/vision_bundle.mjs');
              const wasm = await FilesetResolver.forVisionTasks('/proctoring/wasm');
              const detector = await FaceDetector.createFromOptions(wasm, {
                baseOptions: {
                  modelAssetPath: '/proctoring/blaze_face_short_range.float16.v1.tflite',
                  delegate: 'CPU'
                },
                runningMode: 'VIDEO',
                minDetectionConfidence: 0.5,
                minSuppressionThreshold: 0.3
              });
              const detections = detector.detectForVideo(video, performance.now()).detections.length;
              detector.close();
              stream.getTracks().forEach(track => track.stop());
              return {
                secureContext: window.isSecureContext,
                width: video.videoWidth,
                height: video.videoHeight,
                detections,
                trackEnded: stream.getVideoTracks()[0].readyState === 'ended'
              };
            }"""
        )
        self.assertTrue(result["secureContext"])
        self.assertGreater(result["width"], 0)
        self.assertGreater(result["height"], 0)
        self.assertGreaterEqual(result["detections"], 0)
        self.assertTrue(result["trackEnded"])

    def test_fullscreen_and_screen_capture_api_preflight(self):
        self.assertTrue(
            self.page.evaluate(
                """() => Boolean(navigator.mediaDevices?.getDisplayMedia &&
                  document.documentElement.requestFullscreen &&
                  document.exitFullscreen)"""
            )
        )
        self.page.locator("#fullscreen").click()
        self.page.wait_for_function("document.fullscreenElement === document.documentElement")
        self.page.evaluate("document.exitFullscreen()")
        self.page.wait_for_function("document.fullscreenElement === null")

    def test_optional_next_app_asset_and_route_headers(self):
        """Set PROCTORING_APP_ORIGIN to a running local Next app to include it."""
        app_origin = os.environ.get("PROCTORING_APP_ORIGIN")
        if not app_origin:
            self.skipTest("PROCTORING_APP_ORIGIN not set")
        parsed = urlparse(app_origin)
        self.assertIn(parsed.hostname, ("127.0.0.1", "localhost"))

        model = self.page.request.get(
            app_origin + "/proctoring/blaze_face_short_range.float16.v1.tflite"
        )
        wasm = self.page.request.get(
            app_origin + "/proctoring/wasm/vision_wasm_internal.wasm"
        )
        self.assertEqual(model.status, 200)
        self.assertEqual(wasm.status, 200)
        self.assertEqual(wasm.headers.get("content-type"), "application/wasm")
        self.assertIn("camera=(self)", model.headers.get("permissions-policy", ""))
        self.assertIn("display-capture=(self)", model.headers.get("permissions-policy", ""))

        org_slug = os.environ.get("PROCTORING_TEST_ORG_SLUG")
        if org_slug:
            self.assertRegex(org_slug, r"^[a-z0-9-]+$")
            protected = self.page.request.get(
                app_origin + f"/careers/{org_slug}/dashboard/assessments/smoke-test",
                max_redirects=0,
            )
            self.assertEqual(protected.status, 307)
            self.assertIn(
                f"/careers/{org_slug}/login", protected.headers.get("location", "")
            )


if __name__ == "__main__":
    unittest.main(verbosity=2)
