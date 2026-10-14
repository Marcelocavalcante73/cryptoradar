import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { getScanState, runScan, startScanner, parseMarket, ensureScan, loadScanners } from './server/scanner';
import { fetchHistory } from './server/history';
import { runBacktest } from './src/services/backtest';
import { binanceGet } from './server/universe';
import { getBatchJob, startBatchJob } from './server/backtestJob';
import { getLabJob, startLabJob } from './server/b3LabJob';
import { getB3State, runB3Scan, startB3Scanner, ensureB3Scan, loadB3State } from './server/b3Scanner';
import { getTrendState, runTrendScan, startTrendScanner, ensureTrendScan, loadTrendState } from './server/trendScanner';
import { futuresKlines, futuresPrices, getFuturesProvider } from './server/futuresData';
import { stateRead, stateWrite, storageStatus, checkAccess } from './server/stateApi';
import { runHealth } from './server/health';
import { shouldServeStatic } from './server/runtime';
import fs from 'fs';

dotenv.config();

// Define Binance como corretora padrão do scanner no servidor (evita bloqueio regional 403 da Bybit)
if (!process.env.EXCHANGES) {
  process.env.EXCHANGES = 'binance';
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
function getPort(): number {
  const args = process.argv;
  const portIndex = args.indexOf('--port');
  if (portIndex !== -1 && args[portIndex + 1]) {
    const parsed = Number(args[portIndex + 1]);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return Number(process.env.PORT) || 3000;
}

const PORT = getPort();

app.use(express.json({ limit: '3mb' }));

// In-memory rate limiting map: ip -> array of request timestamps
const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minuto
const MAX_REQUESTS_PER_WINDOW = 5;      // Máximo 5 requisições por minuto

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const timestamps = (rateLimitMap.get(ip) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (timestamps.length >= MAX_REQUESTS_PER_WINDOW) {
    return true;
  }
  timestamps.push(now);
  rateLimitMap.set(ip, timestamps);
  return false;
}

/**
 * GET /api/telegram/status
 * Consulta honesta se o backend possui o bot token configurado em variável de ambiente.
 */
app.get('/api/telegram/status', (_req: Request, res: Response) => {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const configured = Boolean(token && token.length > 10);

  res.json({
    configured,
    service: 'telegram',
    status: configured ? 'CONFIGURED' : 'NOT_CONFIGURED',
    chatConfigured: Boolean(process.env.TELEGRAM_CHAT_ID?.trim()),
    message: configured
      ? 'Backend pronto: variável TELEGRAM_BOT_TOKEN configurada no servidor.'
      : 'Variável TELEGRAM_BOT_TOKEN não encontrada no .env do servidor. Envios reais desabilitados.'
  });
});

/**
 * POST /api/telegram/test
 * Disparo seguro de teste via backend, sem expor tokens no frontend nem em parâmetros de URL.
 */
app.post('/api/telegram/test', async (req: Request, res: Response) => {
  const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';

  // 1. Limite de requisições (Rate limiting)
  if (isRateLimited(clientIp)) {
    return res.status(429).json({
      success: false,
      configured: true,
      error: 'Limite de requisições excedido (rate limit: máximo 5 disparos por minuto). Aguarde instantes.'
    });
  }

  // 2. Validação se o token está configurado no servidor
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token || token.length < 10) {
    return res.status(503).json({
      success: false,
      configured: false,
      error: 'Servidor não configurado: adicione TELEGRAM_BOT_TOKEN no arquivo .env para habilitar envios reais.'
    });
  }

  // 3. Validação do destino (chatId)
  const body = req.body || {};
  const message = body.message;
  const chatId = typeof body.chatId === 'string' && body.chatId.trim() ? body.chatId : process.env.TELEGRAM_CHAT_ID;
  if (!chatId || typeof chatId !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'Defina TELEGRAM_CHAT_ID no .env do servidor para receber os alertas.'
    });
  }

  const cleanChatId = chatId.trim();
  // Aceita canais públicos com @ (ex: @cryptoradar_canal) ou chat IDs numéricos (ex: 123456789, -100123456789)
  const isValidDestination = /^(@[a-zA-Z0-9_]{5,32}|-?[0-9]{5,16})$/.test(cleanChatId);
  if (!isValidDestination) {
    return res.status(400).json({
      success: false,
      error: 'Destino inválido. O Chat ID deve ser numérico (ex: 123456789) ou um canal/grupo público com @ (ex: @canal).'
    });
  }

  // 4. Disparo seguro server-to-server utilizando payload JSON (sem token na URL do cliente)
  try {
    const text = typeof message === 'string' && message.trim().length > 0
      ? message.trim()
      : '🟢 *CryptoRadar - Teste de Alerta Conectado*\n\nSeu canal está configurado para receber sinais e execuções do Paper Trading em tempo real.';

    const telegramResponse = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: cleanChatId,
        text,
        parse_mode: 'Markdown'
      }),
      signal: AbortSignal.timeout(6000)
    });

    const data: any = await telegramResponse.json().catch(() => null);

    if (telegramResponse.ok && data?.ok) {
      return res.json({
        success: true,
        configured: true,
        message: `Mensagem enviada com sucesso para ${cleanChatId}!`
      });
    }

    const errorDesc = data?.description || `Erro HTTP ${telegramResponse.status}`;
    const statusCode = telegramResponse.status >= 400 && telegramResponse.status < 500 ? telegramResponse.status : 502;

    return res.status(statusCode).json({
      success: false,
      configured: true,
      error: `API do Telegram recusou a mensagem: ${errorDesc}`
    });
  } catch (err: any) {
    const isTimeout = err?.name === 'TimeoutError' || err?.message?.includes('timeout');
    return res.status(504).json({
      success: false,
      configured: true,
      error: isTimeout
        ? 'Tempo limite esgotado ao contatar os servidores do Telegram.'
        : 'Falha de rede ao conectar com a API do Telegram.'
    });
  }
});

/**
 * GET /api/market/tickers — cotações 24h reais dos pares USDT da Binance com cache em memória.
 */
let cachedTickers: any = null;
let lastTickersFetch = 0;
const TICKERS_CACHE_TTL_MS = 3000;

app.get('/api/market/tickers', async (_req: Request, res: Response) => {
  const now = Date.now();
  if (cachedTickers && now - lastTickersFetch < TICKERS_CACHE_TTL_MS) {
    return res.json(cachedTickers);
  }
  try {
    const raw = await binanceGet('/api/v3/ticker/24hr', 5000);
    if (Array.isArray(raw)) {
      cachedTickers = raw;
      lastTickersFetch = now;
      return res.json(raw);
    }
    if (cachedTickers) return res.json(cachedTickers);
    res.status(502).json({ error: 'Resposta inválida de cotações da Binance' });
  } catch (err: any) {
    if (cachedTickers) return res.json(cachedTickers);
    res.status(502).json({ error: err?.message || 'Falha ao consultar cotações da Binance' });
  }
});

/**
 * GET /api/signals — sinais gerados pelo scanner (top 100 por market cap) e estado da varredura.
 */
app.get('/api/signals', async (req: Request, res: Response) => {
  const market = parseMarket(req.query.market);
  // wait=1: mantém a requisição aberta enquanto a varredura roda (até 25 s). Em hospedagens que só dão processador
  // durante requisições (Cloud Run / AI Studio publicado), é isso que deixa a varredura terminar.
  await ensureScan(market, req.query.wait === '1' ? 25000 : 0);
  res.json(getScanState(market));
});

/**
 * POST /api/scan — força uma varredura imediata (limitada por rate limit).
 */
app.post('/api/scan', (req: Request, res: Response) => {
  const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
  if (isRateLimited(ip)) return res.status(429).json({ error: 'Limite de requisições excedido.' });
  runScan(parseMarket(req.query.market));
  res.status(202).json({ started: true });
});

/**
 * GET /api/futures/prices?symbols=BTCUSDT,ETHUSDT — preços dos perpétuos USDT-M (proxy da Binance, cache curto).
 * Os preços de futuros diferem um pouco dos de spot; a carteira de futuros precisa dos preços do próprio contrato.
 */
app.get('/api/futures/prices', async (req: Request, res: Response) => {
  const wanted = String(req.query.symbols || '').split(',').map((x) => x.trim().toUpperCase()).filter((x) => /^[A-Z0-9]{3,20}USDT$/.test(x));
  if (wanted.length === 0) return res.status(400).json({ error: 'Informe symbols (ex: BTCUSDT,ETHUSDT).' });
  try {
    const all = await futuresPrices(wanted); // Binance → Bybit → OKX
    const prices: Record<string, number> = {};
    for (const sym of wanted) { const px = all.get(sym); if (px !== undefined && Number.isFinite(px)) prices[sym] = px; }
    res.json({ prices, source: getFuturesProvider() });
  } catch (e: any) {
    res.status(502).json({ error: `Falha ao consultar preços de futuros: ${e?.message ?? 'indisponível'}` });
  }
});

/**
 * GET /api/futures/klines?symbol=BTCUSDT&interval=4h&limit=300 — candles dos perpétuos, no formato da Binance.
 */
app.get('/api/futures/klines', async (req: Request, res: Response) => {
  const symbol = String(req.query.symbol || '').toUpperCase();
  const interval = String(req.query.interval || '4h');
  const limit = Math.min(1000, Math.max(10, Number(req.query.limit) || 300));
  if (!/^[A-Z0-9]{3,20}USDT$/.test(symbol)) return res.status(400).json({ error: 'symbol inválido.' });
  if (!['15m', '1h', '4h', '1d', '1w'].includes(interval)) return res.status(400).json({ error: 'interval inválido.' });
  try {
    res.json(await futuresKlines(symbol, interval, limit));
  } catch (e: any) {
    res.status(502).json({ error: `Falha ao consultar candles de futuros: ${e?.message ?? 'indisponível'}` });
  }
});

/**
 * GET /api/backtest?symbol=BTCUSDT&tf=1h&bars=2000 — backtest do motor de sinais no histórico real.
 */
app.get('/api/backtest', async (req: Request, res: Response) => {
  const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
  if (isRateLimited(ip)) return res.status(429).json({ error: 'Limite de requisições excedido.' });

  const symbol = String(req.query.symbol || '').toUpperCase();
  const tf = String(req.query.tf || '1h');
  const bars = Math.min(5000, Math.max(200, Number(req.query.bars) || 2000));
  if (!/^[A-Z0-9]{3,15}USDT$/.test(symbol)) return res.status(400).json({ error: 'symbol inválido (ex: BTCUSDT).' });
  if (!['15m', '1h', '4h', '1d'].includes(tf)) return res.status(400).json({ error: 'tf inválido (15m, 1h, 4h, 1d).' });

  try {
    const market = parseMarket(req.query.market);
    const candles = await fetchHistory(symbol, tf, bars, 1, market);
    // Spot: só compras. Futuros: compras e vendas, com o funding atual da Binance (fallback 0,01% por 8h)
    let funding = 0.0001;
    if (market === 'futures') {
      try {
        const pi = await binanceGet(`/fapi/v1/premiumIndex?symbol=${symbol}`, 5000, 'futures');
        const r = Math.abs(Number(pi?.lastFundingRate));
        if (Number.isFinite(r) && r > 0) funding = r; // módulo: custo conservador nos dois lados
      } catch { /* mantém o padrão */ }
    }
    const longOnly = market === 'spot' && req.query.both !== 'true';
    const result = runBacktest(candles, symbol, symbol.replace(/USDT$/, ''), tf, {
      longOnly,
      fundingPer8h: market === 'futures' ? funding : 0
    });
    res.json({ ...result, trades: result.trades.slice(-100) });
  } catch (e: any) {
    res.status(502).json({ error: `Falha ao obter histórico da Binance: ${e?.message ?? 'indisponível'}` });
  }
});

/**
 * Estado do usuário no servidor (carteiras simuladas, histórico, ajustes), igual em qualquer hospedagem e navegador.
 *  GET  /api/storage          como o servidor guarda os dados e se exige chave de acesso
 *  POST /api/access           confere a chave de acesso (cabeçalho X-Access-Key)
 *  GET  /api/state/:key       lê  (paper-spot | paper-futures | settings)
 *  PUT  /api/state/:key       grava {value, savedAt}; 409 se o servidor tem uma versão mais nova
 */
const stateHits = new Map<string, number[]>();
function stateLimited(ip: string): boolean {
  const now = Date.now();
  const hits = (stateHits.get(ip) || []).filter((t) => now - t < 60000);
  if (hits.length >= 240) return true;
  hits.push(now);
  stateHits.set(ip, hits);
  return false;
}
const clientIp = (req: Request) => (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';

/** GET /api/health — diagnóstico completo, feito de dentro do servidor (limitado a 12 por minuto). */
const healthHits: number[] = [];
app.get('/api/health', async (_req: Request, res: Response) => {
  const now = Date.now();
  while (healthHits.length && now - healthHits[0] > 60000) healthHits.shift();
  if (healthHits.length >= 12) return res.status(429).json({ error: 'Muitas verificações. Aguarde um minuto.' });
  healthHits.push(now);
  res.json(await runHealth());
});

app.get('/api/storage', (_req: Request, res: Response) => {
  res.json(storageStatus());
});

app.post('/api/access', (req: Request, res: Response) => {
  if (stateLimited(clientIp(req))) return res.status(429).json({ error: 'Muitas requisições.' });
  const r = checkAccess(req.header('x-access-key'));
  res.status(r.status).json(r.json);
});

app.get('/api/state/:key', async (req: Request, res: Response) => {
  if (stateLimited(clientIp(req))) return res.status(429).json({ error: 'Muitas requisições.' });
  const r = await stateRead(req.params.key, req.header('x-access-key'));
  res.status(r.status).json(r.json);
});

app.put('/api/state/:key', async (req: Request, res: Response) => {
  if (stateLimited(clientIp(req))) return res.status(429).json({ error: 'Muitas requisições.' });
  const r = await stateWrite(req.params.key, req.body, req.header('x-access-key'));
  res.status(r.status).json(r.json);
});

/**
 * GET /api/trend — sinais diários da estratégia de rompimento de 55 dias, regime do Bitcoin e lista de observação.
 * POST /api/trend/scan — força uma varredura imediata.
 */
app.get('/api/trend', async (req: Request, res: Response) => {
  await ensureTrendScan(30 * 60e3, req.query.wait === '1' ? 25000 : 0);
  res.json(getTrendState());
});

app.post('/api/trend/scan', (req: Request, res: Response) => {
  const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
  if (isRateLimited(ip)) return res.status(429).json({ error: 'Limite de requisições excedido.' });
  runTrendScan();
  res.status(202).json({ started: true });
});

/**
 * GET /api/b3 — swing trade na B3: tendência do Ibovespa, sinais de tendência e de indicadores.
 * POST /api/b3/scan — força uma varredura imediata.
 */
app.get('/api/b3', async (req: Request, res: Response) => {
  await ensureB3Scan(30 * 60e3, req.query.wait === '1' ? 25000 : 0);
  res.json(getB3State());
});

app.post('/api/b3/scan', (req: Request, res: Response) => {
  const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
  if (isRateLimited(ip)) return res.status(429).json({ error: 'Limite de requisições excedido.' });
  runB3Scan();
  res.status(202).json({ started: true });
});

/**
 * POST /api/backtest/batch {market, tf, top, bars} — inicia o backtest de várias moedas em segundo plano.
 * GET  /api/backtest/batch — andamento e resultado do último backtest em lote.
 */
app.post('/api/backtest/batch', (req: Request, res: Response) => {
  const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
  if (isRateLimited(ip)) return res.status(429).json({ error: 'Limite de requisições excedido.' });
  const b = req.body || {};
  const trend = b.strategy === 'trend';
  const tf = trend ? '1d' : b.tf === '4h' ? '4h' : '1h';
  const top = Math.min(50, Math.max(5, Math.round(Number(b.top) || 30)));
  const bars = Math.min(trend ? 2000 : 4000, Math.max(500, Math.round(Number(b.bars) || (trend ? 1500 : 3000))));
  // A estratégia de tendência é só para spot (compras)
  const job = startBatchJob({ list: b.list === 'classic2022' ? 'classic2022' : b.list === 'b3' ? 'b3' : 'top', strategy: trend || b.list === 'b3' ? 'trend' : 'signals', market: trend || b.list === 'b3' ? 'spot' : parseMarket(b.market), tf, top, bars });
  res.status(202).json(job);
});

/** POST /api/b3lab — inicia o laboratório da B3; GET — andamento e resultado. */
app.post('/api/b3lab', (req: Request, res: Response) => {
  const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
  if (isRateLimited(ip)) return res.status(429).json({ error: 'Limite de requisições excedido.' });
  res.status(202).json(startLabJob());
});

app.get('/api/b3lab', (_req: Request, res: Response) => {
  res.json(getLabJob());
});

app.get('/api/backtest/batch', (_req: Request, res: Response) => {
  res.json(getBatchJob());
});

/**
 * Inicialização do Vite middleware em desenvolvimento ou arquivos estáticos em produção.
 */
async function startServer() {
  const distPathCheck = path.resolve(__dirname, 'dist');
  const distExists = fs.existsSync(path.join(distPathCheck, 'index.html'));
  let isProduction = shouldServeStatic(process.env, process.argv, distExists);
  if (isProduction && !distExists) {
    console.warn('Produção pedida, mas dist/ não existe (rode `npm run build`). Usando o modo de desenvolvimento.');
    isProduction = false;
  }

  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  // Restaura o último resultado antes de aceitar pedidos: o servidor responde com dados desde o primeiro acesso
  await Promise.all([loadScanners(), loadTrendState(), loadB3State()]);

  if (process.env.SCANNER_ENABLED !== 'false') {
    startScanner(Number(process.env.SCAN_INTERVAL_MINUTES) || 5);
    startTrendScanner();
    startB3Scanner();
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`CryptoRadar fullstack server rodando na porta ${PORT} [${isProduction ? 'PROD' : 'DEV'}]`);
  });
}

startServer().catch((err) => {
  console.error('Erro ao iniciar servidor:', err);
  process.exit(1);
});
