# Plano: tela de ações da B3 (rascunho, nada implementado)

## Escopo do MVP
- Terceiro mercado `stocks` ao lado de `spot` e `futures`.
- Universo: Ibovespa (ou as ~50 mais líquidas), só compra/venda, sem alavancagem.
- Timeframes diário e 1h; mesmo motor de sinais, mesmo gráfico (lightweight-charts) com Entrada/Alvo/Stop.

## Fonte de dados (a confirmar preço/limites atuais)
- brapi.dev (token, plano grátis, atraso ~15 min): primeira escolha.
- Yahoo Finance `.SA`: não oficial, sem licença comercial; só uso pessoal.
- B3/UP2DATA ou vendor licenciado: só se o app virar produto.

## Reaproveitável
`indicators.ts`, `signalEngine.ts`, `backtest.ts`, `TvChart.tsx`, carteira simulada, tela de sinais.

## Novo
- Módulo de dados da B3 (`server/b3.ts`) com cache e limite de requisições.
- Calendário de pregão (10h–17h, feriados) e fuso America/Sao_Paulo no gráfico.
- Lote de 100, moeda R$, custos (corretagem/emolumentos), ajuste por proventos e desdobramentos.
- `MarketType` ganha `'stocks'`; scanner próprio sem varredura 24h.

## Etapas sugeridas
1. Dados + universo + gráfico (somente leitura).
2. Sinais e backtest.
3. Carteira simulada e alertas.
