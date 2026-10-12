import { CandleData } from '../src/types/crypto';
import { parseBinanceKline } from '../src/services/apiService';
import { binanceGet } from './universe';

/**
 * Baixa até `bars` candles FECHADOS da Binance (paginando de 1000 em 1000, do mais recente para trás).
 */
export async function fetchHistory(symbol: string, tf: string, bars: number, price = 1): Promise<CandleData[]> {
  const decimals = 10; // mantém a precisão original, inclusive em moedas de valor muito baixo
  void price;
  let endTime: number | undefined;
  let all: CandleData[] = [];

  while (all.length < bars) {
    const limit = Math.min(1000, bars - all.length);
    const raw: any[] = await binanceGet(
      `/api/v3/klines?symbol=${symbol}&interval=${tf}&limit=${limit}${endTime ? `&endTime=${endTime}` : ''}`
    );
    if (!Array.isArray(raw) || raw.length === 0) break;
    const page: CandleData[] = [];
    for (const k of raw) {
      const c = parseBinanceKline(k, tf as any, decimals);
      if (c) page.push(c);
    }
    all = [...page, ...all];
    endTime = raw[0][0] - 1;
    if (raw.length < limit) break;
  }

  all.pop(); // descarta a vela ainda aberta
  return all;
}
