# Browser face-count assets

The assessment face-count signal runs in the candidate's browser. It uses
`@mediapipe/tasks-vision` **1.0.1** (Apache-2.0) with the matching WASM files
copied from that npm package, and Google's BlazeFace short-range float16 model
version 1 (Apache-2.0). Both are served from this application's own origin.
No raw video frame, bounding box, or face embedding is sent to the API.

Sources:

- [MediaPipe Face Detector for Web](https://developers.google.com/edge/mediapipe/solutions/vision/face_detector/web_js)
- [BlazeFace model](https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite)
- [BlazeFace model card](https://storage.googleapis.com/mediapipe-assets/MediaPipe%20BlazeFace%20Model%20Card%20%28Short%20Range%29.pdf)
- [MediaPipe Tasks Vision npm package](https://www.npmjs.com/package/@mediapipe/tasks-vision/v/1.0.1)

The model card states that identity recognition and surveillance are outside the
model's intended use, and detection can degrade with pose, distance, occlusion,
low light, and overlapping faces. This implementation is therefore only an
advisory face-presence signal requiring human interpretation. It must not make
an automatic cheating or identity determination. A labeled validation study on
the intended candidate devices and conditions is required before making any
accuracy claim or using the signal for consequential decisions.

SHA-256 of the bundled model:
`b4578f35940bf5a1a655214a1cce5cab13eba73c1297cd78e1a04c2380b0152f`

The JavaScript WASM loaders and binaries are copied unmodified from the pinned
package. Keep the package version and assets in sync when updating MediaPipe.
