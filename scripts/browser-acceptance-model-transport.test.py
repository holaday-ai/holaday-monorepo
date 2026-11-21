"""Real local HTTP timing/receipts, never the provider or a real model ledger."""
import importlib.util
import json
from pathlib import Path
import signal
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import Request

path = Path(__file__).with_name('browser-acceptance-model-transport.py')
spec = importlib.util.spec_from_file_location('acceptance_transport', path)
transport = importlib.util.module_from_spec(spec) if path.exists() else None
if transport:
    spec.loader.exec_module(transport)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_GET(self):
        self.server.paths.append(self.path)
        try:
            if self.path == '/headers': time.sleep(0.25)
            status = 302 if self.path == '/redirect' else 429 if self.path == '/error' else 200
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('X-Request-ID', '00000000-0000-4000-8000-000000000007')
            self.send_header('Set-Cookie', 'private-do-not-record')
            if status == 302: self.send_header('Location', '/must-not-follow')
            self.end_headers()
            if self.path == '/body': time.sleep(0.25)
            if self.path == '/trickle':
                for _index in range(20):
                    self.wfile.write(b'x')
                    self.wfile.flush()
                    time.sleep(0.015)
            elif self.path == '/large': self.wfile.write(b'x'*129)
            else:
                self.wfile.write(json.dumps({'id': 'msg_fixture', 'content': [{'text': 'not audit metadata'}],
                    'usage': {'input_tokens': 5, 'output_tokens': 3, 'cache_read_input_tokens': 2}}).encode())
        except (BrokenPipeError, ConnectionResetError):
            pass


class TransportTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        cls.server.daemon_threads = True
        cls.server.paths = []
        cls.worker = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.worker.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.worker.join(timeout=2)

    def setUp(self):
        self.assertIsNotNone(transport, 'bounded real transport has not been implemented')
        self.server.paths.clear()

    def fetch(self, route, **kwargs):
        return transport.bounded_http(Request(f'http://127.0.0.1:{self.server.server_port}{route}'),
                                      timeout_seconds=kwargs.pop('timeout_seconds', 0.7), **kwargs)

    def test_actual_reply_keeps_body_and_only_selected_headers(self):
        result = self.fetch('/ok')
        self.assertEqual(result['status'], 200)
        self.assertEqual(json.loads(result['body'])['content'][0]['text'], 'not audit metadata')
        self.assertEqual(result['headers'], {'x-request-id': '00000000-0000-4000-8000-000000000007'})
        self.assertEqual(self.server.paths, ['/ok'])
        metadata = transport.receipt_metadata(result['status'], result['headers'], result['body'])
        self.assertEqual(metadata['providerRequestId'], result['headers']['x-request-id'])
        self.assertEqual(metadata['usage'], {'input_tokens': 5, 'output_tokens': 3, 'cache_read_input_tokens': 2})
        self.assertNotIn('not audit metadata', json.dumps(metadata))
        self.assertNotIn('private-do-not-record', json.dumps(metadata))

    def test_slow_headers_body_and_progressing_stream_obey_total_deadline_without_retry(self):
        old_handler = signal.getsignal(signal.SIGALRM)
        for route in ['/headers', '/body', '/trickle']:
            self.server.paths.clear()
            with self.subTest(route=route):
                start = time.monotonic()
                with self.assertRaises(TimeoutError): self.fetch(route, timeout_seconds=0.055)
                self.assertLess(time.monotonic()-start, 0.22)
                self.assertEqual(self.server.paths, [route])
                self.assertEqual(signal.getsignal(signal.SIGALRM), old_handler)
                self.assertEqual(signal.getitimer(signal.ITIMER_REAL)[0], 0)

    def test_oversize_response_is_not_truncated_into_a_success(self):
        with self.assertRaisesRegex(ValueError, 'TOO_LARGE'):
            self.fetch('/large', max_bytes=128)
        self.assertEqual(self.server.paths, ['/large'])

    def test_redirect_is_returned_without_sending_to_another_target(self):
        result = self.fetch('/redirect')
        self.assertEqual(result['status'], 302)
        self.assertEqual(self.server.paths, ['/redirect'])

    def test_http_error_receipt_is_distinct_from_missing_transport_response(self):
        result = self.fetch('/error')
        self.assertEqual(result['status'], 429)
        self.assertTrue(result['body'])
        self.assertEqual(self.server.paths, ['/error'])

    def test_metadata_drops_credentials_text_and_invalid_numeric_values(self):
        key = 'sk-synthetic-never-a-provider-key'
        body = json.dumps({'id': key, 'content': key, 'request_id': key,
            'usage': {'input_tokens': True, 'output_tokens': -1, 'cache_read_input_tokens': 1,
                      'untrusted': key}}).encode()
        metadata = transport.receipt_metadata(200, {'x-request-id': key, 'authorization': key}, body,
                                              credential=key)
        self.assertNotIn(key, json.dumps(metadata))
        self.assertIsNone(metadata['providerRequestId'])
        self.assertEqual(metadata['usage'], {'cache_read_input_tokens': 1})
        self.assertNotIn('content', metadata)

    def test_invalid_budgets_and_nested_deadlines_do_not_send(self):
        for timeout in [0, 76, True, float('nan')]:
            with self.subTest(timeout=timeout), self.assertRaises(ValueError):
                self.fetch('/ok', timeout_seconds=timeout)
        with self.assertRaises(ValueError): self.fetch('/ok', max_bytes=True)
        signal.setitimer(signal.ITIMER_REAL, 5)
        try:
            with self.assertRaisesRegex(RuntimeError, 'DEADLINE_ALREADY'):
                self.fetch('/ok')
            self.assertGreater(signal.getitimer(signal.ITIMER_REAL)[0], 0)
        finally:
            signal.setitimer(signal.ITIMER_REAL, 0)
        self.assertEqual(self.server.paths, [])


if __name__ == '__main__':
    unittest.main()
