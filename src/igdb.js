const BASE_URL = 'https://api.igdb.com/v4';
const URL_TOKEN = 'https://id.twitch.tv/oauth2/token';
const DURATA_CACHE_MS = 10 * 60 * 1000;
const MASSIMO_ELEMENTI_CACHE = 500;
const INTERVALLO_MINIMO_MS = 260;

const cache = new Map();
const inCorso = new Map();

const statistiche = {
  richieste: 0,
  daCache: 0,
  condivise: 0,
  chiamateIgdb: 0,
  errori: 0,
  tempoTotaleIgdbMs: 0,
};

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

function leggiCache(chiave) {
  const voce = cache.get(chiave);
  if (!voce) {
    return undefined;
  }
  if (voce.scadenza <= Date.now()) {
    cache.delete(chiave);
    return undefined;
  }
  cache.delete(chiave);
  cache.set(chiave, voce);
  return voce.dati;
}

function scriviCache(chiave, dati) {
  if (cache.has(chiave)) {
    cache.delete(chiave);
  } else if (cache.size >= MASSIMO_ELEMENTI_CACHE) {
    const menoUsata = cache.keys().next().value;
    cache.delete(menoUsata);
  }
  cache.set(chiave, { dati, scadenza: Date.now() + DURATA_CACHE_MS });
}

export async function chiamaIgdb(endpoint, query) {
  statistiche.richieste += 1;
  const chiave = `${endpoint}|${query}`;

  const inCache = leggiCache(chiave);
  if (inCache !== undefined) {
    statistiche.daCache += 1;
    return inCache;
  }

  const giaInCorso = inCorso.get(chiave);
  if (giaInCorso) {
    statistiche.condivise += 1;
    return giaInCorso;
  }

  const promessa = (async () => {
    const inizio = performance.now();
    statistiche.chiamateIgdb += 1;
    try {
      const dati = await eseguiRichiesta(endpoint, query, true);
      scriviCache(chiave, dati);
      return dati;
    } catch (errore) {
      statistiche.errori += 1;
      throw errore;
    } finally {
      statistiche.tempoTotaleIgdbMs += performance.now() - inizio;
      inCorso.delete(chiave);
    }
  })();

  inCorso.set(chiave, promessa);
  return promessa;
}

export function getStatistiche() {
  const { richieste, daCache, condivise, chiamateIgdb, errori, tempoTotaleIgdbMs } = statistiche;
  return {
    richieste,
    daCache,
    condivise,
    chiamateIgdb,
    errori,
    percentualeRisparmiata: richieste > 0 ? Math.round(((daCache + condivise) / richieste) * 100) : 0,
    tempoMedioIgdbMs: chiamateIgdb > 0 ? Math.round(tempoTotaleIgdbMs / chiamateIgdb) : 0,
    elementiInCache: cache.size,
  };
}