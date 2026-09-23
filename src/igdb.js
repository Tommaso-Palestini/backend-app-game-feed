const BASE_URL = 'https://api.igdb.com/v4';
const URL_TOKEN = 'https://id.twitch.tv/oauth2/token';
const DURATA_CACHE_MS = 10 * 60 * 1000;
const MASSIMO_ELEMENTI_CACHE = 500;
const INTERVALLO_MINIMO_MS = 260;

const cache = new Map();

let token = null;
let promessaToken = null;
let prossimoTurno = 0;

export class ErroreIgdb extends Error {
  constructor(stato, messaggio) {
    super(messaggio);
    this.stato = stato;
  }
}

function aspetta(ms) {
  return new Promise(risolvi => setTimeout(risolvi, ms));
}

async function attendiTurno() {
  const ora = Date.now();
  const attesa = Math.max(0, prossimoTurno - ora);
  prossimoTurno = Math.max(ora, prossimoTurno) + INTERVALLO_MINIMO_MS;
  if (attesa > 0) {
    await aspetta(attesa);
  }
}

async function richiediToken() {
  const url = new URL(URL_TOKEN);
  url.searchParams.set('client_id', process.env.TWITCH_CLIENT_ID);
  url.searchParams.set('client_secret', process.env.TWITCH_CLIENT_SECRET);
  url.searchParams.set('grant_type', 'client_credentials');

  const risposta = await fetch(url, { method: 'POST' });
  if (!risposta.ok) {
    throw new ErroreIgdb(risposta.status, 'Autenticazione Twitch fallita: controlla Client ID e Secret');
  }

  const dati = await risposta.json();
  return {
    valore: dati.access_token,
    scadenza: Date.now() + (dati.expires_in - 60) * 1000,
  };
}

async function getToken() {
  if (token && token.scadenza > Date.now()) {
    return token.valore;
  }
  if (!promessaToken) {
    promessaToken = richiediToken()
      .then(nuovo => {
        token = nuovo;
        return nuovo;
      })
      .finally(() => {
        promessaToken = null;
      });
  }
  const nuovo = await promessaToken;
  return nuovo.valore;
}

async function eseguiRichiesta(endpoint, query, puoRiprovare) {
  const valoreToken = await getToken();
  await attendiTurno();

  const risposta = await fetch(`${BASE_URL}/${endpoint}`, {
    method: 'POST',
    headers: {
      'Client-ID': process.env.TWITCH_CLIENT_ID,
      Authorization: `Bearer ${valoreToken}`,
      Accept: 'application/json',
    },
    body: query,
  });

  if (risposta.status === 401 && puoRiprovare) {
    token = null;
    return eseguiRichiesta(endpoint, query, false);
  }

  if (risposta.status === 429 && puoRiprovare) {
    await aspetta(1000);
    return eseguiRichiesta(endpoint, query, false);
  }

  if (!risposta.ok) {
    throw new ErroreIgdb(risposta.status, `IGDB ha risposto ${risposta.status} su /${endpoint}`);
  }

  return risposta.json();
}

export async function chiamaIgdb(endpoint, query) {
  const chiaveCache = `${endpoint}|${query}`;
  const inCache = cache.get(chiaveCache);
  if (inCache && inCache.scadenza > Date.now()) {
    return inCache.dati;
  }

  const dati = await eseguiRichiesta(endpoint, query, true);

  if (cache.size >= MASSIMO_ELEMENTI_CACHE) {
    const piuVecchia = cache.keys().next().value;
    cache.delete(piuVecchia);
  }
  cache.set(chiaveCache, { dati, scadenza: Date.now() + DURATA_CACHE_MS });

  return dati;
}