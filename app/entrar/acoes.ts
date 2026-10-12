'use server';

import { cookies, headers } from 'next/headers';
import { esquecerSessoes } from '@/lib/sessao';
import { redirect } from 'next/navigation';
import { bancoConfigurado, central } from '@/lib/db';
import {
  authConfigurado, COOKIE_ACESSO, COOKIE_RENOVA, criarConta, DIAS_SESSAO, encerrarSessao, entrarComSenhaDetalhe, mfaExigido,
  MSG_LOGIN_DESLIGADO, MSG_NAO_CONFIRMADO, type FalhaLogin,
  nivelDaSessao, opcoesCookie, verificarTotp, type Tokens,
} from '@/lib/auth/gotrue';
import { destinoSeguro } from '@/lib/destino';
import { bloqueado, ipDe, LIMITES, limparFalhas, MSG_LIMITE, registrarFalha } from '@/lib/limite';
import { hashCodigo, lerLinkConvite, normalizarCodigo, situacaoNoLink, tokenLinkValido, usarLinkConvite } from '@/lib/painel/gestao';
import { empresaDoDominio, hostDeCabecalhos } from '@/lib/empresa';
import { avisarLoginDesligado, avisoDoSistema } from '@/lib/avisos-sistema';

// Texto da recusa do login (11/10). Só "senha" conta como tentativa errada (limite de tentativas).
const MSG_FALHA: Record<FalhaLogin, string> = {
  senha: 'E-mail ou senha incorretos.',
  nao_confirmado: MSG_NAO_CONFIRMADO,
  login_desligado: MSG_LOGIN_DESLIGADO,
  muitas: 'Muitas tentativas de login agora. Espere alguns minutos e tente de novo.',
  indisponivel: 'O login não respondeu agora. Tente de novo em instantes.',
};
async function recusa(falha: FalhaLogin, email: string, h: Headers) {
  if (falha === 'login_desligado') {
    const dono = await empresaDoDominio(hostDeCabecalhos(h)).catch(() => null);
    await avisarLoginDesligado(email, dono?.id ?? null);
  }
  return MSG_FALHA[falha];
}

// O destino volta para o navegador, que navega sozinho. Um redirect() aqui seria renderizado pelo Next num
// pedido interno para localhost, sem o endereço da empresa (decisão 26).
export type EstadoEntrar = { erro: string | null; email: string; destino?: string };

async function gravarSessao(t: Tokens) {
  const c = await cookies();
  c.set(COOKIE_ACESSO, t.access_token, opcoesCookie(t.expires_in));
  c.set(COOKIE_RENOVA, t.refresh_token, opcoesCookie(DIAS_SESSAO * 86400));
}

export async function entrar(_: EstadoEntrar, form: FormData): Promise<EstadoEntrar> {
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const senha = String(form.get('senha') ?? '');
  if (!email || !senha) return { erro: 'Preencha o e-mail e a senha.', email };
  if (!authConfigurado() || !bancoConfigurado()) {
    return { erro: 'O login ainda não foi configurado neste endereço. Avise a Planee.', email };
  }
  const ip = ipDe(await headers());
  const chaves = [`login:${email}`, `ip:${ip}`];
  if (bloqueado([[chaves[0], LIMITES.email], [chaves[1], LIMITES.ip]])) return { erro: MSG_LIMITE, email };
  const { tokens, falha } = await entrarComSenhaDetalhe(email, senha);
  if (!tokens) {
    if (falha === 'senha' || !falha) registrarFalha(chaves);
    return { erro: await recusa(falha ?? 'senha', email, await headers()), email };
  }
  limparFalhas([chaves[0]]);

  const liberado = await central().query('select master from painel_usuarios where lower(email) = $1 and ativo', [email]);
  if (!liberado.rowCount) {
    await encerrarSessao(tokens.access_token);
    return { erro: 'Este e-mail ainda não tem acesso ao painel. Peça para o gestor liberar.', email };
  }
  await gravarSessao(tokens);
  const destino = destinoSeguro(form.get('volta'));
  // Master: senha certa ainda não basta; falta o código do autenticador.
  if (liberado.rows[0].master && mfaExigido() && nivelDaSessao(tokens.access_token) !== 'aal2') {
    return { erro: null, email, destino: `/entrar/verificacao${destino !== '/' ? `?volta=${encodeURIComponent(destino)}` : ''}` };
  }
  return { erro: null, email, destino };
}

export async function sair() {
  const c = await cookies();
  const acesso = c.get(COOKIE_ACESSO)?.value;
  if (acesso) await encerrarSessao(acesso);
  esquecerSessoes();
  c.delete(COOKIE_ACESSO);
  c.delete(COOKIE_RENOVA);
  redirect('/entrar');
}

export type EstadoPrimeiro = { erro: string | null; email: string; enviado: boolean; destino?: string };

const ERRO_CONVITE = 'E-mail ou código de primeiro acesso inválido, ou o código venceu. Peça um código novo a quem cadastrou você.';

// Primeiro acesso: só com o código que o admin (ou a Planee) recebeu ao cadastrar a pessoa (auditoria 01/10, S2).
// A mensagem de erro é a mesma em todos os casos, para não revelar quais e-mails estão cadastrados.
export async function criarSenha(_: EstadoPrimeiro, form: FormData): Promise<EstadoPrimeiro> {
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const codigo = normalizarCodigo(form.get('codigo'));
  const senha = String(form.get('senha') ?? '');
  const repete = String(form.get('repete') ?? '');
  const volta = (erro: string) => ({ erro, email, enviado: false });
  if (!email || !codigo || !senha) return volta('Preencha o e-mail, o código e a senha.');
  if (senha.length < 8) return volta('A senha precisa ter pelo menos 8 caracteres.');
  if (senha !== repete) return volta('As duas senhas não são iguais.');
  if (!authConfigurado() || !bancoConfigurado()) return volta('O login ainda não foi configurado neste endereço. Avise a Planee.');
  const ip = ipDe(await headers());
  const chaves = [`convite:${email}`, `ip:${ip}`];
  if (bloqueado([[chaves[0], 5], [chaves[1], LIMITES.ip]])) return volta(MSG_LIMITE);

  const p = await central().query(
    `select id from painel_usuarios
      where lower(email) = $1 and ativo and auth_id is null and convite_hash = $2 and convite_expira > now()`,
    [email, hashCodigo(codigo)]);
  if (!p.rowCount) { registrarFalha(chaves); return volta(ERRO_CONVITE); }
  let r: Awaited<ReturnType<typeof criarConta>>;
  try { r = await criarConta(email, senha); } catch { return volta('Não foi possível criar a senha agora. Tente de novo.'); }
  if (r.erro) return volta(r.erro);
  // Código usado não vale de novo.
  await central().query('update painel_usuarios set convite_hash = null, convite_expira = null where id = $1', [p.rows[0].id]);
  limparFalhas([chaves[0]]);
  if (!r.tokens) return { erro: null, email, enviado: true };
  await gravarSessao(r.tokens);
  return { erro: null, email, enviado: false, destino: '/' };
}

export type EstadoVerificacao = { erro: string | null; destino?: string };

// Código de 6 dígitos do autenticador (cadastro do autenticador ou login do master).
export async function verificarCodigo(_: EstadoVerificacao, form: FormData): Promise<EstadoVerificacao> {
  const codigo = String(form.get('codigo') ?? '').replace(/\D/g, '');
  const fator = String(form.get('fator') ?? '');
  if (codigo.length !== 6) return { erro: 'Digite os 6 números que aparecem no aplicativo autenticador.' };
  const acesso = (await cookies()).get(COOKIE_ACESSO)?.value;
  if (!acesso) return { erro: null, destino: '/entrar?motivo=sessao' };
  const ip = ipDe(await headers());
  const chaves = [`mfa:${acesso.slice(-24)}`, `ip:${ip}`];
  if (bloqueado([[chaves[0], 5], [chaves[1], LIMITES.ip]])) return { erro: MSG_LIMITE };
  let t: Tokens | null = null;
  try { t = await verificarTotp(acesso, fator, codigo); } catch { t = null; }
  if (!t) { registrarFalha(chaves); return { erro: 'Código incorreto ou vencido. Confira se o horário do celular está certo e tente de novo.' }; }
  limparFalhas([chaves[0]]);
  await gravarSessao(t);
  return { erro: null, destino: destinoSeguro(form.get('volta')) };
}

export type EstadoConvite = { erro: string | null; nome: string; email: string; enviado: boolean; destino?: string };

const LINK_INVALIDO = 'Este link de convite já foi usado, venceu ou foi cancelado. Peça um link novo a quem convidou você.';

// Link de convite de uso único (09/10): a pessoa põe nome, e-mail e senha e entra na empresa do link como membro,
// com o acesso que o admin escolheu (padrão: nenhum, liberado depois). Quem já tem senha no painel usa a mesma.
export async function entrarPorConvite(_: EstadoConvite, form: FormData): Promise<EstadoConvite> {
  const token = String(form.get('token') ?? '');
  const nome = String(form.get('nome') ?? '').trim().replace(/\s+/g, ' ');
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const senha = String(form.get('senha') ?? '');
  const repete = String(form.get('repete') ?? '');
  const volta = (erro: string) => ({ erro, nome, email, enviado: false });
  if (!tokenLinkValido(token)) return volta(LINK_INVALIDO);
  if (nome.length < 2 || nome.length > 80) return volta('Escreva o seu nome (de 2 a 80 letras).');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return volta('Confira o e-mail.');
  if (senha.length < 8) return volta('A senha precisa ter pelo menos 8 caracteres.');
  if (senha !== repete) return volta('As duas senhas não são iguais.');
  if (!authConfigurado() || !bancoConfigurado()) return volta('O login ainda não foi configurado neste endereço. Avise a Planee.');
  const h = await headers();
  const ip = ipDe(h);
  const chaves = [`link:${email}`, `ip:${ip}`];
  if (bloqueado([[chaves[0], LIMITES.email], [chaves[1], LIMITES.ip]])) return volta(MSG_LIMITE);

  const link = await lerLinkConvite(token);
  if (!link) { registrarFalha([chaves[1]]); return volta(LINK_INVALIDO); }
  // Link de uma empresa aberto no domínio de outra: a sessão não valeria aqui.
  const dono = await empresaDoDominio(hostDeCabecalhos(h)).catch(() => null);
  if (dono && dono.id !== link.empresa_id) return volta('Abra o link exatamente como você recebeu.');

  const situacao = await situacaoNoLink(link.empresa_id, email);
  if (situacao === 'bloqueado') return volta('Este e-mail não pode entrar por convite. Fale com quem convidou você.');
  if (situacao === 'ja_esta') return volta('Este e-mail já está na equipe. Entre com a sua senha em "Já tenho senha".');

  // Quem já tem senha no painel (outra empresa): a senha precisa ser a mesma. Quem não tem: cria agora.
  let tokens: Tokens | null = null;
  const tentativa = await entrarComSenhaDetalhe(email, senha);
  tokens = tentativa.tokens;
  // Login desligado ou e-mail não confirmado: avisa já, sem gastar o link (antes o link era usado e a conta ficava
  // criada sem conseguir entrar).
  if (!tokens && (tentativa.falha === 'login_desligado' || (tentativa.falha === 'nao_confirmado' && situacao === 'tem_senha'))) {
    return volta(await recusa(tentativa.falha, email, h));
  }
  if (!tokens && situacao === 'tem_senha') {
    registrarFalha(chaves);
    return volta('Este e-mail já tem senha no painel. Use a mesma senha (ou peça ajuda a quem convidou você).');
  }
  if (!tokens) {
    let r: Awaited<ReturnType<typeof criarConta>>;
    try { r = await criarConta(email, senha); } catch { return volta('Não foi possível criar a conta agora. Tente de novo.'); }
    if (r.erro) return volta(r.erro);
    tokens = r.tokens;
    // Sem sessão na volta do cadastro (Supabase com confirmação de e-mail): tenta entrar com a senha recém-criada.
    if (!tokens) {
      const segunda = await entrarComSenhaDetalhe(email, senha);
      tokens = segunda.tokens;
      // Supabase com "Confirm email" ligado: a conta nasce sem poder entrar. Avisa a Planee para desligar e liberar.
      if (!tokens && segunda.falha === 'nao_confirmado') {
        const dono = await empresaDoDominio(hostDeCabecalhos(h)).catch(() => null);
        if (dono) {
          await avisoDoSistema(dono.id, { tipo: 'login_desligado', chave: `nao_confirmado:${new Date().toISOString().slice(0, 10)}`,
            titulo: 'Conta criada pelo convite sem poder entrar: "Confirm email" ligado no Supabase do painel. Desligar e confirmar a conta.' });
        }
      }
    }
  }
  if (!(await usarLinkConvite(token, { nome, email }))) {
    if (tokens) await encerrarSessao(tokens.access_token).catch(() => {});
    return volta(LINK_INVALIDO);
  }
  limparFalhas([chaves[0]]);
  // Conta criada: entra direto no painel (CRM; sem acesso ao CRM, o painel leva à primeira tela liberada).
  // Se o Supabase ainda não deixou entrar, vai para o login com o aviso de conta criada (nunca "veja seu e-mail").
  if (!tokens) return { erro: null, nome, email, enviado: false, destino: '/entrar?motivo=criada' };
  await gravarSessao(tokens);
  return { erro: null, nome, email, enviado: false, destino: '/crm' };
}
