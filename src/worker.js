// Redirecionador de QR dinâmico. Rota: /r/<slug> -> 302 para o destino cadastrado.
// Registra só slug e horário (sem IP). Demais rotas servem os arquivos de /public.

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

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
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
