import { Router } from 'express';
import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { caricaDb, salvaDb } from './archivio.js';

const scrypt = promisify(scryptCallback);

const LUNGHEZZA_CHIAVE = 64;
const LUNGHEZZA_MINIMA_PASSWORD = 8;
const LUNGHEZZA_MASSIMA_PASSWORD = 200;
const LUNGHEZZA_MASSIMA_NOME = 50;
const MASSIMO_ELEMENTI_LISTA = 50;
const MASSIMO_WISHLIST = 500;
const DURATA_SESSIONE_MS = 30 * 24 * 60 * 60 * 1000;

const router = Router();

function leggiTesto(valore) {
  return typeof valore === 'string' ? valore.trim() : '';
}

function normalizzaEmail(valore) {
  return leggiTesto(valore).toLowerCase();
}

function emailValida(email) {
  return email.length <= 200 && /^\S+@\S+\.\S+$/.test(email);
}

function listaDiStringhe(valore) {
  return Array.isArray(valore)
    ? valore.filter(v => typeof v === 'string').slice(0, MASSIMO_ELEMENTI_LISTA)
    : [];
}

function leggiPreferenze(valore) {
  const oggetto = valore && typeof valore === 'object' ? valore : {};
  return {
    generi: listaDiStringhe(oggetto.generi),
    piattaforme: listaDiStringhe(oggetto.piattaforme),
    modalita: listaDiStringhe(oggetto.modalita),
  };
}

function leggiGioco(valore) {
  if (!valore || typeof valore !== 'object') {
    return null;
  }
  if (!Number.isInteger(valore.id) || typeof valore.nome !== 'string') {
    return null;
  }
  return {
    id: valore.id,
    nome: valore.nome.slice(0, 200),
    immagine: typeof valore.immagine === 'string' ? valore.immagine : null,
    immagineGrande: typeof valore.immagineGrande === 'string' ? valore.immagineGrande : null,
    generi: listaDiStringhe(valore.generi),
    piattaforme: listaDiStringhe(valore.piattaforme),
    modalita: listaDiStringhe(valore.modalita),
    voto: typeof valore.voto === 'number' ? valore.voto : 0,
    uscita: Number.isInteger(valore.uscita) ? valore.uscita : null,
  };
}

function leggiWishlist(valore) {
  if (!Array.isArray(valore)) {
    return [];
  }
  const idVisti = new Set();
  const wishlist = [];
  for (const elemento of valore) {
    const gioco = leggiGioco(elemento);
    if (gioco && !idVisti.has(gioco.id)) {
      idVisti.add(gioco.id);
      wishlist.push(gioco);
    }
    if (wishlist.length >= MASSIMO_WISHLIST) {
      break;
    }
  }
  return wishlist;
}

async function calcolaHash(password, salt) {
  const chiave = await scrypt(password, salt, LUNGHEZZA_CHIAVE);
  return chiave.toString('hex');
}

async function passwordCorretta(password, utente) {
  const calcolata = await scrypt(password, utente.salt, LUNGHEZZA_CHIAVE);
  const salvata = Buffer.from(utente.passwordHash, 'hex');
  return salvata.length === calcolata.length && timingSafeEqual(salvata, calcolata);
}

function rispostaAccount(utente) {
  return {
    utente: { id: utente.id, nome: utente.nome, email: utente.email },
    dati: { preferenze: utente.preferenze, wishlist: utente.wishlist },
  };
}

function creaSessione(db, idUtente) {
  const ora = Date.now();
  for (const [token, sessione] of Object.entries(db.sessioni)) {
    if (sessione.scadenza < ora) {
      delete db.sessioni[token];
    }
  }
  const token = randomBytes(32).toString('hex');
  db.sessioni[token] = { idUtente, scadenza: ora + DURATA_SESSIONE_MS };
  return token;
}

async function richiediUtente(req, res, next) {
  const intestazione = req.get('Authorization') ?? '';
  const token = intestazione.startsWith('Bearer ') ? intestazione.slice(7) : '';
  const db = await caricaDb();

  const sessione = Object.hasOwn(db.sessioni, token) ? db.sessioni[token] : null;
  const utente = sessione && sessione.scadenza > Date.now()
    ? db.utenti.find(u => u.id === sessione.idUtente)
    : null;

  if (!utente) {
    res.status(401).json({ errore: 'Sessione scaduta, accedi di nuovo' });
    return;
  }

  req.utente = utente;
  req.token = token;
  next();
}

router.post('/registrati', async (req, res) => {
  const corpo = req.body ?? {};
  const nome = leggiTesto(corpo.nome);
  const email = normalizzaEmail(corpo.email);
  const password = typeof corpo.password === 'string' ? corpo.password : '';

  if (nome === '' || nome.length > LUNGHEZZA_MASSIMA_NOME) {
    res.status(400).json({ errore: `Inserisci un nome di massimo ${LUNGHEZZA_MASSIMA_NOME} caratteri` });
    return;
  }
  if (!emailValida(email)) {
    res.status(400).json({ errore: "Inserisci un'email valida" });
    return;
  }
  if (password.length < LUNGHEZZA_MINIMA_PASSWORD || password.length > LUNGHEZZA_MASSIMA_PASSWORD) {
    res.status(400).json({
      errore: `La password deve avere almeno ${LUNGHEZZA_MINIMA_PASSWORD} caratteri`,
    });
    return;
  }

  const salt = randomBytes(16).toString('hex');
  const passwordHash = await calcolaHash(password, salt);
  const db = await caricaDb();

  if (db.utenti.some(u => u.email === email)) {
    res.status(409).json({ errore: 'Esiste già un account con questa email' });
    return;
  }

  const utente = {
    id: randomUUID(),
    nome,
    email,
    salt,
    passwordHash,
    creatoIl: new Date().toISOString(),
    preferenze: leggiPreferenze(corpo.preferenze),
    wishlist: leggiWishlist(corpo.wishlist),
  };

  db.utenti.push(utente);
  const token = creaSessione(db, utente.id);
  await salvaDb();

  res.status(201).json({ token, ...rispostaAccount(utente) });
});

router.post('/accedi', async (req, res) => {
  const corpo = req.body ?? {};
  const email = normalizzaEmail(corpo.email);
  const password = typeof corpo.password === 'string' ? corpo.password : '';

  const db = await caricaDb();
  const utente = db.utenti.find(u => u.email === email);

  if (!utente || !(await passwordCorretta(password, utente))) {
    res.status(401).json({ errore: 'Email o password errate' });
    return;
  }

  const token = creaSessione(db, utente.id);
  await salvaDb();

  res.json({ token, ...rispostaAccount(utente) });
});

router.post('/esci', richiediUtente, async (req, res) => {
  const db = await caricaDb();
  delete db.sessioni[req.token];
  await salvaDb();
  res.status(204).end();
});

router.get('/', richiediUtente, (req, res) => {
  res.json(rispostaAccount(req.utente));
});

router.put('/preferenze', richiediUtente, async (req, res) => {
  req.utente.preferenze = leggiPreferenze(req.body);
  await salvaDb();
  res.status(204).end();
});

router.put('/wishlist', richiediUtente, async (req, res) => {
  req.utente.wishlist = leggiWishlist(req.body?.wishlist);
  await salvaDb();
  res.status(204).end();
});

export default router;