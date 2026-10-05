#!/usr/bin/env python3
"""Kinema party server — комнаты для совместного просмотра.

Только хранит авторитетное состояние комнаты и ретранслирует события
между участниками. Логики воспроизведения здесь нет — плееры клиентов
сами выравниваются по присланному состоянию.
"""

import asyncio
import json
import random
import re
import time

from websockets.asyncio.server import serve
from websockets.exceptions import ConnectionClosed

ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"  # без 0/O/1/I — код читаем на слух
ROOM_TTL_S = 600        # пустая комната живёт 10 минут (запас на перезагрузку страницы)
STATE_SYNC_S = 10.0     # фоновая сверка состояния — лечит потерянные события
MAX_PEERS = 20
MAX_NAME = 24
MAX_CHAT = 300
MAX_TARGET = 300
CHAT_BURST = 5          # сообщений за окно
CHAT_WINDOW_S = 1.0
COUNTDOWN_MS = 5000

ALLOWED_ORIGIN = re.compile(
    r"^https://([\w-]+\.)*vercel\.app$"
    r"|^https?://(localhost|127\.0\.0\.1)(:\d+)?$"
    r"|^null$"
)


def now_ms() -> int:
    return int(time.time() * 1000)


class Peer:
    def __init__(self, ws, peer_id: str, name: str):
        self.ws = ws
        self.id = peer_id
        self.name = name
        self.joined = time.monotonic()
        self.buffering = False
        self.chat_times: list[float] = []


class Room:
    def __init__(self, code: str):
        self.code = code
        self.peers: dict[str, Peer] = {}
        self.host_id: str | None = None
        self.empty_since: float | None = None
        self.sync_task: asyncio.Task | None = None
        self.state = {
            "targetHref": "",
            "paused": True,
            "positionSec": 0.0,
            "anchorTs": now_ms(),
            "translationLabel": None,
            "torrent": None,
        }

    def presence_payload(self, why: str = "") -> dict:
        return {
            "type": "presence",
            "why": why,
            "hostId": self.host_id,
            "peers": [
                {"id": p.id, "name": p.name, "buffering": p.buffering}
                for p in self.peers.values()
            ],
        }

    def state_payload(self, by: str | None) -> dict:
        return {"type": "state", "by": by, **self.state}

    async def broadcast(self, msg: dict, exclude: str | None = None) -> None:
        data = json.dumps(msg)
        for p in list(self.peers.values()):
            if exclude and p.id == exclude:
                continue
            try:
                await p.ws.send(data)
            except ConnectionClosed:
                pass

    def unique_name(self, name: str) -> str:
        names = {p.name for p in self.peers.values()}
        if name not in names:
            return name
        i = 2
        while f"{name}\u00b7{i}" in names:
            i += 1
        return f"{name}\u00b7{i}"


ROOMS: dict[str, Room] = {}


def new_peer_id() -> str:
    return random.getrandbits(48).to_bytes(6, "big").hex()


def new_room_code() -> str:
    while True:
        code = "".join(random.choice(ALPHABET) for _ in range(6))
        if code not in ROOMS:
            return code


async def send(ws, msg: dict) -> None:
    try:
        await ws.send(json.dumps(msg))
    except ConnectionClosed:
        pass


def handle_sync(room: Room, peer: Peer, msg: dict) -> dict | None:
    """state/seek от любого участника. Возвращает payload для рассылки."""
    st = room.state
    if msg["type"] == "state":
        st["paused"] = bool(msg.get("paused", False))
        pos = msg.get("positionSec")
        if isinstance(pos, (int, float)):
            st["positionSec"] = max(0.0, float(pos))
    elif msg["type"] == "seek":
        pos = msg.get("positionSec")
        if not isinstance(pos, (int, float)):
            return None
        st["positionSec"] = max(0.0, float(pos))
    st["anchorTs"] = now_ms()
    return room.state_payload(by=peer.id)


async def handle_message(room: Room, peer: Peer, msg: dict) -> None:
    t = msg.get("type")
    is_host = peer.id == room.host_id

    if t == "ping":
        await send(peer.ws, {"type": "pong", "t": msg.get("t"), "serverTs": now_ms()})

    elif t in ("state", "seek"):
        payload = handle_sync(room, peer, msg)
        if payload:
            await room.broadcast(payload)  # всем, включая автора — зеркало должно быть свежим

    elif t == "goto" and is_host:
        href = msg.get("targetHref")
        if not isinstance(href, str) or not href or len(href) > MAX_TARGET:
            return
        st = room.state
        st["targetHref"] = href
        st["positionSec"] = 0.0
        st["paused"] = True
        st["anchorTs"] = now_ms()
        # Новый тайтл: старые озвучка и раздача к нему не относятся —
        # иначе гости будут применять их уже на другом фильме.
        st["translationLabel"] = None
        st["torrent"] = None
        await room.broadcast({"type": "goto", "targetHref": href, "by": peer.id})

    elif t == "translation" and is_host:
        label = msg.get("label")
        if not isinstance(label, str) or not label or len(label) > 120:
            return
        room.state["translationLabel"] = label
        payload = {"type": "translation", "label": label, "by": peer.id}
        # Раздача, на которой сидит хост: у гостей своя может отличаться,
        # тогда дорожки не сойдутся — переводим их на раздачу хоста.
        tor = msg.get("torrent")
        if isinstance(tor, str) and 8 <= len(tor) <= 64:
            room.state["torrent"] = tor.lower()
            payload["torrent"] = tor.lower()
        await room.broadcast(payload)

    elif t == "chat":
        text = (msg.get("text") or "").strip()[:MAX_CHAT]
        if not text:
            return
        now = time.monotonic()
        peer.chat_times = [x for x in peer.chat_times if now - x < CHAT_WINDOW_S]
        if len(peer.chat_times) >= CHAT_BURST:
            return
        peer.chat_times.append(now)
        await room.broadcast(
            {
                "type": "chat",
                "id": new_peer_id(),
                "peerId": peer.id,
                "name": peer.name,
                "text": text,
                "ts": now_ms(),
            }
        )

    elif t == "react":
        emoji = (msg.get("emoji") or "").strip()[:8]
        if emoji:
            await room.broadcast(
                {"type": "react", "id": new_peer_id(), "peerId": peer.id, "name": peer.name, "emoji": emoji}
            )

    elif t == "buffering":
        peer.buffering = bool(msg.get("buffering", False))
        await room.broadcast(room.presence_payload('buffering'))

    elif t == "countdown" and is_host:
        await room.broadcast({"type": "countdown", "startTs": now_ms() + COUNTDOWN_MS, "by": peer.id})

    elif t == "kick" and is_host:
        target = room.peers.get(msg.get("peerId", ""))
        if target and target.id != peer.id:
            await send(target.ws, {"type": "kick", "by": peer.name})
            await target.ws.close(4100, "kicked")


async def state_sync_loop(room: "Room") -> None:
    """Периодическая рассылка состояния. События теряются при обрывах сети —
    фоновая сверка возвращает отставших без чьего-либо участия."""
    try:
        while True:
            await asyncio.sleep(STATE_SYNC_S)
            if room.peers:
                await room.broadcast(room.state_payload(by="server"))
    except asyncio.CancelledError:
        pass


async def handler(ws) -> None:
    origin = (ws.request.headers.get("Origin") or "").strip()
    if origin and not ALLOWED_ORIGIN.match(origin):
        await ws.close(4403, "origin not allowed")
        return

    peer: Peer | None = None
    room: Room | None = None
    try:
        raw = await asyncio.wait_for(ws.recv(), timeout=10)
        hello = json.loads(raw)
        if hello.get("type") != "hello":
            await send(ws, {"type": "error", "code": "bad", "message": "ожидался hello"})
            return

        name = (hello.get("name") or "Гость").strip()[:MAX_NAME] or "Гость"
        action = hello.get("action")

        if action == "create":
            code = new_room_code()
            room = Room(code)
            ROOMS[code] = room
            st = room.state
            href = hello.get("targetHref")
            if isinstance(href, str) and href and len(href) <= MAX_TARGET:
                st["targetHref"] = href
            pos = hello.get("positionSec")
            if isinstance(pos, (int, float)):
                st["positionSec"] = max(0.0, float(pos))
            st["paused"] = bool(hello.get("paused", True))
            label = hello.get("translationLabel")
            if isinstance(label, str) and label:
                st["translationLabel"] = label[:120]
            tor = hello.get("torrent")
            if isinstance(tor, str) and 8 <= len(tor) <= 64:
                st["torrent"] = tor.lower()
            st["anchorTs"] = now_ms()
        elif action == "join":
            code = (hello.get("room") or "").strip().upper()
            room = ROOMS.get(code)
            if room is None:
                await send(ws, {"type": "error", "code": "room_not_found", "message": "комната не найдена"})
                return
            if len(room.peers) >= MAX_PEERS:
                await send(ws, {"type": "error", "code": "full", "message": "комната заполнена"})
                return
        else:
            await send(ws, {"type": "error", "code": "bad", "message": "неизвестное действие"})
            return

        peer = Peer(ws, new_peer_id(), room.unique_name(name))
        room.peers[peer.id] = peer
        room.empty_since = None
        if room.host_id is None or room.host_id == peer.id:
            room.host_id = peer.id

        await send(
            ws,
            {
                "type": "welcome",
                "room": room.code,
                "self": {"id": peer.id, "name": peer.name},
                "hostId": room.host_id,
                "peers": room.presence_payload()["peers"],
                "state": room.state,
                "serverTs": now_ms(),
            },
        )
        await room.broadcast(room.presence_payload('join'))
        if room.sync_task is None or room.sync_task.done():
            room.sync_task = asyncio.create_task(state_sync_loop(room))

        async for raw in ws:
            try:
                msg = json.loads(raw)
            except (ValueError, TypeError):
                continue
            if not isinstance(msg, dict):
                continue
            await handle_message(room, peer, msg)

    except (ConnectionClosed, asyncio.TimeoutError):
        pass
    finally:
        if room and peer:
            room.peers.pop(peer.id, None)
            if not room.peers:
                room.empty_since = time.monotonic()
                room.host_id = None
                if room.sync_task:
                    room.sync_task.cancel()
                    room.sync_task = None
            elif room.host_id == peer.id:
                # Хост вышел — власть переходит к самому раннему участнику.
                room.host_id = next(iter(room.peers))
            await room.broadcast(room.presence_payload('leave'))


async def cleanup_loop() -> None:
    while True:
        await asyncio.sleep(60)
        t = time.monotonic()
        for code, room in list(ROOMS.items()):
            if not room.peers and room.empty_since and t - room.empty_since > ROOM_TTL_S:
                del ROOMS[code]


async def main() -> None:
    asyncio.create_task(cleanup_loop())
    async with serve(
        handler, "127.0.0.1", 8092, ping_interval=20, ping_timeout=20, max_size=8192
    ):
        print("party server on 127.0.0.1:8092", flush=True)
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
