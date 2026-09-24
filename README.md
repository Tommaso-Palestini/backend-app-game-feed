# backend-app-game-feed

Mini backend Node/Express per l'app [GameFeedApp](https://github.com/Tommaso-Palestini/GameFeedApp).

Fa da ponte con l'API di [IGDB](https://www.igdb.com): tiene le credenziali lontane dall'app,
traduce generi, piattaforme e modalità dall'italiano ai valori di IGDB, calcola la compatibilità
dei giochi con le preferenze dell'utente e mette in cache le risposte.
Gestisce inoltre gli account degli utenti, con preferenze e wishlist.

È un backend temporaneo: in futuro l'app si collegherà al backend del progetto full stack.

## Stack

- Node 22 (ES modules, `fetch` integrato, `--env-file` e `--watch`)
- Express 5
- `compression` per la compressione gzip
- API IGDB v4, con autenticazione Twitch (client credentials)
- `node:crypto` (`scrypt`) per le password

## Requisiti

- Node 22.11 o superiore
- Credenziali Twitch per l'API IGDB (Client ID e Client Secret), vedi sotto

## Credenziali

Le credenziali **non sono incluse nel repository**: vanno messe in un file `.env`,
che è escluso da git.

Per ottenerle:

1. Crea un account [Twitch](https://www.twitch.tv) e attiva l'autenticazione a due fattori
2. Su [dev.twitch.tv/console](https://dev.twitch.tv/console) registra una nuova applicazione:
   - URL di reindirizzamento OAuth: `http://localhost`
   - Categoria: `Application Integration`
   - Tipo di client: **Riservato** (Confidential)
3. Apri l'applicazione creata, copia il **Client ID** e genera un **Client Secret**

Per la valutazione del progetto, le credenziali possono essere fornite privatamente dall'autore.

## Installazione

```bash
git clone https://github.com/Tommaso-Palestini/backend-app-game-feed.git
cd backend-app-game-feed
npm install
cp .env.example .env
```

Poi compila `.env`:

```
TWITCH_CLIENT_ID=il-tuo-client-id
TWITCH_CLIENT_SECRET=il-tuo-client-secret
PORT=3000
```

## Avvio

```bash
npm run dev     # sviluppo, si riavvia a ogni salvataggio
npm start       # avvio normale
```

Il server risponde su `http://localhost:3000`.

## Endpoint

Tutti i parametri con più valori si passano separati da virgola,
per esempio `generi=RPG,Open world`.

### Giochi

| Metodo | Percorso | Descrizione |
|---|---|---|
| GET | `/api/health` | Controllo che il server sia attivo |
| GET | `/api/stats` | Statistiche su cache e tempi di risposta |
| GET | `/api/games/feed` | Feed a pagine ordinato per compatibilità |
| GET | `/api/games/random` | 20 giochi casuali |
| GET | `/api/games/search` | Ricerca con filtri, 30 risultati per pagina |
| GET | `/api/games/:id` | Dettaglio di un gioco |

### Account

| Metodo | Percorso | Descrizione |
|---|---|---|
| POST | `/api/account/registrati` | Crea un account |
| POST | `/api/account/accedi` | Accesso con email e password |
| POST | `/api/account/esci` | Chiude la sessione |
| GET | `/api/account` | Utente, preferenze e wishlist |
| PUT | `/api/account/preferenze` | Salva le preferenze |
| PUT | `/api/account/wishlist` | Salva la wishlist |

Registrazione e accesso restituiscono un token di sessione, valido 30 giorni,
da inviare nelle altre richieste come `Authorization: Bearer <token>`.

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

## Account e sicurezza

- Gli account sono salvati in `data/db.json`, escluso da git
- Le password non sono mai salvate in chiaro: viene salvato solo l'hash calcolato con `scrypt`
  e un salt casuale per ogni utente
- I dati inviati dall'app vengono validati e ripuliti prima di essere salvati
- Il file viene scritto in modo sicuro (prima su un file temporaneo, poi rinominato)
  e le scritture vengono messe in fila per non sovrapporsi

## Struttura

```
src/
├── server.js       avvio di Express, compressione, log, gestione degli errori
├── giochi.js       endpoint /api/games
├── account.js      endpoint /api/account: registrazione, accesso, sessioni, dati utente
├── archivio.js     lettura e scrittura di data/db.json
├── mappature.js    traduzione italiano ↔ IGDB e conversione dei giochi
└── igdb.js         client IGDB: token Twitch, cache, coda, statistiche
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

## Sviluppi futuri

- Database al posto del file JSON e hosting online del server
- Recupero della password via email
- Limite di tentativi di accesso per proteggere gli account
- Cache condivisa (per esempio Redis) per più istanze del server

## Riferimenti

- [Express 5](https://expressjs.com)
- [Node.js – crypto.scrypt](https://nodejs.org/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback)
- [Node.js – opzione --env-file](https://nodejs.org/api/cli.html#--env-fileconfig)
- [compression](https://github.com/expressjs/compression)
- [IGDB API](https://api-docs.igdb.com)
- [Twitch Developer Console](https://dev.twitch.tv/console)

## Crediti

Dati dei giochi forniti da [IGDB](https://www.igdb.com), uso non commerciale
secondo il Twitch Developer Service Agreement.