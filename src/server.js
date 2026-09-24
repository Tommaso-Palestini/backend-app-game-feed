import express from 'express';
import compression from 'compression';
import giochiRouter from './giochi.js';
import accountRouter from './account.js';
import { ErroreIgdb, getStatistiche } from './igdb.js';

if (!process.env.TWITCH_CLIENT_ID || !process.env.TWITCH_CLIENT_SECRET) {
  console.error('Mancano TWITCH_CLIENT_ID o TWITCH_CLIENT_SECRET nel file .env');
  process.exit(1);
}

const app = express();

app.use(compression());
app.use(express.json({ limit: '1mb' }));

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
app.use('/api/account', accountRouter);

app.use((req, res) => {
  res.status(404).json({ errore: 'Endpoint non trovato' });
});

app.use((errore, req, res, _next) => {
  if (errore.type === 'entity.parse.failed' || errore.type === 'entity.too.large') {
    res.status(errore.status).json({ errore: 'Richiesta non valida' });
    return;
  }

  console.error(errore);

  if (errore instanceof ErroreIgdb) {
    const stato = errore.stato === 401 ? 401 : 502;
    res.status(stato).json({
      errore: stato === 401 ? 'Credenziali IGDB non valide' : 'Errore nel recupero dei dati da IGDB',
    });
    return;
  }

  res.status(500).json({ errore: 'Errore interno del server' });
});

const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, () => {
  console.log(`Backend in ascolto su http://localhost:${PORT}`);
});