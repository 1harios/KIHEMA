#!/usr/bin/env python3
"""Kinema party server — комнаты для совместного просмотра.

Только хранит авторитетное состояние комнаты и ретранслирует события
между участниками. Логики воспроизведения здесь нет — плееры клиентов
сами выравниваются по присланному состоянию.
"""

import asyncio
import json
import math
import random
import re
import secrets
import time
from urllib.parse import parse_qs, urlencode, urlsplit

from websockets.asyncio.server import serve
from websockets.exceptions import ConnectionClosed

ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"  # без 0/O/1/I — код читаем на слух
ROOM_TTL_S = 600        # пустая комната живёт 10 минут (запас на перезагрузку страницы)
STATE_SYNC_S = 3.0
MAX_PEERS = 20
MAX_NAME = 24
MAX_CHAT = 300
MAX_TARGET = 300
CHAT_BURST = 5          # сообщений за окно
CHAT_WINDOW_S = 1.0
COUNTDOWN_MS = 3000
RECONNECT_GRACE_S = 12

ALLOWED_ORIGIN = re.compile(
    r"^https://([\w-]+\.)*vercel\.app$"
    r"|^https://kihema\.93-123-84-128\.sslip\.io$"
    r"|^https?://(localhost|127\.0\.0\.1)(:\d+)?$"
    r"|^null$"
)


def now_ms() -> int:
    return int(time.time() * 1000)


def valid_position(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and 0 <= value <= 604800


def watch_href(value) -> str | None:
    if not isinstance(value, str) or not value.startswith('/') or value.startswith('//') or len(value) > MAX_TARGET:
        return None
    url = urlsplit(value)
    external = re.fullmatch(r'/rutube/[a-f0-9]{32}/watch', url.path)
    if not re.fullmatch(r'/(movie|show)/[^/]+/watch', url.path) and not external:
        return None
    if external:
        return url.path
    query = parse_qs(url.query)
    params = {key: query[key][0] for key in sorted(('season', 'episode', 's', 'e')) if key in query and query[key][0].isdigit()}
    return url.path + ('?' + urlencode(params) if params else '')


def position(room: 'Room') -> float:
    st = room.state
    elapsed = 0 if st['paused'] or st['buffering'] else max(0, now_ms() - st['anchorTs']) / 1000
    return st['positionSec'] + elapsed * st['rate']


def reanchor(room: 'Room', pos: float | None = None) -> None:
    room.state['positionSec'] = position(room) if pos is None else pos
    room.state['anchorTs'] = now_ms()
    room.state['revision'] += 1


class Peer:
    def __init__(self, ws, peer_id: str, name: str, protocol: int = 1):
        self.ws = ws
        self.id = peer_id
        self.name = name
        self.joined = time.monotonic()
        self.buffering = False
        self.ready = protocol < 2
        self.protocol = protocol
        self.resume_token = secrets.token_urlsafe(24)
        self.chat_times: list[float] = []


class Room:
    def __init__(self, code: str):
        self.code = code
        self.peers: dict[str, Peer] = {}
        self.host_id: str | None = None
        self.empty_since: float | None = None
        self.sync_task: asyncio.Task | None = None
        self.host_task: asyncio.Task | None = None
        self.disconnected: dict[str, tuple[Peer, float]] = {}
        self.pending_start = False
        self.state = {
            "targetHref": "",
            "paused": True,
            "positionSec": 0.0,
            "anchorTs": now_ms(),
            "translationLabel": None,
            "torrent": None,
            "rate": 1.0,
            "buffering": False,
            "waitingForReady": False,
            "revision": 0,
            "sourcePending": False,
            "changeId": 0,
            "changeKind": None,
            "changeLabel": None,
        }

    def presence_payload(self, why: str = "") -> dict:
        return {
            "type": "presence",
            "why": why,
            "hostId": self.host_id,
            "peers": [
                {"id": p.id, "name": p.name, "buffering": p.buffering, "ready": p.ready}
                for p in self.peers.values()
            ],
        }

    def state_payload(self, by: str | None) -> dict:
        return {"type": "state", "by": by, "serverTs": now_ms(), **self.state}

    async def broadcast(self, msg: dict, exclude: str | None = None) -> None:
        data = json.dumps(msg)
        async def deliver(p):
            if exclude and p.id == exclude:
                return
            try:
                await p.ws.send(data)
            except ConnectionClosed:
                pass
        await asyncio.gather(*(deliver(p) for p in list(self.peers.values())))

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
    if peer.protocol >= 2 and msg.get('intent') is not True:
        return None
    if watch_href(msg.get('targetHref', st['targetHref'])) != st['targetHref']:
        return None
    pos = msg.get('positionSec')
    if not valid_position(pos):
        return None
    reanchor(room, float(pos))
    if msg["type"] == "state":
        wants_pause = bool(msg.get("paused", False))
        must_wait = st['sourcePending'] or not all(p.ready for p in room.peers.values())
        room.pending_start = not wants_pause and must_wait
        st['waitingForReady'] = room.pending_start
        st["paused"] = wants_pause or must_wait
    elif msg["type"] == "seek":
        pass
    elif msg['type'] == 'rate':
        rate = msg.get('rate')
        if isinstance(rate, (int, float)) and rate in (0.5, 0.75, 1, 1.25, 1.5, 1.75, 2):
            st['rate'] = float(rate)
    return room.state_payload(by=peer.id)


async def maybe_start(room: Room) -> None:
    if not room.pending_start or not room.peers or room.host_id not in room.peers:
        return
    if room.state['sourcePending'] or not all(p.ready for p in room.peers.values()):
        return
    room.pending_start = False
    reanchor(room)
    room.state.update(paused=False, buffering=False, waitingForReady=False, anchorTs=now_ms() + COUNTDOWN_MS)
    await room.broadcast(room.state_payload('server'))
    await room.broadcast({'type': 'countdown', 'startTs': room.state['anchorTs']})


async def handle_message(room: Room, peer: Peer, msg: dict) -> None:
    t = msg.get("type")
    is_host = peer.id == room.host_id

    if t == "ping":
        await send(peer.ws, {"type": "pong", "t": msg.get("t"), "serverTs": now_ms()})

    elif t in ("state", "seek", "rate"):
        payload = handle_sync(room, peer, msg)
        if payload:
            await room.broadcast(payload)  # всем, включая автора — зеркало должно быть свежим

    elif t == "goto" and is_host:
        href = msg.get("targetHref")
        href = watch_href(href)
        if not href:
            return
        st = room.state
        st["targetHref"] = href
        if href.startswith('/rutube/'):
            st['rate'] = 1.0  # The public RUTUBE API has no playback-rate command.
        st["positionSec"] = 0.0
        st["paused"] = True
        st["anchorTs"] = now_ms()
        # Новый тайтл: старые озвучка и раздача к нему не относятся —
        # иначе гости будут применять их уже на другом фильме.
        st["translationLabel"] = None
        st["torrent"] = None
        st['buffering'] = False
        st['waitingForReady'] = True
        st['sourcePending'] = True
        st['changeId'] += 1
        st['changeKind'] = 'movie'
        title = msg.get('title')
        st['changeLabel'] = title.strip()[:200] if isinstance(title, str) else None
        st['revision'] += 1
        room.pending_start = True
        for p in room.peers.values():
            p.ready = p.protocol < 2
        await room.broadcast(room.state_payload(peer.id))
        await room.broadcast(room.presence_payload('loading'))

    elif t == 'prepare' and is_host:
        # Freeze the shared clock BEFORE resolving the host's new torrent.
        # Guests keep the old frame, never continue playing the old source.
        reanchor(room)
        resume = not room.state['paused'] or room.pending_start
        room.state.update(paused=True, buffering=False, waitingForReady=resume, sourcePending=True,
                          changeKind='source', changeLabel=None)
        room.pending_start = resume
        room.state['changeId'] += 1
        for p in room.peers.values():
            p.ready = p.protocol < 2
        await room.broadcast(room.state_payload(peer.id))
        await room.broadcast(room.presence_payload('loading'))

    elif t == "translation" and is_host:
        label = msg.get("label")
        if label is not None and (not isinstance(label, str) or not label or len(label) > 500):
            return
        if label is None and not room.state['sourcePending']:
            return
        tor = msg.get('torrent')
        if 'torrent' in msg and tor is None:
            tor = None
        else:
            tor = tor.lower() if isinstance(tor, str) and re.fullmatch(r'[a-fA-F0-9]{40}|[a-zA-Z2-7]{32}', tor) else room.state['torrent']
        pending = room.state['sourcePending']
        if not pending and label == room.state['translationLabel'] and tor == room.state['torrent']:
            return
        if not pending:
            room.state['changeId'] += 1
            room.state['changeKind'] = 'translation'
            room.state['changeLabel'] = label
        room.state['sourcePending'] = False
        if not room.state['paused'] or room.pending_start:
            reanchor(room)
            room.state.update(paused=True, waitingForReady=True, buffering=False)
            room.pending_start = True
        for p in room.peers.values():
            p.ready = p.protocol < 2
        room.state["translationLabel"] = label
        payload = {"type": "translation", "label": label, "by": peer.id, "torrent": tor}
        # Раздача, на которой сидит хост: у гостей своя может отличаться,
        # тогда дорожки не сойдутся — переводим их на раздачу хоста.
        room.state["torrent"] = tor
        room.state['revision'] += 1
        await room.broadcast(payload)
        await room.broadcast(room.state_payload(peer.id))
        await room.broadcast(room.presence_payload('loading'))

    elif t == "chat":
        text = msg.get('text')
        if not isinstance(text, str):
            return
        text = text.strip()[:MAX_CHAT]
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
        emoji = msg.get('emoji')
        if not isinstance(emoji, str):
            return
        emoji = emoji.strip()[:8]
        if emoji:
            await room.broadcast(
                {"type": "react", "id": new_peer_id(), "peerId": peer.id, "name": peer.name, "emoji": emoji}
            )

    elif t == "buffering":
        peer.buffering = bool(msg.get("buffering", False))
        await room.broadcast(room.presence_payload('buffering'))

    elif t == 'report':
        st = room.state
        if watch_href(msg.get('targetHref')) != st['targetHref']:
            return
        source_matches = not st['torrent'] or msg.get('torrent') == st['torrent']
        label_matches = not st['translationLabel'] or msg.get('translationLabel') == st['translationLabel']
        blocking = st['targetHref'].startswith('/rutube/') and msg.get('blocking') is True
        ready = msg.get('ready') is True and source_matches and label_matches and not st['sourcePending'] and not blocking
        changed = ready != peer.ready or bool(msg.get('buffering')) != peer.buffering
        peer.ready = ready
        peer.buffering = bool(msg.get('buffering'))
        pos = msg.get('positionSec')
        # Ads/permission prompts belong to RUTUBE, not the shared content clock.
        # Wait for every viewer without skipping or trying to pause their ads.
        if blocking and not st['paused']:
            reanchor(room)
            st.update(paused=True, waitingForReady=True, buffering=False)
            room.pending_start = True
            await room.broadcast(room.state_payload('server'))
        # Only the host's actual media clock anchors playback, not a guest's lag.
        # Never let a heartbeat turn a scheduled countdown into an immediate start.
        if is_host and not st['waitingForReady'] and now_ms() >= st['anchorTs'] and valid_position(pos):
            buffering = not ready
            if buffering != st['buffering'] or (not st['paused'] and abs(position(room) - pos) > 0.4):
                reanchor(room, float(pos))
                st['buffering'] = buffering
                await room.broadcast(room.state_payload('server'))
        if changed:
            await room.broadcast(room.presence_payload('ready'))
        await maybe_start(room)

    elif t == "countdown" and is_host:
        reanchor(room)
        room.state.update(paused=True, waitingForReady=True, buffering=False)
        room.pending_start = True
        await room.broadcast(room.state_payload('server'))
        await maybe_start(room)

    elif t == "kick" and is_host:
        target = room.peers.get(msg.get("peerId", ""))
        if target and target.id != peer.id:
            target.resume_token = ''
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
    if origin and not ALLOWED_ORIGIN.fullmatch(origin):
        await ws.close(4403, "origin not allowed")
        return

    peer: Peer | None = None
    room: Room | None = None
    try:
        raw = await asyncio.wait_for(ws.recv(), timeout=10)
        hello = json.loads(raw)
        if not isinstance(hello, dict) or hello.get("type") != "hello":
            await send(ws, {"type": "error", "code": "bad", "message": "ожидался hello"})
            return

        name = hello.get('name')
        name = name.strip()[:MAX_NAME] if isinstance(name, str) and name.strip() else 'Гость'
        action = hello.get("action")

        if action == "create":
            code = new_room_code()
            room = Room(code)
            ROOMS[code] = room
            st = room.state
            href = watch_href(hello.get("targetHref"))
            if href:
                st["targetHref"] = href
            else:
                del ROOMS[code]
                await send(ws, {'type': 'error', 'code': 'bad_target', 'message': 'Откройте видео, чтобы создать комнату'})
                return
            pos = hello.get("positionSec")
            if valid_position(pos):
                st["positionSec"] = max(0.0, float(pos))
            st["paused"] = bool(hello.get("paused", True))
            label = hello.get("translationLabel")
            if isinstance(label, str) and label:
                st["translationLabel"] = label[:500]
            tor = hello.get("torrent")
            if isinstance(tor, str) and 8 <= len(tor) <= 64:
                st["torrent"] = tor.lower()
            st["anchorTs"] = now_ms()
        elif action == "join":
            code = hello.get('room')
            code = code.strip().upper() if isinstance(code, str) else ''
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

        token = hello.get('resumeToken')
        previous = room.disconnected.pop(token, None) if isinstance(token, str) else None
        if previous and previous[1] > time.monotonic():
            old = previous[0]
            peer = Peer(ws, old.id, old.name, int(hello.get('protocol', 1)))
        else:
            peer = Peer(ws, new_peer_id(), room.unique_name(name), int(hello.get('protocol', 1)))
        room.peers[peer.id] = peer
        room.empty_since = None
        if room.host_id is None or room.host_id == peer.id:
            room.host_id = peer.id
            if room.host_task:
                room.host_task.cancel()
                room.host_task = None

        # Late joiners must finish loading before the group clock runs away.
        # Freeze at the current room position and restart with the same barrier.
        if len(room.peers) > 1 and peer.protocol >= 2 and not room.state['paused']:
            reanchor(room)
            room.state.update(paused=True, waitingForReady=True, buffering=False)
            room.pending_start = True

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
                "resumeToken": peer.resume_token,
                "protocol": 2,
            },
        )
        await room.broadcast(room.presence_payload('join'))
        await room.broadcast(room.state_payload('server'))
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

    except (ConnectionClosed, asyncio.TimeoutError, ValueError, TypeError):
        pass
    finally:
        if room and peer and room.peers.get(peer.id) is peer:
            room.peers.pop(peer.id, None)
            if peer.resume_token:
                room.disconnected[peer.resume_token] = (peer, time.monotonic() + ROOM_TTL_S)
            if not room.peers:
                room.empty_since = time.monotonic()
                if room.sync_task:
                    room.sync_task.cancel()
                    room.sync_task = None
            if room.host_id == peer.id:
                reanchor(room)
                room.state['buffering'] = True
                await room.broadcast(room.state_payload('server'))
                room.host_task = asyncio.create_task(transfer_host(room, peer.id))
            await room.broadcast(room.presence_payload('leave'))
            await maybe_start(room)


async def transfer_host(room: Room, previous_id: str) -> None:
    await asyncio.sleep(RECONNECT_GRACE_S)
    if room.host_id == previous_id and previous_id not in room.peers:
        room.host_id = next(iter(room.peers), None)
        await room.broadcast(room.presence_payload('host'))
        await maybe_start(room)


async def cleanup_loop() -> None:
    while True:
        await asyncio.sleep(60)
        t = time.monotonic()
        for code, room in list(ROOMS.items()):
            room.disconnected = {token: entry for token, entry in room.disconnected.items() if entry[1] > t}
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
