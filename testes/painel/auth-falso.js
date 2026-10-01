// Supabase Auth falso, só para os testes locais do painel (token, renovação, usuário, sair, MFA TOTP).
// Uso: TTL=3600 node auth-falso.js   (TTL em segundos; 30 testa a renovação do token)
// Chave pública esperada: anon-teste. Usuários fictícios, senha senha123. Código do autenticador: 123456.
const http = require('http');
const USERS = { 'amanda@teste.local': 'senha123', 'gestor@teste.local': 'senha123', 'planee@teste.local': 'senha123', 'semacesso@teste.local': 'senha123' };
const ids = {}; const refresh = {}; const fatores = {};
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const TTL = Number(process.env.TTL || 3600);
const rnd = () => Math.random().toString(36).slice(2, 10);
function idDe(email) {
  if (!ids[email]) ids[email] = '00000000-0000-4000-b000-' + String(Object.keys(USERS).indexOf(email) + 1).padStart(12, '0');
  return ids[email];
}
// aal1 = só senha; aal2 = senha + código do autenticador (como o Supabase).
function emitir(email, aal = 'aal1') {
  const at = b64({ alg: 'HS256' }) + '.' + b64({ sub: idDe(email), email, aal, exp: Math.floor(Date.now() / 1000) + TTL }) + '.sig';
  const rt = 'rt_' + rnd(); refresh[rt] = { email, aal };
  return { access_token: at, refresh_token: rt, expires_in: TTL, token_type: 'bearer' };
}
function dono(req) {
  const t = (req.headers.authorization || '').replace('Bearer ', '');
  try { const p = JSON.parse(Buffer.from(t.split('.')[1], 'base64url')); if (p.exp > Date.now() / 1000) return p; } catch {}
  return null;
}
http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => body += c); req.on('end', () => {
    const u = new URL(req.url, 'http://x'); const j = (s, o) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.headers.apikey !== 'anon-teste') return j(401, { msg: 'no apikey' });
    const d = (() => { try { return JSON.parse(body || '{}'); } catch { return {}; } })();
    if (u.pathname === '/auth/v1/token') {
      if (u.searchParams.get('grant_type') === 'password') return USERS[d.email] === d.password ? j(200, emitir(d.email)) : j(400, { error: 'invalid_grant' });
      if (u.searchParams.get('grant_type') === 'refresh_token') { const e = refresh[d.refresh_token]; setTimeout(() => delete refresh[d.refresh_token], 10000); /* como o Supabase: reuso por 10 s */ return e ? j(200, emitir(e.email, e.aal)) : j(400, { error: 'invalid_grant' }); }
    }
    if (u.pathname === '/auth/v1/signup') {
      // Primeiro acesso (Supabase com "Confirm email" desligado devolve a sessão; CONFIRMA=1 imita o ligado).
      if (USERS[d.email]) return j(200, { id: 'x', email: d.email }); // Supabase não revela que o e-mail já existe
      USERS[d.email] = d.password;
      return process.env.CONFIRMA === '1' ? j(200, { id: 'novo', email: d.email, confirmation_sent_at: new Date().toISOString() }) : j(200, emitir(d.email));
    }
    const p = dono(req);
    if (u.pathname === '/auth/v1/user') return p ? j(200, { id: p.sub, email: p.email, factors: fatores[p.email] || [] }) : j(401, { msg: 'invalid token' });
    if (u.pathname === '/auth/v1/logout') return j(204, {});
    // MFA (TOTP)
    const m = /^\/auth\/v1\/factors(?:\/([^/]+))?(?:\/(challenge|verify))?$/.exec(u.pathname);
    if (m) {
      if (!p) return j(401, { msg: 'invalid token' });
      const lista = (fatores[p.email] = fatores[p.email] || []);
      const [, id, passo] = m;
      if (!id && req.method === 'POST') {
        const f = { id: 'f_' + rnd(), factor_type: 'totp', status: 'unverified', friendly_name: d.friendly_name };
        lista.push(f);
        return j(200, { id: f.id, type: 'totp', totp: { qr_code: 'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>', secret: 'SEGREDOTESTE', uri: 'otpauth://totp/teste' } });
      }
      const f = lista.find((x) => x.id === id);
      if (!f) return j(404, { msg: 'factor not found' });
      if (!passo && req.method === 'DELETE') { lista.splice(lista.indexOf(f), 1); return j(200, { id }); }
      if (passo === 'challenge') return j(200, { id: 'ch_' + rnd(), type: 'totp' });
      if (passo === 'verify') {
        if (d.code !== '123456' || !d.challenge_id) return j(422, { msg: 'Invalid TOTP code entered' });
        f.status = 'verified';
        return j(200, emitir(p.email, 'aal2'));
      }
    }
    j(404, {});
  });
}).listen(Number(process.env.PORTA || 54321), () => console.log('gotrue falso em 54321'));
