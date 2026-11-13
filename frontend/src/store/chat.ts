import { create } from "zustand";
import { api } from "../lib/api";
import type {
  AgentDeltaPayload,
  AgentDonePayload,
  AgentErrorPayload,
  AgentStartPayload,
  AgentToolPayload,
  ChatChannel,
  ChatResponse,
  ToolCallInfo,
} from "../lib/types";

/** Chat v panelu a hlasový hovor jsou dvě oddělené konverzace. */
export type Lane = "chat" | "call";

export interface UIMessage {
  /** stabilní klíč pro React (id se po agent.start změní na message_id) */
  key: string;
  /** dokud server nepošle message_id, je to lokální id */
  id: string;
  role: "user" | "assistant";
  text: string;
  tools: ToolCallInfo[];
  streaming: boolean;
  channel: ChatChannel;
  error?: string;
  ts: number;
}

interface Pending {
  localId: string;
  messageId: string | null;
  channel: ChatChannel;
  conversationId: string | null;
}

interface LaneState {
  conversationId: string | null;
  messages: UIMessage[];
  pending: Pending | null;
}

interface ChatState {
  lanes: Record<Lane, LaneState>;
  open: boolean;
  setOpen: (open: boolean) => void;
  send: (
    lane: Lane,
    text: string,
    opts?: { channel?: ChatChannel; callSessionId?: string | null },
  ) => Promise<ChatResponse | null>;
  resetLane: (lane: Lane, seed?: UIMessage[]) => void;
  onStart: (p: AgentStartPayload) => void;
  onDelta: (p: AgentDeltaPayload) => void;
  onTool: (p: AgentToolPayload) => void;
  onDone: (p: AgentDonePayload) => void;
  onError: (p: AgentErrorPayload) => void;
}

let seq = 0;
const localId = () => `local_${Date.now().toString(36)}_${++seq}`;
const emptyLane = (): LaneState => ({ conversationId: null, messages: [], pending: null });

function upsertTool(tools: ToolCallInfo[], tool: ToolCallInfo): ToolCallInfo[] {
  const idx = tools.findIndex((t) => t.id === tool.id);
  if (idx < 0) return [...tools, tool];
  const next = tools.slice();
  next[idx] = { ...next[idx], ...tool };
  return next;
}

/** Najde pruh a zprávu podle message_id (jen streamované zprávy). */
function findByMessageId(lanes: Record<Lane, LaneState>, messageId: string): Lane | null {
  for (const lane of ["chat", "call"] as Lane[]) {
    if (lanes[lane].messages.some((m) => m.id === messageId && m.streaming)) return lane;
  }
  return null;
}

export const useChat = create<ChatState>((set, get) => {
  const patchMessage = (lane: Lane, id: string, fn: (m: UIMessage) => UIMessage) =>
    set((s) => ({
      lanes: {
        ...s.lanes,
        [lane]: { ...s.lanes[lane], messages: s.lanes[lane].messages.map((m) => (m.id === id ? fn(m) : m)) },
      },
    }));

  return {
    lanes: { chat: emptyLane(), call: emptyLane() },
    open: false,
    setOpen: (open) => set({ open }),

    resetLane: (lane, seed = []) => set((s) => ({ lanes: { ...s.lanes, [lane]: { ...emptyLane(), messages: seed } } })),

    send: async (lane, text, opts = {}) => {
      const trimmed = text.trim();
      if (!trimmed || get().lanes[lane].pending) return null;
      const channel = opts.channel ?? "text";
      const state = get().lanes[lane];
      const userId = localId();
      const userMsg: UIMessage = {
        key: userId,
        id: userId,
        role: "user",
        text: trimmed,
        tools: [],
        streaming: false,
        channel,
        ts: Date.now(),
      };
      const placeholderId = localId();
      const placeholder: UIMessage = {
        key: placeholderId,
        id: placeholderId,
        role: "assistant",
        text: "",
        tools: [],
        streaming: true,
        channel,
        ts: Date.now(),
      };
      const pending: Pending = {
        localId: placeholder.id,
        messageId: null,
        channel,
        conversationId: state.conversationId,
      };
      set((s) => ({
        lanes: {
          ...s.lanes,
          [lane]: { ...s.lanes[lane], messages: [...s.lanes[lane].messages, userMsg, placeholder], pending },
        },
      }));

      try {
        const res = await api.chat({
          text: trimmed,
          conversation_id: state.conversationId,
          channel,
          call_session_id: opts.callSessionId ?? null,
        });
        // POST je konečná pravda: i když WebSocket nejede, odpověď se zobrazí
        set((s) => {
          const l = s.lanes[lane];
          const p = l.pending;
          const ids = new Set([pending.localId, p?.messageId].filter(Boolean) as string[]);
          return {
            lanes: {
              ...s.lanes,
              [lane]: {
                conversationId: res.conversation_id,
                pending: null,
                messages: l.messages.map((m) =>
                  ids.has(m.id)
                    ? {
                        ...m,
                        text: res.message.text,
                        tools: res.message.tool_calls.length ? res.message.tool_calls : m.tools,
                        streaming: false,
                      }
                    : m,
                ),
              },
            },
          };
        });
        return res;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Neznámá chyba";
        set((s) => {
          const l = s.lanes[lane];
          const ids = new Set([pending.localId, l.pending?.messageId].filter(Boolean) as string[]);
          return {
            lanes: {
              ...s.lanes,
              [lane]: {
                ...l,
                pending: null,
                messages: l.messages.map((m) =>
                  ids.has(m.id)
                    ? { ...m, streaming: false, error: msg, text: m.text || "Tohle se nepovedlo odeslat. Zkus to znovu." }
                    : m,
                ),
              },
            },
          };
        });
        return null;
      }
    },

    onStart: (p) => {
      const { lanes } = get();
      for (const lane of ["call", "chat"] as Lane[]) {
        const pend = lanes[lane].pending;
        if (!pend || pend.messageId) continue;
        if (pend.channel !== p.channel) continue;
        if (pend.conversationId && pend.conversationId !== p.conversation_id) continue;
        set((s) => ({
          lanes: {
            ...s.lanes,
            [lane]: {
              ...s.lanes[lane],
              conversationId: p.conversation_id,
              pending: { ...pend, messageId: p.message_id },
              messages: s.lanes[lane].messages.map((m) => (m.id === pend.localId ? { ...m, id: p.message_id } : m)),
            },
          },
        }));
        return;
      }
    },
    onDelta: (p) => {
      const lane = findByMessageId(get().lanes, p.message_id);
      if (lane) patchMessage(lane, p.message_id, (m) => ({ ...m, text: m.text + p.text }));
    },
    onTool: (p) => {
      const lane = findByMessageId(get().lanes, p.message_id);
      if (lane) patchMessage(lane, p.message_id, (m) => ({ ...m, tools: upsertTool(m.tools, p.tool) }));
    },
    onDone: (p) => {
      const lane = findByMessageId(get().lanes, p.message_id);
      if (lane)
        patchMessage(lane, p.message_id, (m) => ({
          ...m,
          text: p.message.text,
          tools: p.message.tool_calls.length ? p.message.tool_calls : m.tools,
          streaming: false,
        }));
    },
    onError: (p) => {
      const lane = findByMessageId(get().lanes, p.message_id);
      if (lane) patchMessage(lane, p.message_id, (m) => ({ ...m, error: p.error }));
    },
  };
});

/** Běží teď nějaká odpověď? (pro stav orbu) */
export function useAgentActivity(): "idle" | "thinking" | "streaming" {
  return useChat((s) => {
    for (const lane of ["chat", "call"] as Lane[]) {
      const l = s.lanes[lane];
      if (!l.pending) continue;
      const msg = l.messages.find((m) => m.id === (l.pending?.messageId ?? l.pending?.localId));
      return msg && msg.text.length > 0 ? "streaming" : "thinking";
    }
    return "idle";
  });
}

/** Poslední (i rozepsaná) odpověď Fridy v chatu: titulek pod orbem. */
export function useLastAssistantText(): { text: string; streaming: boolean } | null {
  const msg = useChat((s) => {
    const msgs = s.lanes.chat.messages;
    for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === "assistant") return msgs[i];
    return null;
  });
  if (!msg || (!msg.text && !msg.streaming)) return null;
  return { text: msg.text, streaming: msg.streaming };
}
