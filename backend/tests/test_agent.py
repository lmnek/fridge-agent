"""Smyčka agenta s falešným Claude klientem: streamování, nástroje, historie jen přidáváním."""

from __future__ import annotations

import copy
from types import SimpleNamespace

from anthropic.types.beta import BetaMessage

from frida.agent.brain import AgentBrain
from frida.agent.tools import TOOLS, tool_definitions
from frida.schemas import ChatRequest
from frida.seed import seed_demo


def _msg(content: list[dict], stop_reason: str) -> BetaMessage:
    return BetaMessage.model_validate(
        {
            "id": "msg_test",
            "type": "message",
            "role": "assistant",
            "model": "claude-opus-5-5",
            "content": content,
            "stop_reason": stop_reason,
            "stop_sequence": None,
            "usage": {"input_tokens": 10, "output_tokens": 10},
        }
    )


class FakeStream:
    def __init__(self, message: BetaMessage) -> None:
        self.message = message

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    def __aiter__(self):
        async def gen():
            for block in self.message.content:
                yield SimpleNamespace(type="content_block_start", content_block=block)
                if block.type == "text":
                    for word in block.text.split(" "):
                        yield SimpleNamespace(
                            type="content_block_delta",
                            delta=SimpleNamespace(type="text_delta", text=word + " "),
                        )

        return gen()

    async def get_final_message(self) -> BetaMessage:
        return self.message


class FakeClient:
    def __init__(self, responses: list[BetaMessage]) -> None:
        self.responses = list(responses)
        self.calls: list[dict] = []
        self.beta = SimpleNamespace(messages=SimpleNamespace(stream=self.stream))

    def stream(self, **kwargs):
        self.calls.append(copy.deepcopy(kwargs))
        return FakeStream(self.responses.pop(0))

    async def close(self):
        pass


THINK = {"type": "thinking", "thinking": "Podívám se do lednice a na akce.", "signature": "sig-abc"}


async def test_tool_loop_parallel_results_and_append_only_history(services):
    await seed_demo(services)
    client = FakeClient(
        [
            _msg(
                [
                    THINK,
                    {"type": "text", "text": "Mrknu do lednice."},
                    {
                        "type": "tool_use",
                        "id": "toolu_1",
                        "name": "get_inventory",
                        "input": {"filter": "expiring"},
                    },
                    {"type": "tool_use", "id": "toolu_2", "name": "find_deals", "input": {"query": "máslo"}},
                ],
                "tool_use",
            ),
            _msg([{"type": "text", "text": "Brzy sněz jahody. Máslo je nejlevněji v Penny."}], "end_turn"),
            _msg([{"type": "text", "text": "Rádo se stalo."}], "end_turn"),
        ]
    )
    brain = AgentBrain(services, client)  # type: ignore[arg-type]
    deltas: list[str] = []
    reply = await brain.respond(ChatRequest(text="Co se kazí a kde je levné máslo?"), on_delta=deltas.append)

    assert "jahody" in reply.message.text
    assert "".join(deltas).strip().startswith("Mrknu do lednice.")
    assert [t.name for t in reply.message.tool_calls] == ["get_inventory", "find_deals"]
    assert all(t.status == "done" for t in reply.message.tool_calls)

    first, second = client.calls[0], client.calls[1]
    assert first["model"] == "claude-opus-5-5"
    assert first["output_config"] == {"effort": "medium"}
    assert first["fallbacks"] == "default" and "server-side-fallback-2026-07-01" in first["betas"]
    assert first["cache_control"] == {"type": "ephemeral"}
    assert "thinking" not in first  # Opus 5.5 myslí vždy, budget_tokens se neposílá
    assert all(t.get("eager_input_streaming") for t in first["tools"])
    roles = [m["role"] for m in first["messages"]]
    assert roles == ["user", "system"]  # stav lednice jako systémová zpráva za otázkou

    msgs = second["messages"]
    assert msgs[: len(first["messages"])] == first["messages"]  # jen přidáváno
    assistant = msgs[2]
    assert assistant["role"] == "assistant"
    assert assistant["content"][0] == THINK  # thinking blok vrácen beze změny
    results = msgs[3]
    assert results["role"] == "user"
    assert [b["tool_use_id"] for b in results["content"]] == ["toolu_1", "toolu_2"]  # obě v jedné zprávě

    # druhá otázka ve stejné konverzaci: prefix z minula zůstává beze změny
    reply2 = await brain.respond(ChatRequest(text="Díky", conversation_id=reply.conversation_id))
    assert reply2.conversation_id == reply.conversation_id
    third = client.calls[2]["messages"]
    assert third[: len(msgs) + 1][: len(msgs)] == msgs
    assert [m["role"] for m in third[len(msgs) + 1 :]] == ["user", "system"]
    assert len(brain.history(reply.conversation_id)) == 4


async def test_invalid_tool_input_returns_error_result(services):
    client = FakeClient(
        [
            _msg(
                [
                    {
                        "type": "tool_use",
                        "id": "toolu_x",
                        "name": "find_deals",
                        "input": {"max_results": "hodně"},
                    }
                ],
                "tool_use",
            ),
            _msg([{"type": "text", "text": "Promiň, zkusím to jinak."}], "end_turn"),
        ]
    )
    brain = AgentBrain(services, client)  # type: ignore[arg-type]
    reply = await brain.respond(ChatRequest(text="akce"))
    result = client.calls[1]["messages"][-1]["content"][0]
    assert result["is_error"] is True and "INVALID_INPUT" in result["content"]
    assert reply.message.tool_calls[0].status == "error"


async def test_voice_channel_has_hangup_tool_and_low_effort(services):
    client = FakeClient(
        [
            _msg(
                [
                    {"type": "text", "text": "Měj se."},
                    {"type": "tool_use", "id": "toolu_h", "name": "zavesit", "input": {}},
                ],
                "tool_use",
            ),
            _msg([{"type": "text", "text": ""}], "end_turn"),
        ]
    )
    brain = AgentBrain(services, client)  # type: ignore[arg-type]
    reply = await brain.respond(ChatRequest(text="Nashle", channel="voice"))
    assert reply.hangup
    call = client.calls[0]
    assert call["output_config"] == {"effort": "low"}
    names = {t["name"] for t in call["tools"]}
    assert "zavesit" in names and "call_user" not in names


async def test_failed_turn_is_not_saved(services):
    class Boom(FakeClient):
        def stream(self, **kwargs):
            raise RuntimeError("API down")

    brain = AgentBrain(services, Boom([]))  # type: ignore[arg-type]
    reply = await brain.respond(ChatRequest(text="Ahoj"))
    assert "pokazilo" in reply.message.text
    conv = services.store.get_raw("conversations", reply.conversation_id)
    assert conv["api"] == []


def test_tool_schemas_are_plain_json_schema():
    for channel in ("text", "voice"):
        for d in tool_definitions(channel, rohlik_live=True):
            text = str(d["input_schema"])
            assert "$ref" not in text and "$defs" not in text
            assert d["input_schema"]["type"] == "object"
    assert len({t.name for t in TOOLS}) == len(TOOLS)


async def test_scripted_brain_without_key(services):
    await seed_demo(services)
    brain = AgentBrain(services, None)
    reply = await brain.respond(ChatRequest(text="kde je nejlevnější máslo?"))
    assert "Kč" in reply.message.text
    assert reply.message.tool_calls[0].name == "find_deals"
