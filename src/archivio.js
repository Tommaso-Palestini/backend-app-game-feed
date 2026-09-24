import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const CARTELLA = path.join(import.meta.dirname, '..', 'data');
const FILE = path.join(CARTELLA, 'db.json');

let promessaDb = null;
let codaScritture = Promise.resolve();

async function leggiDaDisco() {
  try {
    const db = JSON.parse(await readFile(FILE, 'utf8'));
    return { utenti: db.utenti ?? [], sessioni: db.sessioni ?? {} };
  } catch (errore) {
    if (errore.code === 'ENOENT') {
      return { utenti: [], sessioni: {} };
    }
    throw errore;
  }
}

export function caricaDb() {
  if (!promessaDb) {
    promessaDb = leggiDaDisco().catch(errore => {
      promessaDb = null;
      throw errore;
    });
  }
  return promessaDb;
}

export function salvaDb() {
  const scrittura = codaScritture.then(async () => {
    const db = await caricaDb();
    await mkdir(CARTELLA, { recursive: true });
    const temporaneo = `${FILE}.tmp`;
    await writeFile(temporaneo, JSON.stringify(db, null, 2));
    await rename(temporaneo, FILE);
  });
  codaScritture = scrittura.catch(() => {});
  return scrittura;
}