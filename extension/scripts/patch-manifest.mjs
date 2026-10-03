import { readFile, writeFile } from 'node:fs/promises';

const manifestPath = new URL('../dist/manifest.json', import.meta.url);
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

if (Array.isArray(manifest.web_accessible_resources)) {
  manifest.web_accessible_resources = manifest.web_accessible_resources.map((resource) => ({
    ...resource,
    use_dynamic_url: false,
  }));
}

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
