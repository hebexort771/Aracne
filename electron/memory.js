// Telaraña de memoria: lo que has leído se guarda solo en tu computadora.
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

let file;
let entries = [];
const MAX = 600;

export function loadMemory() {
  file = path.join(app.getPath('userData'), 'memoria.json');
  try {
    entries = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(entries)) entries = [];
  } catch {
    entries = [];
  }
}

function save() {
  try {
    fs.writeFileSync(file, JSON.stringify(entries));
  } catch (err) {
    console.error('No se pudo guardar la memoria', err);
  }
}

export function listMemory() {
  return entries;
}

/** entry: {id, title, source, kind, keywords:[[t,w,display]], highlights:[string], words, lang} */
export function addMemory(entry) {
  const now = new Date().toISOString();
  const i = entries.findIndex((e) => e.id === entry.id);
  if (i >= 0) {
    entries[i] = { ...entries[i], ...entry, lastRead: now, reads: (entries[i].reads || 1) + 1 };
  } else {
    entries.unshift({ ...entry, firstRead: now, lastRead: now, reads: 1 });
  }
  entries.sort((a, b) => (b.lastRead || '').localeCompare(a.lastRead || ''));
  if (entries.length > MAX) entries.length = MAX;
  save();
  return entries;
}

export function removeMemory(id) {
  entries = entries.filter((e) => e.id !== id);
  save();
  return entries;
}

export function clearMemory() {
  entries = [];
  save();
}
