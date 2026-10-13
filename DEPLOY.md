# Publicar o CryptoRadar para rodar igual em qualquer lugar

O app roda em qualquer hospedagem que execute Node 22 ou Docker. Para ele se comportar igual em todas (e a carteira e o
histórico aparecerem iguais em todo aparelho), três coisas precisam estar certas:

1. **Armazenamento que sobrevive** (Supabase): a carteira simulada, o histórico e os sinais ficam no servidor, não no navegador.
2. **Região do servidor fora dos EUA**: a Binance e a Bybit bloqueiam IPs de lá (erros 451/403).
3. **Chave de acesso**: sem ela, qualquer pessoa com o link vê e altera a sua carteira.

Depois de publicar, abra **Ajustes → Armazenamento e diagnóstico → Verificar agora**: o app testa tudo de dentro do servidor
(armazenamento, Binance, Bybit, OKX, CoinGecko, scanners) e diz o que está errado e como corrigir.

## 1. Supabase (grátis)

1. Crie um projeto em supabase.com.
2. Em **SQL Editor**, rode o conteúdo de [`supabase/schema.sql`](supabase/schema.sql) (cria a tabela `app_state`, com acesso só pelo servidor).
3. Em **Project Settings → API**, copie a **Project URL** e a chave **service_role**.

A chave `service_role` dá acesso total ao banco: coloque-a **só** nas variáveis do servidor, nunca no código nem no navegador.

## 2. Variáveis de ambiente (no painel da hospedagem, não no código)

| Variável | Para quê |
| --- | --- |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Armazenamento persistente. Sem elas o servidor usa arquivo em disco, que some ao reiniciar em hospedagens gratuitas |
| `APP_ACCESS_KEY` | Chave de acesso (escolha uma longa). O app pede a chave ao abrir |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Alertas no Telegram (opcional) |
| `NODE_ENV=production` | Serve o app já compilado (o Dockerfile e o `render.yaml` já definem) |
| `CMC_API_KEY` | Ranking pela CoinMarketCap em vez do CoinGecko (opcional) |

Para **ver a mesma carteira em todos os lugares**, todas as hospedagens precisam usar o **mesmo** projeto do Supabase e a mesma `APP_ACCESS_KEY`.

## 3. Hospedagem

### Render
1. **New → Blueprint** apontando para este repositório (usa o [`render.yaml`](render.yaml): Docker, região **Frankfurt**).
2. Preencha as variáveis da tabela acima.
3. O plano gratuito dorme após ~15 min sem acesso. Para mantê-lo acordado, use um monitor gratuito (ex.: cron-job.org) chamando `https://SEU-APP.onrender.com/api/storage` a cada 5 minutos.

### AI Studio (publicar) / Google Cloud Run
- Defina as variáveis da tabela como **secrets/variáveis de ambiente** da publicação.
- Cloud Run só dá processador ao servidor **enquanto há uma requisição aberta**. O app já lida com isso (mantém a conexão aberta durante as varreduras e carrega o último resultado salvo ao ligar), mas, se a opção existir, escolha **processador sempre alocado** e **1 instância no máximo**, para os alertas do Telegram não saírem duplicados.
- Sem Supabase, a instância reinicia e o histórico se perde. Com Supabase isso não acontece.
- A região padrão costuma ser dos EUA. Se o diagnóstico mostrar a Binance/Bybit bloqueadas, escolha uma região da Europa ou da Ásia (ex.: `europe-west1`, `asia-southeast1`).

### Docker (VPS, Railway, Fly.io etc.)
```bash
docker build -t cryptoradar .
docker run -p 3000:3000 --env-file .env cryptoradar
```
Em um servidor próprio com disco persistente, defina `PERSISTENT_DISK=true` para o app tratar o arquivo como definitivo (mesmo assim o Supabase é mais seguro).

## 4. Como o app se comporta

- **Abrir o app:** carrega a carteira, o histórico e os ajustes do servidor. Se o aparelho tiver uma cópia mais nova (ex.: você simulou sem conexão), ela é enviada; vale sempre a **mais nova**.
- **Navegador bloqueando o armazenamento** (comum em quadros/iframes como a pré-visualização do AI Studio): o app usa o servidor e avisa. Antes ele perdia tudo em silêncio.
- **Sem conexão com o servidor:** continua funcionando, avisa "salvo só neste aparelho" e tenta de novo a cada 15 s.
- **Servidor reiniciado:** carrega o último resultado salvo dos scanners e responde na hora, sem esperar uma varredura.
- **Dados antigos de outro aparelho nunca apagam os novos:** o servidor recusa gravações mais velhas que a que já tem.
