import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { getScanState, runScan, startScanner } from './server/scanner';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json());

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
  const { chatId, message } = req.body || {};
  if (!chatId || typeof chatId !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'Identificador de destino (chatId) é obrigatório.'
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
 * GET /api/signals — sinais gerados pelo scanner (top 100 por market cap) e estado da varredura.
 */
app.get('/api/signals', (_req: Request, res: Response) => {
  res.json(getScanState());
});

/**
 * POST /api/scan — força uma varredura imediata (limitada por rate limit).
 */
app.post('/api/scan', (req: Request, res: Response) => {
  const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
  if (isRateLimited(ip)) return res.status(429).json({ error: 'Limite de requisições excedido.' });
  runScan();
  res.status(202).json({ started: true });
});

/**
 * Inicialização do Vite middleware em desenvolvimento ou arquivos estáticos em produção.
 */
async function startServer() {
  const isProduction = process.env.NODE_ENV === 'production';

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

  if (process.env.SCANNER_ENABLED !== 'false') startScanner(Number(process.env.SCAN_INTERVAL_MINUTES) || 5);

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`CryptoRadar fullstack server rodando na porta ${PORT} [${isProduction ? 'PROD' : 'DEV'}]`);
  });
}

startServer().catch((err) => {
  console.error('Erro ao iniciar servidor:', err);
  process.exit(1);
});
