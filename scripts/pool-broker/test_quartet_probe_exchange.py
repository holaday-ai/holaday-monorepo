"""Bounded protocol bytes, not live service ownership or readiness receipts."""
import base64
import hashlib
import json
import struct
import unittest
import quartet_worker_guard as guard


def x11_setup():
    vendor = b'Test'
    fixed = struct.pack('!IIIIHHBBBBBBBB4x', 1, 0x200000, 0x1fffff, 0, len(vendor), 65535,
                        1, 1, 0, 0, 32, 32, 8, 255)
    format_ = struct.pack('!BBB5x', 24, 32, 32)
    screen = struct.pack('!IIIIIHHHHHHIBBBB', 1, 2, 0xffffff, 0, 0, 1280, 800, 340, 212, 1, 1, 33, 0, 0, 24, 1)
    depth = struct.pack('!BBH4x', 24, 0, 1) + struct.pack('!IBBHIII4x', 33, 4, 8, 256, 0xff0000, 0xff00, 0xff)
    body = fixed + vendor + format_ + screen + depth
    return struct.pack('!BBHHH', 1, 0, 11, 0, len(body) // 4) + body


def server_init():
    return struct.pack('!HHBBBBHHHBBB3xI', 1280, 800, 32, 24, 0, 1, 255, 255, 255, 16, 8, 0, 4) + b'Test'


class ProbeExchangeTests(unittest.TestCase):
    def new(self, stage):
        cls = getattr(guard, '_ProbeExchange', None)
        self.assertIsNotNone(cls, 'fixed bounded protocol exchange missing')
        return cls(stage, b'c' * 16 if stage == 1 else None)

    def sent(self, item):
        data = item._outbound
        if data: item.sent(len(data))
        return data

    def websocket_payload(self, wire):
        self.assertEqual(wire[0], 0x82)
        self.assertTrue(wire[1] & 128)
        length = wire[1] & 127
        self.assertLess(length, 126)
        mask, data = wire[2:6], wire[6:]
        self.assertEqual(len(data), length)
        return bytes(byte ^ mask[index % 4] for index, byte in enumerate(data))

    def ws(self, data):
        return bytes([0x82, len(data)]) + data if len(data) < 126 else b'\x82\x7e' + struct.pack('!H', len(data)) + data

    def upgrade(self, item):
        request = self.sent(item)
        key = request.split(b'Sec-WebSocket-Key: ', 1)[1].split(b'\r\n', 1)[0]
        accept = base64.b64encode(hashlib.sha1(key + b'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest())
        return b'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Protocol: binary\r\nSec-WebSocket-Accept: ' + accept + b'\r\n\r\n'

    def rfb(self, item, websocket=False):
        feed = lambda data: item.feed(self.ws(data) if websocket else data)
        consume = lambda: self.websocket_payload(self.sent(item)) if websocket else self.sent(item)
        feed(b'RFB 003.008\n')
        self.assertEqual(consume(), b'RFB 003.008\n')
        feed(b'\x01\x01')
        self.assertEqual(consume(), b'\x01')
        feed(bytes(4))
        self.assertEqual(consume(), b'\x01')  # Always shared; never disconnect other clients.
        data = server_init()
        feed(data[:13])
        self.assertFalse(item._complete)
        feed(data[13:])
        self.assertTrue(item._complete)
        self.assertEqual(item._outbound, b'')  # Never request framebuffer/screenshot.

    def test_x11_cookie_setup_and_full_reply_required(self):
        item = self.new(1)
        request = self.sent(item)
        self.assertEqual(request[:12], struct.pack('!BBHHHHH', 66, 0, 11, 0, 18, 16, 0))
        self.assertIn(b'MIT-MAGIC-COOKIE-1', request)
        self.assertTrue(request.endswith(b'c' * 16))
        response = x11_setup()
        for byte in response[:-1]: item.feed(bytes([byte]))
        self.assertFalse(item._complete)
        item.feed(response[-1:])
        self.assertTrue(item._complete)

    def test_cdp_fixed_version_not_arbitrary_discovery_or_page(self):
        item = self.new(2)
        self.assertIn(b'GET /json/version HTTP/1.1\r\nHost: 127.0.0.1:19222', self.sent(item))
        body = json.dumps({'Browser': 'Chrome/synthetic', 'Protocol-Version': '1.3',
            'webSocketDebuggerUrl': 'ws://127.0.0.1:19222/devtools/browser/11111111-2222-3333-4444-555555555555'}).encode()
        packet = b'HTTP/1.1 200 OK\r\nContent-Type: application/json; charset=UTF-8\r\nContent-Length: ' + str(len(body)).encode() + b'\r\n\r\n' + body
        item.feed(packet[:20])
        item.feed(packet[20:])
        self.assertTrue(item._complete)

    def test_rfb_requires_security_result_and_shared_server_init(self):
        self.rfb(self.new(3))

    def test_websocket_upgrade_alone_is_not_ready_and_real_rfb_is_required(self):
        item = self.new(4)
        item.feed(self.upgrade(item))
        self.assertFalse(item._complete)
        self.rfb(item, True)

    def test_invalid_or_unbounded_protocols_are_terminal(self):
        cases = [(1, b'\x00' + x11_setup()[1:]), (1, x11_setup() + b'extra'),
                 (2, b'HTTP/1.1 302 Found\r\nContent-Length: 0\r\n\r\n'),
                 (2, b'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n'),
                 (2, b'x' * 4097), (3, b'RFB 003.003\n')]
        for stage, data in cases:
            with self.subTest(stage=stage, length=len(data)):
                item = self.new(stage)
                self.sent(item)
                with self.assertRaises(ValueError): item.feed(data)
                self.assertFalse(item._complete)
                with self.assertRaises(ValueError): item.feed(b'x')

    def test_ws_wrong_accept_mask_and_non_rfb_data_are_rejected(self):
        for mode in ('accept', 'masked', 'text', 'fragment', 'rfb'):
            with self.subTest(mode=mode):
                item = self.new(4)
                upgrade = self.upgrade(item)
                if mode == 'accept':
                    with self.assertRaises(ValueError): item.feed(upgrade.replace(b'Sec-WebSocket-Accept:', b'Invalid-Accept:'))
                    continue
                item.feed(upgrade)
                data = {'masked': b'\x82\x81' + b'1234' + b'x', 'text': b'\x81\x01x',
                        'fragment': b'\x02\x01x', 'rfb': self.ws(b'notRFBbytes!')}[mode]
                with self.assertRaises(ValueError): item.feed(data)

    def test_many_small_binary_messages_do_not_exhaust_python_stack(self):
        item = self.new(4)
        item.feed(self.upgrade(item))
        for incoming in (b'RFB 003.008\n', b'\x01\x01', bytes(4)):
            item.feed(self.ws(incoming))
            self.sent(item)
        data = server_init()[:20] + struct.pack('!I', 1500) + b'n' * 1500
        item.feed(b''.join(self.ws(bytes([byte])) for byte in data))
        self.assertTrue(item._complete)

    def test_cdp_external_discovery_duplicate_json_and_oversized_lengths_deny(self):
        for mode in ('external', 'page', 'duplicate', 'length'):
            with self.subTest(mode=mode):
                item = self.new(2)
                self.sent(item)
                body = json.dumps({'Browser': 'Chrome/synthetic', 'Protocol-Version': '1.3',
                    'webSocketDebuggerUrl': 'ws://127.0.0.1:19222/devtools/browser/11111111-2222-3333-4444-555555555555'}).encode()
                if mode == 'external': body = body.replace(b'127.0.0.1', b'example.test')
                if mode == 'page': body = body.replace(b'/browser/', b'/page/')
                if mode == 'duplicate': body = b'{"Browser":"first",' + body[1:]
                length = b'99999' if mode == 'length' else str(len(body)).encode()
                with self.assertRaises(ValueError):
                    item.feed(b'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ' + length + b'\r\n\r\n' + body)


if __name__ == '__main__': unittest.main()
