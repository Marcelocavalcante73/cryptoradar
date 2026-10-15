/**
 * Serviço de Integração com Telegram Bot - CryptoRadar
 * Executa requisições de forma segura através do backend (/api/telegram/test),
 * mantendo o token de bot exclusivamente em variáveis de ambiente do servidor.
 * Não envia tokens em URLs no navegador e relata honestamente o status de configuração.
 */

export interface TelegramBackendStatus {
  configured: boolean;
  service: string;
  status: 'CONFIGURED' | 'NOT_CONFIGURED';
  message: string;
}

export interface TelegramSendResult {
  success: boolean;
  configured: boolean;
  message: string;
  statusCode?: number;
}

/**
 * Valida localmente o formato do destino do Telegram (canal @ ou ID numérico).
 */
export function validateTelegramDestination(chatId: string): { isValid: boolean; error?: string } {
  if (!chatId || !chatId.trim()) {
    return { isValid: false, error: 'Informe o Chat ID ou o @canal de destino.' };
  }
  const clean = chatId.trim();
  if (clean.includes('exemplo')) {
    return { isValid: false, error: 'Substitua o identificador de exemplo pelo seu chat ID real.' };
  }

  const isValid = /^(@[a-zA-Z0-9_]{5,32}|-?[0-9]{5,16})$/.test(clean);
  if (!isValid) {
    return {
      isValid: false,
      error: 'Formato inválido. Use um ID numérico (ex: 123456789 ou -100123456789) ou um canal público com @ (ex: @meucanal).'
    };
  }

  return { isValid: true };
}

import { safeReadJson } from './http';

/**
 * Consulta o backend para verificar se TELEGRAM_BOT_TOKEN está configurado no servidor.
 */
export async function getTelegramServerStatus(): Promise<TelegramBackendStatus> {
  try {
    const response = await fetch('/api/telegram/status', {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(4000)
    });

    if (response.ok) {
      const data = await safeReadJson<any>(response, null, '/api/telegram/status');
      return {
        configured: Boolean(data?.configured),
        service: 'telegram',
        status: data?.configured ? 'CONFIGURED' : 'NOT_CONFIGURED',
        message: data?.message || (data?.configured ? 'Backend pronto para envio.' : 'Token ausente no servidor.')
      };
    }

    return {
      configured: false,
      service: 'telegram',
      status: 'NOT_CONFIGURED',
      message: `Backend retornou status HTTP ${response.status}. Verifique o servidor.`
    };
  } catch {
    return {
      configured: false,
      service: 'telegram',
      status: 'NOT_CONFIGURED',
      message: 'Não foi possível conectar ao endpoint do backend (/api/telegram/status).'
    };
  }
}

/**
 * Dispara uma mensagem de teste através do backend seguro.
 * O frontend NUNCA manipula ou transmite o token do bot.
 */
export async function sendTelegramTestMessage(
  chatId: string = '',
  customMessage?: string
): Promise<TelegramSendResult> {
  // Sem destino informado, o servidor usa TELEGRAM_CHAT_ID do .env
  const validation = chatId.trim() ? validateTelegramDestination(chatId) : { isValid: true, error: undefined };
  if (!validation.isValid) {
    return {
      success: false,
      configured: false,
      message: validation.error || 'Destino inválido.'
    };
  }

  try {
    const response = await fetch('/api/telegram/test', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({
        chatId: chatId.trim() || undefined,
        message: customMessage
      }),
      signal: AbortSignal.timeout(8000)
    });

    const data = await safeReadJson<any>(response, null, '/api/telegram/test');

    if (response.ok && data?.success) {
      return {
        success: true,
        configured: true,
        message: data.message || 'Mensagem de teste enviada.',
        statusCode: 200
      };
    }

    const errorMsg = data?.error || (response.status === 503
      ? 'Backend não configurado: adicione TELEGRAM_BOT_TOKEN no arquivo .env do servidor.'
      : response.status === 429
      ? 'Limite de requisições excedido no backend (máximo 5 mensagens/minuto).'
      : `Erro ${response.status} ao processar envio.`);

    return {
      success: false,
      configured: data?.configured ?? false,
      message: errorMsg,
      statusCode: response.status
    };
  } catch (err: any) {
    const isTimeout = err?.name === 'TimeoutError' || err?.message?.includes('timeout');
    return {
      success: false,
      configured: false,
      message: isTimeout
        ? 'Tempo limite de conexão esgotado ao contatar o servidor.'
        : 'Falha de conexão com o backend local do CryptoRadar (/api/telegram/test).'
    };
  }
}
