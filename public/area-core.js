(function (root) {
    'use strict';

    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

    function normalize(box, width, height, padding = 0) {
        if (![box.x, box.y, box.width, box.height, width, height].every(Number.isFinite)
            || box.width <= 0 || box.height <= 0 || width <= 0 || height <= 0) return null;
        const x = clamp((box.x - box.width * padding) / width, 0, 1);
        const y = clamp((box.y - box.height * padding) / height, 0, 1);
        const right = clamp((box.x + box.width * (1 + padding)) / width, 0, 1);
        const bottom = clamp((box.y + box.height * (1 + padding)) / height, 0, 1);
        return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
    }

    function detectionSubjects(detections, width, height, faces = false) {
        const boxes = detections.map(detection => {
            const box = detection.boundingBox;
            const score = Math.max(0, ...(detection.categories || []).map(category => category.score || 0));
            if (!box || score < (faces ? 0.5 : 0.45)) return null;
            const area = normalize({ x: box.originX, y: box.originY, width: box.width, height: box.height }, width, height);
            return area ? { ...area, score } : null;
        }).filter(Boolean);
        if (!boxes.length) return [];

        // Keep all detected faces. For other subjects, omit incidental small objects.
        const ranks = boxes.map(box => box.width * box.height * box.score);
        const bestRank = Math.max(...ranks);
        return (faces ? boxes : boxes.filter((box, i) => ranks[i] >= bestRank * 0.3))
            .map(({ x, y, width, height }) => ({ x, y, width, height }));
    }

    function detectionArea(detections, width, height, faces = false) {
        const subjects = detectionSubjects(detections, width, height, faces);
        if (!subjects.length) return null;
        const x = Math.min(...subjects.map(box => box.x));
        const y = Math.min(...subjects.map(box => box.y));
        const right = Math.max(...subjects.map(box => box.x + box.width));
        const bottom = Math.max(...subjects.map(box => box.y + box.height));
        // Include a little space around heads/subjects without enforcing an output ratio.
        return normalize({ x, y, width: right - x, height: bottom - y }, 1, 1, faces ? 0.2 : 0.08);
    }

    function hasSelection(values) {
        // Zero dimensions mean no selection in Contao; an explicit full-image area is kept.
        return Number(values.width) > 0 && Number(values.height) > 0;
    }

    const api = { normalize, detectionSubjects, detectionArea, hasSelection };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.WaImageArea = api;
})(typeof self !== 'undefined' ? self : globalThis);
