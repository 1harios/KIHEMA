"""Offline protocol tests: actual room code, fake sockets, no live users/torrents."""
import asyncio
import importlib.util
import json
import sys
import types
import unittest

# Only the transport import needs a stub on development machines without websockets.
try:
    import websockets.asyncio.server
except ImportError:
    for name in ('websockets', 'websockets.asyncio', 'websockets.asyncio.server', 'websockets.exceptions'):
        sys.modules[name] = types.ModuleType(name)
    sys.modules['websockets.asyncio.server'].serve = None
    sys.modules['websockets.exceptions'].ConnectionClosed = type('ConnectionClosed', (Exception,), {})

spec = importlib.util.spec_from_file_location('party_server', 'deploy/vps/party-server.py')
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)


class Socket:
    def __init__(self):
        self.messages = []

    async def send(self, data):
        self.messages.append(json.loads(data))


class PartyTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.room = server.Room('ABCDEF')
        self.room.state['targetHref'] = '/movie/550-fight-club/watch'
        self.host = server.Peer(Socket(), 'host', 'Host', 2)
        self.guest = server.Peer(Socket(), 'guest', 'Guest', 2)
        self.room.peers = {'host': self.host, 'guest': self.guest}
        self.room.host_id = 'host'

    def report(self, **values):
        return {**dict(type='report', targetHref=self.room.state['targetHref'], ready=True,
                       buffering=False, positionSec=0), **values}

    async def test_countdown_waits_for_both_and_commits_playing_state(self):
        await server.handle_message(self.room, self.host, {'type': 'countdown'})
        self.assertTrue(self.room.state['waitingForReady'])
        await server.handle_message(self.room, self.host, self.report())
        self.assertTrue(self.room.pending_start)
        await server.handle_message(self.room, self.guest, self.report())
        self.assertFalse(self.room.pending_start)
        self.assertFalse(self.room.state['paused'])
        self.assertGreater(self.room.state['anchorTs'], server.now_ms() + 2500)
        self.assertTrue(any(m['type'] == 'countdown' for m in self.guest.ws.messages))
        anchor = self.room.state['anchorTs']
        await server.handle_message(self.room, self.host, self.report())
        self.assertEqual(self.room.state['anchorTs'], anchor)
        self.assertFalse(self.room.state_payload('server')['paused'])

    async def test_media_echo_without_intent_cannot_pause_room(self):
        self.room.state['paused'] = False
        await server.handle_message(self.room, self.guest, {'type': 'state', 'paused': True, 'positionSec': 0})
        self.assertFalse(self.room.state['paused'])
        await server.handle_message(self.room, self.guest, {'type': 'state', 'intent': True, 'paused': True, 'positionSec': 12})
        self.assertTrue(self.room.state['paused'])
        self.assertEqual(self.room.state['positionSec'], 12)

    async def test_guest_buffering_cannot_reanchor_host_clock(self):
        self.room.state.update(paused=False, positionSec=20)
        await server.handle_message(self.room, self.guest, self.report(positionSec=1))
        self.assertEqual(self.room.state['positionSec'], 20)
        self.assertFalse(self.room.state['buffering'])

    async def test_host_buffering_freezes_then_resumes_shared_clock(self):
        self.room.state.update(paused=False, positionSec=20)
        msg = self.report(positionSec=21)
        msg.update(ready=False, buffering=True)
        await server.handle_message(self.room, self.host, msg)
        self.assertTrue(self.room.state['buffering'])
        self.assertEqual(server.position(self.room), 21)
        await server.handle_message(self.room, self.host, self.report(positionSec=21))
        self.assertFalse(self.room.state['buffering'])

    async def test_other_title_and_nonfinite_positions_are_ignored(self):
        for value in (float('nan'), float('inf'), -1, True):
            await server.handle_message(self.room, self.host, {'type': 'seek', 'intent': True, 'positionSec': value})
        await server.handle_message(self.room, self.host, {'type': 'seek', 'intent': True, 'positionSec': 40, 'targetHref': '/movie/1-other/watch'})
        self.assertEqual(self.room.state['positionSec'], 0)

    async def test_source_mismatch_is_not_ready(self):
        self.room.state['torrent'] = 'a' * 40
        await server.handle_message(self.room, self.guest, self.report(torrent='b' * 40))
        self.assertFalse(self.guest.ready)

    async def test_goto_clears_previous_source_and_readiness(self):
        self.room.pending_start = True
        self.host.ready = self.guest.ready = True
        self.room.state['torrent'] = 'a' * 40
        await server.handle_message(self.room, self.host, {'type': 'goto', 'targetHref': '/show/1-show/watch?season=2&episode=3&t=99&room=OLDOLD'})
        self.assertEqual(self.room.state['targetHref'], '/show/1-show/watch?episode=3&season=2')
        self.assertTrue(self.room.pending_start)
        self.assertIsNone(self.room.state['torrent'])
        self.assertFalse(self.guest.ready)

    async def test_new_movie_waits_for_host_source_then_starts_everyone(self):
        await server.handle_message(self.room, self.host, {'type': 'goto', 'targetHref': '/movie/2-test/watch', 'title': 'Новый фильм'})
        self.assertEqual(self.room.state['changeLabel'], 'Новый фильм')
        await server.handle_message(self.room, self.host, self.report())
        await server.handle_message(self.room, self.guest, self.report())
        self.assertTrue(self.room.pending_start)
        self.assertTrue(self.room.state['sourcePending'])
        await server.handle_message(self.room, self.host, {'type': 'translation', 'label': 'Озвучка', 'torrent': 'a' * 40})
        await server.handle_message(self.room, self.host, self.report(torrent='a' * 40, translationLabel='Озвучка'))
        self.assertTrue(self.room.pending_start)
        await server.handle_message(self.room, self.guest, self.report(torrent='a' * 40, translationLabel='Озвучка'))
        self.assertFalse(self.room.pending_start)
        self.assertFalse(self.room.state['paused'])
        self.assertEqual(self.room.state['changeKind'], 'movie')
        self.assertGreater(self.room.state['anchorTs'], server.now_ms() + 2500)

    async def test_preparing_torrent_freezes_before_resolver_finishes(self):
        self.room.state.update(paused=False, positionSec=30, translationLabel='Озвучка', torrent='a' * 40)
        await server.handle_message(self.room, self.host, {'type': 'prepare'})
        self.assertTrue(self.room.state['sourcePending'])
        self.assertTrue(self.room.state['paused'])
        self.assertTrue(self.room.pending_start)
        await server.handle_message(self.room, self.host, self.report(torrent='a' * 40, translationLabel='Озвучка'))
        self.assertFalse(self.host.ready)
        await server.handle_message(self.room, self.host, {'type': 'translation', 'label': 'Озвучка', 'torrent': 'b' * 40})
        self.assertFalse(self.room.state['sourcePending'])
        self.assertEqual(self.room.state['torrent'], 'b' * 40)
        self.assertEqual(self.room.state['changeId'], 1)

    async def test_sources_without_audio_menu_can_finish_movie_change(self):
        await server.handle_message(self.room, self.host, {'type': 'goto', 'targetHref': '/movie/2-test/watch'})
        await server.handle_message(self.room, self.host, {'type': 'translation', 'label': None})
        await server.handle_message(self.room, self.host, self.report())
        await server.handle_message(self.room, self.guest, self.report())
        self.assertFalse(self.room.pending_start)

    async def test_guest_cannot_change_movie_or_prepare_source(self):
        for msg in ({'type': 'goto', 'targetHref': '/movie/2-test/watch'}, {'type': 'prepare'}, {'type': 'translation', 'label': 'Другая'}):
            await server.handle_message(self.room, self.guest, msg)
        self.assertEqual(self.room.state['changeId'], 0)
        self.assertEqual(self.room.state['targetHref'], '/movie/550-fight-club/watch')

    async def test_switching_back_to_cdn_clears_torrent_selection(self):
        self.room.state['torrent'] = 'a' * 40
        await server.handle_message(self.room, self.host, {'type': 'translation', 'label': 'CDN', 'torrent': None})
        self.assertIsNone(self.room.state['torrent'])

    async def test_rate_is_shared(self):
        await server.handle_message(self.room, self.guest, {'type': 'rate', 'intent': True, 'rate': 1.5, 'positionSec': 25})
        self.assertEqual(self.room.state['rate'], 1.5)

    async def test_play_click_cannot_bypass_loading_barrier(self):
        self.room.state['sourcePending'] = True
        await server.handle_message(self.room, self.host, {'type': 'state', 'intent': True, 'paused': False, 'positionSec': 5})
        self.assertTrue(self.room.state['paused'])
        self.assertTrue(self.room.pending_start)
        await server.handle_message(self.room, self.guest, {'type': 'seek', 'intent': True, 'positionSec': 10})
        self.assertTrue(self.room.pending_start)
        self.assertTrue(self.room.state['waitingForReady'])

    async def test_translation_waits_for_matching_source_before_restart(self):
        self.room.state['paused'] = False
        await server.handle_message(self.room, self.host, {'type': 'translation', 'label': 'Русская озвучка', 'torrent': 'a' * 40})
        self.assertTrue(self.room.pending_start)
        await server.handle_message(self.room, self.host, self.report(torrent='a' * 40, translationLabel='Русская озвучка'))
        await server.handle_message(self.room, self.guest, self.report(torrent='a' * 40, translationLabel='Другая озвучка'))
        self.assertTrue(self.room.pending_start)
        await server.handle_message(self.room, self.guest, self.report(torrent='a' * 40, translationLabel='Русская озвучка'))
        self.assertFalse(self.room.pending_start)

    def test_invite_target_cannot_be_external(self):
        for href in ('https://example.com/movie/1/watch', '//example.com/movie/1/watch', '/login'):
            self.assertIsNone(server.watch_href(href))


if __name__ == '__main__':
    unittest.main()
