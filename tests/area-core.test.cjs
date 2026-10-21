const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalize, detectionSubjects, detectionArea, hasSelection } = require('../public/area-core.js');

const detection = (x, y, width, height, score = 0.9) => ({
    boundingBox: { originX: x, originY: y, width, height }, categories: [{ score }],
});

test('image coordinates are fractions, remain bounded, and preserve headroom at edges', () => {
    assert.deepEqual(normalize({ x: 200, y: 100, width: 200, height: 100 }, 1000, 500),
        { x: 0.2, y: 0.2, width: 0.2, height: 0.2 });
    const area = detectionArea([detection(-10, 0, 100, 100)], 200, 200, true);
    assert.equal(area.x, 0);
    assert.equal(area.y, 0);
    assert.ok(area.width > 0.45);
    assert.ok(area.height > 0.5);
    assert.ok(area.x + area.width <= 1);
    assert.ok(area.y + area.height <= 1);
});

test('group portraits include every confident face, including smaller faces', () => {
    const area = detectionArea([detection(10, 20, 100, 100), detection(800, 100, 30, 30)], 1000, 500, true);
    assert.ok(area.x <= 0.01);
    assert.ok(area.x + area.width >= 0.83);
    assert.ok(area.y + area.height >= 0.26);
});

test('objects favour substantial subjects over small incidental detections', () => {
    const area = detectionArea([detection(100, 100, 300, 300), detection(900, 0, 10, 10)], 1000, 500);
    assert.ok(area.x + area.width < 0.5);
    assert.ok(area.x < 0.1);
    assert.ok(area.y < 0.2);
});

test('reported subjects are the boxes the suggested area encloses', () => {
    const detections = [detection(100, 100, 300, 300), detection(900, 0, 10, 10)];
    const subjects = detectionSubjects(detections, 1000, 500);
    assert.equal(subjects.length, 1);
    for (const [key, value] of Object.entries({ x: 0.1, y: 0.2, width: 0.3, height: 0.6 })) {
        assert.ok(Math.abs(subjects[0][key] - value) < 1e-9, key);
    }
    assert.deepEqual(Object.keys(subjects[0]), ['x', 'y', 'width', 'height']);
    const area = detectionArea(detections, 1000, 500);
    assert.ok(area.x <= subjects[0].x && area.x + area.width >= subjects[0].x + subjects[0].width);
    assert.equal(detectionSubjects([detection(10, 20, 100, 100), detection(800, 100, 30, 30)], 1000, 500, true).length, 2);
    assert.deepEqual(detectionSubjects([], 100, 100), []);
});

test('uncertain, missing, non-finite and off-image detections are rejected', () => {
    for (const candidates of [[], [detection(0, 0, 40, 40, 0.2)], [{}],
        [detection(NaN, 0, 40, 40)], [detection(500, 0, 10, 10)]]) {
        assert.equal(detectionArea(candidates, 200, 200, true), null);
    }
    assert.equal(normalize({ x: 0, y: 0, width: 0, height: 10 }, 100, 100), null);
});

test('explicit full-image selections are preserved; zero dimensions mean unset', () => {
    assert.equal(hasSelection({ width: '1', height: '1' }), true);
    assert.equal(hasSelection({ width: '0.4', height: '0.3' }), true);
    assert.equal(hasSelection({ width: '0', height: '0' }), false);
    assert.equal(hasSelection({ width: '', height: '' }), false);
});
