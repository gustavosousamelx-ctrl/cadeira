// Prévia de compartilhamento, dados estruturados, app instalável, robots, cabeçalhos de segurança e compressão.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { openDb, type Db } from '../src/db/db.ts';
import { createApp } from '../src/app.ts';
import { clock, resetRateLimits } from '../src/lib/core.ts';
import { http, NOW } from './helpers.ts';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'public');

describe('extras', () => {
  let db: Db, app: ReturnType<typeof createApp>, H: ReturnType<typeof http>, A: any;
  before(async () => {
    clock.now = () => NOW; resetRateLimits();
    db = await openDb(); app = createApp(db, { billing: null, publicHost: 'cadeira.exemplo.com', secureCookies: true });
    H = http(app); A = await H.signupShop('vitrine');
    await H.req('/app/s/vitrine/pagina/publicar', { cookie: A.cookie, form: {} });
  });
  after(() => db.close());

  test('página pública: prévia (Open Graph), endereço canônico e schema.org sem brecha de script', async () => {
    await db.system((q) => q.exec(`update shops set name = 'Corte </script><script>alert(1)</script>', phone = '11988887777' where slug = 'vitrine'`));
    const r = await H.req('/b/vitrine');
    assert.equal(r.status, 200);
    assert.match(r.text, /<meta property="og:url" content="https:\/\/cadeira\.exemplo\.com\/b\/vitrine">/);
    assert.match(r.text, /<link rel="canonical" href="https:\/\/cadeira\.exemplo\.com\/b\/vitrine">/);
    const ld = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(r.text)!;
    assert.ok(ld, 'tem JSON-LD');
    assert.ok(!r.text.includes('<script>alert(1)'), 'nome com </script> não injeta código');
    const data = JSON.parse(ld[1]);
    assert.equal(data['@type'], 'HairSalon'); assert.equal(data.telephone, '+5511988887777');
    assert.ok(data.openingHoursSpecification.some((h: any) => h.dayOfWeek === 'Tuesday' && h.opens === '09:00' && h.closes === '19:00'));
  });

  test('link de reserva não é indexado; robots.txt tira painel e links secretos da busca', async () => {
    const robots = await H.req('/robots.txt');
    assert.match(robots.text, /Disallow: \/app\//); assert.match(robots.text, /Disallow: \/b\/\*\/reserva\//); assert.match(robots.text, /Disallow: \/redefinir\//);
    assert.doesNotMatch(robots.text, /Disallow: \/b\/\n/);
    const page = await H.req('/b/vitrine/reserva/' + 'x'.repeat(32));
    assert.equal(page.status, 404);
  });

  test('painel instalável: manifesto válido e ícones existentes', async () => {
    const r = await H.req('/manifest.webmanifest');
    assert.equal(r.res.headers.get('content-type'), 'application/manifest+json');
    const m = JSON.parse(r.text);
    assert.equal(m.display, 'standalone'); assert.equal(m.start_url, '/app');
    for (const i of m.icons) assert.ok(existsSync(join(PUBLIC, i.src.replace('/static/', ''))), i.src);
    assert.ok(m.icons.some((i: any) => i.sizes === '192x192') && m.icons.some((i: any) => i.sizes === '512x512') && m.icons.some((i: any) => i.purpose === 'maskable'));
    const home = await H.req('/');
    assert.match(home.text, /<link rel="manifest" href="\/manifest.webmanifest">/);
    assert.ok(existsSync(join(PUBLIC, 'img', 'apple-touch-icon.png')));
  });

  test('cabeçalhos de segurança e HSTS em produção; HTML comprimido', async () => {
    const r = await H.req('/');
    assert.equal(r.res.headers.get('strict-transport-security'), 'max-age=31536000');
    assert.match(r.res.headers.get('permissions-policy')!, /camera=\(\)/);
    assert.equal(r.res.headers.get('cross-origin-opener-policy'), 'same-origin');
    assert.match(r.res.headers.get('content-security-policy')!, /form-action 'self' https:\/\/wa\.me https:\/\/api\.whatsapp\.com/);
    const z = await app.request('/', { headers: { host: 'localhost', 'accept-encoding': 'gzip' } });
    assert.equal(z.headers.get('content-encoding'), 'gzip');
    assert.match(gunzipSync(Buffer.from(await z.arrayBuffer())).toString(), /<!doctype html>/);
    // fora de produção não manda HSTS (localhost sem HTTPS)
    const dev = await http(createApp(db, { billing: null })).req('/');
    assert.equal(dev.res.headers.get('strict-transport-security'), null);
  });
});
