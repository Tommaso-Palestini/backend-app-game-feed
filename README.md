# game-feed-backend

Mini backend Node/Express che fa da ponte tra l'app [GameFeedApp](https://github.com/TUO-UTENTE/GameFeedApp)
e l'API di [IGDB](https://www.igdb.com).

Tiene le credenziali IGDB lontane dall'app, traduce generi, piattaforme e modalità
dall'italiano ai valori di IGDB, calcola la compatibilità dei giochi con le preferenze
dell'utente e mette in cache le risposte.

È un backend temporaneo: in futuro l'app si collegherà al backend del progetto full stack.

## Stack

- Node 22 (ES modules, `fetch` integrato, `--env-file` e `--watch`)
- Express 5
- API IGDB v4, con autenticazione Twitch (client credentials)

## Requisiti

- Node 22.11 o superiore
- Un account Twitch con l'autenticazione a due fattori attiva
- Un'applicazione registrata su [dev.twitch.tv/console](https://dev.twitch.tv/console)
  con tipo di client **Riservato** (Confidential), da cui prendere Client ID e Client Secret

## Installazione

```bash
git clone https://github.com/TUO-UTENTE/game-feed-backend.git
cd game-feed-backend
npm install
cp .env.example .env
```

Poi compila `.env` con le tue credenziali:

```
TWITCH_CLIENT_ID=il-tuo-client-id
TWITCH_CLIENT_SECRET=il-tuo-client-secret
PORT=3000
```

Il file `.env` è escluso da git e non va mai caricato nel repository.

## Avvio

```bash
npm run dev     # sviluppo, si riavvia a ogni salvataggio
npm start       # avvio normale
```

Il server risponde su `http://localhost:3000`.

## Endpoint

Tutti i parametri con più valori si passano separati da virgola,
per esempio `generi=RPG,Open world`.

| Metodo | Percorso | Descrizione |
|---|---|---|
| GET | `/api/health` | Controllo che il server sia attivo |
| GET | `/api/games/feed` | Feed a pagine ordinato per compatibilità |
| GET | `/api/games/random` | 20 giochi casuali |
| GET | `/api/games/search` | Ricerca con filtri, 30 risultati per pagina |
| GET | `/api/games/:id` | Dettaglio di un gioco |

### `/api/games/feed`

Parametri: `generi`, `piattaforme`, `modalita`, `cursore`.

Risposta: `{ giochi, cursore }`. Per la pagina successiva si ripassa il `cursore` ricevuto;
quando vale `null` i giochi compatibili sono finiti.

Il feed ha due livelli: prima i giochi che hanno generi, piattaforme e modalità scelte,
poi quelli con generi e piattaforme ma senza le modalità. Dentro ogni livello i giochi
vanno dal più popolare al meno popolare, e ogni pagina è ordinata per compatibilità.

La compatibilità (0–100) è calcolata così:
- 60% generi in comune con quelli scelti
- 25% disponibilità su almeno una delle piattaforme scelte
- 15% modalità in comune con quelle scelte

### `/api/games/random`

Parametri: `piattaforme`. Restituisce 20 giochi pescati a caso tra i più valutati.

### `/api/games/search`

Parametri: `q`, `generi`, `piattaforme`, `modalita`, `annoDa`, `annoA`, `pagina`.

Risposta: `{ giochi, altrePagine }`. Con del testo vengono unite due ricerche:
per nome contenuto (funziona anche con parte del nome) e per pertinenza
(tollera errori di battitura). Senza testo restituisce i giochi più popolari.

### `/api/games/:id`

Oltre ai campi base restituisce `descrizione`, `sviluppatori`, `votoCritica` e `paginaIgdb`.

### Formato di un gioco

```json
{
  "id": 1942,
  "nome": "The Witcher 3: Wild Hunt",
  "immagine": "https://images.igdb.com/...",
  "immagineGrande": "https://images.igdb.com/...",
  "generi": ["RPG", "Avventura", "Open world"],
  "piattaforme": ["PC", "PlayStation 4", "Xbox One", "Nintendo Switch"],
  "modalita": ["Single player"],
  "voto": 4.6,
  "uscita": 2015,
  "compatibilita": 85
}
```

`compatibilita` è presente solo nel feed.

## Struttura

```
src/
├── server.js       avvio di Express, gestione degli errori
├── giochi.js       endpoint /api/games
├── mappature.js    traduzione italiano ↔ IGDB e conversione dei giochi
└── igdb.js         client IGDB: token Twitch, cache, limite di richieste
```

## Ottimizzazioni

- **Cache LRU in memoria** delle risposte IGDB: 10 minuti di validità, massimo 500 voci;
  quando è piena viene eliminata la voce usata meno di recente
- **Richieste identiche unite**: se una richiesta uguale è già in corso verso IGDB,
  la nuova attende la stessa risposta invece di ripetere la chiamata
- **Compressione gzip** delle risposte JSON
- **Token Twitch** richiesto una sola volta e rinnovato automaticamente alla scadenza
- **Limite di 4 richieste al secondo** verso IGDB rispettato mettendo in coda le richieste
- **Nuovo tentativo automatico** in caso di token scaduto (401) o troppe richieste (429)
- **Id di generi, temi e piattaforme** scaricati da IGDB una sola volta all'avvio

### Misurazioni

Ogni richiesta viene registrata nel terminale con il tempo di risposta.
`GET /api/stats` restituisce il numero di richieste, quante sono state servite dalla cache
o unite a una già in corso, la percentuale di chiamate a IGDB risparmiate e il tempo medio
di risposta di IGDB.

## Crediti

Dati dei giochi forniti da [IGDB](https://www.igdb.com), uso non commerciale
secondo il Twitch Developer Service Agreement.