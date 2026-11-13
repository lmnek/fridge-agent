import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  setData: (d: T | null) => void;
}

/** Načte data při změně závislostí. Starší odpovědi se zahodí, ať nepřepíšou novější. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[], enabled = true): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    const my = ++seq.current;
    setLoading(true);
    setError(null);
    fn()
      .then((d) => {
        if (my === seq.current) setData(d);
      })
      .catch((e: unknown) => {
        if (my === seq.current) setError(e instanceof Error ? e.message : "Nepodařilo se načíst data.");
      })
      .finally(() => {
        if (my === seq.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce, enabled]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, loading, error, reload, setData };
}

export function ErrorLine({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl border border-tomato/25 bg-tomato/[0.07] px-4 py-3 text-sm">
      <span className="min-w-0 flex-1 text-frost">{message}</span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] text-tomato hover:bg-tomato/10"
        >
          <RefreshCw className="size-3.5" aria-hidden />
          Zkusit znovu
        </button>
      )}
    </div>
  );
}
