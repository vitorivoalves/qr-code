import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWifiString, buildLinkUrl, escapeWifi } from '../public/wifi.js';
import { parseSlug, isSafeDestination } from '../src/worker.js';

test('Wi-Fi WPA simples', () => {
  assert.equal(
    buildWifiString({ ssid: 'HomeNet', password: 'latte2026' }),
    'WIFI:T:WPA;S:HomeNet;P:latte2026;H:false;;'
  );
});

test('Wi-Fi com caracteres especiais é escapado', () => {
  assert.equal(escapeWifi('a;b:c,d"e\\f'), 'a\\;b\\:c\\,d\\"e\\\\f');
  assert.equal(
    buildWifiString({ ssid: "Joe;s Cafe", password: 'p:w' }),
    'WIFI:T:WPA;S:Joe\\;s Cafe;P:p\\:w;H:false;;'
  );
});

test('Wi-Fi aberto não leva senha', () => {
  assert.equal(
    buildWifiString({ ssid: 'Visitantes', security: 'nopass' }),
    'WIFI:T:nopass;S:Visitantes;H:false;;'
  );
});

test('Wi-Fi oculto', () => {
  assert.match(buildWifiString({ ssid: 'X', password: 'y', hidden: true }), /H:true;;$/);
});

test('Wi-Fi valida entradas', () => {
  assert.throws(() => buildWifiString({ ssid: '', password: 'x' }));
  assert.throws(() => buildWifiString({ ssid: 'X' }));
  assert.throws(() => buildWifiString({ ssid: 'X', password: 'y', security: 'abc' }));
});

test('URL do link dinâmico', () => {
  assert.equal(buildLinkUrl('https://meusite.com.br/', 'Padaria-Joao'), 'https://meusite.com.br/r/padaria-joao');
  assert.throws(() => buildLinkUrl('meusite.com.br', 'a'));
  assert.throws(() => buildLinkUrl('https://x.com', 'com espaço'));
});

test('Worker: slug e destino', () => {
  assert.equal(parseSlug('/r/Padaria-Joao'), 'padaria-joao');
  assert.equal(parseSlug('/r/padaria/'), 'padaria');
  assert.equal(parseSlug('/r/a/b'), null);
  assert.equal(parseSlug('/outra'), null);
  assert.equal(isSafeDestination('https://exemplo.com/x'), true);
  assert.equal(isSafeDestination('javascript:alert(1)'), false);
  assert.equal(isSafeDestination('nao-e-url'), false);
});
