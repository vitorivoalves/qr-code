import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { isAuthorized, safeEqual, validateLink } from '../src/worker.js';

const TOKEN = 'token-de-teste-123456';

// D1 falso, só o suficiente para as consultas do Worker
function fakeEnv() {
  const links = new Map();
  const scans = [];
  const db = {
    prepare(sql) {
      let args = [];
      const stmt = {
        bind(...a) { args = a; return stmt; },
        async first() {
          if (sql.startsWith('SELECT 1 FROM links')) return links.has(args[0]) ? { 1: 1 } : null;
          if (sql.startsWith('SELECT destination')) {
            const l = links.get(args[0]);
            return l && l.active ? { destination: l.destination } : null;
          }
          throw new Error('first: SQL não previsto: ' + sql);
        },
        async all() {
          if (sql.includes('FROM links l')) {
            const results = [...links.values()].map((l) => ({
              ...l, scans: scans.filter((s) => s === l.slug).length,
            }));
            return { results };
          }
          throw new Error('all: SQL não previsto: ' + sql);
        },
        async run() {
          if (sql.startsWith('INSERT INTO links')) {
            const [slug, destination, label, vertical] = args;
            links.set(slug, { slug, destination, label, vertical, active: 1, created_at: 'now' });
          } else if (sql.startsWith('INSERT INTO scans')) {
            scans.push(args[0]);
          } else if (sql.startsWith('UPDATE links SET')) {
            const slug = args.at(-1);
            const cols = sql.match(/SET (.+) WHERE/)[1].split(', ').map((c) => c.replace(' = ?', ''));
            Object.assign(links.get(slug), Object.fromEntries(cols.map((c, i) => [c, args[i]])));
          } else throw new Error('run: SQL não previsto: ' + sql);
          return { success: true };
        },
      };
      return stmt;
    },
  };
  return { DB: db, ADMIN_TOKEN: TOKEN, ASSETS: { fetch: async () => new Response('asset') }, _links: links, _scans: scans };
}

const ctx = () => { const p = []; return { waitUntil: (x) => p.push(x), done: () => Promise.all(p) }; };
const call = (env, path, { method = 'GET', body, token = TOKEN } = {}) =>
  worker.fetch(new Request('https://x.test' + path, {
    method,
    headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }), env, ctx());

test('autenticação: sem token, token errado e token não configurado', async () => {
  const env = fakeEnv();
  assert.equal((await call(env, '/api/links', { token: null })).status, 401);
  assert.equal((await call(env, '/api/links', { token: 'errado' })).status, 401);
  assert.equal((await call({ ...env, ADMIN_TOKEN: undefined }, '/api/links', { token: 'qualquer' })).status, 401);
  assert.equal((await call({ ...env, ADMIN_TOKEN: 'curto' }, '/api/links', { token: 'curto' })).status, 401);
  assert.equal((await call(env, '/api/links')).status, 200);
});

test('safeEqual', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
});

test('criar, listar, editar e desativar um link', async () => {
  const env = fakeEnv();

  let r = await call(env, '/api/links', { method: 'POST', body: { slug: 'Padaria-Joao', destination: 'https://exemplo.com/a', label: 'Padaria do João', vertical: 'restaurante' } });
  assert.equal(r.status, 201);

  r = await call(env, '/api/links', { method: 'POST', body: { slug: 'padaria-joao', destination: 'https://exemplo.com/b' } });
  assert.equal(r.status, 409);

  r = await call(env, '/api/links/padaria-joao', { method: 'PATCH', body: { destination: 'https://exemplo.com/novo' } });
  assert.equal(r.status, 200);
  assert.equal(env._links.get('padaria-joao').destination, 'https://exemplo.com/novo');

  // redireciona e conta o scan
  const c = ctx();
  const red = await worker.fetch(new Request('https://x.test/r/padaria-joao'), env, c);
  await c.done();
  assert.equal(red.status, 302);
  assert.equal(red.headers.get('location'), 'https://exemplo.com/novo');
  assert.equal(env._scans.length, 1);

  r = await call(env, '/api/links');
  const { links } = await r.json();
  assert.equal(links.length, 1);
  assert.equal(links[0].scans, 1);

  // desativado => 404 no QR
  await call(env, '/api/links/padaria-joao', { method: 'PATCH', body: { active: false } });
  const off = await worker.fetch(new Request('https://x.test/r/padaria-joao'), env, ctx());
  assert.equal(off.status, 404);
});

test('validação rejeita entradas ruins', async () => {
  const env = fakeEnv();
  const bad = [
    { slug: 'com espaço', destination: 'https://a.com' },
    { slug: 'ok', destination: 'javascript:alert(1)' },
    { slug: 'ok', destination: 'https://a.com', vertical: 'padaria' },
    { slug: 'ok', destination: 'https://a.com', label: 'x'.repeat(101) },
  ];
  for (const body of bad) {
    assert.equal((await call(env, '/api/links', { method: 'POST', body })).status, 400, JSON.stringify(body));
  }
  assert.equal(env._links.size, 0);
});

test('PATCH não troca o código nem aceita colunas arbitrárias', async () => {
  const env = fakeEnv();
  await call(env, '/api/links', { method: 'POST', body: { slug: 'a', destination: 'https://a.com' } });
  await call(env, '/api/links/a', { method: 'PATCH', body: { slug: 'b', 'destination = 1; --': 'x', label: 'Novo' } });
  assert.equal(env._links.has('b'), false);
  assert.equal(env._links.get('a').label, 'Novo');
  const { value } = validateLink({ 'destination = 1; --': 'x', label: 'ok' }, { partial: true });
  assert.deepEqual(Object.keys(value), ['label']);
});

test('PATCH em link inexistente e método não permitido', async () => {
  const env = fakeEnv();
  assert.equal((await call(env, '/api/links/nao-existe', { method: 'PATCH', body: { label: 'x' } })).status, 404);
  assert.equal((await call(env, '/api/links/nao-existe', { method: 'DELETE' })).status, 405);
});

test('isAuthorized exige o prefixo Bearer', () => {
  const env = { ADMIN_TOKEN: TOKEN };
  assert.equal(isAuthorized(new Request('https://x', { headers: { authorization: TOKEN } }), env), false);
  assert.equal(isAuthorized(new Request('https://x', { headers: { authorization: 'Bearer ' + TOKEN } }), env), true);
});
