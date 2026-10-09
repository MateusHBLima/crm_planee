import 'server-only';
import { ErroApi } from '@/lib/db';
import type { Usuario } from '@/lib/sessao';
import * as crm from './crm';
import * as sv from './servicos';
import * as inbox from './inbox';
import * as av from './avisos';
import * as pl from './planee';
import * as rs from './resultados';
import * as ag from './agenda';

// Leituras das telas, servidas por GET /api/painel/ler/<recurso> (rota em app/api/painel/ler).
// Por que rota e não "ação do servidor": o Next.js roda as ações uma por vez em cada navegador. Com as
// atualizações automáticas (quadro a cada 15 s, Inbox a cada 10 s) na mesma fila, o clique da pessoa esperava
// atrás delas e parecia travado (08/10). As rotas GET rodam em paralelo; as ações ficam só para gravar.
// As mesmas regras de sempre: sessão, empresa e permissão conferidas no servidor a cada pedido.

const exigir = (q: URLSearchParams, k: string) => {
  const v = q.get(k);
  if (!v) throw new ErroApi(400, `Falta "${k}".`);
  return v;
};

export const LEITURAS: Record<string, (u: Usuario, q: URLSearchParams) => Promise<unknown>> = {
  quadro: (u) => crm.lerQuadro(u),
  detalhe: (u, q) => crm.lerDetalhe(u, exigir(q, 'id')),
  comercial: (u) => crm.lerComercial(u),
  contatos: (u) => crm.lerContatos(u),
  atendimentos_contato: (u, q) => crm.lerAtendimentosDoContato(u, exigir(q, 'id')),
  notas_contato: (u, q) => crm.notasDoContato(u, exigir(q, 'id')),
  historico: (u, q) => sv.historicoContato(u, exigir(q, 'id')),
  servico: (u, q) => sv.detalheServico(u, exigir(q, 'id')),
  conversas: (u, q) => inbox.listarConversas(u, q.get('busca') ?? undefined, q.get('filtro')),
  // Abrir ou atualizar a conversa marca como lida (a equipe; o master só olha). Paginar para trás e a leitura
  // antecipada (previa=1, mouse em cima da conversa na lista) não marcam.
  conversa: (u, q) => {
    const antes = q.get('antes');
    return inbox.lerConversa(u, exigir(q, 'numero'), exigir(q, 'wa'), antes, { marcar: !antes && q.get('previa') !== '1' });
  },
  // Avisos para a Planee, novidades e saúde (08/10). As da Planee conferem master lá dentro.
  planee_empresa: async (u) => ({ avisos: await av.meusAvisos(u), novidades: await pl.novidadesDaEmpresa(u) }),
  faixa: (u) => pl.faixaDaEmpresa(u),
  avisos: (u, q) => av.listarAvisos(u, { estado: q.get('estado'), empresa: q.get('empresa') }),
  aviso: (u, q) => av.abrirAviso(u, exigir(q, 'id')),
  saude: (u) => pl.saudeClientes(u),
  saude_empresa: (u, q) => pl.saudeEmpresa(u, exigir(q, 'id')),
  novidades: (u) => pl.listarNovidades(u),
  integracoes: (u) => pl.listarIntegracoes(u),
  // Resultados da empresa (fase 1.3, 09/10): ?periodo=7|30|90|mes
  resultados: (u, q) => rs.lerResultados(u, q.get('periodo')),
  // Agenda do dia (09/10): ?dia=YYYY-MM-DD
  agenda: (u, q) => ag.lerAgenda(u, q.get('dia')),
};
