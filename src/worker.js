// QR dinâmico + painel simples.
//   /r/<slug>        -> 302 para o destino cadastrado (público)
//   /api/links...    -> API do painel (exige Authorization: Bearer <ADMIN_TOKEN>)
//   demais rotas     -> arquivos de /public (inclui /admin.html)
// Registra só slug e horário de cada scan (sem IP).

const SLUG_RE = /^[a-z0-9-]{1,64}$/;
const VERTICALS = ['restaurante', 'hospedagem'];

export function parseSlug(pathname) {
  const m = pathname.match(/^\/r\/([a-z0-9-]{1,64})\/?$/i);
  return m ? m[1].toLowerCase() : null;
}

export function isSafeDestination(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

// Comparação sem atalho de saída antecipada
export function safeEqual(a, b) {
  const x = new TextEncoder().encode(String(a));
  const y = new TextEncoder().encode(String(b));
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export function isAuthorized(req, env) {
  // sem ADMIN_TOKEN configurado, o painel fica fechado
  if (!env.ADMIN_TOKEN || String(env.ADMIN_TOKEN).length < 12) return false;
  const header = req.headers.get('authorization') || '';
  const m = header.match(/^Bearer (.+)$/);
  return !!m && safeEqual(m[1], env.ADMIN_TOKEN);
}

export function validateLink(input, { partial = false } = {}) {
  const out = {};
  const errors = [];

  if (!partial || 'slug' in input) {
    const slug = String(input.slug ?? '').trim().toLowerCase();
    if (!SLUG_RE.test(slug)) errors.push('Código inválido: use letras, números e hífen (até 64).');
    out.slug = slug;
  }
  if (!partial || 'destination' in input) {
    const dest = String(input.destination ?? '').trim();
    if (!isSafeDestination(dest)) errors.push('Destino inválido: use um endereço http(s).');
    out.destination = dest;
  }
  if ('label' in input) {
    const label = String(input.label ?? '').trim();
    if (label.length > 100) errors.push('Nome muito longo (máx. 100).');
    out.label = label || null;
  }
  if ('vertical' in input) {
    const v = input.vertical || null;
    if (v !== null && !VERTICALS.includes(v)) errors.push('Tipo de negócio inválido.');
    out.vertical = v;
  }
  if ('active' in input) {
    out.active = input.active ? 1 : 0;
  }
  return { value: out, errors };
}

async function readBody(req) {
  try {
    const body = await req.json();
    return body && typeof body === 'object' ? body : {};
  } catch {
    return null;
  }
}

export async function handleApi(req, env, url) {
  if (!isAuthorized(req, env)) return json({ error: 'Não autorizado.' }, 401);

  const m = url.pathname.match(/^\/api\/links(?:\/([a-z0-9-]{1,64}))?$/i);
  if (!m) return json({ error: 'Rota não encontrada.' }, 404);
  const slug = m[1] ? m[1].toLowerCase() : null;

  // Listar
  if (!slug && req.method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT l.slug, l.destination, l.label, l.vertical, l.active, l.created_at,
              (SELECT COUNT(*) FROM scans s WHERE s.slug = l.slug) AS scans
         FROM links l ORDER BY l.created_at DESC, l.slug`
    ).all();
    return json({ links: results });
  }

  // Criar
  if (!slug && req.method === 'POST') {
    const body = await readBody(req);
    if (!body) return json({ error: 'JSON inválido.' }, 400);
    const { value, errors } = validateLink(body);
    if (errors.length) return json({ error: errors.join(' ') }, 400);

    const exists = await env.DB.prepare('SELECT 1 FROM links WHERE slug = ?').bind(value.slug).first();
    if (exists) return json({ error: 'Já existe um link com esse código.' }, 409);

    await env.DB.prepare(
      'INSERT INTO links (slug, destination, label, vertical) VALUES (?, ?, ?, ?)'
    ).bind(value.slug, value.destination, value.label ?? null, value.vertical ?? null).run();
    return json({ ok: true, slug: value.slug }, 201);
  }

  // Editar (sem exclusão: desative o link em vez de apagar, para não "matar" um QR já impresso por engano)
  if (slug && req.method === 'PATCH') {
    const body = await readBody(req);
    if (!body) return json({ error: 'JSON inválido.' }, 400);
    delete body.slug; // o código é o que está impresso no QR; não muda
    const { value, errors } = validateLink(body, { partial: true });
    if (errors.length) return json({ error: errors.join(' ') }, 400);

    const fields = Object.keys(value);
    if (!fields.length) return json({ error: 'Nada para atualizar.' }, 400);

    const exists = await env.DB.prepare('SELECT 1 FROM links WHERE slug = ?').bind(slug).first();
    if (!exists) return json({ error: 'Link não encontrado.' }, 404);

    // nomes de coluna vêm de uma lista fechada (validateLink), nunca da requisição
    const set = fields.map((f) => `${f} = ?`).join(', ');
    await env.DB.prepare(`UPDATE links SET ${set} WHERE slug = ?`)
      .bind(...fields.map((f) => value[f]), slug)
      .run();
    return json({ ok: true });
  }

  return json({ error: 'Método não permitido.' }, 405);
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    if (url.pathname.startsWith('/api/')) {
      return handleApi(req, env, url);
    }

    const slug = parseSlug(url.pathname);
    if (slug) {
      const row = await env.DB
        .prepare('SELECT destination FROM links WHERE slug = ? AND active = 1')
        .bind(slug)
        .first();

      if (!row || !isSafeDestination(row.destination)) {
        return new Response('Link não encontrado', {
          status: 404,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        });
      }

      // não atrasa o redirecionamento por causa do registro do scan
      ctx.waitUntil(
        env.DB.prepare('INSERT INTO scans (slug) VALUES (?)').bind(slug).run()
      );

      // 302 (não 301): o navegador não guarda em cache, então trocar o destino funciona
      return new Response(null, {
        status: 302,
        headers: { location: row.destination, 'cache-control': 'no-store' },
      });
    }

    return env.ASSETS.fetch(req);
  },
};
