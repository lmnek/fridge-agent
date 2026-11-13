"""Příkazová řádka Fridy: spuštění serveru a samostatné testy integrací.

uv run frida serve                       # API + (sestavený) frontend
uv run frida status                      # co běží naostro a co v demo režimu
uv run frida camera-info                 # Reolink: kamery, baterie, signál
uv run frida snapshot --channel 0 --out police.jpg
uv run frida rohlik-tools                # nástroje Rohlík MCP (ověření přihlášení)
uv run frida rohlik-search "máslo"
uv run frida deals "máslo"               # FRIDA_DEALS_LIVE=true pro skutečné weby
uv run frida stores --lat 50.0755 --lon 14.4378
uv run frida test-call --reason "Došlo mléko."
uv run frida relay-sim                   # hlasový agent v terminálu (jako telefon)
uv run frida chat "co mám v lednici?"
uv run frida demo-take mleko             # demo: vezmi věc z lednice a sleduj, co Frida udělá
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import tempfile
from pathlib import Path

from .config import Settings, get_settings


def _print(obj) -> None:
    if hasattr(obj, "model_dump"):
        obj = obj.model_dump(mode="json")
    elif isinstance(obj, list):
        obj = [o.model_dump(mode="json") if hasattr(o, "model_dump") else o for o in obj]
    print(json.dumps(obj, ensure_ascii=False, indent=2, default=str))


def _isolated_settings() -> Settings:
    """Pro jednorázové příkazy: vlastní dočasná databáze, ať se nepletou do běžícího serveru."""
    tmp = Path(tempfile.mkdtemp(prefix="frida-cli-"))
    return get_settings().model_copy(update={"data_dir": tmp})


async def _with_services(fn, *, seed: bool = True, settings: Settings | None = None):
    from .seed import seed_demo
    from .services import build_services

    svc = build_services(settings or _isolated_settings())
    if seed:
        await seed_demo(svc)
    try:
        return await fn(svc)
    finally:
        await svc.stop()


# ----------------------------------------------------------------- příkazy
def cmd_serve(args) -> None:
    import uvicorn

    uvicorn.run("frida.main:app", host=args.host, port=args.port, reload=args.reload)


def cmd_status(args) -> None:
    _print(get_settings().integration_modes())


async def cmd_camera_info(args) -> None:
    s = get_settings()
    if not s.has_reolink:
        print("Reolink není nastavený (FRIDA_REOLINK_HOST, FRIDA_REOLINK_PASSWORD). Běží demo kamera.")
        return
    from .camera.reolink import ReolinkCamera, ReolinkHub

    hub = ReolinkHub(s)
    await hub.connect()
    try:
        for n, ch in enumerate(s.reolink_channels):
            cam = ReolinkCamera(
                hub, s, f"cam{n}", s.reolink_camera_names[n] if n < len(s.reolink_camera_names) else "", ch
            )
            _print(await cam.info())
    finally:
        await hub.close()


async def cmd_snapshot(args) -> None:
    s = get_settings()
    if s.has_reolink:
        from .camera.reolink import ReolinkCamera, ReolinkHub

        hub = ReolinkHub(s)
        await hub.connect()
        try:
            frame = await ReolinkCamera(hub, s, f"cam{args.channel}", "", args.channel).snapshot()
        finally:
            await hub.close()
    else:
        from .camera.demo import DemoCamera, DemoWorld

        world = DemoWorld()
        world.seed_default()
        frame = await DemoCamera(world, f"cam{args.channel}", "Demo", args.channel).snapshot()
    await asyncio.to_thread(Path(args.out).write_bytes, frame.jpeg)
    print(f"Uloženo {args.out} ({frame.width}×{frame.height}, {len(frame.jpeg) // 1024} kB)")


async def cmd_rohlik_tools(args) -> None:
    s = get_settings()
    if not s.has_rohlik:
        print("Rohlík MCP není nastavený (FRIDA_ROHLIK_MCP_URL nebo FRIDA_ROHLIK_MCP_COMMAND).")
        return
    from .grocery.rohlik_mcp import ALLOWED_TOOLS, BLOCKED_TOOLS, PASSTHROUGH_TOOLS, RohlikMcpProvider

    p = RohlikMcpProvider(s)
    try:
        for t in await p.list_tools():
            state = (
                "blokováno"
                if t.name in BLOCKED_TOOLS
                else ("povoleno" if t.name in ALLOWED_TOOLS | PASSTHROUGH_TOOLS else "nepoužito")
            )
            print(f"- {t.name} [{state}]")
    finally:
        await p.close()


async def cmd_rohlik_search(args) -> None:
    s = get_settings()
    if s.has_rohlik:
        from .grocery.rohlik_mcp import RohlikMcpProvider

        p = RohlikMcpProvider(s)
        try:
            _print(await p.search(args.query, limit=args.limit))
        finally:
            await p.close()
    else:
        from .grocery.mock import DemoGroceryProvider

        print("(demo, Rohlík není nastavený)")
        _print(await DemoGroceryProvider().search(args.query, limit=args.limit))


async def cmd_deals(args) -> None:
    async def run(svc):
        _print(await svc.deals.search(args.query, location=svc.prefs.location))

    await _with_services(run, seed=False)


async def cmd_stores(args) -> None:
    from .db import DocStore
    from .geo.service import GeoService
    from .schemas import GeoPoint

    s = _isolated_settings()
    geo = GeoService(s, DocStore(s.sqlite_url))
    stores = await geo.stores_near(GeoPoint(lat=args.lat, lon=args.lon), args.radius)
    for st in stores:
        print(f"{st.distance_m:>5} m  {st.chain:<9} {st.name}  {st.address or ''}")


async def cmd_test_call(args) -> None:
    async def run(svc):
        session = await svc.voice.call_user(args.reason, to=args.to)
        _print(session)
        if session.status == "ringing":
            print("Hovor běží. Twilio teď čeká na tvůj server na FRIDA_PUBLIC_BASE_URL (/voice/relay).")

    await _with_services(run, seed=False)


async def cmd_chat(args) -> None:
    from .schemas import ChatRequest

    async def run(svc):
        def out(t: str) -> None:
            print(t, end="", flush=True)

        reply = await svc.agent.respond(ChatRequest(text=args.text, channel=args.channel), on_delta=out)
        print()
        for t in reply.message.tool_calls:
            print(f"  · {t.title}: {t.summary} [{t.status}]", file=sys.stderr)

    await _with_services(run)


async def cmd_relay_sim(args) -> None:
    """Hlasový agent v terminálu. Stejná cesta jako telefon, jen bez Twilia."""
    from .schemas import ChatRequest

    async def run(svc):
        session = await svc.voice.call_user(args.reason)
        print(f"Frida: {svc.voice.greeting(session.reason)}")
        conv = None
        while True:
            try:
                text = await asyncio.to_thread(input, "Ty: ")
            except EOFError:
                break
            if not text.strip():
                continue
            print("Frida: ", end="", flush=True)
            reply = await svc.agent.respond(
                ChatRequest(text=text, conversation_id=conv, channel="voice"),
                on_delta=lambda t: print(t, end="", flush=True),
                extra_context=f"- právě telefonuješ s uživatelem, důvod hovoru: {session.reason}",
            )
            conv = reply.conversation_id
            print()
            if reply.hangup:
                print("(Frida zavěsila)")
                break

    await _with_services(run)


async def cmd_demo_take(args) -> None:
    async def run(svc):
        res = await svc.cameras.simulate("take", args.item)
        _print(res)
        for e in svc.events.recent(6):
            print(f"[{e.kind}] {e.title}  {e.detail or ''}")
        for n in svc.notify.recent(3):
            print(f"(notifikace {n.channel}/{n.status}) {n.title}: {n.body}")

    await _with_services(run)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="frida", description="Frida, chytrá lednice")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("serve", help="spustí API server")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--reload", action="store_true")
    p.set_defaults(fn=cmd_serve)

    sub.add_parser("status", help="režimy integrací").set_defaults(fn=cmd_status)
    sub.add_parser("camera-info", help="Reolink: stav kamer").set_defaults(fn=cmd_camera_info)

    p = sub.add_parser("snapshot", help="uloží snímek z kamery")
    p.add_argument("--channel", type=int, default=0)
    p.add_argument("--out", default="snapshot.jpg")
    p.set_defaults(fn=cmd_snapshot)

    sub.add_parser("rohlik-tools", help="vypíše nástroje Rohlík MCP").set_defaults(fn=cmd_rohlik_tools)
    p = sub.add_parser("rohlik-search", help="hledání v Rohlíku")
    p.add_argument("query")
    p.add_argument("--limit", type=int, default=5)
    p.set_defaults(fn=cmd_rohlik_search)

    p = sub.add_parser("deals", help="akce na potravinu v okolí")
    p.add_argument("query")
    p.set_defaults(fn=cmd_deals)

    p = sub.add_parser("stores", help="obchody v okolí (OpenStreetMap)")
    p.add_argument("--lat", type=float, default=get_settings().home_lat)
    p.add_argument("--lon", type=float, default=get_settings().home_lon)
    p.add_argument("--radius", type=int, default=None)
    p.set_defaults(fn=cmd_stores)

    p = sub.add_parser("test-call", help="zkušební hovor přes Twilio")
    p.add_argument("--reason", default="Tohle je zkušební hovor z Fridy.")
    p.add_argument("--to", default=None)
    p.set_defaults(fn=cmd_test_call)

    p = sub.add_parser("relay-sim", help="hlasový agent v terminálu")
    p.add_argument("--reason", default="Došlo mléko a vejce.")
    p.set_defaults(fn=cmd_relay_sim)

    p = sub.add_parser("chat", help="jedna otázka na Fridu")
    p.add_argument("text")
    p.add_argument("--channel", choices=["text", "voice"], default="text")
    p.set_defaults(fn=cmd_chat)

    p = sub.add_parser("demo-take", help="demo: vezme věc z lednice")
    p.add_argument("item")
    p.set_defaults(fn=cmd_demo_take)

    args = parser.parse_args(argv)
    result = args.fn(args)
    if asyncio.iscoroutine(result):
        asyncio.run(result)


if __name__ == "__main__":
    main()
