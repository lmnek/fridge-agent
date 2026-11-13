"""Mozek Fridy: smyčka agenta nad Claude API se streamováním a nástroji.

Jak to funguje:
1. Zpráva uživatele + systémová zpráva s aktuálním stavem (čas, poloha,
   souhrn lednice) se připojí na konec historie. Historie se nikdy nepřepisuje,
   jen přidává (bloky thinking se vrací beze změny, jinak by je API zahodilo).
   Když je historie moc dlouhá, začne se nová konverzace.
2. `client.beta.messages.stream(...)` streamuje text do UI (WebSocket) a do
   telefonu (ConversationRelay), nástroje mají `eager_input_streaming`.
3. Všechna volání nástrojů z jedné odpovědi běží paralelně a výsledky se vrací
   v jedné zprávě. Nejvýš `MAX_ROUNDS` kol na jednu otázku.
4. Bez klíče Anthropic odpovídá `ScriptedBrain` (pravidla + stejné nástroje),
   takže UI i hlas jde vyzkoušet bez API.

Model `claude-opus-5-5`, thinking je u něj vždy zapnuté, hloubka přes `effort`
(chat `medium`, hlas `low`). Zapnutý je server-side fallback (viz `frida/ai.py`).
"""

from __future__ import annotations

import asyncio
import inspect
import json
import logging
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from anthropic import AsyncAnthropic

from ..ai import request_kwargs
from ..db import utcnow
from ..schemas import ChatMessage, ChatRequest, ToolCallInfo
from .prompts import context_message, system_prompt
from .tools import ToolContext, run_tool, tool_definitions

if TYPE_CHECKING:
    from ..services import Services

log = logging.getLogger(__name__)

CONVERSATIONS = "conversations"
MAX_ROUNDS = 8
MAX_HISTORY_MESSAGES = 160
MAX_HISTORY_CHARS = 600_000
JSON_RETRIES = 2

DeltaCallback = Callable[[str], Awaitable[None] | None]


@dataclass
class AgentReply:
    conversation_id: str
    message: ChatMessage
    hangup: bool = False
    hangup_reason: str | None = None


class AgentBrain:
    def __init__(self, svc: Services, client: AsyncAnthropic | None) -> None:
        self.svc = svc
        self.client = client
        self._locks: dict[str, asyncio.Lock] = {}

    @property
    def mode(self) -> str:
        return "claude" if self.client is not None else "scripted"

    # ------------------------------------------------------------- konverzace
    def _new_conversation(self, channel: str) -> dict[str, Any]:
        from ..grocery.rohlik_mcp import RohlikMcpProvider

        now = utcnow().isoformat()
        return {
            "id": f"conv_{uuid.uuid4().hex[:12]}",
            "channel": channel,
            "created_at": now,
            "updated_at": now,
            # sada nástrojů se zmrazí na začátku konverzace (stabilní prefix pro cache a thinking)
            "rohlik_live": isinstance(self.svc.grocery, RohlikMcpProvider),
            "api": [],
            "display": [],
        }

    def _load(self, conversation_id: str | None, channel: str) -> dict[str, Any]:
        if conversation_id:
            conv = self.svc.store.get_raw(CONVERSATIONS, conversation_id)
            if conv and conv.get("channel") == channel and not self._too_long(conv):
                return conv
        return self._new_conversation(channel)

    @staticmethod
    def _too_long(conv: dict[str, Any]) -> bool:
        api = conv.get("api", [])
        return len(api) > MAX_HISTORY_MESSAGES or len(json.dumps(api, ensure_ascii=False)) > MAX_HISTORY_CHARS

    def _save(self, conv: dict[str, Any]) -> None:
        conv["updated_at"] = utcnow().isoformat()
        self.svc.store.put(CONVERSATIONS, conv["id"], conv)

    def history(self, conversation_id: str) -> list[ChatMessage]:
        conv = self.svc.store.get_raw(CONVERSATIONS, conversation_id)
        return [ChatMessage.model_validate(m) for m in (conv or {}).get("display", [])]

    def conversations(self, limit: int = 20) -> list[dict[str, Any]]:
        out = []
        for c in self.svc.store.list_raw(CONVERSATIONS, limit=limit):
            first = next((m["text"] for m in c.get("display", []) if m["role"] == "user"), "")
            out.append(
                {"id": c["id"], "channel": c["channel"], "updated_at": c["updated_at"], "title": first[:60]}
            )
        return out

    # ------------------------------------------------------------- odpověď
    async def respond(
        self,
        req: ChatRequest,
        *,
        on_delta: DeltaCallback | None = None,
        extra_context: str | None = None,
        call_session_id: str | None = None,
    ) -> AgentReply:
        conv = self._load(req.conversation_id, req.channel)
        lock = self._locks.setdefault(conv["id"], asyncio.Lock())
        async with lock:
            return await self._respond_locked(conv, req, on_delta, extra_context, call_session_id)

    async def _respond_locked(
        self,
        conv: dict[str, Any],
        req: ChatRequest,
        on_delta: DeltaCallback | None,
        extra_context: str | None,
        call_session_id: str | None,
    ) -> AgentReply:
        svc = self.svc
        conv_id = conv["id"]
        message_id = f"msg_{uuid.uuid4().hex[:10]}"
        location = req.location or svc.prefs.location
        ctx = ToolContext(
            svc=svc,
            conversation_id=conv_id,
            message_id=message_id,
            channel=req.channel,
            location=location,
            call_session_id=call_session_id,
        )
        base = {"conversation_id": conv_id, "message_id": message_id}
        svc.bus.publish("agent.start", {**base, "channel": req.channel})

        async def emit(text: str) -> None:
            if not text:
                return
            svc.bus.publish("agent.delta", {**base, "text": text})
            if on_delta is not None:
                res = on_delta(text)
                if inspect.isawaitable(res):
                    await res

        def on_tool(info: ToolCallInfo) -> None:
            svc.bus.publish("agent.tool", {**base, "tool": info.model_dump(mode="json")})

        user_msg = ChatMessage(role="user", text=req.text, ts=utcnow())
        api_before = list(conv["api"])
        try:
            if self.client is None:
                from .scripted import scripted_reply

                text = await scripted_reply(ctx, req.text, emit, on_tool)
            else:
                text = await self._run_api(conv, ctx, req, emit, on_tool, extra_context)
        except Exception as exc:
            log.exception("agent selhal")
            conv["api"] = api_before  # nedokončené kolo se do historie neuloží
            svc.bus.publish("agent.error", {**base, "error": f"{type(exc).__name__}: {str(exc)[:200]}"})
            text = "Promiň, teď se mi něco pokazilo. Zkus to prosím za chvíli znovu."
            await emit(text)

        reply = ChatMessage(role="assistant", text=text.strip(), ts=utcnow(), tool_calls=ctx.tool_calls)
        conv["display"].extend([user_msg.model_dump(mode="json"), reply.model_dump(mode="json")])
        self._save(conv)
        svc.bus.publish("agent.done", {**base, "message": reply.model_dump(mode="json")})
        return AgentReply(conv_id, reply, hangup=ctx.hangup, hangup_reason=ctx.hangup_reason)

    async def _run_api(
        self,
        conv: dict[str, Any],
        ctx: ToolContext,
        req: ChatRequest,
        emit: Callable[[str], Awaitable[None]],
        on_tool: Callable[[ToolCallInfo], None],
        extra_context: str | None,
    ) -> str:
        assert self.client is not None
        svc = self.svc
        settings = svc.settings
        channel = req.channel
        effort = settings.agent_effort_voice if channel == "voice" else settings.agent_effort_chat
        tools = tool_definitions(channel, rohlik_live=conv.get("rohlik_live", False))
        items = svc.inventory.list()
        context = context_message(
            now=utcnow().astimezone(svc.tz),
            location=ctx.location,
            summary=svc.inventory.summary(),
            items=items,
            modes=svc.integration_modes(),
            extra=extra_context,
        )
        conv["api"].append({"role": "user", "content": req.text})
        conv["api"].append({"role": "system", "content": context})

        texts: list[str] = []
        streamed = False  # už šel do UI nějaký text (oddělit další blok prázdným řádkem)
        new_block = False
        json_retries = 0
        rounds = 0
        while rounds < MAX_ROUNDS:
            rounds += 1
            try:
                async with self.client.beta.messages.stream(
                    **request_kwargs(settings, effort),
                    max_tokens=8000 if channel == "voice" else 16000,
                    system=system_prompt(channel),
                    tools=tools,
                    messages=conv["api"],
                    cache_control={"type": "ephemeral"},
                ) as stream:
                    async for event in stream:
                        if event.type == "content_block_delta" and event.delta.type == "text_delta":
                            if streamed and not event.delta.text.startswith("\n") and new_block:
                                await emit("\n\n")
                            new_block = False
                            streamed = True
                            await emit(event.delta.text)
                        elif event.type == "content_block_start" and event.content_block.type == "text":
                            new_block = True
                    response = await stream.get_final_message()
                json_retries = 0
            except ValueError:
                # Vstup nástroje, který SDK vůbec neumí rozparsovat. Kolo se zopakuje (max 2x).
                json_retries += 1
                rounds -= 1
                if json_retries > JSON_RETRIES:
                    raise
                continue

            content = [b.model_dump(mode="json", exclude_none=True) for b in response.content]
            conv["api"].append({"role": "assistant", "content": content})
            texts.extend(b.text for b in response.content if b.type == "text" and b.text)

            if response.stop_reason == "refusal":
                note = "Na tohle ti bohužel neodpovím."
                await emit(note)
                texts.append(note)
                break

            tool_uses = [b for b in response.content if b.type == "tool_use"]
            if not tool_uses:
                break

            if response.stop_reason == "max_tokens":
                # Useknutý vstup nástroje nespouštíme, ale historie musí dostat odpověď na každý tool_use.
                results = [
                    {
                        "type": "tool_result",
                        "tool_use_id": b.id,
                        "is_error": True,
                        "content": "Vstup nástroje byl useknutý (max_tokens). Zkus to s kratším vstupem.",
                    }
                    for b in tool_uses
                ]
            else:
                results = list(
                    await asyncio.gather(*(run_tool(ctx, b.name, b.input, b.id, on_tool) for b in tool_uses))
                )
            conv["api"].append({"role": "user", "content": results})
        else:
            note = "Zabralo mi to víc kroků, než mám povoleno. Zkus otázku zúžit."
            await emit(note)
            texts.append(note)

        return "\n\n".join(t.strip() for t in texts if t.strip())
