import { detectHost, DEFAULT_HOST } from './health';

/**
 * Decide se o servidor entrega o app já compilado (dist/, produção) ou usa o servidor de desenvolvimento do Vite.
 *  - `npm run dev` (--dev) e NODE_ENV=development: sempre desenvolvimento.
 *  - NODE_ENV=production: produção.
 *  - Sem nada definido: produção se existir dist/ e o servidor estiver numa hospedagem conhecida (Cloud Run, Render, ...);
 *    em máquina própria continua em desenvolvimento, para não servir uma versão compilada antiga por engano.
 * Se produção for pedida mas dist/ não existir, quem chama deve avisar e cair em desenvolvimento (melhor que tela em branco).
 */
export function shouldServeStatic(env: NodeJS.ProcessEnv, argv: string[], distExists: boolean): boolean {
  if (argv.includes('--dev') || env.NODE_ENV === 'development') return false;
  if (env.NODE_ENV === 'production') return true;
  return distExists && detectHost(env) !== DEFAULT_HOST;
}
