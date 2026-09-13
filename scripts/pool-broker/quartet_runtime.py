"""Private original running-group owner. Never reconstruct from durable ready."""
from quartet_material import _GroupMaterial
from quartet_create_offer import _CreateOffer
from quartet_records import ROLES


def _deny():
    try:
        raise ValueError('POOL_BROKER_RUNNING_GROUP_UNPROVEN') from None
    except ValueError as error:
        error.__context__ = None
        raise


class _RunningQuartet:
    def __init__(self): raise TypeError('private original running group')
    def __reduce_ex__(self, _protocol): raise TypeError('private original running group')

    @classmethod
    def adopt(cls, material, offer):
        try:
            if (type(material) is not _GroupMaterial or type(offer) is not _CreateOffer
                    or material._busy or material._runtime is not None or material._ready_offer is not offer
                    or material._launch_offer is not offer
                    or not offer._accepted or not offer._consumed or material._prepared is not offer._prepared
                    or material._journal is not offer._journal or material._resource != offer._resource
                    or material._create_deadline_ns != offer._deadline_ns
                    or len(material._terminal_workers) != 5
                    or material._journal._resources[material._resource]['state'] != 'ready'): raise ValueError()
            item = object.__new__(cls)
            item._material, item._offer, item._workers = material, offer, material._terminal_workers
            item._retired = False
            offer._budget()  # Original create/control deadline, including its tail.
            material._owner_veto()
            # No native boundary between the final original veto and transfer.
            material._runtime = item
            item._veto()
            return item
        except Exception:
            if type(material) is _GroupMaterial: material.close()
            _deny()

    def _veto(self):
        material, offer = self._material, self._offer
        if (self._retired or material._retired or material._runtime is not self or material._ready_offer is not offer
                or material._terminal_workers is not self._workers or len(self._workers) != 5
                or offer._journal is not material._journal or offer._prepared is not material._prepared
                or not offer._accepted or not offer._consumed
                or material._journal._resources[material._resource]['state'] != 'ready'):
            raise ValueError()
        offer._veto()  # Original ownership only; no obsolete creation time scope.

    def check(self):
        try:
            self._veto()
            material = self._material
            def verify():
                material._anchor_locked()
                for role in ROLES[1:]:
                    material._workers[role]._view._check_running_locked(scope_guard=material._remaining)
                material._probe_clock._check_locked(scope_guard=material._remaining)
                for _role, _worker, pin, _view in self._workers:
                    pin._run(pin._observe, material._remaining, locked=True)
                material._remaining()
            material._run(verify)
            self._veto()
            material._owner_veto()
        except Exception:
            self.retire()
            _deny()

    def _discard(self):
        self._retired = True
        self._offer.close()

    def retire(self):
        self._retired = True
        self._material.close()
        self._offer.close()
        # No stop, groupExit, physical slot release, or successful drain claim.
