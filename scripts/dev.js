// Modo desarrollo: servidor de Vite + Electron apuntando a él.
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import electron from 'electron';

const server = await createServer({ configFile: 'vite.config.js' });
await server.listen();
const url = `http://localhost:${server.config.server.port}`;
const child = spawn(electron, ['.', ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, ARACNE_DEV_URL: url } });
child.on('close', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
