import { Router } from 'express';
import { chiamaIgdb } from './igdb.js';
import {
  CAMPI_GIOCO,
  FILTRO_BASE,
  caricaCatalogo,
  condizioneGeneri,
  condizioneModalita,
  condizionePiattaforme,
  convertiGioco,
  giocoValido,
  unisciCondizioni,
} from './mappature.js';

const router = Router();

const GIOCHI_PER_PAGINA_FEED = 50;
const MASSIMO_PAGINE_PER_RICHIESTA = 5;
const GIOCHI_PER_PAGINA_RICERCA = 30;
const GIOCHI_CASUALI = 20;
const MASSIMO_GIOCHI_CASUALI = 3000;
const MINIMO_VALUTAZIONI_CASUALI = 5;

function leggiLista(valore) {
  return typeof valore === 'string' && valore !== '' ? valore.split(',') : [];
}

function leggiAnno(valore) {
  const anno = Number(valore);
  return Number.isInteger(anno) && anno >= 1950 && anno <= 2100 ? anno : null;
}

function leggiPagina(valore) {
  const pagina = Number(valore);
  return Number.isInteger(pagina) && pagina > 0 ? pagina : 1;
}

function leggiTesto(valore) {
  return typeof valore === 'string' ? valore.replace(/["\\]/g, '').trim() : '';
}

function leggiPreferenze(query) {
  return {
    generi: leggiLista(query.generi),
    piattaforme: leggiLista(query.piattaforme),
    modalita: leggiLista(query.modalita),
  };
}

function leggiCursore(valore, livelloIniziale) {
  if (typeof valore === 'string') {
    const [livello, offset] = valore.split(':').map(Number);
    if ((livello === 1 || livello === 2) && Number.isInteger(offset) && offset >= 0) {
      return { livello, offset };
    }
  }
  return { livello: livelloIniziale, offset: 0 };
}

function inizioAnno(anno) {
  return Date.UTC(anno, 0, 1) / 1000;
}

function quotaInComune(valori, scelti) {
  if (scelti.length === 0) {
    return 1;
  }
  return valori.filter(v => scelti.includes(v)).length / scelti.length;
}

function calcolaCompatibilita(gioco, { generi, piattaforme, modalita }) {
  const piattaformaOk =
    piattaforme.length === 0 || gioco.piattaforme.some(p => piattaforme.includes(p));

  const punteggio =
    quotaInComune(gioco.generi, generi) * 0.6 +
    (piattaformaOk ? 1 : 0) * 0.25 +
    quotaInComune(gioco.modalita, modalita) * 0.15;

  return Math.round(punteggio * 100);
}

function mescola(lista) {
  const copia = [...lista];
  for (let i = copia.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

function convertiLista(risultati, catalogo) {
  return risultati
    .filter(gioco => giocoValido(gioco, catalogo))
    .map(gioco => convertiGioco(gioco, catalogo));
}

function senzaDoppioni(liste) {
  const perId = new Map();
  for (const lista of liste) {
    for (const gioco of lista) {
      if (!perId.has(gioco.id)) {
        perId.set(gioco.id, gioco);
      }
    }
  }
  return [...perId.values()];
}

router.get('/feed', async (req, res) => {
  const preferenze = leggiPreferenze(req.query);
  const catalogo = await caricaCatalogo();

  const condizioniBase = unisciCondizioni([
    FILTRO_BASE,
    condizioneGeneri(preferenze.generi, catalogo),
    condizionePiattaforme(preferenze.piattaforme, catalogo),
  ]);
  const condizioneModi = condizioneModalita(preferenze.modalita, catalogo);
  const idModalitaScelte = preferenze.modalita.flatMap(m => catalogo.modalita.get(m) ?? []);

  let { livello, offset } = leggiCursore(req.query.cursore, condizioneModi ? 1 : 2);
  const giochi = [];
  let finito = false;

  for (
    let richiesta = 0;
    richiesta < MASSIMO_PAGINE_PER_RICHIESTA && giochi.length === 0;
    richiesta += 1
  ) {
    const condizioni =
      livello === 1 ? unisciCondizioni([condizioniBase, condizioneModi]) : condizioniBase;

    const risultati = await chiamaIgdb(
      'games',
      `fields ${CAMPI_GIOCO}; where ${condizioni}; sort total_rating_count desc; limit ${GIOCHI_PER_PAGINA_FEED}; offset ${offset};`,
    );

    const nuovi = risultati.filter(gioco => {
      if (livello === 1) {
        return true;
      }
      return !(gioco.game_modes ?? []).some(id => idModalitaScelte.includes(id));
    });

    giochi.push(...convertiLista(nuovi, catalogo));

    if (risultati.length === GIOCHI_PER_PAGINA_FEED) {
      offset += GIOCHI_PER_PAGINA_FEED;
    } else if (livello === 1) {
      livello = 2;
      offset = 0;
    } else {
      finito = true;
      break;
    }
  }

  const ordinati = giochi
    .map(gioco => ({ ...gioco, compatibilita: calcolaCompatibilita(gioco, preferenze) }))
    .sort((a, b) => b.compatibilita - a.compatibilita || b.voto - a.voto);

  res.json({
    giochi: ordinati,
    cursore: finito ? null : `${livello}:${offset}`,
  });
});

router.get('/random', async (req, res) => {
  const preferenze = leggiPreferenze(req.query);
  const catalogo = await caricaCatalogo();

  const condizioni = unisciCondizioni([
    FILTRO_BASE,
    `total_rating_count > ${MINIMO_VALUTAZIONI_CASUALI}`,
    condizionePiattaforme(preferenze.piattaforme, catalogo),
  ]);

  const { count } = await chiamaIgdb('games/count', `where ${condizioni};`);
  const massimoOffset = Math.max(0, Math.min(count, MASSIMO_GIOCHI_CASUALI) - GIOCHI_CASUALI);
  const offset = Math.floor(Math.random() * (massimoOffset + 1));

  const risultati = await chiamaIgdb(
    'games',
    `fields ${CAMPI_GIOCO}; where ${condizioni}; sort total_rating_count desc; limit ${GIOCHI_CASUALI}; offset ${offset};`,
  );

  res.json({ giochi: mescola(convertiLista(risultati, catalogo)) });
});

router.get('/search', async (req, res) => {
  const testo = leggiTesto(req.query.q);
  const preferenze = leggiPreferenze(req.query);
  const annoDa = leggiAnno(req.query.annoDa);
  const annoA = leggiAnno(req.query.annoA);
  const pagina = leggiPagina(req.query.pagina);
  const catalogo = await caricaCatalogo();

  const condizioni = unisciCondizioni([
    FILTRO_BASE,
    condizioneGeneri(preferenze.generi, catalogo),
    condizionePiattaforme(preferenze.piattaforme, catalogo),
    condizioneModalita(preferenze.modalita, catalogo),
    annoDa !== null ? `first_release_date >= ${inizioAnno(annoDa)}` : null,
    annoA !== null ? `first_release_date < ${inizioAnno(annoA + 1)}` : null,
  ]);

  const offset = (pagina - 1) * GIOCHI_PER_PAGINA_RICERCA;
  const limite = `limit ${GIOCHI_PER_PAGINA_RICERCA}; offset ${offset};`;

  if (testo === '') {
    const risultati = await chiamaIgdb(
      'games',
      `fields ${CAMPI_GIOCO}; where ${condizioni}; sort total_rating_count desc; ${limite}`,
    );
    res.json({
      giochi: convertiLista(risultati, catalogo),
      altrePagine: risultati.length === GIOCHI_PER_PAGINA_RICERCA,
    });
    return;
  }

  const condizioniPerNome = unisciCondizioni([condizioni, `name ~ *"${testo}"*`]);

  const [perNome, perPertinenza] = await Promise.all([
    chiamaIgdb(
      'games',
      `fields ${CAMPI_GIOCO}; where ${condizioniPerNome}; sort total_rating_count desc; ${limite}`,
    ),
    chiamaIgdb('games', `search "${testo}"; fields ${CAMPI_GIOCO}; where ${condizioni}; ${limite}`),
  ]);

  res.json({
    giochi: convertiLista(senzaDoppioni([perNome, perPertinenza]), catalogo),
    altrePagine:
      perNome.length === GIOCHI_PER_PAGINA_RICERCA ||
      perPertinenza.length === GIOCHI_PER_PAGINA_RICERCA,
  });
});

router.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ errore: 'Id non valido' });
    return;
  }

  const [catalogo, risultati] = await Promise.all([
    caricaCatalogo(),
    chiamaIgdb(
      'games',
      `fields ${CAMPI_GIOCO},summary,storyline,aggregated_rating,url,involved_companies.company.name,involved_companies.developer; where id = ${id};`,
    ),
  ]);

  if (risultati.length === 0) {
    res.status(404).json({ errore: 'Gioco non trovato' });
    return;
  }

  const gioco = risultati[0];

  res.json({
    ...convertiGioco(gioco, catalogo),
    descrizione: gioco.summary ?? gioco.storyline ?? '',
    sviluppatori: (gioco.involved_companies ?? [])
      .filter(coinvolta => coinvolta.developer)
      .map(coinvolta => coinvolta.company.name),
    votoCritica: gioco.aggregated_rating ? Math.round(gioco.aggregated_rating) : null,
    paginaIgdb: gioco.url ?? null,
  });
});

export default router;