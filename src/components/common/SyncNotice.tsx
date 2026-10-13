import React from 'react';
import { SyncStatus, StorageInfo } from '../../services/remoteState';

interface SyncNoticeProps {
  status: SyncStatus;
  info: StorageInfo | null;
  blocked: boolean;   // o navegador bloqueia o armazenamento local
  detail?: string | null;
}

/** Uma linha que diz, sem enrolação, onde a carteira e o histórico estão sendo salvos. */
export const SyncNotice: React.FC<SyncNoticeProps> = ({ status, info, blocked, detail }) => {
  let text = '';
  let tone = 'text-slate-500';

  if (status === 'saving') {
    text = 'Salvando…';
  } else if (status === 'saved' && info?.persistent) {
    text = '✓ Salvo no servidor';
    tone = 'text-emerald-400';
  } else if (status === 'saved') {
    text = 'Salvo no servidor, mas em disco temporário: pode sumir quando o servidor reiniciar. Configure o Supabase (veja DEPLOY.md).';
    tone = 'text-amber-300';
  } else if (status === 'offline') {
    text = blocked
      ? 'Sem conexão com o servidor e o navegador bloqueia o armazenamento: o que você fizer só vale até fechar esta página.'
      : 'Sem conexão com o servidor. Salvo só neste aparelho; vamos tentar de novo.';
    tone = 'text-amber-300';
  } else if (status === 'error') {
    text = `Não foi possível salvar no servidor${detail ? `: ${detail}` : ''}.`;
    tone = 'text-rose-400';
  } else if (status === 'checking') {
    text = blocked ? 'O navegador bloqueia o armazenamento local; usando o servidor…' : '';
  }

  if (!text) return null;
  return <p className={`text-xs leading-relaxed ${tone}`}>{text}</p>;
};
