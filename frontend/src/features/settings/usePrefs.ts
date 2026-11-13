import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import type { UserPreferences, UserPreferencesUpdate } from "../../lib/types";
import { useApp } from "../../store/app";

/** Nastavení s optimistickým ukládáním: UI se změní hned, při chybě se vrátí zpátky. */
export function usePrefs() {
  const [prefs, setPrefs] = useState<UserPreferences | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const latest = useRef<UserPreferences | null>(null);
  latest.current = prefs;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPrefs(await api.prefs());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nastavení se nenačetlo.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async (patch: UserPreferencesUpdate) => {
    const before = latest.current;
    if (!before) return;
    setPrefs({ ...before, ...(patch as Partial<UserPreferences>) });
    try {
      setPrefs(await api.updatePrefs(patch));
    } catch (err) {
      setPrefs(before);
      useApp.getState().toast({
        title: "Nastavení se neuložilo",
        body: err instanceof Error ? err.message : undefined,
        tone: "critical",
      });
    }
  }, []);

  return { prefs, setPrefs, error, loading, reload: load, save };
}
