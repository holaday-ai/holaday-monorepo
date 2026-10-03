"""Real journal/manager control flow; only Linux and external busctl are synthetic."""
import contextlib
import hashlib
import json
import unittest
from unittest.mock import patch

import manager_probe
import resource_journal
import test_manager_probe
from protocol import decode_request

try:
    import xvfb_launch
except ModuleNotFoundError as error:
    if error.name != 'xvfb_launch': raise
    xvfb_launch = None

NATIVE = test_manager_probe.NATIVE


class LaunchTests(unittest.TestCase):
    def request(self, **changes):
        return decode_request(json.dumps({'version':1, 'action':'create', 'boot':'b'*32,
            'requestId':'c'*32, 'component':'xvfb', 'slot':1} | changes).encode())

    @contextlib.contextmanager
    def system(self):
        self.assertIsNotNone(xvfb_launch, 'fixed launch transaction missing')
        def setup(root, package, manifest):
            folder=root/'var/lib/holaday-pool-broker'; folder.mkdir(parents=True); folder.chmod(0o700)
            path=folder/'resource-journal.jsonl'; path.write_bytes(resource_journal._HEADER); path.chmod(0o600)
            auth=root/'etc/holaday-pool-broker/xauthority'; auth.mkdir(parents=True); auth.chmod(0o700)
            source=auth/'slot-1.auth'; source.write_bytes(b'synthetic-not-a-credential'); source.chmod(0o600)
            tool=root/'usr/bin/Xvfb'; tool.write_bytes(b'synthetic Xvfb, never executed'); tool.chmod(0o755)
            manifest['tools']['/usr/bin/Xvfb']={'resolved':'/usr/bin/Xvfb',
                'sha256':hashlib.sha256(tool.read_bytes()).hexdigest()}
            (package/'native-build-manifest.json').write_text(json.dumps(manifest))
        with test_manager_probe.ProbeTests().system(setup) as s, contextlib.ExitStack() as stack:
            stack.enter_context(patch.object(resource_journal, 'os', s.proxy))
            manager=manager_probe.SystemManagerProbe.open(s.registration)
            journal=resource_journal.ResourceJournal.open(s.registration)
            path=s.root/'var/lib/holaday-pool-broker/resource-journal.jsonl'
            s.manager,s.journal,s.path=manager,journal,path
            s.events=[]; s.mode=None; s.hook=lambda method:None
            s.rows=lambda:[json.loads(line) for line in path.read_bytes().splitlines()]
            original=manager_probe._capture.side_effect
            sync=s.proxy.fsync
            def fsync(fd):
                sync(fd); s.events.append('sync')
            stack.enter_context(patch.object(s.proxy,'fsync',side_effect=fsync))
            def capture(argv,fd,deadline,guard):
                if argv[8]=='org.freedesktop.DBus': return original(argv,fd,deadline,guard)
                guard(); method=argv[11]; s.events.append(method); s.hook(method)
                self.assertEqual(argv[8],':1.5')
                self.assertIn('guid='+'d'*32,argv[1])
                if method=='StartTransientUnit':
                    rows=s.rows(); self.assertEqual(rows[-1]['action'],'dispatch')
                    self.assertEqual(s.events[-3:-1],['sync','sync'])
                    self.assertEqual(rows[-1]['managerOwner'],':1.5')
                    s.start_argv=argv
                    if s.mode=='lost': raise TimeoutError()
                    if s.mode=='exists': raise ValueError('synthetic UnitExists')
                    if s.mode=='bad-job': return b'{"type":"o","data":["/wrong/job/7"]}'
                    return b'{"type":"o","data":["/org/freedesktop/systemd1/job/7"]}'
                unit=s.rows()[2]['unit']; obj='/org/freedesktop/systemd1/unit/'+unit.replace('-','_2d').replace('.','_2e')
                if method=='GetUnit':
                    return json.dumps({'type':'o','data':[obj if s.mode!='wrong-path' else obj+'x']}).encode()
                self.assertEqual(method,'Get'); self.assertEqual(argv[9],obj)
                prop=argv[-1]
                value=unit if prop=='Id' else [1]*16
                if prop=='InvocationID':
                    if s.mode=='zero': value=[0]*16
                    if s.mode=='bool': value=[True]*16
                    if s.mode=='drift' and s.events.count('Get')>=3: value=[18]*16
                    if s.mode=='second-bool' and s.events.count('Get')>=3: value=[True]*16
                return json.dumps({'type':'v','data':[{'type':'s' if prop=='Id' else 'ay','data':value}]}).encode()
            stack.enter_context(patch.object(manager_probe,'_capture',side_effect=capture))
            try: yield s
            finally: journal.close(); manager.close()

    def denied(self, call):
        with self.assertRaises(ValueError) as caught: call()
        self.assertEqual(str(caught.exception),'POOL_BROKER_XVFB_UNPROVEN')
        self.assertIsNone(caught.exception.__context__)

    def test_durable_real_transaction_and_exact_fixed_template(self):
        with self.system() as s:
            self.assertEqual(xvfb_launch.launch_xvfb(s.journal,s.manager,self.request()),
                {'state':'observed','groupExitProven':False})
            self.assertEqual([row['action'] for row in s.rows()],['initialize','prepare','dispatch','accepted','observe'])
            args=s.start_argv
            self.assertEqual(args[12],'ssa(sv)a(sa(sv))')
            self.assertEqual(args[14],'fail'); self.assertNotIn('-ac',args)
            self.assertIn('${CREDENTIALS_DIRECTORY}/xauthority',args)
            self.assertIn('a(ss)',args); self.assertIn('a(sasb)',args)
            self.assertIn(':101',args); self.assertIn('1280x800x24',args)
            self.assertEqual(s.journal.snapshot()['dispatching'],1)

    def test_duplicate_after_success_and_reopen_never_restarts(self):
        with self.system() as s:
            xvfb_launch.launch_xvfb(s.journal,s.manager,self.request())
            s.journal.close()
            reopened=resource_journal.ResourceJournal.open(s.registration)
            try: self.denied(lambda:xvfb_launch.launch_xvfb(reopened,s.manager,self.request()))
            finally: reopened.close()
            self.assertEqual(s.events.count('StartTransientUnit'),1)

    def test_lost_response_retains_dispatch_and_replay_denies(self):
        with self.system() as s:
            s.mode='lost'
            self.denied(lambda:xvfb_launch.launch_xvfb(s.journal,s.manager,self.request()))
            self.assertEqual(s.rows()[-1]['action'],'dispatch')
            self.denied(lambda:xvfb_launch.launch_xvfb(s.journal,s.manager,self.request()))
            self.assertEqual(s.events.count('StartTransientUnit'),1)

    def test_wrong_readbacks_retain_accepted_not_observed(self):
        for mode in ('wrong-path','zero','bool','drift','second-bool'):
            with self.subTest(mode=mode),self.system() as s:
                s.mode=mode
                self.denied(lambda:xvfb_launch.launch_xvfb(s.journal,s.manager,self.request()))
                self.assertEqual(s.rows()[-1]['action'],'accepted')

    def test_preparation_sync_failure_never_dispatches(self):
        with self.system() as s:
            with patch.object(s.proxy,'fsync',side_effect=OSError('synthetic')):
                self.denied(lambda:xvfb_launch.launch_xvfb(s.journal,s.manager,self.request()))
            self.assertNotIn('StartTransientUnit',s.events)

    def test_other_roles_rejected_without_journal_write(self):
        with self.system() as s:
            self.denied(lambda:xvfb_launch.launch_xvfb(s.journal,s.manager,self.request(component='brave')))
            self.assertEqual(len(s.rows()),1)
            self.assertEqual(s.events,[])

    def test_cross_registration_denied_before_mutation(self):
        with self.system() as s:
            original=s.manager._registration
            s.manager._registration=type(original)('a'*40,998)
            try:
                self.denied(lambda:xvfb_launch.launch_xvfb(s.journal,s.manager,self.request()))
                self.assertEqual(s.events,[])
                self.assertEqual(len(s.rows()),1)
            finally: s.manager._registration=original

    def test_manager_rejection_or_bad_job_does_not_reissue(self):
        for mode in ('exists','bad-job'):
            with self.subTest(mode=mode),self.system() as s:
                s.mode=mode
                self.denied(lambda:xvfb_launch.launch_xvfb(s.journal,s.manager,self.request()))
                self.denied(lambda:xvfb_launch.launch_xvfb(s.journal,s.manager,self.request()))
                self.assertEqual(s.events.count('StartTransientUnit'),1)
                self.assertEqual(s.rows()[-1]['action'],'dispatch')

    def test_close_after_dispatch_leaves_unknown(self):
        with self.system() as s:
            s.hook=lambda method:s.journal.close() if method=='StartTransientUnit' else None
            self.denied(lambda:xvfb_launch.launch_xvfb(s.journal,s.manager,self.request()))
            self.assertEqual(s.rows()[-1]['action'],'dispatch')
            self.assertEqual(s.events.count('StartTransientUnit'),1)

    def test_dispatch_sync_failure_and_close_veto_actual_popen(self):
        for mode in ('sync-fail','journal-close','manager-close'):
            with self.subTest(mode=mode),self.system() as s:
                original=s.proxy.fsync
                def sync(fd):
                    if len(s.rows())>=3:
                        if mode=='sync-fail': raise OSError('synthetic')
                        (s.journal if mode=='journal-close' else s.manager).close()
                    original(fd)
                with patch.object(s.proxy,'fsync',side_effect=sync):
                    self.denied(lambda:xvfb_launch.launch_xvfb(s.journal,s.manager,self.request()))
                self.assertNotIn('StartTransientUnit',s.events)

    def test_accepted_fsync_failure_does_not_observe_or_retry(self):
        with self.system() as s:
            original=s.proxy.fsync
            def sync(fd):
                if len(s.rows())>=4: raise OSError('synthetic')
                original(fd)
            with patch.object(s.proxy,'fsync',side_effect=sync):
                self.denied(lambda:xvfb_launch.launch_xvfb(s.journal,s.manager,self.request()))
            self.assertEqual(s.events.count('StartTransientUnit'),1)
            self.assertNotIn('GetUnit',s.events)
            s.journal.close()
            reopened=resource_journal.ResourceJournal.open(s.registration)
            try: self.assertEqual(reopened.snapshot()['dispatching'],1)
            finally: reopened.close()

    def test_credential_is_never_read_and_bad_metadata_blocks_before_dispatch(self):
        for mode in ('no-read','writable','empty','symlink'):
            with self.subTest(mode=mode),self.system() as s:
                auth=s.root/'etc/holaday-pool-broker/xauthority/slot-1.auth'
                if mode=='writable': NATIVE.chmod(str(auth),0o666)
                if mode=='empty': auth.write_bytes(b'')
                if mode=='symlink':
                    NATIVE.rename(str(auth),str(auth)+'.saved'); NATIVE.symlink(str(auth)+'.saved',str(auth))
                auth_ino=NATIVE.stat(str(auth)).st_ino
                original=s.proxy.pread
                def pread(fd,*args):
                    self.assertNotEqual(NATIVE.fstat(fd).st_ino,auth_ino,'credential bytes read')
                    return original(fd,*args)
                with patch.object(s.proxy,'pread',side_effect=pread):
                    if mode=='no-read': xvfb_launch.launch_xvfb(s.journal,s.manager,self.request())
                    else:
                        self.denied(lambda:xvfb_launch.launch_xvfb(s.journal,s.manager,self.request()))
                        self.assertNotIn('StartTransientUnit',s.events)

    def test_manager_and_tool_drift_retain_unresolved(self):
        for mode in ('owner','tool'):
            with self.subTest(mode=mode),self.system() as s:
                def hook(method):
                    if method=='StartTransientUnit':
                        if mode=='owner': s.state['owner']=':1.6'
                        else: (s.root/'usr/bin/Xvfb').write_bytes(b'changed synthetic tool')
                s.hook=hook
                self.denied(lambda:xvfb_launch.launch_xvfb(s.journal,s.manager,self.request()))
                self.assertNotEqual(s.rows()[-1]['action'],'observe')
                self.assertEqual(s.events.count('StartTransientUnit'),1)

    def test_corrupt_new_journal_events_cannot_be_replayed(self):
        with self.system() as s:
            xvfb_launch.launch_xvfb(s.journal,s.manager,self.request())
            rows=s.rows()
            for index,field,value in ((2,'managerGuid','0'*32),(2,'unit','another.service'),
                    (2,'managerOwner','org.freedesktop.systemd1'),(3,'job','/bad'),
                    (4,'invocation','0'*32),(4,'action','accepted')):
                changed=[row.copy() for row in rows]; changed[index][field]=value
                raw=resource_journal._HEADER+b''.join(json.dumps(row).encode()+b'\n' for row in changed[1:])
                with self.assertRaises(ValueError): resource_journal._replay(raw)

    def test_last_collector_clock_close_prevents_popen(self):
        for target in ('journal','manager','registration','pin'):
            with self.subTest(target=target),self.system() as s:
                original=manager_probe._capture.side_effect
                attempted=[]
                closing=s.registration._pin if target=='pin' else getattr(s,target)
                def capture(argv,fd,deadline,guard):
                    if 'StartTransientUnit' not in argv: return original(argv,fd,deadline,guard)
                    real=manager_probe.time.monotonic
                    clocks=[]
                    def clock():
                        if __import__('sys')._getframe(1).f_code.co_name == 'budget':
                            clocks.append(True)
                            if len(clocks) == 2: closing.close()
                        return real()
                    with patch.object(manager_probe,'time',__import__('types').SimpleNamespace(monotonic=clock)), \
                            patch.object(manager_probe.subprocess,'Popen',
                                side_effect=lambda *a,**kw:attempted.append(True)):
                        return test_manager_probe.REAL_CAPTURE(argv,fd,deadline,guard)
                with patch.object(manager_probe,'_capture',side_effect=capture):
                    self.denied(lambda:xvfb_launch.launch_xvfb(s.journal,s.manager,self.request()))
                self.assertEqual(s.rows()[-1]['action'],'dispatch')
                self.assertEqual(attempted,[], 'revoked origin still reached Popen')
