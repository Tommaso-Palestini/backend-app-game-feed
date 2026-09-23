import { chiamaIgdb } from './igdb.js';

const GENERI = {
  Azione: { categoria: 'themes', slug: ['action'] },
  Avventura: { categoria: 'genres', slug: ['adventure'] },
  RPG: { categoria: 'genres', slug: ['role-playing-rpg'] },
  Strategia: {
    categoria: 'genres',
    slug: ['strategy', 'real-time-strategy-rts', 'turn-based-strategy-tbs', 'tactical'],
  },
  Sparatutto: { categoria: 'genres', slug: ['shooter'] },
  Platform: { categoria: 'genres', slug: ['platform'] },
  Picchiaduro: { categoria: 'genres', slug: ['fighting'] },
  Corse: { categoria: 'genres', slug: ['racing'] },
  Sport: { categoria: 'genres', slug: ['sport'] },
  Simulazione: { categoria: 'genres', slug: ['simulator'] },
  Puzzle: { categoria: 'genres', slug: ['puzzle'] },
  Casual: { categoria: 'genres', slug: ['arcade'] },
  Indie: { categoria: 'genres', slug: ['indie'] },
  Horror: { categoria: 'themes', slug: ['horror'] },
  Survival: { categoria: 'themes', slug: ['survival'] },
  'Open world': { categoria: 'themes', slug: ['open-world'] },
  Roguelike: { categoria: 'keywords', slug: ['roguelike', 'roguelite'] },
  Metroidvania: { categoria: 'keywords', slug: ['metroidvania'] },
};

const MODALITA = {
  'Single player': ['single-player'],
  Multiplayer: ['multiplayer', 'massively-multiplayer-online-mmo', 'battle-royale'],
  'Co-op': ['co-operative', 'split-screen'],
};

const PIATTAFORME = {
  PC: 'PC (Microsoft Windows)',
  'PlayStation 5': 'PlayStation 5',
  'PlayStation 4': 'PlayStation 4',
  'Xbox Series X|S': 'Xbox Series X|S',
  'Xbox One': 'Xbox One',
  'Nintendo Switch 2': 'Nintendo Switch 2',
  'Nintendo Switch': 'Nintendo Switch',
  iOS: 'iOS',
  Android: 'Android',
};

const SLUG_TEMA_ESCLUSO = 'erotic';

export const CAMPI_GIOCO =
  'name,cover.image_id,genres,themes,keywords,game_modes,platforms,first_release_date,total_rating,total_rating_count';

export const FILTRO_BASE = 'cover != null & version_parent = null & parent_game = null';

const URL_IMMAGINI = 'https://images.igdb.com/igdb/image/upload';
const FORMATO_PICCOLO = 't_cover_big';
const FORMATO_GRANDE = 't_1080p';

let promessaCatalogo = null;

async function idPerValore(endpoint, campo, valori) {
  const lista = valori.map(v => `"${v}"`).join(',');
  const risultati = await chiamaIgdb(
    endpoint,
    `fields id,${campo}; where ${campo} = (${lista}); limit 500;`,
  );
  return new Map(risultati.map(r => [r[campo].toLowerCase(), r.id]));
}

async function costruisciCatalogo() {
  const slugPerCategoria = { genres: new Set(), themes: new Set([SLUG_TEMA_ESCLUSO]), keywords: new Set() };
  for (const { categoria, slug } of Object.values(GENERI)) {
    slug.forEach(s => slugPerCategoria[categoria].add(s));
  }

  const [genres, themes, keywords, modalitaTrovate, piattaformeTrovate] = await Promise.all([
    idPerValore('genres', 'slug', [...slugPerCategoria.genres]),
    idPerValore('themes', 'slug', [...slugPerCategoria.themes]),
    idPerValore('keywords', 'slug', [...slugPerCategoria.keywords]),
    idPerValore('game_modes', 'slug', Object.values(MODALITA).flat()),
    idPerValore('platforms', 'name', Object.values(PIATTAFORME)),
  ]);

  const trovatiPerCategoria = { genres, themes, keywords };

  const generi = new Map();
  for (const [etichetta, { categoria, slug }] of Object.entries(GENERI)) {
    const ids = slug
      .map(s => trovatiPerCategoria[categoria].get(s))
      .filter(id => id !== undefined);
    if (ids.length === 0) {
      console.warn(`Genere non trovato su IGDB: ${etichetta}`);
    }
    generi.set(etichetta, { categoria, ids });
  }

  const modalita = new Map();
  for (const [etichetta, slug] of Object.entries(MODALITA)) {
    const ids = slug.map(s => modalitaTrovate.get(s)).filter(id => id !== undefined);
    if (ids.length === 0) {
      console.warn(`Modalità non trovata su IGDB: ${etichetta}`);
    }
    modalita.set(etichetta, ids);
  }

  const idPerPiattaforma = new Map();
  const piattaformaPerId = new Map();
  for (const [etichetta, nome] of Object.entries(PIATTAFORME)) {
    const id = piattaformeTrovate.get(nome.toLowerCase());
    if (id === undefined) {
      console.warn(`Piattaforma non trovata su IGDB: ${nome}`);
      continue;
    }
    idPerPiattaforma.set(etichetta, id);
    piattaformaPerId.set(id, etichetta);
  }

  return {
    generi,
    modalita,
    idPerPiattaforma,
    piattaformaPerId,
    idTemaEscluso: themes.get(SLUG_TEMA_ESCLUSO),
  };
}

export function caricaCatalogo() {
  if (!promessaCatalogo) {
    promessaCatalogo = costruisciCatalogo().catch(errore => {
      promessaCatalogo = null;
      throw errore;
    });
  }
  return promessaCatalogo;
}

function listaId(ids) {
  return `(${ids.join(',')})`;
}

export function condizioneGeneri(etichette, catalogo) {
  const idPerCategoria = { genres: [], themes: [], keywords: [] };
  for (const etichetta of etichette) {
    const genere = catalogo.generi.get(etichetta);
    if (genere) {
      idPerCategoria[genere.categoria].push(...genere.ids);
    }
  }

  const parti = Object.entries(idPerCategoria)
    .filter(([, ids]) => ids.length > 0)
    .map(([categoria, ids]) => `${categoria} = ${listaId(ids)}`);

  return parti.length > 0 ? `(${parti.join(' | ')})` : null;
}

export function condizionePiattaforme(etichette, catalogo) {
  const ids = etichette.map(e => catalogo.idPerPiattaforma.get(e)).filter(Boolean);
  return ids.length > 0 ? `platforms = ${listaId(ids)}` : null;
}

export function condizioneModalita(etichette, catalogo) {
  const ids = etichette.flatMap(e => catalogo.modalita.get(e) ?? []);
  return ids.length > 0 ? `game_modes = ${listaId(ids)}` : null;
}

export function unisciCondizioni(condizioni) {
  return condizioni.filter(Boolean).join(' & ');
}

export function giocoValido(gioco, catalogo) {
  const temi = gioco.themes ?? [];
  return Boolean(gioco.cover?.image_id) && !temi.includes(catalogo.idTemaEscluso);
}

function haInComune(valori, ids) {
  return ids.some(id => (valori ?? []).includes(id));
}

function urlImmagine(imageId, formato) {
  return imageId ? `${URL_IMMAGINI}/${formato}/${imageId}.jpg` : null;
}

export function convertiGioco(gioco, catalogo) {
  const generi = [...catalogo.generi]
    .filter(([, genere]) => haInComune(gioco[genere.categoria], genere.ids))
    .map(([etichetta]) => etichetta);

  const modalita = [...catalogo.modalita]
    .filter(([, ids]) => haInComune(gioco.game_modes, ids))
    .map(([etichetta]) => etichetta);

  const piattaforme = (gioco.platforms ?? [])
    .map(id => catalogo.piattaformaPerId.get(id))
    .filter(Boolean);

  const imageId = gioco.cover?.image_id;

  return {
    id: gioco.id,
    nome: gioco.name,
    immagine: urlImmagine(imageId, FORMATO_PICCOLO),
    immagineGrande: urlImmagine(imageId, FORMATO_GRANDE),
    generi,
    piattaforme,
    modalita,
    voto: gioco.total_rating ? Math.round(gioco.total_rating / 2) / 10 : 0,
    uscita: gioco.first_release_date
      ? new Date(gioco.first_release_date * 1000).getUTCFullYear()
      : null,
  };
}