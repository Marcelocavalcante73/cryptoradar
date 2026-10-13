# CryptoRadar

Sinais de compra e venda das 100 maiores criptomoedas (por valor de mercado) que existem na **Binance** (spot e futuros; a Bybit fica para depois), com carteira simulada e histórico das simulações.

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

O app tem dois modos, escolhidos no seletor **Spot | Futuros** (cada um com seus sinais, sua carteira simulada e seu histórico):

- **Spot**: só compras. “Vender (sair)” significa sair de uma posição que você já tem.
- **Futuros** (perpétuos USDT-M): sinais de **Long** e **Short**, com alavancagem, margem isolada, preço de liquidação e alavancagem segura para cada stop. O universo é o top 100 ∩ perpétuos da Binance (moedas como PEPE aparecem como `1000PEPE`).

## Variáveis (.env)

| Variável | Para quê |
| --- | --- |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Alertas automáticos de cada sinal novo |
| `CMC_API_KEY` | Usar CoinMarketCap em vez do CoinGecko para o ranking |
| `EXCHANGES` | `binance` (padrão). `binance,bybit` exige o par nas duas corretoras (Bybit ainda não é suportada de ponta a ponta) |
| `FUTURES_ENABLED` | `true` (padrão). Use `false` para desligar o scanner de futuros |
| `SCAN_INTERVAL_MINUTES` | Intervalo da varredura (padrão 5) |

## Backtest

No app: **Ajustes → Abrir backtest**. Escolha mercado, tempo de vela e quantidade de moedas; o servidor roda em segundo plano e mostra o veredito contra os critérios (100+ operações, fator de lucro 1,3+, média positiva e as duas metades do período com fator 1,0+). Também por linha de comando:

```bash
npm run backtest -- --tf 1h --top 30 --bars 2000                 # spot (só compras)
npm run backtest -- --tf 1h --top 30 --bars 2000 --market futures  # futuros (long e short, com funding)
```

Roda o motor no histórico real com taxa e derrapagem. Resultado passado não garante resultado futuro.

## Antes de usar dinheiro real

Leia o [plano de validação](docs/PLANO-DE-VALIDACAO.md). Em Sinais → *Desempenho dos sinais* há um semáforo que mostra, com base nos seus sinais reais, se os critérios mínimos já foram atingidos. O app não envia ordens: você opera na corretora e, em Ajustes → *Capital real*, informa seu capital para ver o tamanho sugerido em cada sinal de compra.

## Testes

```bash
npm test
npm run lint
```

> Sinais técnicos automáticos não são recomendação de investimento. O app não envia ordens reais: toda operação é simulada.
