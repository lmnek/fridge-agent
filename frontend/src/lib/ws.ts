/**
 * Jediné WebSocket spojení na /ws pro celou aplikaci.
 * Spouští se z main.tsx mimo React (StrictMode by jinak spojení otevíral dvakrát).
 */
import { useApp } from "../store/app";
import { useChat } from "../store/chat";
import { api } from "./api";
import type {
  AgentDeltaPayload,
  AgentDonePayload,
  AgentErrorPayload,
  AgentStartPayload,
  AgentToolPayload,
  CallSession,
  CameraInfo,
  Cart,
  DoorPayload,
  FridgeEvent,
  HelloPayload,
  InventorySnapshot,
  Notification,
  Observation,
  WsEnvelope,
} from "./types";

type Listener = (env: WsEnvelope) => void;

let socket: WebSocket | null = null;
let attempts = 0;
let everOpened = false;
let pingTimer = 0;
let retryTimer = 0;
const listeners = new Set<Listener>();

/** Doplňkový odběr (např. kamera chce vědět o nových snímcích). */
export function onWs(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function url(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws`;
}

/** Co se mohlo stát, zatímco jsme byli odpojení (hello a inventory přijdou samy). */
async function resync(): Promise<void> {
  const app = useApp.getState();
  const [events, cameras, notifications, cart] = await Promise.allSettled([
    api.events(60),
    api.cameras(),
    api.notifications(30),
    api.cart(),
  ]);
  if (events.status === "fulfilled") app.setEvents(events.value);
  if (cameras.status === "fulfilled") app.setCameras(cameras.value);
  if (notifications.status === "fulfilled") app.setNotifications(notifications.value);
  if (cart.status === "fulfilled") app.setCart(cart.value);
}

function dispatch(env: WsEnvelope): void {
  const app = useApp.getState();
  const chat = useChat.getState();
  const p = env.payload as unknown;
  switch (env.type) {
    case "hello":
      app.setHello(p as HelloPayload);
      break;
    case "inventory":
      app.setInventory(p as InventorySnapshot);
      break;
    case "event":
      app.pushEvent(p as FridgeEvent);
      break;
    case "observation":
      app.setObservation(p as Observation);
      break;
    case "camera":
      app.upsertCamera(p as CameraInfo);
      break;
    case "door": {
      const d = p as DoorPayload;
      app.setDoor(d.camera_id, d.open);
      break;
    }
    case "notification": {
      const n = p as Notification;
      app.pushNotification(n);
      if (n.channel !== "call") {
        const tone = /prošl|vyhod|došlo/i.test(n.title) ? "warning" : n.status === "failed" ? "critical" : "info";
        app.toast({ title: n.title, body: n.body, tone });
      }
      break;
    }
    case "call":
      app.onCall(p as CallSession);
      break;
    case "cart":
      app.setCart(p as Cart);
      break;
    case "agent.start":
      chat.onStart(p as AgentStartPayload);
      break;
    case "agent.delta":
      chat.onDelta(p as AgentDeltaPayload);
      break;
    case "agent.tool":
      chat.onTool(p as AgentToolPayload);
      break;
    case "agent.done":
      chat.onDone(p as AgentDonePayload);
      break;
    case "agent.error":
      chat.onError(p as AgentErrorPayload);
      break;
    case "pong":
      break;
  }
  for (const fn of listeners) fn(env);
}

function scheduleReconnect(): void {
  window.clearTimeout(retryTimer);
  const delay = Math.min(15000, 800 * 2 ** attempts) + Math.random() * 400;
  attempts++;
  retryTimer = window.setTimeout(connect, delay);
}

function connect(): void {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  useApp.getState().setWs("connecting");
  let ws: WebSocket;
  try {
    ws = new WebSocket(url());
  } catch {
    scheduleReconnect();
    return;
  }
  socket = ws;
  ws.onopen = () => {
    attempts = 0;
    useApp.getState().setWs("open");
    window.clearInterval(pingTimer);
    pingTimer = window.setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" }));
    }, 20000);
    if (everOpened) void resync();
    everOpened = true;
  };
  ws.onmessage = (msg) => {
    try {
      dispatch(JSON.parse(msg.data as string) as WsEnvelope);
    } catch (err) {
      console.warn("ws: nečitelná zpráva", err);
    }
  };
  ws.onclose = () => {
    window.clearInterval(pingTimer);
    if (socket === ws) socket = null;
    useApp.getState().setWs("closed");
    scheduleReconnect();
  };
  ws.onerror = () => {
    /* onclose přijde hned potom */
  };
}

export function startRealtime(): void {
  connect();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !socket) {
      attempts = 0;
      connect();
    }
  });
}

/** Počáteční data přes REST (WebSocket pošle hello a inventář sám). */
export async function bootstrap(): Promise<void> {
  const app = useApp.getState();
  const results = await Promise.allSettled([
    api.status(),
    api.inventory(),
    api.events(60),
    api.cameras(),
    api.notifications(30),
    api.cart(),
  ]);
  const [status, inventory, events, cameras, notifications, cart] = results;
  if (status.status === "fulfilled") app.setStatus(status.value);
  if (inventory.status === "fulfilled" && !useApp.getState().loaded) app.setInventory(inventory.value, false);
  if (events.status === "fulfilled") app.setEvents(events.value);
  if (cameras.status === "fulfilled") app.setCameras(cameras.value);
  if (notifications.status === "fulfilled") app.setNotifications(notifications.value);
  if (cart.status === "fulfilled") app.setCart(cart.value);
  // poslední snímky kvůli rámečkům detekcí
  try {
    const obs = await api.observations(undefined, 12);
    for (const o of [...obs].reverse()) useApp.getState().setObservation(o);
  } catch {
    /* nevadí */
  }
}
