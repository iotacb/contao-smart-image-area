(function () {
    'use strict';

    const keys = { x: 'X', y: 'Y', width: 'Width', height: 'Height' };
    const selected = values => Number(values.width) > 0 && Number(values.height) > 0;
    const sameArea = (a, b) => Object.keys(keys).every(key => Math.abs(Number(a[key]) - Number(b[key])) < 0.001);
    const validArea = area => Boolean(area) && Object.keys(keys).every(key => Number.isFinite(area[key]))
        && area.x >= 0 && area.y >= 0 && area.width > 0 && area.height > 0
        && area.x + area.width <= 1.000001 && area.y + area.height <= 1.000001;

    function box(className, area) {
        const element = document.createElement('div');
        element.className = className;
        Object.assign(element.style, {
            left: `${area.x * 100}%`,
            top: `${area.y * 100}%`,
            width: `${area.width * 100}%`,
            height: `${area.height * 100}%`,
        });
        return element;
    }

    function initialize(root) {
        if (root.dataset.initialized) return;
        const form = root.closest('form');
        const section = root.closest('.tl_tbox,.tl_box') || form;
        const preview = section?.querySelector('.tl_edit_preview');
        const image = preview?.querySelector('img');
        const fields = Object.fromEntries(Object.entries(keys).map(([key, suffix]) =>
            [key, section?.querySelector(`input[name="importantPart${suffix}"]`)]));
        if (!form || !image || Object.values(fields).some(field => !field || field.disabled || field.readOnly)) {
            root.hidden = true;
            return;
        }
        root.dataset.initialized = 'true';

        const status = root.querySelector('[data-status]');
        const suggest = root.querySelector('[data-suggest]');
        const undo = root.querySelector('[data-undo]');
        // Covers the image content box; holds the progress effect and the unsaved suggestion.
        const layer = document.createElement('div');
        layer.className = 'wa-image-area-layer';
        layer.setAttribute('aria-hidden', 'true');
        preview.append(layer);
        const read = () => Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.value]));
        const original = read();
        let previous = null;
        let worker = null;
        let timer;
        let generation = 0;
        let edited = false;
        let submitted = false;

        function message(key, note) {
            const text = root.dataset[key] || '';
            status.dataset.message = key;
            if (note) status.dataset.note = note;
            else delete status.dataset.note;
            status.replaceChildren(...note
                ? [Object.assign(document.createElement('strong'), { textContent: text }), ' ', root.dataset[note] || '']
                : [text]);
        }

        function stop() {
            generation++;
            clearTimeout(timer);
            worker?.terminate();
            worker = null;
            suggest.disabled = false;
            root.removeAttribute('aria-busy');
            if (preview.dataset.waState === 'busy') delete preview.dataset.waState;
        }

        function showSuggestion(area, subjects) {
            const frame = box('wa-image-area-suggestion', area);
            const badge = document.createElement('span');
            badge.className = 'wa-image-area-badge';
            badge.textContent = root.dataset.badge || '';
            frame.append(badge);
            layer.replaceChildren(frame, ...subjects.map(subject => box('wa-image-area-subject', subject)));
            preview.dataset.waState = 'suggested';
        }

        function clearSuggestion() {
            if (preview.dataset.waState === 'suggested') delete preview.dataset.waState;
            layer.replaceChildren();
        }

        function contentBox() {
            // Contao's wizard measures the selection inside the image's border and padding.
            const style = getComputedStyle(image);
            const imageRect = image.getBoundingClientRect();
            const previewRect = preview.getBoundingClientRect();
            const left = parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
            const top = parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop);
            return {
                left: imageRect.left - previewRect.left - preview.clientLeft + left,
                top: imageRect.top - previewRect.top - preview.clientTop + top,
                width: imageRect.width - left - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight),
                height: imageRect.height - top - parseFloat(style.borderBottomWidth) - parseFloat(style.paddingBottom),
            };
        }

        function renderSelection() {
            const content = contentBox();
            Object.assign(layer.style, {
                left: `${content.left}px`,
                top: `${content.top}px`,
                width: `${content.width}px`,
                height: `${content.height}px`,
            });
            const overlay = preview.querySelector('.tl_edit_preview_important_part');
            if (!overlay) return;
            Object.assign(overlay.style, {
                left: `${content.left + Number(fields.x.value) * content.width}px`,
                top: `${content.top + Number(fields.y.value) * content.height}px`,
                width: `${Number(fields.width.value) * content.width}px`,
                height: `${Number(fields.height.value) * content.height}px`,
                display: selected(read()) ? '' : 'none',
            });
        }

        function write(values) {
            for (const [key, field] of Object.entries(fields)) field.value = String(values[key]);
            for (const field of Object.values(fields)) {
                field.dispatchEvent(new Event('input', { bubbles: true }));
                field.dispatchEvent(new Event('change', { bubbles: true }));
            }
            renderSelection();
        }

        const markEdited = event => {
            if (!event.isTrusted) return;
            edited = true;
            stop();
            clearSuggestion();
            message('edited');
        };
        preview.addEventListener('pointerdown', markEdited);
        for (const field of Object.values(fields)) field.addEventListener('input', markEdited);
        form.addEventListener('submit', () => { submitted = true; stop(); });
        form.addEventListener('reset', () => { edited = true; stop(); clearSuggestion(); setTimeout(renderSelection, 0); });
        window.addEventListener('pagehide', stop, { once: true });
        if (typeof ResizeObserver !== 'undefined') new ResizeObserver(renderSelection).observe(image);
        renderSelection();

        async function run() {
            stop();
            clearSuggestion();
            if (submitted) return;
            const currentGeneration = generation;
            const snapshot = read();
            edited = false;
            suggest.disabled = true;
            root.setAttribute('aria-busy', 'true');
            preview.dataset.waState = 'busy';
            message('loading');
            try {
                timer = setTimeout(() => { stop(); message('error'); }, 60000);
                await image.decode();
                if (currentGeneration !== generation || edited || submitted || !root.isConnected) return;
                const scale = Math.min(1, 768 / Math.max(image.naturalWidth, image.naturalHeight));
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
                canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
                const context = canvas.getContext('2d', { willReadFrequently: true });
                // Composite transparent pixels against white before analysing logos/graphics.
                context.fillStyle = '#ffffff';
                context.fillRect(0, 0, canvas.width, canvas.height);
                context.drawImage(image, 0, 0, canvas.width, canvas.height);
                const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
                worker = new Worker(root.dataset.workerUrl);
                const activeWorker = worker;
                worker.onerror = () => {
                    if (currentGeneration !== generation || worker !== activeWorker) return;
                    stop();
                    message('error');
                };
                worker.onmessage = ({ data }) => {
                    if (currentGeneration !== generation || worker !== activeWorker) return;
                    const unchanged = Object.entries(snapshot).every(([key, value]) => fields[key].value === value);
                    if (edited || submitted || !root.isConnected || !unchanged) {
                        stop();
                        message('edited');
                        return;
                    }
                    stop();
                    const area = data.area;
                    if (data.error || !validArea(area)) {
                        message('error');
                        return;
                    }
                    // Re-detecting an area that is already selected keeps the existing undo target.
                    if (!sameArea(area, snapshot)) {
                        previous = snapshot;
                        write(area);
                        undo.textContent = root.dataset[selected(previous) ? 'restore' : 'discard'] || '';
                        undo.hidden = false;
                    }
                    showSuggestion(area, Array.isArray(data.subjects) ? data.subjects.filter(validArea) : []);
                    message(data.degraded && data.method === 'saliency' ? 'fallback' : data.method,
                        sameArea(area, original) ? 'unchanged' : 'pending');
                };
                worker.postMessage({ width: pixels.width, height: pixels.height, buffer: pixels.data.buffer }, [pixels.data.buffer]);
            } catch (error) {
                if (currentGeneration === generation) { stop(); message('error'); }
                console.warn('Smart image area: suggestion failed', error);
            }
        }

        suggest.addEventListener('click', run);
        undo.addEventListener('click', () => {
            stop();
            clearSuggestion();
            edited = true;
            const values = previous || original;
            write(values);
            previous = null;
            undo.hidden = true;
            message(selected(values) ? 'restored' : 'discarded');
        });
        if (selected(original)) message('preserved');
        else run();
    }

    function initializeAll() {
        document.querySelectorAll('[data-wa-image-area]').forEach(initialize);
    }

    // Run after Contao's domready preview initialization, including dynamically added forms.
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(initializeAll, 0));
    else setTimeout(initializeAll, 0);
    new MutationObserver(initializeAll).observe(document.documentElement, { childList: true, subtree: true });
})();
