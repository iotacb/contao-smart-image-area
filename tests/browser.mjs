import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const host = resolve(root, '../..');
const fixtures = resolve(root, 'tests/fixtures');
await mkdir(fixtures, { recursive: true });
await mkdir(resolve(root, 'tests/artifacts'), { recursive: true });
for (const [name, url] of [
    ['portrait.jpg', 'https://storage.googleapis.com/mediapipe-assets/portrait.jpg'],
    ['objects.jpg', 'https://storage.googleapis.com/mediapipe-assets/cats_and_dogs.jpg'],
]) {
    try { await readFile(resolve(fixtures, name)); } catch {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Fixture ${url}: ${response.status}`);
        await writeFile(resolve(fixtures, name), Buffer.from(await response.arrayBuffer()));
    }
}

const helper = `<div class="widget wa-image-area" data-wa-image-area data-worker-url="/bundles/smartimagearea/detector.worker.js"
    data-loading="loading" data-faces="faces" data-objects="objects" data-saliency="saliency"
    data-fallback="fallback" data-pending="pending" data-unchanged="unchanged" data-preserved="preserved"
    data-edited="edited" data-restored="restored" data-discarded="discarded" data-error="error"
    data-restore="restore" data-discard="discard" data-badge="Suggestion">
    <button type="button" data-suggest>Detect area automatically</button><button type="button" data-undo hidden>restore</button>
    <p data-status role="status"></p></div>`;

function harness(query) {
    const selected = query.get('saved') === '1';
    const values = selected ? [0.1, 0.2, 0.4, 0.5] : [0, 0, 0, 0];
    const source = query.get('image') === 'landscape' ? '/test/landscape.svg'
        : `/fixtures/${query.get('image') === 'objects' ? 'objects.jpg' : 'portrait.jpg'}`;
    return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Contao image area integration test</title>
    <style>body{font:16px sans-serif;padding:25px}.tl_edit_preview{position:relative;width:699px;max-width:100%}
    .tl_edit_preview img{display:block;max-width:100%;max-height:524px;width:auto;height:auto;padding:6px;border:1px solid #bbb}
    .tl_edit_preview_important_part{position:absolute;box-sizing:border-box;border:2px solid #e54718;background:#e5471820}
    button{margin:10px 5px 0 0;padding:8px}</style><link rel="stylesheet" href="/bundles/smartimagearea/image-area.css">
    <script src="/test/mootools-core.js"></script><script src="/test/mootools-more.js"></script><script src="/test/preview.js"></script>
    <form><div class="tl_tbox"><div class="widget"><div class="tl_edit_preview"><img src="${source}" alt=""></div></div>
    ${helper}${['X', 'Y', 'Width', 'Height'].map((key, i) => `<div class="widget"><input name="importantPart${key}" value="${values[i]}"></div>`).join('')}
    <button type="submit">Save</button></div></form><script src="/test/setup.js"></script>
    <script src="/bundles/smartimagearea/image-area.js"></script></html>`;
}

const coreSource = await readFile(resolve(host, 'vendor/contao/core-bundle/assets/scripts/core.js'), 'utf8');
const wizardStart = coreSource.indexOf('editPreviewWizard: function(el) {');
const wizardEnd = coreSource.indexOf('\n\t/**', wizardStart);
assert.ok(wizardStart > 0 && wizardEnd > wizardStart, 'Installed Contao preview wizard must exist');
const wizard = `window.Backend={${coreSource.slice(wizardStart, wizardEnd)}};`;

const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
        if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html'); res.end(harness(url.searchParams)); return; }
        if (url.pathname === '/test/preview.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(wizard); return; }
        if (url.pathname === '/test/landscape.svg') {
            res.setHeader('Content-Type', 'image/svg+xml');
            res.end('<svg xmlns="http://www.w3.org/2000/svg" width="700" height="400"><defs><linearGradient id="sky"><stop stop-color="#c4deee"/><stop offset="1" stop-color="#d2b4de"/></linearGradient></defs><rect width="700" height="400" fill="url(#sky)"/><path d="M0 400L200 150L350 300L470 200L700 400Z" fill="#466c59"/></svg>');
            return;
        }
        if (url.pathname === '/test/setup.js') {
            res.setHeader('Content-Type', 'text/javascript');
            res.end(`Backend.editPreviewWizard(document.querySelector('.tl_edit_preview'));
                document.querySelector('form').addEventListener('submit', event => event.preventDefault());`);
            return;
        }
        const map = {
            '/test/mootools-core.js': resolve(host, 'assets/mootools/js/mootools-core.js'),
            '/test/mootools-more.js': resolve(host, 'assets/mootools/js/mootools-more.js'),
        };
        let path = map[url.pathname];
        if (!path) {
            const base = url.pathname.startsWith('/fixtures/') ? fixtures : resolve(root, 'public');
            const relative = url.pathname.startsWith('/fixtures/') ? url.pathname.slice(10) : url.pathname.replace('/bundles/smartimagearea/', '');
            path = resolve(base, relative);
            if (!path.startsWith(base + sep)) { res.writeHead(403).end(); return; }
        }
        const types = { '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.jpg': 'image/jpeg' };
        res.setHeader('Content-Type', types[extname(path)] || 'application/octet-stream');
        res.end(await readFile(path));
    } catch { res.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chromium' });
const context = await browser.newContext();
const page = await context.newPage();
const messages = [];
page.on('console', msg => { if (msg.type() === 'warning' || msg.type() === 'error') messages.push(msg.text()); });
page.on('pageerror', error => messages.push(String(error)));
const external = [];
context.on('request', req => { if (!req.url().startsWith(base) && !req.url().startsWith('data:')) external.push(req.url()); });
const state = () => page.evaluate(() => {
    const image = document.querySelector('.tl_edit_preview img');
    const style = getComputedStyle(image);
    const rect = image.getBoundingClientRect();
    const status = document.querySelector('[data-status]');
    const undo = document.querySelector('[data-undo]');
    return {
        status: status.dataset.message,
        note: status.dataset.note,
        values: [...document.querySelectorAll('input[name^="importantPart"]')].map(input => Number(input.value)),
        overlay: document.querySelector('.tl_edit_preview_important_part')?.getBoundingClientRect().toJSON(),
        content: {
            x: rect.x + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft),
            y: rect.y + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop),
            width: image.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
            height: image.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
        },
        view: document.querySelector('.tl_edit_preview').dataset.waState,
        suggestion: document.querySelector('.wa-image-area-suggestion')?.getBoundingClientRect().toJSON(),
        subjects: document.querySelectorAll('.wa-image-area-subject').length,
        undo: undo.hidden ? null : undo.textContent,
    };
});
const settled = () => page.waitForFunction(() => {
    const message = document.querySelector('[data-status]')?.dataset.message;
    return message && message !== 'loading';
}, null, { timeout: 90000 });

try {
    await page.goto(base);
    await settled();
    let result = await state();
    assert.equal(result.status, 'faces', JSON.stringify({ result, messages }));
    assert.equal(result.note, 'pending');
    assert.ok(result.values[2] > 0 && result.values[3] > 0);
    assert.ok(result.overlay.width > 0 && result.overlay.height > 0);
    // Selections are fractions of the image content box, inside the preview's padding and border.
    assert.ok(Math.abs(result.overlay.width - result.content.width * result.values[2]) < 1);
    assert.ok(Math.abs(result.overlay.x - (result.content.x + result.content.width * result.values[0])) < 1);
    assert.ok(Math.abs(result.overlay.y - (result.content.y + result.content.height * result.values[1])) < 1);
    assert.equal(result.view, 'suggested');
    assert.ok(Math.abs(result.suggestion.x - result.overlay.x) < 1 && Math.abs(result.suggestion.width - result.overlay.width) < 1);
    assert.ok(result.subjects >= 1);
    assert.equal(result.undo, 'discard');
    await page.screenshot({ path: resolve(root, 'tests/artifacts/portrait.png') });
    await page.click('[data-undo]');
    result = await state();
    assert.deepEqual(result.values, [0, 0, 0, 0]);
    assert.equal(result.status, 'discarded');
    assert.equal(result.view, undefined);
    assert.equal(result.suggestion, undefined);
    console.log('PASS: real face model, distinct suggestion aligned with Contao overlay, discard');

    await page.goto(`${base}/?saved=1`);
    await settled();
    result = await state();
    assert.equal(result.status, 'preserved');
    assert.deepEqual(result.values, [0.1, 0.2, 0.4, 0.5]);
    // This is also the reload path after a regular Contao save.
    assert.equal(result.view, undefined);
    await page.click('[data-suggest]');
    await settled();
    result = await state();
    assert.equal(result.status, 'faces');
    assert.equal(result.undo, 'restore');
    // Detecting the same area again keeps the saved selection as the undo target.
    await page.click('[data-suggest]');
    await settled();
    result = await state();
    assert.equal(result.status, 'faces');
    assert.equal(result.note, 'pending');
    assert.equal(result.undo, 'restore');
    await page.click('[data-undo]');
    result = await state();
    assert.deepEqual(result.values, [0.1, 0.2, 0.4, 0.5]);
    assert.equal(result.status, 'restored');
    assert.equal(result.view, undefined);
    console.log('PASS: saved selection preserved; replacement and repeated detection can be undone');

    await page.goto(`${base}/?image=objects`);
    await settled();
    result = await state();
    assert.equal(result.status, 'objects', JSON.stringify({ result, messages }));
    await page.screenshot({ path: resolve(root, 'tests/artifacts/objects.png') });
    console.log('PASS: real object model detects animal subjects');

    await page.goto(`${base}/?image=landscape`);
    await settled();
    result = await state();
    assert.equal(result.status, 'saliency', JSON.stringify({ result, messages }));
    assert.ok(result.values[2] > 0 && result.values[3] > 0);
    await page.screenshot({ path: resolve(root, 'tests/artifacts/landscape.png') });
    console.log('PASS: images outside model categories receive a visual-detail suggestion');

    await context.route('**/vendor/models/*.tflite', route => route.fulfill({ status: 404, body: '' }));
    await page.goto(base);
    await settled();
    result = await state();
    assert.equal(result.status, 'fallback', JSON.stringify({ result, messages }));
    assert.ok(result.values[2] > 0 && result.values[3] > 0);
    console.log('PASS: missing models fall back to content analysis');
    await context.unroute('**/vendor/models/*.tflite');

    // Delay inference so the user can begin drawing before a result arrives.
    await context.route('**/vendor/models/*.tflite', async route => {
        await new Promise(done => setTimeout(done, 1500));
        await route.continue().catch(() => {});
    });
    await page.goto(base);
    await page.waitForSelector('[data-wa-image-area][data-initialized]');
    const rect = await page.locator('.tl_edit_preview img').boundingBox();
    await page.mouse.move(rect.x + 20, rect.y + 20);
    await page.mouse.down();
    await page.mouse.move(rect.x + 120, rect.y + 140);
    await page.mouse.up();
    const manual = (await state()).values;
    await page.waitForTimeout(1800);
    assert.deepEqual((await state()).values, manual);
    assert.equal((await state()).status, 'edited', JSON.stringify({ result: await state(), messages }));
    assert.equal((await state()).view, undefined);
    assert.ok(manual[2] > 0);
    console.log('PASS: delayed suggestions never overwrite manual drawing');

    await page.goto(base);
    await page.waitForSelector('[data-wa-image-area][data-initialized]');
    await page.click('[type="submit"]');
    const submitted = (await state()).values;
    await page.waitForTimeout(1800);
    assert.deepEqual((await state()).values, submitted);
    console.log('PASS: submitting cancels pending changes');
    assert.deepEqual(external, [], 'All runtime requests must stay local');
    console.log('PASS: no external runtime requests');
} finally {
    await browser.close();
    await new Promise(done => server.close(done));
}
