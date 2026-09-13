"""Single-use original prepared offer backed by the actual durable journal."""
import json
import unittest
from unittest.mock import patch

import resource_journal
import quartet_protocol as protocol
import test_quartet_journal as fixture
try:
    import quartet_create_offer as module
except ModuleNotFoundError as error:
    if error.name != 'quartet_create_offer': raise
    module = None


class CreateOfferTests(unittest.TestCase):
    def test_provided_scope_must_return_positive_finite_budget(self):
        self.assertIsNotNone(module)
        for value in (None, True, 0, float('nan'), float('inf')):
            with self.subTest(value=type(value).__name__), fixture.QuartetJournalTests().system() as s:
                before = s.contents()
                with self.assertRaises(ValueError): module._CreateOffer.open(s.journal,
                    fixture.QuartetJournalTests().request(), scope_guard=lambda: value)
                self.assertEqual(s.contents(), before)

    def open(self, s):
        self.assertIsNotNone(module, 'original create offer missing')
        return module._CreateOffer.open(s.journal, fixture.QuartetJournalTests().request())

    def accepted(self, raw, **change):
        prepared = protocol.decode_control_frame(raw)
        scope = {key: prepared[key] for key in ('version', 'requestId', 'candidate', 'boot', 'resource', 'slot')}
        return protocol.encode_control_frame(scope | {'phase': 'accepted',
            'preparedDigest': protocol.control_prepared_digest(raw)} | change)

    def test_offer_and_accept_are_durable_before_either_original_handoff(self):
        with fixture.QuartetJournalTests().system() as s:
            offer = self.open(s)
            self.assertEqual([json.loads(line)['action'] for line in s.contents().splitlines()][-1], 'create_offer')
            raw = offer.take_prepared()
            offer.accept_frame(self.accepted(raw))
            self.assertEqual([json.loads(line)['action'] for line in s.contents().splitlines()][-1], 'create_accept')
            prepared = offer.consume()
            self.assertIs(prepared, s.journal._handles[offer._resource])
            self.assertGreaterEqual(len(s.syncs), 4)
            self.assertEqual(s.journal._resources[offer._resource]['state'], 'prepared')
            with self.assertRaises(ValueError): offer.consume()

    def test_accept_before_offer_wrong_digest_and_cross_scope_poison_offer(self):
        for mode in ('early', 'digest', 'resource', 'duplicate'):
            with self.subTest(mode=mode), fixture.QuartetJournalTests().system() as s:
                offer = self.open(s)
                raw = offer._frame if mode == 'early' else offer.take_prepared()
                changes = {'preparedDigest': '9'*64} if mode == 'digest' else {'resource': '9'*32} if mode == 'resource' else {}
                if mode == 'duplicate': offer.accept_frame(self.accepted(raw))
                with self.assertRaises(ValueError): offer.accept_frame(self.accepted(raw, **changes))
                with self.assertRaises(ValueError): offer.consume()
                self.assertTrue(offer._retired)

    def test_existing_request_never_reoffers_even_after_original_writer_reopen(self):
        with fixture.QuartetJournalTests().system() as s:
            self.open(s).take_prepared()
            before = s.contents()
            s.journal.close()
            s.journal = resource_journal.ResourceJournal.open(s.registration)
            with self.assertRaises(ValueError): self.open(s)
            self.assertEqual(s.contents(), before)

    def test_offer_write_failure_never_exposes_frame_and_preserves_unknown(self):
        with fixture.QuartetJournalTests().system() as s:
            self.assertIsNotNone(module, 'original create offer missing')
            original = s.proxy.fsync
            def sync(fd):
                original(fd)
                if b'"action":"create_offer"' in s.contents(): raise OSError('synthetic')
            s.proxy.fsync = sync
            with self.assertRaises(ValueError): self.open(s)
            self.assertIn(b'create_offer', s.contents())

    def test_original_total_deadline_and_post_journal_tail_cannot_be_extended(self):
        with fixture.QuartetJournalTests().system() as s:
            offer = self.open(s)
            with patch.object(module.time, 'monotonic_ns', return_value=offer._deadline_ns):
                with self.assertRaises(ValueError): offer.take_prepared()
            self.assertTrue(offer._retired)

    def test_unaccepted_offer_cannot_claim_material(self):
        with fixture.QuartetJournalTests().system() as s:
            offer = self.open(s)
            before = s.contents()
            with self.assertRaises(ValueError):
                s.journal._run(lambda: s.journal._append({'version': 2, 'action': 'material_claim',
                    'resource': offer._resource, 'rootfsDigest': '1'*64,
                    'managerGuid': '2'*32, 'managerOwner': ':1.2'}))
            self.assertEqual(s.contents(), before)


if __name__ == '__main__': unittest.main()
