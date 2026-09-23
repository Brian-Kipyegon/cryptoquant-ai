// First-run setup: checks the Node.js version and creates .env from .env.example.
// Cross-platform replacement for the old Windows .bat launchers.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));

const requiredMajor = Number(String(pkg.engines?.node || '').match(/\d+/)?.[0] || 0);
const currentMajor = Number(process.versions.node.split('.')[0]);
if (requiredMajor && currentMajor < requiredMajor) {
  console.warn(`[setup] Node.js ${requiredMajor}+ is required (found ${process.versions.node}).`);
  process.exitCode = 1;
} else {
  console.log(`[setup] Node.js ${process.versions.node} OK.`);
}

const envPath = path.join(root, '.env');
const examplePath = path.join(root, '.env.example');
if (fs.existsSync(envPath)) {
  console.log('[setup] .env already exists; leaving it unchanged.');
} else if (fs.existsSync(examplePath)) {
  fs.copyFileSync(examplePath, envPath);
  console.log('[setup] Created .env from .env.example. Edit it and replace every YOUR_..._HERE value before starting.');
} else {
  console.warn('[setup] .env.example not found; create .env manually.');
}

console.log('[setup] Next: "npm run dev" for development, or "npm start" to build and run in production mode.');
