import { trpc } from '@/lib/trpc';

export interface StockPageInitialRequests {
  watchlist: ReturnType<typeof trpc.watchlists.list.query>;
  briefingStatus: ReturnType<typeof trpc.watchlists.briefingStatus.query>;
  dashboardSnapshot: ReturnType<typeof trpc.stocks.dashboardSnapshot.query>;
}

const PREPARED_REQUEST_MAX_AGE_MS = 30_000;

interface PreparedInitialRequests {
  requests: StockPageInitialRequests;
  preparedAtMs: number;
}

let preparedInitialRequests: PreparedInitialRequests | null = null;

function observeRejection<T>(promise: Promise<T>): Promise<T> {
  void promise.catch(() => undefined);
  return promise;
}

export function createStockPageInitialRequests(): StockPageInitialRequests {
  return {
    watchlist: observeRejection(trpc.watchlists.list.query()),
    briefingStatus: observeRejection(trpc.watchlists.briefingStatus.query()),
    dashboardSnapshot: observeRejection(trpc.stocks.dashboardSnapshot.query()),
  };
}

export function prepareStockPageInitialRequests(): StockPageInitialRequests {
  const nowMs = Date.now();
  if (
    !preparedInitialRequests ||
    nowMs - preparedInitialRequests.preparedAtMs > PREPARED_REQUEST_MAX_AGE_MS
  ) {
    preparedInitialRequests = {
      requests: createStockPageInitialRequests(),
      preparedAtMs: nowMs,
    };
  }
  return preparedInitialRequests.requests;
}

export function consumeStockPageInitialRequests(): StockPageInitialRequests {
  const prepared = preparedInitialRequests;
  preparedInitialRequests = null;
  if (!prepared || Date.now() - prepared.preparedAtMs > PREPARED_REQUEST_MAX_AGE_MS) {
    return createStockPageInitialRequests();
  }
  return prepared.requests;
}

export function loadStockTasksPageRoute(): Promise<typeof import('@/pages/StockTasksPage')> {
  prepareStockPageInitialRequests();
  return import('@/pages/StockTasksPage');
}
