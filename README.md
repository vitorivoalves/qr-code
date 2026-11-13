# qr-code (preview)

QR codes para negócios locais (hospedagem e restaurantes), rodando em Cloudflare Workers + D1 no plano gratuito.

- **QR de Wi-Fi:** gerado inteiramente no navegador (a senha não vai ao servidor), com botão de placa A5 para imprimir.
- **QR de link editável:** o QR aponta para `https://seudominio/r/<slug>`; o Worker consulta o destino no banco, registra o scan (só slug e horário, sem IP) e redireciona com `302`. Trocar o destino não exige reimprimir.

Este é um preview para avaliação: não há painel nem login nem cobrança. Links são criados por comando.

## Estado

| Peça | Estado |
| --- | --- |
| Gerador de Wi-Fi + placa A5 (`public/`) | Testado no navegador; o QR gerado foi decodificado e confere com o texto esperado |
| Formato e escape do Wi-Fi, validação de links (`public/wifi.js`) | 7 testes unitários passando (`npm test`) |
| Redirecionador (`src/worker.js`) | Lógica de rota e validação testada; **não foi executado contra o D1 nem implantado** |
| Painel, login, cobrança, nota fiscal | Não existem (próxima fase, só depois da validação com clientes) |

## Como rodar

```bash
npm install
npx wrangler login
npx wrangler d1 create qr-db          # copie o database_id para wrangler.toml
npm run db:init                       # cria as tabelas no banco remoto
npm run dev                           # teste local
npm run deploy                        # publica
```

Criar e editar links (sem painel):

```bash
npx wrangler d1 execute qr-db --remote --command \
  "INSERT INTO links (slug, destination, label, vertical) VALUES ('padaria-joao', 'https://exemplo.com/cardapio', 'Padaria do João', 'restaurante')"

npx wrangler d1 execute qr-db --remote --command \
  "UPDATE links SET destination = 'https://exemplo.com/novo' WHERE slug = 'padaria-joao'"

npx wrangler d1 execute qr-db --remote --command \
  "SELECT slug, COUNT(*) AS scans FROM scans GROUP BY slug"
```

Depois use a aba "Link editável" da página para gerar o QR do endereço `https://seudominio/r/padaria-joao`.

## Limites do plano gratuito da Cloudflare (em 13/11/2026)

100.000 requisições por dia no Worker e, no D1, 100.000 linhas escritas por dia (cada scan com o índice conta 2). Passando disso, as operações falham até 00:00 UTC. Fonte: [Cloudflare, Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/).

## Créditos

QR gerado com [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) 2.0.4 (MIT), incluído em `public/vendor/`.
