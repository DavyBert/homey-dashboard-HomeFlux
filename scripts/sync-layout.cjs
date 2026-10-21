'use strict';
// Homey may embed settings HTML without loading relative external scripts.
// Keep both HTML entry points self-contained, using the same canonical factory.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'widgets/dashboard/public/layout.js'), 'utf8');
const factory = source.match(/\}\)\(globalThis, (function \(\) \{[\s\S]*\})\);\s*$/)?.[1];
if (!factory) throw new Error('Cannot find the shared layout factory');
const block = '// BEGIN SHARED LAYOUT (scripts/sync-layout.cjs)\n const layout=(' + factory + ')();\n // END SHARED LAYOUT';
for (const relative of ['settings/index.html', 'widgets/dashboard/public/index.html']) {
  const file = path.join(root, relative);
  const html = fs.readFileSync(file, 'utf8');
  const marker = /\/\/ BEGIN SHARED LAYOUT \(scripts\/sync-layout\.cjs\)[\s\S]*?\/\/ END SHARED LAYOUT/;
  const target = marker.test(html) ? marker : /const layout=HomeFluxLayout;/;
  if (!target.test(html)) throw new Error('Cannot find the layout block in ' + relative);
  const updated = html.replace(target, () => block)
    .replace(/^<script src="[^"\n]*layout\.js"><\/script>\r?\n/m, '');
  fs.writeFileSync(file, updated);
}
