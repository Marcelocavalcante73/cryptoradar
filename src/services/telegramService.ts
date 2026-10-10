/**
 * Serviço de Integração com Telegram Bot - CryptoRadar
 * Executa chamadas reais à API do Telegram para envio de alertas,
 * valida credenciais de forma estrita, mascara tokens para não expor segredos
 * e nunca declara envio com sucesso caso o disparo não tenha ocorrido.
 */

export interface TelegramSendResult {
  success: boolean;
  message: string;
  maskedToken?: string;
  statusCode?: number;
}

/**
 * Mascara o token para exibição segura na interface (ex: 712345...89ab).
 */
export function maskTelegramToken(token: string): string {
  if (!token || token.length < 8) return '****';
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

/**
 * Valida o formato básico de um token do BotFather (números:caracteres).
 */
export function isValidTokenFormat(token: string): boolean {
  if (!token) return false;
  const trimmed = token.trim();
  // Formato: 123456789:ABCdefGHIjklMNOpqrSTUvwxYZ
  return /^\d{6,12}:[A-Za-z0-9_-]{20,50}$/.test(trimmed);
}

/**
 * Dispara uma mensagem de teste real para o bot configurado.
 */
export async function sendTelegramTestMessage(
  token: string,
  chatId: string
): Promise<TelegramSendResult> {
  const cleanToken = (token || '').trim();
  const cleanChatId = (chatId || '').trim();

  // 1. Verificação de token vazio ou placeholder de demonstração
  if (!cleanToken || cleanToken.includes('exemplo') || cleanToken.includes('AAH')) {
    return {
      success: false,
      message: 'Token de bot ausente ou inválido. Forneça o token real gerado pelo @BotFather.',
      maskedToken: maskTelegramToken(cleanToken)
    };
  }

  // 2. Verificação de chat ID
  if (!cleanChatId || cleanChatId.includes('exemplo')) {
    return {
      success: false,
      message: 'Chat ID ou @canal ausente. Forneça o identificador de destino do Telegram.',
      maskedToken: maskTelegramToken(cleanToken)
    };
  }

  // 3. Validação do formato do token
  if (!isValidTokenFormat(cleanToken)) {
    return {
      success: false,
      message: 'Formato de Bot Token incorreto. O token deve seguir o padrão: 123456789:ABCDefgh...',
      maskedToken: maskTelegramToken(cleanToken)
    };
  }

  const masked = maskTelegramToken(cleanToken);

  // 4. Execução real da requisição para api.telegram.org
  try {
    const text = encodeURIComponent(
      '🟢 *CryptoRadar - Teste de Alerta Conectado*\n\n' +
      'Seu canal está configurado para receber sinais e execuções do Paper Trading em tempo real.'
    );
    const url = `https://api.telegram.org/bot${cleanToken}/sendMessage?chat_id=${encodeURIComponent(cleanChatId)}&text=${text}&parse_mode=Markdown`;

    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000)
    });

    const data = await response.json().catch(() => null);

    if (response.ok && data?.ok) {
      return {
        success: true,
        message: `Mensagem enviada com sucesso para o chat ${cleanChatId}!`,
        maskedToken: masked,
        statusCode: 200
      };
    }

    const desc = data?.description || `Erro HTTP ${response.status}`;
    return {
      success: false,
      message: `Telegram API recusou a requisição (${desc}). Verifique se o bot foi iniciado pelo usuário.`,
      maskedToken: masked,
      statusCode: response.status
    };
  } catch (err: any) {
    const isTimeout = err?.name === 'TimeoutError' || err?.message?.includes('timeout');
    return {
      success: false,
      message: isTimeout
        ? 'Tempo limite de conexão esgotado ao contatar api.telegram.org.'
        : 'Falha de rede ao conectar com a API do Telegram (bloqueio ou sem internet).',
      maskedToken: masked
    };
  }
}
