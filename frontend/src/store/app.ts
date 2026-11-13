import { create } from "zustand";
import type {
  CallSession,
  CameraInfo,
  Cart,
  FridgeEvent,
  HelloPayload,
  InventoryItem,
  InventorySnapshot,
  InventorySummary,
  Notification,
  Observation,
  SystemStatus,
} from "../lib/types";

export type WsState = "connecting" | "open" | "closed";
export type ChangeKind = "added" | "changed";

export interface Toast {
  id: string;
  title: string;
  body?: string;
  tone: "info" | "success" | "warning" | "critical";
  emoji?: string;
}

const MAX_EVENTS = 80;

function itemChanged(a: InventoryItem, b: InventoryItem): boolean {
  return (
    a.quantity !== b.quantity ||
    a.fill_level !== b.fill_level ||
    a.status !== b.status ||
    a.expires_on !== b.expires_on ||
    a.name !== b.name ||
    a.staple !== b.staple
  );
}

interface AppState {
  ws: WsState;
  hello: HelloPayload | null;
  status: SystemStatus | null;
  integrations: Record<string, string>;
  agentMode: "claude" | "scripted" | null;

  items: InventoryItem[];
  summary: InventorySummary | null;
  loaded: boolean;
  /** položky, které se právě změnily (kvůli zvýraznění) */
  recent: Record<string, { kind: ChangeKind; at: number }>;

  events: FridgeEvent[];
  cameras: CameraInfo[];
  door: Record<string, boolean>;
  doorOpenedAt: Record<string, number>;
  observations: Record<string, Observation>;
  /** poslední snímek, na kterém model něco viděl (pro rámečky detekcí) */
  detected: Record<string, Observation>;
  /** zvyšuje se při každém novém snímku: obrázky si podle toho obnoví cache */
  frameTick: Record<string, number>;

  notifications: Notification[];
  toasts: Toast[];
  cart: Cart | null;

  incomingCall: CallSession | null;
  activeCall: CallSession | null;
  seenCalls: string[];

  setWs: (s: WsState) => void;
  setHello: (h: HelloPayload) => void;
  setStatus: (s: SystemStatus) => void;
  setInventory: (snap: InventorySnapshot, animate?: boolean) => void;
  upsertItem: (item: InventoryItem) => void;
  setEvents: (events: FridgeEvent[]) => void;
  pushEvent: (e: FridgeEvent) => void;
  setCameras: (c: CameraInfo[]) => void;
  upsertCamera: (c: CameraInfo) => void;
  setDoor: (cameraId: string, open: boolean) => void;
  setObservation: (o: Observation) => void;
  setNotifications: (n: Notification[]) => void;
  pushNotification: (n: Notification) => void;
  toast: (t: Omit<Toast, "id">) => void;
  dismissToast: (id: string) => void;
  setCart: (c: Cart) => void;
  onCall: (c: CallSession) => void;
  setActiveCall: (c: CallSession | null) => void;
  clearIncoming: () => void;
}

let toastSeq = 0;

export const useApp = create<AppState>((set, get) => ({
  ws: "connecting",
  hello: null,
  status: null,
  integrations: {},
  agentMode: null,
  items: [],
  summary: null,
  loaded: false,
  recent: {},
  events: [],
  cameras: [],
  door: {},
  doorOpenedAt: {},
  observations: {},
  detected: {},
  frameTick: {},
  notifications: [],
  toasts: [],
  cart: null,
  incomingCall: null,
  activeCall: null,
  seenCalls: [],

  setWs: (ws) => set({ ws }),
  setHello: (hello) =>
    set((s) => ({
      hello,
      integrations: { ...s.integrations, ...hello.integrations },
      agentMode: hello.agent,
      door: { ...s.door, ...hello.door },
    })),
  setStatus: (status) =>
    set((s) => ({
      status,
      integrations: { ...status.integrations, ...s.integrations },
      cameras: s.cameras.length ? s.cameras : status.cameras,
    })),

  setInventory: (snap, animate = true) => {
    const prev = get().items;
    const now = Date.now();
    const recent = { ...get().recent };
    if (animate && get().loaded) {
      const byId = new Map(prev.map((i) => [i.id, i]));
      for (const item of snap.items) {
        const old = byId.get(item.id);
        if (!old) recent[item.id] = { kind: "added", at: now };
        else if (itemChanged(old, item)) recent[item.id] = { kind: "changed", at: now };
      }
    }
    for (const [id, r] of Object.entries(recent)) if (now - r.at > 6000) delete recent[id];
    set({ items: snap.items, summary: snap.summary, loaded: true, recent });
  },
  upsertItem: (item) =>
    set((s) => {
      const idx = s.items.findIndex((i) => i.id === item.id);
      const items = idx >= 0 ? s.items.map((i) => (i.id === item.id ? item : i)) : [item, ...s.items];
      return { items };
    }),

  setEvents: (events) => set({ events: events.slice(0, MAX_EVENTS) }),
  pushEvent: (e) =>
    set((s) => (s.events.some((x) => x.id === e.id) ? s : { events: [e, ...s.events].slice(0, MAX_EVENTS) })),

  setCameras: (cameras) => set({ cameras }),
  upsertCamera: (c) =>
    set((s) => {
      const exists = s.cameras.some((x) => x.id === c.id);
      return {
        cameras: exists ? s.cameras.map((x) => (x.id === c.id ? c : x)) : [...s.cameras, c],
        frameTick: { ...s.frameTick, [c.id]: (s.frameTick[c.id] ?? 0) + 1 },
      };
    }),
  setDoor: (cameraId, open) =>
    set((s) => {
      const doorOpenedAt = { ...s.doorOpenedAt };
      if (open) doorOpenedAt[cameraId] = Date.now();
      else delete doorOpenedAt[cameraId];
      return { door: { ...s.door, [cameraId]: open }, doorOpenedAt };
    }),
  setObservation: (o) =>
    set((s) => ({
      observations: { ...s.observations, [o.camera_id]: o },
      detected: o.detections.length ? { ...s.detected, [o.camera_id]: o } : s.detected,
      frameTick: { ...s.frameTick, [o.camera_id]: (s.frameTick[o.camera_id] ?? 0) + 1 },
    })),

  setNotifications: (notifications) => set({ notifications }),
  pushNotification: (n) =>
    set((s) => (s.notifications.some((x) => x.id === n.id) ? s : { notifications: [n, ...s.notifications].slice(0, 50) })),
  toast: (t) => {
    const id = `t${++toastSeq}`;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }));
    window.setTimeout(() => get().dismissToast(id), t.tone === "critical" ? 9000 : 5500);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  setCart: (cart) => set({ cart }),

  onCall: (c) =>
    set((s) => {
      const patch: Partial<AppState> = {};
      if (s.activeCall?.id === c.id) patch.activeCall = c;
      const ringing = c.status === "simulated" || c.status === "ringing";
      if (ringing && !c.ended_at && !s.seenCalls.includes(c.id) && s.activeCall?.id !== c.id) {
        patch.incomingCall = c;
        patch.seenCalls = [...s.seenCalls, c.id];
      }
      if (s.incomingCall?.id === c.id && !ringing) patch.incomingCall = null;
      return patch;
    }),
  setActiveCall: (activeCall) => set({ activeCall }),
  clearIncoming: () => set({ incomingCall: null }),
}));

/** Je teď otevřená nějaká dvířka? */
export const selectAnyDoorOpen = (s: AppState) => Object.values(s.door).some(Boolean);

/** Integrace běží naostro? (live, claude, cascade, local...) */
export function isDemoMode(mode: string | undefined): boolean {
  return mode === undefined || mode === "demo" || mode === "mock";
}
