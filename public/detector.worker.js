/* All dependencies, models and image pixels stay on this origin. */
// Reuse the worker's asset version: bundle assets are cached long-term and must update together.
importScripts(`area-core.js${self.location.search}`);
// Smartcrop's UMD wrapper expects window in browsers. Use its CommonJS export in a worker.
self.exports = {};
importScripts('vendor/smartcrop.js');
const smartcrop = self.exports.smartcrop;
delete self.exports;

let filesetPromise;
let facePromise;
let objectPromise;

async function detector(type) {
    if (!filesetPromise) {
        importScripts('vendor/vision_bundle.js');
        filesetPromise = Vision.FilesetResolver.forVisionTasks(new URL('vendor/wasm', self.location.href).href);
    }
    const fileset = await filesetPromise;
    if (type === 'face') {
        facePromise ||= Vision.FaceDetector.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: new URL('vendor/models/face.tflite', self.location.href).href, delegate: 'CPU' },
            runningMode: 'IMAGE', minDetectionConfidence: 0.5,
        });
        return facePromise;
    }
    objectPromise ||= Vision.ObjectDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: new URL('vendor/models/objects.tflite', self.location.href).href, delegate: 'CPU' },
        runningMode: 'IMAGE', scoreThreshold: 0.45, maxResults: 20,
    });
    return objectPromise;
}

async function saliency(image) {
    // Supply raw image operations so Smartcrop needs neither DOM nor OffscreenCanvas.
    const result = await smartcrop.crop(image, {
        cropWidth: Math.max(1, Math.round(image.width * 0.6)),
        cropHeight: Math.max(1, Math.round(image.height * 0.6)),
        minScale: 1, maxScale: 1, prescale: false,
        // Skin colour is unnecessary here; actual face detection runs first.
        skinWeight: 0,
        imageOperations: {
            open: data => Promise.resolve(data),
            getData: data => Promise.resolve(data),
        },
    });
    return WaImageArea.normalize(result.topCrop, image.width, image.height);
}

self.onmessage = async ({ data }) => {
    const { width, height, buffer } = data;
    try {
        const image = new ImageData(new Uint8ClampedArray(buffer), width, height);
        let degraded = false;
        for (const type of ['face', 'object']) {
            try {
                const instance = await detector(type);
                const result = instance.detect(image);
                const area = WaImageArea.detectionArea(result.detections, width, height, type === 'face');
                if (area) {
                    // The individual boxes show the editor what the suggested area is based on.
                    const subjects = WaImageArea.detectionSubjects(result.detections, width, height, type === 'face');
                    self.postMessage({ area, subjects, method: type === 'face' ? 'faces' : 'objects', degraded });
                    return;
                }
            } catch (error) {
                degraded = true;
                console.warn(`Smart image area: ${type} detection unavailable`, error);
            }
        }
        const area = await saliency(image);
        if (!area) throw new Error('No valid suggestion');
        self.postMessage({ area, method: 'saliency', degraded });
    } catch (error) {
        self.postMessage({ error: String(error) });
    }
};
