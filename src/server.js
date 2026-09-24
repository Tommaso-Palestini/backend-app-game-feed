import express from 'express';
import compression from 'compression';
import giochiRouter from './giochi.js';
import { ErroreIgdb, getStatistiche } from './igdb.js';

if (!process.env.TWITCH_CLIENT_ID || !process.env.TWITCH_CLIENT_SECRET) {
  console.error('Mancano TWITCH_CLIENT_ID o TWITCH_CLIENT_SECRET nel file .env');
  process.exit(1);
}

const app = express();

app.use(compression());

app.use((req, res, next) => {
  const inizio = performance.now();
  res.on('finish', () => {
    const durata = Math.round(performance.now() - inizio);
    console.log(`${req.method} ${decodeURIComponent(req.originalUrl)} → ${res.statusCode} in ${durata} ms`);
  });
  next();
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.get('/api/stats', (req, res) => {
  res.json({
    ...getStatistiche(),
    attivoDaSecondi: Math.round(process.uptime()),
  });
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