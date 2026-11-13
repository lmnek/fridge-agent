import { useEffect, useState } from "react";
import { BatteryMedium, CircleCheck, CircleX, Phone, Video, Wifi, WifiOff } from "lucide-react";
import { api } from "../../lib/api";
import { hasCzechVoice, speechSupport } from "../../lib/speech";
import { cx } from "../../lib/format";
import { isDemoMode, useApp } from "../../store/app";
import { useVoice } from "../../store/voice";
import { Panel, SectionTitle, Toggle } from "../../ui/bits";
import { Button } from "../../ui/Button";
import { INTEGRATIONS, modeDetail } from "./integrations";

export function ModeBadge({ mode }: { mode: string | undefined }) {
  const demo = isDemoMode(mode);
  return demo ? (
    <span className="inline-flex h-6 shrink-0 items-center rounded-full border border-dashed border-mist/35 px-2.5 text-xs text-mist">
      demo
    </span>
  ) : (
    <span className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full bg-glacier/12 px-2.5 text-xs font-medium text-glacier">
      <span className="size-1.5 rounded-full bg-glacier shadow-[0_0_8px_var(--color-glacier)]" aria-hidden />
      naostro
    </span>
  );
}

export function IntegrationsPanel() {
  const integrations = useApp((s) => s.integrations);
  const agentMode = useApp((s) => s.agentMode);
  const [version, setVersion] = useState<string | null>(null);
  const [statusModes, setStatusModes] = useState<Record<string, string>>({});

  useEffect(() => {
    api
      .status()
      .then((s) => {
        setVersion(s.version);
        setStatusModes(s.integrations);
      })
      .catch(() => {});
  }, []);

  const modes = { ...statusModes, ...integrations };
  const liveCount = INTEGRATIONS.filter((i) => !isDemoMode(modes[i.key])).length;

  return (
    <Panel aria-labelledby="integrations" className="lg:col-span-2">
      <SectionTitle
        id="integrations"
        aside={
          <span className="text-xs text-mist">
            {liveCount} z {INTEGRATIONS.length} naostro{version ? `, verze ${version}` : ""}
          </span>
        }
      >
        Integrace
      </SectionTitle>
      <p className="-mt-1 mb-4 max-w-2xl text-sm text-mist">
        {agentMode === "claude"
          ? "Frida přemýšlí pomocí Clauda."
          : "Frida teď běží s ukázkovým mozkem, odpovědi jsou předem připravené."}{" "}
        Co je v demo režimu, je simulované a nikam se nic neposílá. Klíče a adresy patří do backend/.env.
      </p>
      <ul className="grid gap-x-8 gap-y-1 md:grid-cols-2">
        {INTEGRATIONS.map((i) => {
          const mode = modes[i.key];
          const detail = isDemoMode(mode) ? "" : modeDetail(mode);
          return (
            <li key={i.key} className="border-t border-white/[0.06] py-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-frost">
                  {i.label}
                  {detail && <span className="ml-2 text-xs font-normal text-mist">{detail}</span>}
                </p>
                <ModeBadge mode={mode} />
              </div>
              <p className="mt-1 text-[13px] leading-snug text-mist">{i.note}</p>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

export function CamerasPanel() {
  const cameras = useApp((s) => s.cameras);
  const door = useApp((s) => s.door);
  return (
    <Panel aria-labelledby="cams">
      <SectionTitle id="cams">Kamery</SectionTitle>
      {cameras.length === 0 ? (
        <p className="text-sm text-mist">Žádná kamera se zatím nepřihlásila.</p>
      ) : (
        <ul className="space-y-3">
          {cameras.map((c) => (
            <li key={c.id} className="frost-chip rounded-2xl p-3.5">
              <div className="flex items-center justify-between gap-3">
                <p className="flex items-center gap-2 text-sm font-medium text-frost">
                  <Video className="size-4 text-mist" aria-hidden />
                  {c.name}
                  {door[c.id] && <span className="text-xs font-normal text-glacier">otevřeno</span>}
                </p>
                <ModeBadge mode={c.mode} />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-mist">
                <span className={cx("inline-flex items-center gap-1", !c.online && "text-tomato")}>
                  {c.online ? <Wifi className="size-3.5" aria-hidden /> : <WifiOff className="size-3.5" aria-hidden />}
                  {c.online ? `online, signál ${c.wifi_signal ?? "?"}` : "offline"}
                </span>
                {c.battery_pct !== null && (
                  <span className={cx("inline-flex items-center gap-1", c.battery_pct <= 25 && "text-apricot")}>
                    <BatteryMedium className="size-3.5" aria-hidden />
                    baterie {c.battery_pct} %
                  </span>
                )}
                <span>kanál {c.channel}</span>
              </div>
              {c.live?.note && <p className="mt-1.5 text-xs text-haze">{c.live.note}</p>}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      {ok ? (
        <CircleCheck className="mt-0.5 size-4 shrink-0 text-glacier" aria-label="ano" />
      ) : (
        <CircleX className="mt-0.5 size-4 shrink-0 text-apricot" aria-label="ne" />
      )}
      <span className="text-mist">{children}</span>
    </li>
  );
}

export function VoicePanel() {
  const readAloud = useVoice((s) => s.readAloud);
  const setReadAloud = useVoice((s) => s.setReadAloud);
  const [czech, setCzech] = useState(() => hasCzechVoice());
  const recognition = speechSupport.recognition();
  const synthesis = speechSupport.synthesis();

  useEffect(() => {
    if (!synthesis) return;
    const update = () => setCzech(hasCzechVoice());
    window.speechSynthesis.addEventListener?.("voiceschanged", update);
    const t = window.setTimeout(update, 600);
    return () => {
      window.speechSynthesis.removeEventListener?.("voiceschanged", update);
      window.clearTimeout(t);
    };
  }, [synthesis]);

  return (
    <Panel aria-labelledby="voice">
      <SectionTitle id="voice">Hlas</SectionTitle>
      <Toggle
        checked={readAloud}
        onChange={(v) => {
          if (!v) useVoice.getState().hush();
          setReadAloud(v);
        }}
        label="Číst odpovědi nahlas"
        hint="Když se Fridy zeptáš hlasem, odpoví ti i nahlas."
      />
      <ul className="mt-3 space-y-2">
        <Check ok={recognition}>
          {recognition ? "Prohlížeč rozumí mluvené češtině." : "Tenhle prohlížeč neumí rozpoznávat řeč. Psaní funguje vždycky, hlas zkus v Chrome nebo Safari."}
        </Check>
        <Check ok={synthesis && czech}>
          {!synthesis
            ? "Prohlížeč neumí číst nahlas."
            : czech
              ? "Český hlas pro čtení je k dispozici."
              : "Český hlas pro čtení chybí, Frida bude mluvit výchozím hlasem systému."}
        </Check>
      </ul>
    </Panel>
  );
}

export function TestCallPanel({ allowCalls, phone }: { allowCalls: boolean | undefined; phone: string | null | undefined }) {
  const voiceMode = useApp((s) => s.integrations.voice);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const call = async () => {
    setBusy(true);
    setError(null);
    try {
      const session = await api.startCall("Testovací hovor z nastavení. Slyšíme se?");
      if (session.status === "refused" || session.status === "failed") {
        setError(
          session.status === "refused"
            ? "Hovor se teď nedá uskutečnit (tiché hodiny, limit hovorů, nebo chybí číslo)."
            : "Hovor se nepodařilo spojit.",
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Hovor se nepodařilo spustit.");
    } finally {
      setBusy(false);
    }
  };

  const demo = isDemoMode(voiceMode);
  return (
    <Panel aria-labelledby="test-call">
      <SectionTitle id="test-call">Zkušební hovor</SectionTitle>
      <p className="-mt-1 text-sm text-mist">
        {demo
          ? "V demo režimu se nic nevytáčí. Frida ti zavolá přímo sem do aplikace a hovor přijmeš tady."
          : phone
            ? `Frida zavolá na ${phone}.`
            : "Frida zavolá na číslo z FRIDA_USER_PHONE."}
      </p>
      {allowCalls === false && <p className="mt-2 text-sm text-apricot">Hovory máš v upozorněních vypnuté.</p>}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="primary" icon={<Phone className="size-4" aria-hidden />} busy={busy} onClick={() => void call()}>
          Zavolej mi
        </Button>
        {error && (
          <p className="text-sm text-tomato" role="alert">
            {error}
          </p>
        )}
      </div>
    </Panel>
  );
}
