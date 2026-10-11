# CryptoRadar

Sinais de compra e venda das 100 maiores criptomoedas (por valor de mercado) que existem na **Binance e na Bybit**, com carteira simulada e histórico das simulações.

## Como usar

```bash
npm install
cp .env.example .env     # opcional: só precisa editar se quiser alertas no Telegram
npm run dev              # abre em http://localhost:3000
```

Sem configurar nada o app já funciona: o scanner busca o ranking no CoinGecko, cruza com as duas corretoras e gera sinais a cada 5 minutos.

Para produção: `npm run build` e depois `NODE_ENV=production npm start`.

## Telas

- **Sinais**: compras e vendas com entrada, alvo e stop. Toque em **Simular** para abrir a operação na carteira simulada já com tamanho calculado pelo risco.
- **Carteira**: patrimônio, posições abertas e histórico de todas as simulações (exportável em CSV). “Zerar saldo” mantém o histórico.
- **Mercado**: as moedas do scanner em ordem de valor de mercado, com gráfico.
- **Ajustes** (engrenagem): risco por operação, intervalo de atualização, Telegram e estado do scanner.

## Como o sinal é gerado

Pontuação de −100 a +100 combinando tendência (EMA 20/50), MACD, RSI, volume e cruzamentos recentes, sempre em candles **fechados**. Só emite sinal com pontuação de 60 ou mais e tendência definida. Stop e alvo vêm do ATR (risco:retorno 1:2).

Modo **spot** (padrão): “Vender” significa sair de uma posição que você já tem. Para futuros, use `MARKET_MODE=futures`.

## Variáveis (.env)

| Variável | Para quê |
| --- | --- |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Alertas automáticos de cada sinal novo |
| `CMC_API_KEY` | Usar CoinMarketCap em vez do CoinGecko para o ranking |
| `EXCHANGES` | `binance,bybit` (padrão). O par precisa existir em todas as listadas |
| `MARKET_MODE` | `spot` (padrão) ou `futures` |
| `SCAN_INTERVAL_MINUTES` | Intervalo da varredura (padrão 5) |

## Backtest

```bash
npm run backtest -- --tf 1h --top 30 --bars 2000
```

Roda o motor no histórico real com taxa e derrapagem. Resultado passado não garante resultado futuro.

## Testes

```bash
npm test
npm run lint
```

> Sinais técnicos automáticos não são recomendação de investimento. O app não envia ordens reais: toda operação é simulada.
