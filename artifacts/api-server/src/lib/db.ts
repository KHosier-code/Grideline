import { AsyncLocalStorage } from "node:async_hooks";
import { pool } from "@workspace/db";

type DatabaseClient = {
  query: (...args: any[]) => unknown;
  release: (error?: Error) => void;
};
type DatabasePool = {
  connect: () => Promise<DatabaseClient>;
};
type QueryCallback = (error: unknown, result?: unknown) => void;
type QueryClient = DatabaseClient & {
  _getActiveQuery?: () => unknown;
  _queryQueue?: unknown[];
  cancel?: (client: DatabaseClient, query: unknown) => void;
};

const databaseAbortContext = new AsyncLocalStorage<AbortSignal>();
const originalPoolQuery = pool.query.bind(pool) as (...args: any[]) => unknown;

export function createDatabaseAbortError(): Error {
  const error = new Error("Database query aborted");
  error.name = "AbortError";
  return error;
}

/**
 * Acquire a pool client without allowing a timed-out waiter to start work
 * later. node-postgres does not accept an AbortSignal for pool.connect(), so a
 * pending pool request may still resolve after the caller has given up. In
 * that case, release the late client with the abort error and never dispatch
 * the query.
 */
async function acquireCancellableDatabaseClient(
  databasePool: DatabasePool,
  signal: AbortSignal,
): Promise<QueryClient> {
  if (signal.aborted) {
    throw createDatabaseAbortError();
  }

  const connection = Promise.resolve().then(() => databasePool.connect());

  return new Promise<QueryClient>((resolve, reject) => {
    let settled = false;
    let aborted = false;
    let abortError: Error | undefined;

    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
    };

    const onAbort = () => {
      if (settled) return;
      settled = true;
      aborted = true;
      abortError = createDatabaseAbortError();
      cleanup();
      reject(abortError);
    };

    signal.addEventListener("abort", onAbort, { once: true });
    void connection.then(
      (client) => {
        if (settled) {
          if (aborted) {
            client.release(abortError);
          }
          return;
        }
        settled = true;
        cleanup();
        resolve(client as QueryClient);
      },
      (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      },
    );
  });
}

/**
 * Run one node-postgres query with cancellation and client cleanup tied to an
 * AbortSignal. Releasing with an error removes a client whose query may still
 * be running, rather than returning it to the pool in an unknown state.
 */
export async function executeCancellableDatabaseQuery<T>(
  databasePool: DatabasePool,
  queryOrConfig: unknown,
  values: unknown[] | undefined,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    throw createDatabaseAbortError();
  }

  const client = await acquireCancellableDatabaseClient(databasePool, signal);
  if (signal.aborted) {
    const error = createDatabaseAbortError();
    client.release(error);
    throw error;
  }

  let released = false;
  let settled = false;
  let query: unknown;

  const release = (error?: Error) => {
    if (released) return;
    released = true;
    client.release(error);
  };

  return new Promise<T>((resolve, reject) => {
    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
    };

    const finish = (error: unknown, result?: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) {
        release(error instanceof Error ? error : new Error(String(error)));
        reject(error);
      } else {
        release();
        resolve(result as T);
      }
    };

    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();

      const abortError = createDatabaseAbortError();
      const activeQuery =
        client._getActiveQuery?.() ?? client._queryQueue?.[0] ?? query;
      try {
        if (client.cancel && activeQuery) {
          client.cancel(client, activeQuery);
        }
      } catch {
        // Closing the client below still releases the pool slot if cancellation
        // cannot be sent because the connection is already unhealthy.
      }
      release(abortError);
      reject(abortError);
    };

    signal.addEventListener("abort", onAbort, { once: true });
    const callback: QueryCallback = (error, result) => finish(error, result);

    try {
      query = (
        client.query as unknown as (
          queryOrConfig: unknown,
          values: unknown[] | undefined,
          callback: QueryCallback,
        ) => unknown
      )(queryOrConfig, values, callback);
      query = client._getActiveQuery?.() ?? client._queryQueue?.[0] ?? query;
    } catch (error) {
      finish(error);
    }
  });
}

/**
 * Propagate a route's shared deadline to all database calls started by a
 * health-check operation.
 */
export function withDatabaseQueryCancellation<T>(
  signal: AbortSignal,
  operation: () => T | PromiseLike<T>,
): Promise<T> {
  return databaseAbortContext.run(signal, () =>
    Promise.resolve().then(operation),
  );
}

const poolQueryWithCancellation = (
  queryOrConfig: unknown,
  valuesOrCallback?: unknown,
  callback?: QueryCallback,
) => {
  const signal = databaseAbortContext.getStore();
  if (!signal) {
    return originalPoolQuery(queryOrConfig, valuesOrCallback, callback);
  }

  const values =
    typeof valuesOrCallback === "function" ? undefined : valuesOrCallback;
  const queryCallback =
    typeof valuesOrCallback === "function" ? valuesOrCallback : callback;
  const query = executeCancellableDatabaseQuery(
    pool as unknown as DatabasePool,
    queryOrConfig,
    values as unknown[] | undefined,
    signal,
  );

  if (queryCallback) {
    void query.then(
      (result) => queryCallback(undefined, result),
      (error) => queryCallback(error),
    );
    return undefined;
  }
  return query;
};

pool.query = poolQueryWithCancellation as typeof pool.query;
