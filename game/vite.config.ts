import { sites } from '@openai/sites-vite-plugin';
import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import hostingConfig from './.openai/hosting.json';

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  '00000000-0000-4000-8000-000000000000';

const { d1, r2 } = hostingConfig;
const CHARACTER_MODELS_ID = 'virtual:character-models';
const RESOLVED_CHARACTER_MODELS_ID = `\0${CHARACTER_MODELS_ID}`;
const modelsDirectory = fileURLToPath(new URL('./public/models', import.meta.url));
const characterNames: Record<number, string> = {
  1: '棍子爹',
  2: '哈基米',
  3: '曼波',
  4: '龙哥',
};

function readCharacterModels() {
  return readdirSync(modelsDirectory)
    .map((fileName) => ({ fileName, match: /^character(\d+)\.(?:glb|fbx)$/i.exec(fileName) }))
    .filter((entry): entry is { fileName: string; match: RegExpExecArray } => Boolean(entry.match))
    .sort((left, right) => Number(left.match[1]) - Number(right.match[1]))
    .map(({ fileName, match }) => {
      const id = Number(match[1]);
      return { id, name: characterNames[id] ?? `Character${id}`, url: `/models/${fileName}` };
    });
}

const characterModelsPlugin = {
  name: 'otto-character-models',
  resolveId(id: string) {
    return id === CHARACTER_MODELS_ID ? RESOLVED_CHARACTER_MODELS_ID : undefined;
  },
  load(id: string) {
    return id === RESOLVED_CHARACTER_MODELS_ID
      ? `export default ${JSON.stringify(readCharacterModels())}`
      : undefined;
  },
  configureServer(server: { watcher: { add: (path: string) => void; on: (event: string, callback: (path: string) => void) => void }; moduleGraph: { getModuleById: (id: string) => unknown; invalidateModule: (module: never) => void }; ws: { send: (message: { type: string }) => void } }) {
    server.watcher.add(modelsDirectory);
    const refreshModels = (filePath: string) => {
      if (!/^character\d+\.(?:glb|fbx)$/i.test(filePath.split('/').pop() ?? '')) return;
      const module = server.moduleGraph.getModuleById(RESOLVED_CHARACTER_MODELS_ID);
      if (module) server.moduleGraph.invalidateModule(module as never);
      server.ws.send({ type: 'full-reload' });
    };
    server.watcher.on('add', refreshModels);
    server.watcher.on('unlink', refreshModels);
  },
};

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';

const localBindingConfig = {
  main: 'vinext/server/fetch-handler',
  compatibility_flags: ['nodejs_compat'],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: 'site-creator-d1',
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: 'site-creator-r2',
        },
      ]
    : [],
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= 'false';
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import('@cloudflare/vite-plugin');

  return {
    css: { postcss: { plugins: [tailwindcss()] } },
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      characterModelsPlugin,
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
        config: localBindingConfig,
      }),
    ],
  };
});
