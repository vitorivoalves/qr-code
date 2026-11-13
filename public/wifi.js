// Monta o texto do QR de Wi-Fi no formato do projeto ZXing:
// WIFI:T:<WPA|WEP|nopass>;S:<ssid>;P:<senha>;H:<true|false>;;
// Fonte do formato: https://github.com/zxing/zxing/wiki/Barcode-Contents

// Caracteres que precisam de barra invertida dentro de S e P
export function escapeWifi(value) {
  return String(value).replace(/([\\;,:"])/g, '\\$1');
}

export function buildWifiString({ ssid, password = '', security = 'WPA', hidden = false }) {
  if (!ssid || !String(ssid).trim()) {
    throw new Error('Informe o nome da rede (SSID).');
  }
  if (!['WPA', 'WEP', 'nopass'].includes(security)) {
    throw new Error('Tipo de segurança inválido.');
  }
  if (security !== 'nopass' && !password) {
    throw new Error('Informe a senha ou escolha "Sem senha".');
  }

  const parts = [`T:${security}`, `S:${escapeWifi(ssid)}`];
  if (security !== 'nopass') parts.push(`P:${escapeWifi(password)}`);
  parts.push(`H:${hidden ? 'true' : 'false'}`);
  return `WIFI:${parts.join(';')};;`;
}

export function buildLinkUrl(baseUrl, slug) {
  const clean = String(slug || '').trim().toLowerCase();
  if (!/^[a-z0-9-]{1,64}$/.test(clean)) {
    throw new Error('O código do link aceita letras, números e hífen (até 64).');
  }
  const base = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) {
    throw new Error('Informe o endereço do site começando com https://');
  }
  return `${base}/r/${clean}`;
}
