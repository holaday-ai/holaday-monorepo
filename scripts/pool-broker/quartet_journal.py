"""Whole-group preparation sharing the legacy journal's actual FD and flock."""
import hmac
import json

import resource_journal
import slot_identity
from quartet_protocol import QuartetCreateRequest, QuartetResourceRequest, decode_quartet_request
from resource_journal import ResourceJournal


def _deny():
    try:
        raise ValueError('POOL_BROKER_QUARTET_JOURNAL_UNPROVEN') from None
    except ValueError as error:
        error.__context__ = None
        raise


class PreparedQuartet:
    __slots__ = ()

    def __init__(self):
        raise TypeError('private quartet reference')

    def __reduce_ex__(self, _protocol):
        raise TypeError('private quartet reference')


def prepare_quartet(journal, request, *, scope_guard=None, fresh=False):
    try:
        if (type(journal) is not ResourceJournal or type(request) is not QuartetCreateRequest
                or type(fresh) is not bool):
            raise ValueError()

        def operation():
            journal._local()
            data = {'version': request.version, 'action': request.action, 'requestId': request.request_id,
                    'boot': request.boot, 'slot': request.slot}
            if decode_quartet_request(json.dumps(data).encode()) != request or request.boot != journal._boot:
                raise ValueError()
            if fresh and (request.boot, request.request_id) in journal._requests:
                raise ValueError()
            snapshot = journal._io(slot_identity.inspect_slot_identities, journal._candidate)
            identity = snapshot.for_slot(request.slot)
            resource = journal._requests.get((request.boot, request.request_id))
            if resource is not None:
                row = journal._resources[resource]
                if (row['component'] != 'quartet' or row['slot'] != request.slot
                        or row['uid'] != identity.uid or row['gid'] != identity.gid
                        or row['policyDigest'] != snapshot.policy_digest):
                    raise ValueError()
            else:
                resource = journal._io(_random, 16)
                management = journal._io(_random, 32)
                egress = journal._io(_random, 32)
                journal._append(data | {'action': 'prepare', 'resource': resource, 'component': 'quartet',
                    'candidate': journal._candidate, 'uid': identity.uid, 'gid': identity.gid,
                    'policyDigest': snapshot.policy_digest, 'capability': management, 'egressCapability': egress})
            if resource not in journal._handles:
                journal._handles[resource] = object.__new__(PreparedQuartet)
            return journal._handles[resource]
        return journal._run(operation, scope_guard)
    except Exception:
        _deny()


def _random(size):
    # Use the journal's existing OS boundary so entropy failures poison the
    # same writer. Values never leave trusted storage through public results.
    raw = resource_journal.os.urandom(size)
    if type(raw) is not bytes or len(raw) != size or raw == b'\0' * size:
        raise ValueError()
    return raw.hex()


def query_quartet(journal, request):
    try:
        if type(journal) is not ResourceJournal or type(request) is not QuartetResourceRequest:
            raise ValueError()

        def operation():
            journal._local()
            if request.action != 'query' or request.boot != journal._boot:
                raise ValueError()
            decode_quartet_request(json.dumps({'version': request.version, 'action': request.action,
                'requestId': request.request_id, 'boot': request.boot, 'capability': request.capability}).encode())
            row = next((row for row in journal._resources.values() if row['component'] == 'quartet'
                        and hmac.compare_digest(row['capability'], request.capability)), None)
            if row is None:
                raise ValueError()
            return {'state': row['state'], 'groupExitProven': False}
        return journal._run(operation)
    except Exception:
        _deny()
