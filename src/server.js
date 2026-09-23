import express from 'express';
import giochiRouter from './giochi.js';
import { ErroreIgdb } from './igdb.js';

if (!process.env.TWITCH_CLIENT_ID || !process.env.TWITCH_CLIENT_SECRET) {
  console.error('Mancano TWITCH_CLIENT_ID o TWITCH_CLIENT_SECRET nel file .env');
  process.exit(1);
}

const app = express();

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.use('/api/games', giochiRouter);

app.use((req, res) => {
  res.status(404).json({ errore: 'Endpoint non trovato' });
});

app.use((errore, req, res, _next) => {
  console.error(errore);
  const stato = errore instanceof ErroreIgdb && errore.stato === 401 ? 401 : 502;
  res.status(stato).json({
    errore:
      stato === 401
        ? 'Credenziali IGDB non valide'
        : 'Errore nel recupero dei dati da IGDB',
  });
});

const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, () => {
  console.log(`Backend in ascolto su http://localhost:${PORT}`);
});