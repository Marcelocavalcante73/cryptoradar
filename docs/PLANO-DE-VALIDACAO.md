# Plano de validação: do simulado ao dinheiro real

Objetivo: só arriscar dinheiro depois de ter números reais mostrando que a estratégia se sustenta. O app **não envia ordens**: você opera na corretora e usa o app como apoio.

> Isto é um roteiro de disciplina, não recomendação de investimento. Cripto pode levar a perda total, e atingir os critérios abaixo **não garante lucro futuro**.

## Fase 0: preparar (1 dia)

1. Rode o app num lugar que fique **ligado 24h** (um servidor ou VPS). O scanner só gera e acompanha sinais enquanto o servidor está no ar; se ele ficar desligado, você perde sinais e o resultado fica enviesado.
2. Configure `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID` para receber cada sinal na hora.
3. Confirme que a pasta `data/` do servidor **não é apagada** a cada reinício (é lá que o histórico de sinais fica).

## Fase 1: backtest (1 dia)

```bash
npm run backtest -- --tf 1h --top 30 --bars 3000
npm run backtest -- --tf 4h --top 30 --bars 3000
```

Passa se, no **agregado** (e nos dois timeframes):

| Critério | Mínimo |
| --- | --- |
| Operações | 100 ou mais |
| Fator de lucro | 1,3 ou mais |
| Expectativa por operação | positiva depois dos custos |
| Drawdown máximo | que você aguentaria ver na vida real |

Se reprovar, **pare e ajuste a estratégia** antes de avançar. Cuidado ao ajustar: não mexa nos parâmetros até o histórico "dar certo", isso só decora o passado. Ajuste e confirme em um período diferente.

## Fase 2: simulação ao vivo, 4 semanas (mínimo)

Regras para a simulação valer:

- Simule **todo sinal de compra**, não só os que "parecem bons". Escolher a dedo invalida o teste.
- Use o tamanho sugerido pelo risco (aba Carteira → Simular).
- Não mude parâmetros no meio do teste.

Acompanhe em **Sinais → Desempenho dos sinais → "Pronto para valor real?"**. O semáforo exige:

- 30 sinais encerrados ou mais
- 28 dias ou mais de acompanhamento
- resultado médio acima de +0,10R por sinal (já com taxas e derrapagem)
- fator de lucro de 1,3 ou mais
- resultado ainda positivo sem os 3 melhores sinais

Se terminar o período e **não passar**, a conclusão é: não operar com dinheiro real com esta estratégia.

## Fase 3: dinheiro real, começando pequeno

Só se o semáforo ficar verde.

1. Em **Ajustes → Capital real**, informe o valor e um risco de **0,5% a 1%** por operação. Cada sinal de compra passa a mostrar quanto comprar.
2. Use um capital que você aceite **perder por inteiro**.
3. **Sempre coloque o stop na corretora** (ordem stop-limit ou OCO) no momento da compra. Não dependa do app aberto nem de ficar olhando a tela.
4. Antes de comprar, confira o preço **na corretora**: o do app pode estar um pouco defasado.
5. Limites para proteger o capital:
   - no máximo 3 posições abertas ao mesmo tempo;
   - se perder 3% do capital no dia, pare até o dia seguinte;
   - se perder 6% na semana, pare até a semana seguinte;
   - 8 stops seguidos ou 10% de perda do capital de teste: **pause e revise tudo**.
6. Registre as operações reais (data, preço de entrada e saída, taxas) e compare com a simulação. Se o real for sistematicamente pior (taxas, derrapagem, atraso), revise os custos.

## Spot: como ler "Vender"

Em spot, "Vender (sair)" só vale se você **já tem** a moeda. Não é para abrir operação. Se quiser operar vendido no futuro, é outra etapa (futuros), com risco bem maior, e precisaria passar por esta mesma validação separadamente.

## Quando reavaliar

Refaça o ciclo (backtest + simulação) sempre que mudar a estratégia ou os parâmetros. Resultado antigo não vale para regra nova.
