# qr-code (preview)

QR codes para negócios locais (hospedagem e restaurantes), rodando em Cloudflare Workers + D1 no plano gratuito.

- **QR de Wi-Fi:** gerado inteiramente no navegador (a senha não vai ao servidor), com botão de placa A5 para imprimir.
- **QR de link editável:** o QR aponta para `https://seudominio/r/<slug>`; o Worker consulta o destino no banco, registra o scan (só slug e horário, sem IP) e redireciona com `302`. Trocar o destino não exige reimprimir.

Este é um preview para avaliação. Há um painel simples em `/admin` para criar e editar links, protegido por um token. Ainda não há cobrança nem contas de clientes.

## Estado

| Peça | Estado |
| --- | --- |
| Gerador de Wi-Fi + placa A5 (`public/`) | Testado no navegador; o QR gerado foi decodificado e confere com o texto esperado |
| Formato e escape do Wi-Fi, validação de links (`public/wifi.js`) | 7 testes unitários passando (`npm test`) |
| Redirecionador e API do painel (`src/worker.js`) | 14 testes unitários (`npm test`) e teste de ponta a ponta com `wrangler dev` e D1 local: criar, editar, desativar, contar scans, 401 sem token. **Não foi implantado na Cloudflare** |
| Painel `/admin` (`public/admin.html`) | Testado no navegador contra o `wrangler dev`: login, criar, salvar, baixar QR |
| Cobrança, contas de clientes, nota fiscal | Não existem (próxima fase, só depois da validação com clientes) |

## Como rodar

```bash
npm install
npx wrangler login
npx wrangler d1 create qr-db          # copie o database_id para wrangler.toml
npm run db:init                       # cria as tabelas no banco remoto
npx wrangler secret put ADMIN_TOKEN   # token do painel (mín. 12 caracteres; use um valor longo e aleatório)
npm run deploy                        # publica
```

Teste local: crie um arquivo `.dev.vars` com `ADMIN_TOKEN=um-token-de-teste-123`, rode `npm run db:init:local` e depois `npm run dev`.

## Preview no GitHub Pages

O workflow `.github/workflows/pages.yml` publica a pasta `public/` (sem o painel) em `https://vitorivoalves.github.io/qr-code/`. No Pages só funciona a parte estática: o gerador de Wi-Fi com a placa A5 e a prévia do QR de link. O painel e o redirecionamento `/r/<slug>` precisam do Worker da Cloudflare e **não funcionam no Pages**.

Para ativar uma vez: no GitHub, Settings > Pages > Source: **GitHub Actions**. Depois, cada push em `main` atualiza o site.

## Painel (`/admin`)

Entre com o token. Você pode criar links, trocar o destino, o nome e o tipo de negócio, desativar/reativar, ver o número de scans e baixar o QR em SVG. O código do link não muda depois de criado (é o que está impresso no QR) e não há botão de excluir, de propósito: desativar é reversível, apagar não.

Segurança: sem `ADMIN_TOKEN` configurado (ou com menos de 12 caracteres), a API recusa tudo. O token fica só na sessão do navegador (`sessionStorage`) e é enviado em cada chamada. É um acesso de um único usuário para a fase de teste; para vários usuários, use contas com login ou o Cloudflare Access.

Alternativa por linha de comando, sem o painel:

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
