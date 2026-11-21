/*
 * vite-partials.js
 *
 * Tiny Vite plugin: replaces <!-- @partial name --> in any HTML page with
 * the contents of partials/name.html (recursively), in both `vite` dev
 * and `vite build`. Used so the header/menu/nav, footer and background
 * video live in one file instead of being copy-pasted into every page.
 * Partials' own leading <!-- comments --> are kept; they're harmless.
 */

import fs from 'node:fs';
import path from 'node:path';

const MARKER = /<!--\s*@partial\s+([\w-]+)\s*-->/g;

export function renderPartials(html, dir, seen = []) {
    return html.replace(MARKER, (_match, name) => {
        if (seen.includes(name)) {
            throw new Error(`[partials] Include circular: ${[...seen, name].join(' -> ')}`);
        }

        const file = path.join(dir, `${name}.html`);

        if (!fs.existsSync(file)) {
            throw new Error(`[partials] No existe ${file}`);
        }

        return renderPartials(fs.readFileSync(file, 'utf8'), dir, [...seen, name]);
    });
}

export default function partials({ dir }) {
    return {
        name: 'inercia-partials',
        transformIndexHtml: {
            order: 'pre',
            handler: (html) => renderPartials(html, dir)
        },
        handleHotUpdate({ file, server }) {
            if (path.resolve(file).startsWith(path.resolve(dir))) {
                server.ws.send({ type: 'full-reload' });
                return [];
            }
        }
    };
}
