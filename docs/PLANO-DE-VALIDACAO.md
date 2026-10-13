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

### Resultado do primeiro backtest (estratégia de sinais por indicadores)

Spot, 30 moedas em 1h (470 operações): fator de lucro 0,87. Spot, 50 moedas em 4h (633 operações): fator de lucro 0,76, com as duas metades do período perdendo. A taxa de acerto (32% a 34%) ficou abaixo do ponto de empate do alvo de 2 para 1, ou seja, os sinais não tinham vantagem sobre o acaso. Conclusão: não seguir para a simulação ao vivo com essa estratégia nem ajustar parâmetros em cima dela.

### Estratégia alternativa: rompimento de 55 dias (tendência)

Testada no app (Backtest → "Rompimento de 55 dias") ou por `npm run backtest -- --strategy trend --top 50 --bars 1500`. As regras foram **fixadas antes de ver o resultado** e não devem ser ajustadas depois para "passar": entrada no rompimento da máxima de 55 dias com o Bitcoin acima da média de 200 dias, stop de 2 ATR, saída quando perde a mínima de 20 dias, sem alvo fixo, velas diárias, só compras. Os mesmos critérios valem (100+ operações, fator 1,3+, média positiva e as duas metades do período com fator 1,0+). Se reprovar, a conclusão é abandonar a ideia, não variar números.

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

## Futuros: validação separada e mais exigente

Futuros **não herdam** a validação do spot: têm short, alavancagem e liquidação. Cada modo tem seu próprio semáforo (o do modo Futuros só conta sinais de futuros). Siga as mesmas fases, com estas diferenças:

- **Backtest:** `npm run backtest -- --tf 1h --top 30 --bars 3000 --market futures` (inclui long, short e um funding conservador de 0,01% por 8h).
- **Alavancagem:** comece com **2x ou 3x**. O app mostra a "alavancagem segura" de cada sinal (a liquidação fica pelo menos o dobro da distância do stop). Nunca passe dela.
- **O stop tem de vir antes da liquidação.** O simulador recusa a ordem se não vier. Na corretora, use **margem isolada** e coloque o stop na hora da abertura.
- **Limites mais curtos:** pare por 1 dia se perder 2% do capital no dia e por 1 semana se perder 5% na semana.
- **Quanto você arrisca vem do stop, não da alavancagem.** Alavancagem maior só deixa a liquidação mais perto: o stop pode nem ser executado em um movimento brusco (gap, pavio).

O que a simulação de futuros **não** captura (o real tende a ser pior):

- o stop é "executado" exatamente no preço do stop, sem derrapagem;
- o preço é checado só a cada atualização (30 s por padrão), então um pavio rápido que tocaria stop ou liquidação pode passar despercebido;
- não há funding nas posições simuladas (só no backtest);
- a liquidação é uma aproximação (0,5% de manutenção): a da corretora pode ser diferente, principalmente em posições grandes.

Operar futuros com dinheiro real só depois de o semáforo **de futuros** ficar verde, com a mesma regra: valor pequeno, que você aceite perder por inteiro.

## Spot: como ler "Vender"

Em spot, "Vender (sair)" só vale se você **já tem** a moeda. Não é para abrir operação. Para operar vendido, use o modo Futuros (seção acima), que tem validação própria.

## Quando reavaliar

Refaça o ciclo (backtest + simulação) sempre que mudar a estratégia ou os parâmetros. Resultado antigo não vale para regra nova.
