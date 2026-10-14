import 'server-only';
import { bancoDaEmpresa, central, ErroApi } from '@/lib/db';
import type { Usuario } from '@/lib/sessao';
import { PERMISSOES } from '@/lib/permissoes';
import { diasEntre, hojeNoFuso, lerIntervalo, somaDias, type Intervalo } from '@/lib/periodo';
import { fuso, mascararTexto, nomesDasPessoas } from './crm';
import { NOME_PAPEL } from '@/lib/pessoas';

// Tela Registro (11/10): tudo o que cada pessoa fez no painel desta empresa, com o login de quem fez. Só o admin da
// empresa e a Planee (master) veem. Junta as duas auditorias que já existiam:
//   painel_auditoria (banco da empresa): CRM — assumir, mover, passar, notas, assunto, arquivar, contatos, funil,
//     configuração; também o que a Sara e as integrações fizeram pela API (chave), se pedido.
//   central_auditoria (banco central): Inbox — mensagens enviadas pelo painel, assumir e devolver a conversa,
//     renomear contato, abrir conversa (Planee); Equipe — pessoas, permissões, avisos, convites.
// Nada é gravado aqui: é só leitura. Texto de nota aparece (o admin já vê no CRM); CPF sai mascarado para a Planee.

export type Area = 'crm' | 'inbox' | 'equipe' | 'planee';
export type ItemRegistro = {
  id: string; quando: string; area: Area;
  quem: string | null; email: string | null; sistema: boolean; // sistema: a Sara ou uma integração (chave da API)
  texto: string; alvo: string | null;
};
export type Registro = {
  periodo: Intervalo; hoje: string; fuso: string; itens: ItemRegistro[]; mais: boolean;
  pessoas: { id: string; nome: string }[]; // para o filtro: a equipe e quem aparece no período
};

const LIMITE = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AREAS: Area[] = ['crm', 'inbox', 'equipe', 'planee'];

const RECURSO: Record<string, string> = {
  atendimentos: 'atendimento', contatos: 'contato', notas: 'nota', oportunidades: 'oportunidade', topicos: 'assunto do quadro',
  etapas: 'etapa do funil', config: 'configuração do CRM', servicos: 'agendamento', pagamentos: 'pagamento',
};
const VERBO: Record<string, string> = { criar: 'Criou', atualizar: 'Editou', arquivar: 'Arquivou', definir: 'Mudou' };
const ETAPAS: Record<string, string> = { aguardando: 'Aguardando equipe', em_atendimento: 'Em atendimento', pendente: 'Pendente interno', finalizado: 'Finalizado' };
const corta = (t: string, n = 160) => (t.length > n ? t.slice(0, n - 1) + '…' : t);

function textoCrm(acao: string, recurso: string, d: Record<string, unknown>, etapas: Record<string, string>, topicos: Map<string, string>): string {
  const s = (k: string) => (d[k] === null || d[k] === undefined ? '' : String(d[k]));
  if (recurso === 'atendimentos') {
    if (acao === 'criar') return 'Abriu atendimento';
    if (acao === 'arquivar') return 'Arquivou atendimento';
    if (d.passou_para) return `Passou para ${s('passou_para')}${s('responsavel') ? ` · ${s('responsavel')}` : ''}`;
    if (s('etapa') === 'em_atendimento' && s('responsavel') && Object.keys(d).length === 2) return 'Assumiu atendimento';
    if (d.etapa) return `Moveu para ${etapas[s('etapa')] ?? s('etapa')}`;
    if (d.topico_id) return `Mudou o assunto para ${topicos.get(s('topico_id')) ?? s('topico_id')}`;
    if (d.responsavel) return `Responsável: ${s('responsavel')}`;
    return 'Editou atendimento';
  }
  if (recurso === 'notas' && acao === 'criar') return `Anotou: ${corta(s('texto'))}`;
  if (recurso === 'topicos' && acao === 'atualizar' && 'cor' in d) return `Mudou a cor da coluna para ${s('cor') || 'sem cor'}`;
  if (recurso === 'pagamentos' && d.conferido !== undefined) return d.conferido ? 'Conferiu comprovante: confere' : 'Conferiu comprovante: não confere';
  if (recurso === 'contatos' && acao === 'carregar') {
    // Carga do "Quem é quem" (POST /api/v1/pessoas/lote, migração 024).
    if (d.removido) return 'Desligou a pessoa de um número';
    const papel = NOME_PAPEL[s('papel')] ?? s('papel');
    return `${d.separado ? 'Separou do contato do número e ligou' : 'Ligou'} ao número como ${papel}${d.servicos_movidos ? ` (${s('servicos_movidos')} agendamentos)` : ''}${d.dono_renomeado ? '; o dono do número ganhou o nome do WhatsApp' : ''}`;
  }
  if (recurso === 'contatos' && 'automaticas_paradas' in d) return d.automaticas_paradas ? 'Parou as mensagens automáticas' : 'Voltou as mensagens automáticas';
  return `${VERBO[acao] ?? acao} ${RECURSO[recurso] ?? recurso}`;
}

const NOME_PERMISSAO = new Map<string, string>(PERMISSOES.map((p) => [p.id, p.nome]));
function textoCentral(acao: string, d: Record<string, unknown>, alvoNome: string | null, topicos: Map<string, string>): { area: Area; texto: string } {
  const s = (k: string) => (d[k] === null || d[k] === undefined ? '' : String(d[k]));
  switch (acao) {
    case 'enviar_mensagem': return { area: 'inbox', texto: s('resultado') && s('resultado') !== 'ok' ? `Tentou enviar mensagem pelo painel (${s('resultado')})` : 'Enviou mensagem pelo painel' };
    case 'assumir_conversa': return { area: 'inbox', texto: d.ao_enviar ? 'Assumiu a conversa ao responder' : `Assumiu a conversa${s('prazo') ? ` (${s('prazo') === 'sem_prazo' ? 'sem prazo' : s('prazo')})` : ''}` };
    case 'devolver_conversa': return { area: 'inbox', texto: 'Devolveu a conversa para a IA' };
    case 'renomear_contato': return { area: 'inbox', texto: d.limpou ? 'Tirou o nome do contato' : 'Renomeou o contato' };
    case 'abrir_conversa': return { area: 'planee', texto: 'Abriu a conversa (acesso da Planee)' };
    case 'abrir_midia': return { area: 'planee', texto: 'Abriu uma mídia (acesso da Planee)' };
    case 'abrir_comprovante': return { area: 'crm', texto: 'Abriu um comprovante' };
    case 'adicionar_pessoa': return { area: 'equipe', texto: 'Adicionou pessoa à equipe' };
    case 'atualizar_pessoa': {
      const partes: string[] = [];
      if (d.nivel) partes.push(`nível ${s('nivel')}`);
      if (Array.isArray(d.permissoes)) partes.push(d.permissoes.length ? `permissões: ${d.permissoes.map((p) => NOME_PERMISSAO.get(String(p)) ?? p).join(', ')}` : 'sem permissões');
      if (d.ativo !== undefined) partes.push(d.ativo ? 'reativou' : 'desativou');
      return { area: 'equipe', texto: `Mudou o acesso${alvoNome ? ` de ${alvoNome}` : ''}${partes.length ? `: ${partes.join('; ')}` : ''}` };
    }
    case 'avisos_crm': {
      const lista = Array.isArray(d.assuntos) ? d.assuntos.map((x) => topicos.get(String(x)) ?? String(x)) : null;
      return { area: 'equipe', texto: `Avisos do CRM${alvoNome ? ` de ${alvoNome}` : ''}: ${lista ? (lista.length ? lista.join(', ') : 'nenhum assunto') : 'todos os assuntos'}` };
    }
    case 'novo_convite': return { area: 'equipe', texto: `Gerou código de primeiro acesso${alvoNome ? ` para ${alvoNome}` : ''}` };
    case 'gerar_link_convite': return { area: 'equipe', texto: 'Gerou link de convite' };
    case 'cancelar_link_convite': return { area: 'equipe', texto: 'Cancelou link de convite' };
    case 'usar_link_convite': return { area: 'equipe', texto: 'Entrou pelo link de convite' };
    default: return { area: 'planee', texto: acao.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) };
  }
}

// "numero:1234" (conversa) → "conversa final 1234". Outros alvos não aparecem (ids internos não dizem nada).
const alvoConversa = (alvo: string | null) => {
  const m = /:(\d{4})$/.exec(alvo ?? '');
  return m ? `conversa final ${m[1]}` : null;
};

export async function lerRegistro(u: Usuario, q: URLSearchParams): Promise<Registro> {
  if (!u.empresa) throw new ErroApi(400, 'Escolha uma empresa primeiro.');
  if (u.nivel !== 'master') throw new ErroApi(403, 'Só a Planee vê o registro.');
  const empresa = u.empresa;
  const f = fuso();
  const hoje = hojeNoFuso(f);
  const periodo = lerIntervalo(q.get('de'), q.get('ate')) ?? { de: somaDias(hoje, -6), ate: hoje };
  if (diasEntre(periodo.de, periodo.ate) > 366) throw new ErroApi(400, 'Escolha um período de até um ano.');
  const pessoa = q.get('pessoa') && UUID.test(q.get('pessoa')!) ? q.get('pessoa')! : null;
  const area = AREAS.includes(q.get('area') as Area) ? (q.get('area') as Area) : null;
  const sistema = q.get('sistema') === '1' && !pessoa;
  const antes = q.get('antes') && !Number.isNaN(Date.parse(q.get('antes')!)) ? new Date(q.get('antes')!) : null;
  const P = [periodo.de, periodo.ate, f, antes, pessoa];
  const janela = `quando >= ($1::date::timestamp at time zone $3) and quando < (($2::date + 1)::timestamp at time zone $3)
                  and ($4::timestamptz is null or quando < $4::timestamptz) and ($5::uuid is null or usuario_id = $5::uuid)`;

  const [dados, cent, equipe] = await Promise.all([
    area && area !== 'crm' ? null : bancoDaEmpresa(empresa).query(
      `select (select coalesce(json_agg(x order by x.quando desc), '[]'::json) from (
                 select p.id, p.quando, p.usuario_id, k.nome as chave, p.acao, p.recurso, p.alvo_id, p.detalhe,
                        case when p.recurso = 'atendimentos' then (select c.nome from atendimentos a join contatos c on c.id = a.contato_id where a.id::text = p.alvo_id)
                             when p.recurso = 'notas' then (select c.nome from atendimentos a join contatos c on c.id = a.contato_id where a.id::text = p.detalhe ->> 'alvo_id')
                             when p.recurso = 'contatos' then (select c.nome from contatos c where c.id::text = p.alvo_id) end as contato
                   from painel_auditoria p left join api_chaves k on k.id = p.chave_id
                  where ${janela.replace(/quando/g, 'p.quando').replace(/usuario_id/g, 'p.usuario_id')}
                    and (p.usuario_id is not null or $6::boolean)
                  order by p.quando desc limit ${LIMITE + 1}) x) as itens,
              (select valor from crm_config where chave = 'etapas_atendimento') as etapas,
              (select coalesce(json_object_agg(id, nome), '{}'::json) from crm_topicos) as topicos`, [...P, sistema]),
    area === 'crm' ? null : central().query(
      `select id, quando, usuario_id, acao, alvo, detalhe from central_auditoria
        where empresa_id = $6 and ${janela} order by quando desc limit ${LIMITE + 1}`, [...P, empresa.id]),
    central().query(
      `select p.id, p.nome from painel_vinculos v join painel_usuarios p on p.id = v.usuario_id where v.empresa_id = $1 order by p.nome`, [empresa.id]),
  ]);

  const linha = dados?.rows[0];
  const etapas = { ...ETAPAS, ...((linha?.etapas ?? {}) as Record<string, string>) };
  const topicos = new Map(Object.entries((linha?.topicos ?? {}) as Record<string, string>));
  const crus: (ItemRegistro & { usuario_id: string | null; alvoPessoa?: string | null })[] = [];

  for (const r of (linha?.itens ?? []) as Record<string, unknown>[]) {
    const d = (r.detalhe ?? {}) as Record<string, unknown>;
    let texto = textoCrm(String(r.acao), String(r.recurso), d, etapas, topicos);
    if (u.master) texto = mascararTexto(texto);
    crus.push({
      id: `d${r.id}`, quando: new Date(String(r.quando)).toISOString(), area: 'crm', usuario_id: (r.usuario_id as string | null) ?? null,
      quem: r.usuario_id ? null : ((r.chave as string | null) ?? ((r.detalhe as { por?: string } | null)?.por) ?? 'Integração'), email: null, sistema: !r.usuario_id,
      texto, alvo: (r.contato as string | null) ?? (r.recurso === 'topicos' ? topicos.get(String(r.alvo_id)) ?? null : null),
    });
  }
  const alvosPessoa = new Set<string>();
  for (const r of cent?.rows ?? []) if (['atualizar_pessoa', 'avisos_crm', 'novo_convite'].includes(r.acao) && UUID.test(String(r.alvo))) alvosPessoa.add(String(r.alvo));

  const ids = new Set<string>([...crus.map((x) => x.usuario_id).filter(Boolean) as string[], ...(cent?.rows ?? []).map((r) => String(r.usuario_id ?? '')).filter(Boolean), ...alvosPessoa]);
  const nomes = await nomesDasPessoas([...ids]);

  for (const r of cent?.rows ?? []) {
    const alvoNome = alvosPessoa.has(String(r.alvo)) ? nomes.get(String(r.alvo))?.nome ?? null : null;
    const t = textoCentral(String(r.acao), (r.detalhe ?? {}) as Record<string, unknown>, alvoNome, topicos);
    if (area && t.area !== area) continue;
    crus.push({
      id: `c${r.id}`, quando: new Date(r.quando).toISOString(), area: t.area, usuario_id: r.usuario_id ? String(r.usuario_id) : null,
      quem: null, email: null, sistema: false, texto: t.texto,
      alvo: r.acao === 'adicionar_pessoa' ? String(r.alvo ?? '') || null : alvoConversa(r.alvo),
    });
  }

  for (const x of crus) {
    if (!x.usuario_id) continue;
    const n = nomes.get(x.usuario_id);
    x.quem = n?.nome ?? 'Pessoa removida'; x.email = n?.email ?? null;
  }
  crus.sort((a, b) => b.quando.localeCompare(a.quando));
  const mais = crus.length > LIMITE;
  const itens = crus.slice(0, LIMITE).map(({ usuario_id: _u, alvoPessoa: _a, ...resto }) => resto);

  const pessoas = new Map<string, string>(equipe.rows.map((p) => [String(p.id), String(p.nome)]));
  for (const [id, n] of nomes) if (!pessoas.has(id) && crus.some((x) => x.usuario_id === id)) pessoas.set(id, n.nome);
  return {
    periodo, hoje, fuso: f, itens, mais,
    pessoas: [...pessoas].map(([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
  };
}
