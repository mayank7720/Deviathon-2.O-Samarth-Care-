import { env } from 'cloudflare:workers';

/** The existing Vite build resolves its runtime here through an explicit alias. */
export function serverRuntime() {
  return {
    env,
    db: env.DB,
    local: import.meta.env.DEV || env.SAMARTH_LOCAL_DEMO === 'true',
  };
}

/** Worker requests already retain the browser's original origin. */
export const normalizeNodeRequest=request=>request;
