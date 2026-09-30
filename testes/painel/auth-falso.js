// Supabase Auth falso, só para os testes locais do painel (token, renovação, usuário, sair).
// Uso: TTL=3600 node auth-falso.js   (TTL em segundos; 30 testa a renovação do token)
// Chave pública esperada: anon-teste. Usuários fictícios, senha senha123.
const http = require('http');
const USERS = { 'amanda@teste.local': 'senha123', 'gestor@teste.local': 'senha123', 'planee@teste.local': 'senha123', 'semacesso@teste.local': 'senha123' };
const ids = {}; let n = 0; const refresh = {};
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const TTL = Number(process.env.TTL || 3600);
function emitir(email) {
  ids[email] = '00000000-0000-4000-b000-' + String(Object.keys(USERS).indexOf(email) + 1).padStart(12, '0');
  const at = b64({ alg: 'HS256' }) + '.' + b64({ sub: ids[email], email, exp: Math.floor(Date.now() / 1000) + TTL }) + '.sig';
  const rt = 'rt_' + Math.random().toString(36).slice(2); refresh[rt] = email;
  return { access_token: at, refresh_token: rt, expires_in: TTL, token_type: 'bearer' };
}
http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => body += c); req.on('end', () => {
    const u = new URL(req.url, 'http://x'); const j = (s, o) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.headers.apikey !== 'anon-teste') return j(401, { msg: 'no apikey' });
    if (u.pathname === '/auth/v1/token') {
      const d = JSON.parse(body || '{}');
      if (u.searchParams.get('grant_type') === 'password') return USERS[d.email] === d.password ? j(200, emitir(d.email)) : j(400, { error: 'invalid_grant' });
      if (u.searchParams.get('grant_type') === 'refresh_token') { const e = refresh[d.refresh_token]; setTimeout(() => delete refresh[d.refresh_token], 10000); /* como o Supabase: reuso por 10 s */ return e ? j(200, emitir(e)) : j(400, { error: 'invalid_grant' }); }
    }
    if (u.pathname === '/auth/v1/user') {
      const t = (req.headers.authorization || '').replace('Bearer ', ''); try { const p = JSON.parse(Buffer.from(t.split('.')[1], 'base64url')); if (p.exp > Date.now() / 1000) return j(200, { id: p.sub, email: p.email }); } catch {}
      return j(401, { msg: 'invalid token' });
    }
    if (u.pathname === '/auth/v1/logout') return j(204, {});
    j(404, {});
  });
}).listen(Number(process.env.PORTA || 54321), () => console.log('gotrue falso em 54321'));
