import type { AkshareClient } from './akshare-client.js';
import { HttpAkshareClient } from './akshare-http-client.js';
import { tradingDayKnown } from './ashare-fact-card.js';

const LOCAL_AKSHARE_URL = 'http://127.0.0.1:8848';

interface CalendarLogger {
  warn: (obj: Record<string, unknown>, msg: string) => void;
}

/**
 * FIX-36 复审 #1 #7: the exchange calendar a scrape task's dates come from. One client per
 * task (built on first use); an unset `AKSHARE_HTTP_URL` falls back to the local akshare-mcp,
 * and says so once.
 */
export function taskTradingCalendar(
  logger: CalendarLogger,
  env: Readonly<Record<string, string | undefined>> = process.env,
  makeClient: (baseUrl: string) => AkshareClient = (baseUrl) =>
    new HttpAkshareClient({ baseUrl, logger }),
): (iso: string) => Promise<boolean | null> {
  let client: AkshareClient | null = null;
  return (iso) => {
    if (!client) {
      const configured = env.AKSHARE_HTTP_URL;
      if (!configured)
        logger.warn(
          { code: 'AKSHARE_URL_DEFAULT', baseUrl: LOCAL_AKSHARE_URL },
          'trading calendar: AKSHARE_HTTP_URL is not set, using the local akshare-mcp',
        );
      client = makeClient(configured ?? LOCAL_AKSHARE_URL);
    }
    return tradingDayKnown(client, iso);
  };
}
