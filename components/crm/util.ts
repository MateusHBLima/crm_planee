// Formatação usada pelas telas do CRM (navegador).

export function criarFormatos(fuso: string) {
  const hora = new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, hour: '2-digit', minute: '2-digit' });
  const dia = new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, day: '2-digit', month: '2-digit' });
  const chaveDia = new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' });
  const hoje = () => chaveDia.format(new Date());
  return {
    // "14:02" hoje; "29/09 14:02" em outro dia
    quando(iso: string | null | undefined): string {
      if (!iso) return '';
      const d = new Date(iso);
      return chaveDia.format(d) === hoje() ? hora.format(d) : `${dia.format(d)} ${hora.format(d)}`;
    },
    hora: (iso: string) => hora.format(new Date(iso)),
  };
}

// "12 min", "3 h", "2 dias"
export function duracao(deIso: string | null | undefined, ateIso?: string | null): string {
  if (!deIso) return '';
  const ms = (ateIso ? new Date(ateIso).getTime() : Date.now()) - new Date(deIso).getTime();
  const min = Math.max(0, Math.round(ms / 60000));
  if (min < 1) return 'agora';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h${min % 60 && h < 10 ? ` ${min % 60} min` : ''}`;
  const d = Math.floor(h / 24);
  return d === 1 ? '1 dia' : `${d} dias`;
}

// 554799991234 -> +55 47 9999-1234 ; 5547999991234 -> +55 47 99999-1234
export function telefoneBonito(t: string | null | undefined): string {
  const d = String(t ?? '').replace(/\D/g, '');
  if (d.length === 12) return `+${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, 8)}-${d.slice(8)}`;
  if (d.length === 13) return `+${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, 9)}-${d.slice(9)}`;
  return t ?? '';
}

export function cpfBonito(c: string | null | undefined): string {
  if (!c) return '';
  if (c.includes('*')) return c;
  const d = c.replace(/\D/g, '');
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  return c;
}

export function linkWhatsApp(t: string | null | undefined): string | null {
  const d = String(t ?? '').replace(/\D/g, '');
  return d.length >= 12 ? `https://wa.me/${d}` : null;
}

// "há 12 min"; logo depois de abrir, "agora"
export function ha(deIso: string | null | undefined): string {
  const d = duracao(deIso);
  return d === 'agora' ? 'agora' : `há ${d}`;
}

// Busca sem acento e sem caixa; telefone e documento só por dígitos.
export function normal(s: string | null | undefined): string {
  return String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
export function casaBusca(q: string, campos: (string | null | undefined)[]): boolean {
  const n = normal(q).trim();
  if (!n) return true;
  const dig = n.replace(/\D/g, '');
  return campos.some((c) => {
    const v = normal(c);
    return v.includes(n) || (dig.length >= 3 && v.replace(/\D/g, '').includes(dig));
  });
}
