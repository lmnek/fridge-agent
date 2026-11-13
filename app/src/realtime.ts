/**
 * One OpenAI Realtime session is the whole brain. It hears the kitchen, sees camera photos,
 * and calls tools. Function calls run against the bridge, and Rohlík runs as a remote MCP server
 * that OpenAI calls directly. Every Rohlík call asks for approval first. Read and cart calls are
 * approved here automatically, anything else waits for a human tap.
 */

export type Status = "off" | "connecting" | "listening" | "thinking" | "speaking";

export interface McpApproval {
  id: string;
  name: string;
  server: string;
  args: string;
}

export interface Handlers {
  status(s: Status): void;
  /** Coldex's speech so far in this response. `id` is stable per response, `final` once it's done. */
  caption(text: string, final?: boolean, id?: string): void;
  /** The human's speech (input transcription, part 3 turns it on). `id` is stable per utterance. */
  heard?(text: string, final: boolean, id: string): void;
  approval(req: McpApproval): void;
  error(message: string): void;
  /** The session's audio streams, again after every reconnect: the mic after echo cancellation, and Coldex's voice. */
  stream?(who: "kitchen" | "coldex", stream: MediaStream): void;
}

type Json = Record<string, unknown>;
type Send = (event: Json) => void;

// The bridge only lets these Rohlík tools into the session (bridge/rohlik.py SAFE_TOOLS) with no approvals.
// This is the second lock: if an approval request ever arrives for anything else, a human decides.
const AUTO_APPROVE =
  /^(batch_search_products|get_product_details|get_cart|add_items_to_cart|update_cart_item|remove_cart_item|get_checkout_link|get_discounted_items)$/;

export class FridgeBrain {
  private h: Handlers;
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private outbox: Json[] = [];
  private busy = false;
  /** Coldex's voice is playing (WebRTC's output buffer), which outlasts generation: audio streams in faster than real time. */
  private playing = false;
  private lastActive = 0; // when the last response ended
  private wantResponse = false;
  private seen = new Set<string>();
  private captionText = "";
  private captionId = "";
  private heardText = new Map<string, string>();
  private micTrack: MediaStreamTrack | null = null;
  private micOn = true;
  private ctx: AudioContext | null = null;
  private inAnalyser: AnalyserNode | null = null;
  private outAnalyser: AnalyserNode | null = null;
  private buf = new Uint8Array(512);
  readonly audio: HTMLAudioElement = new Audio();
  private sendRaw: Send;
  private injected: boolean;

  /** `sendRaw` is for tests: it replaces the data channel. */
  constructor(handlers: Handlers, sendRaw?: Send) {
    this.h = handlers;
    this.audio.autoplay = true;
    this.injected = Boolean(sendRaw);
    this.sendRaw = sendRaw ?? ((e) => this.dc?.send(JSON.stringify(e)));
  }

  get connected() {
    return this.dc?.readyState === "open";
  }

  /** Woken by a human and not put to sleep since: a dropped or expired session reconnects by itself. */
  private wanted = false;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private wakeLock: { release(): Promise<void> } | null = null;

  async start() {
    this.wanted = true;
    void this.holdScreen();
    this.h.status("connecting");
    const tokenRes = await fetch("/api/realtime/token");
    if (!tokenRes.ok) throw new Error((await tokenRes.json().catch(() => null))?.detail ?? "The bridge is not running.");
    const { value } = await tokenRes.json();

    const pc = new RTCPeerConnection();
    this.pc = pc;
    this.ctx = new AudioContext();
    pc.ontrack = (e) => {
      this.audio.srcObject = e.streams[0];
      this.outAnalyser = this.analyser(e.streams[0]);
      this.h.stream?.("coldex", e.streams[0]);
    };
    const mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.micTrack = mic.getTracks()[0];
    this.micTrack.enabled = this.micOn;
    pc.addTrack(this.micTrack, mic);
    this.inAnalyser = this.analyser(mic);
    this.h.stream?.("kitchen", mic);

    const dc = pc.createDataChannel("oai-events");
    this.dc = dc;
    dc.onmessage = (e) => void this.handle(JSON.parse(e.data));
    dc.onopen = () => {
      this.h.status("listening");
      for (const e of this.outbox.splice(0)) this.sendRaw(e);
    };
    // A session that drops or expires (60 min) comes back on its own, so the fridge stays listening.
    dc.onclose = () => {
      if (this.dc !== dc) return; // an old session closing after a reconnect
      if (this.wanted) this.reconnect();
      else this.h.status("off");
    };
    pc.onconnectionstatechange = () => {
      if (this.pc === pc && pc.connectionState === "failed" && this.wanted) this.reconnect();
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const sdp = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      body: offer.sdp,
      headers: { Authorization: `Bearer ${value}`, "Content-Type": "application/sdp" },
    });
    if (!sdp.ok) throw new Error(`OpenAI refused the call: ${await sdp.text()}`);
    await pc.setRemoteDescription({ type: "answer", sdp: await sdp.text() });
  }

  stop() {
    this.wanted = false;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    this.teardown();
    void this.wakeLock?.release().catch(() => {});
    this.wakeLock = null;
    this.h.status("off");
  }

  private teardown() {
    this.pc?.getSenders().forEach((s) => s.track?.stop());
    this.pc?.close();
    void this.ctx?.close();
    this.pc = this.dc = null;
    this.ctx = this.inAnalyser = this.outAnalyser = this.micTrack = null;
    this.busy = this.wantResponse = this.playing = false;
  }

  private reconnect(delay = 1500) {
    if (this.retry || !this.wanted) return;
    this.teardown();
    this.h.status("connecting");
    this.retry = setTimeout(async () => {
      this.retry = null;
      if (!this.wanted) return;
      try {
        await this.start();
      } catch (e) {
        this.h.error(`Reconnecting: ${e instanceof Error ? e.message : String(e)}`);
        this.reconnect(Math.min(delay * 2, 10_000));
      }
    }, delay);
  }

  /** Keeps the tablet's screen on while Coldex is awake (Screen Wake Lock, where the browser has it). */
  private async holdScreen() {
    if (this.wakeLock || !("wakeLock" in navigator)) return;
    try {
      const lock = await (navigator as any).wakeLock.request("screen");
      this.wakeLock = lock;
      lock.addEventListener?.("release", () => {
        this.wakeLock = null;
        // The browser drops the lock when the tab is hidden; take it again once it's visible.
        if (this.wanted) document.addEventListener("visibilitychange", () => void this.holdScreen(), { once: true });
      });
    } catch {
      // not allowed (no gesture, insecure origin): the screen may dim, the session still runs
    }
  }

  /** The mic gate. Off, the session hears nothing (the stage mic stays off until C). Works before start(). */
  setMic(on: boolean) {
    this.micOn = on;
    if (this.micTrack) this.micTrack.enabled = on;
  }

  get mic() {
    return this.micOn;
  }

  /** Mic and voice levels, 0..1, for the orb. */
  levels() {
    return { input: this.rms(this.inAnalyser), output: this.rms(this.outAnalyser) };
  }

  /** A note from the app (approval tapped, order placed). The model answers out loud. */
  tell(text: string) {
    this.note(text);
    this.respond();
  }

  /** Context only: the model reads it on its next turn but isn't asked to answer now. */
  note(text: string) {
    this.send({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text }] } });
  }

  /** Talking, thinking or running tools now, or did within `ms`. A camera result then goes in as a note. */
  activeWithin(ms: number) {
    return this.busy || Date.now() - this.lastActive < ms;
  }

  /** Fresh camera frames plus the current inventory, so the model can diff them itself. */
  look(images: string[], inventory: string) {
    const text =
      `[camera] The fridge door just closed. Current inventory: ${inventory}. ` +
      "Compare with the photos, update the inventory, then react briefly. Stay quiet if nothing changed.";
    this.send({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text }] } });
    for (const image_url of images) {
      this.send({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_image", image_url }] } });
    }
    this.respond();
  }

  approve(id: string, approve: boolean) {
    this.send({ type: "conversation.item.create", item: { type: "mcp_approval_response", approval_request_id: id, approve } });
    this.respond();
  }

  maxMessageBytes() {
    return this.pc?.sctp?.maxMessageSize || 256 * 1024;
  }

  // ------------------------------------------------------------------ events

  async handle(ev: Json) {
    switch (ev.type) {
      case "response.created":
        this.busy = true;
        this.captionText = "";
        this.captionId = String((ev.response as Json)?.id ?? `r${Date.now()}`);
        this.settle();
        break;
      case "output_audio_buffer.started":
        this.playing = true;
        this.settle();
        break;
      case "output_audio_buffer.stopped":
      case "output_audio_buffer.cleared":
        this.playing = false;
        this.settle();
        break;
      case "input_audio_buffer.speech_started":
        if (!this.playing) this.h.status("listening"); // a real barge-in clears the buffer, which settles it
        break;
      case "response.output_audio_transcript.delta":
      case "response.output_text.delta":
        this.captionText += String(ev.delta ?? "");
        this.h.caption(this.captionText, false, this.captionId);
        break;
      case "conversation.item.input_audio_transcription.delta": {
        const id = String(ev.item_id ?? "");
        const text = (this.heardText.get(id) ?? "") + String(ev.delta ?? "");
        this.heardText.set(id, text);
        this.h.heard?.(text, false, id);
        break;
      }
      case "conversation.item.input_audio_transcription.completed": {
        const id = String(ev.item_id ?? "");
        this.heardText.delete(id);
        this.h.heard?.(String(ev.transcript ?? ""), true, id);
        break;
      }
      case "conversation.item.added":
      case "conversation.item.done":
        this.onItem(ev.item as Json);
        break;
      case "response.done":
        await this.onResponseDone(ev.response as Json);
        break;
      case "error": {
        const message = String((ev.error as Json)?.message ?? "Realtime error");
        if (/active response/i.test(message)) {
          this.busy = true;
          this.wantResponse = true;
        } else {
          this.h.error(message);
        }
        break;
      }
    }
  }

  private onItem(item: Json) {
    if (item?.type !== "mcp_approval_request" || !item.name || this.seen.has(String(item.id))) return;
    this.seen.add(String(item.id));
    const req = { id: String(item.id), name: String(item.name), server: String(item.server_label ?? ""), args: String(item.arguments ?? "{}") };
    if (AUTO_APPROVE.test(req.name)) this.approve(req.id, true);
    else this.h.approval(req);
  }

  private async onResponseDone(response: Json) {
    if (this.captionText) this.h.caption(this.captionText, true, this.captionId);
    const output = (response?.output as Json[]) ?? [];
    const calls = output.filter((o) => o.type === "function_call");
    if (calls.length) {
      // Answer every call from this response, then ask for one follow-up. `busy` stays on meanwhile.
      const results = await Promise.all(calls.map((c) => runTool(String(c.name), String(c.arguments ?? "{}"))));
      calls.forEach((c, i) => {
        this.send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: c.call_id, output: results[i] } });
      });
      this.wantResponse = false; // this follow-up already covers anything queued meanwhile
      this.send({ type: "response.create" });
      return;
    }
    this.busy = false;
    this.lastActive = Date.now();
    this.settle();
    if (this.wantResponse) {
      this.wantResponse = false;
      this.respond();
    }
  }

  // ------------------------------------------------------------------ plumbing

  /**
   * Speaking lasts while the voice plays, not while the model generates: a long answer is generated in a few
   * seconds (response.done) and plays for half a minute (output_audio_buffer.stopped). A follow-up response
   * after tool calls starts while the voice still plays, so it doesn't cut speaking short either.
   */
  private settle() {
    this.h.status(this.playing ? "speaking" : this.busy ? "thinking" : "listening");
  }

  private send(event: Json) {
    if (this.injected || this.connected) this.sendRaw(event);
    else this.outbox.push(event);
  }

  private respond() {
    if (this.busy) {
      this.wantResponse = true;
      return;
    }
    this.busy = true;
    this.send({ type: "response.create" });
  }

  private analyser(stream: MediaStream) {
    const node = this.ctx!.createAnalyser();
    node.fftSize = 512;
    this.ctx!.createMediaStreamSource(stream).connect(node);
    return node;
  }

  private rms(node: AnalyserNode | null) {
    if (!node) return 0;
    node.getByteTimeDomainData(this.buf);
    let sum = 0;
    for (const v of this.buf) sum += ((v - 128) / 128) ** 2;
    return Math.min(1, Math.sqrt(sum / this.buf.length) * 4);
  }
}

/** Which screen this page is. Tool events carry it, so the kitchen's tool calls don't move the stage panel to C. */
let screen: "kitchen" | "stage" = "kitchen";
export function setScreen(s: "kitchen" | "stage") {
  screen = s;
}

export async function runTool(name: string, args: string): Promise<string> {
  try {
    const res = await fetch(`/api/tools/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Coldex-Screen": screen },
      body: args || "{}",
    });
    return JSON.stringify(res.ok ? await res.json() : { error: `${name} failed with ${res.status}: ${await res.text()}` });
  } catch (e) {
    return JSON.stringify({ error: String(e) });
  }
}
