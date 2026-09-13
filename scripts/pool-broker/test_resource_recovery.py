"""Recovery uses real launch, file journal, lock and manager; only platform IO is synthetic."""
import contextlib
import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import manager_probe
import resource_journal
import test_xvfb_launch
import xvfb_launch

try:
    import resource_recovery
except ModuleNotFoundError as error:
    if error.name != 'resource_recovery': raise
    resource_recovery = None

NATIVE=test_xvfb_launch.NATIVE


class RecoveryTests(unittest.TestCase):
    @contextlib.contextmanager
    def system(self, stage='observed', transform=None):
        self.assertIsNotNone(resource_recovery,'whole resource recovery missing')
        helper=test_xvfb_launch.LaunchTests()
        with helper.system() as s, contextlib.ExitStack() as stack:
            if stage in ('prepared','legacy'):
                handle=s.journal.prepare(helper.request())
                if stage=='legacy': s.journal.claim_dispatch(handle)
            elif stage in ('dispatch','accepted','observed'):
                s.mode={'dispatch':'lost','accepted':'zero','observed':None}[stage]
                if stage=='observed': xvfb_launch.launch_xvfb(s.journal,s.manager,helper.request())
                else:
                    with self.assertRaises(ValueError): xvfb_launch.launch_xvfb(s.journal,s.manager,helper.request())
            s.journal.close(); s.manager.close(); s.mode=None
            if transform is not None:
                rows=s.rows(); transform(rows)
                s.path.write_bytes(resource_journal._HEADER+b''.join(json.dumps(row).encode()+b'\n' for row in rows[1:]))
            journal=resource_journal.ResourceJournal.open(s.registration)
            stack.enter_context(patch.object(manager_probe,'Socket',return_value=type(s.channel)()))
            manager=manager_probe.SystemManagerProbe.open(s.registration)
            s.journal,s.manager=journal,manager
            s.before=s.path.read_bytes(); s.reads=[]; s.behavior=None; s.active='active'
            s.hook=lambda method,prop:None
            previous=manager_probe._capture.side_effect
            def capture(argv,fd,deadline,guard):
                if argv[8]=='org.freedesktop.DBus': return previous(argv,fd,deadline,guard)
                method=argv[11]; prop=argv[-1] if method=='Get' else None
                guard(); s.reads.append((method,prop,argv)); s.hook(method,prop)
                if s.behavior=='disconnect': raise OSError('synthetic raw text must not escape')
                if s.behavior=='not-found': raise ValueError('synthetic NoSuchUnit')
                rows=s.rows()
                units=[row['unit'] for row in rows if row['action']=='dispatch']
                if method=='GetUnit': unit=argv[-1]
                else:
                    unit=next(unit for unit in units if argv[9]=='/org/freedesktop/systemd1/unit/'+unit.replace('-','_2d').replace('.','_2e'))
                obj='/org/freedesktop/systemd1/unit/'+unit.replace('-','_2d').replace('.','_2e')
                if method=='GetUnit':
                    return json.dumps({'type':'o','data':[obj+'x' if s.behavior=='wrong-path' else obj]}).encode()
                if method!='Get': raise AssertionError('unexpected resource write')
                value={'Id':unit,'InvocationID':[1]*16,'ActiveState':s.active}[prop]
                count=sum(item[1]==prop for item in s.reads)
                if s.behavior=='wrong-id' and prop=='Id': value='different.service'
                if s.behavior=='replaced' and prop=='InvocationID': value=[2]*16
                if s.behavior=='late-replace' and prop=='InvocationID' and count>=3: value=[2]*16
                if s.behavior=='changing' and prop=='ActiveState' and count>=2: value='inactive'
                if s.behavior=='bool' and prop=='InvocationID': value=[True]*16
                if s.behavior=='zero' and prop=='InvocationID': value=[0]*16
                if s.behavior=='unknown-state' and prop=='ActiveState': value='future-state'
                if s.behavior=='duplicate-json': return b'{"type":"v","type":"v","data":[]}'
                return json.dumps({'type':'v','data':[{'type':'ay' if prop=='InvocationID' else 's','data':value}]}).encode()
            stack.enter_context(patch.object(manager_probe,'_capture',side_effect=capture))
            try: yield s
            finally:
                journal.close(); manager.close()

    def recover(self,s):
        return resource_recovery.recover_resources(s.journal,s.manager)

    def denied(self,s):
        with self.assertRaises(ValueError) as caught: self.recover(s)
        self.assertEqual(str(caught.exception),'POOL_BROKER_RECOVERY_UNPROVEN')
        self.assertIsNone(caught.exception.__context__)
        self.assertEqual(s.path.read_bytes(),s.before)
        self.assertTrue(all(method in ('GetUnit','Get') for method,_,_ in s.reads))

    def invariant(self,s,result):
        self.assertFalse(result['groupExitProven']); self.assertFalse(result['admissionAllowed'])
        self.assertEqual(result['total'],result['matched']+result['prepared']+result['unknown'])
        self.assertEqual(result['matched'],sum(result['observedStates'].values()))
        self.assertEqual(result['unknown'],sum(result['unknownReasons'].values()))
        self.assertEqual(s.path.read_bytes(),s.before)
        self.assertTrue(all(method in ('GetUnit','Get') for method,_,_ in s.reads))
        for method,prop,argv in s.reads:
            self.assertEqual(argv[8],':1.5')
            self.assertIn('guid='+'d'*32,argv[1])
            self.assertIn('--auto-start=no',argv)
            self.assertIn('--allow-interactive-authorization=no',argv)
            if method=='Get':
                self.assertIn(prop,('Id','InvocationID','ActiveState'))
                self.assertEqual(argv[10],'org.freedesktop.DBus.Properties')
                self.assertEqual(argv[12:14],('ss','org.freedesktop.systemd1.Unit'))
        for text in ('a'*40,'b'*32,':1.5','d'*32,'holaday-pool-xvfb-'):
            self.assertNotIn(text,repr(result))

    def test_reopen_correlates_original_instance_without_writing_or_clearing(self):
        with self.system() as s:
            result=self.recover(s)
            self.assertEqual(result['matched'],1); self.assertEqual(result['unknown'],0)
            self.assertEqual(result['observedStates']['active'],1)
            self.invariant(s,result)
            count=len(s.reads)
            self.assertEqual(self.recover(s),result)
            self.assertGreater(len(s.reads),count,'cached success reused')

    def test_every_supported_state_is_only_observed_not_exit_permission(self):
        for state in ('active','inactive','failed','reloading','activating','deactivating','maintenance'):
            with self.subTest(state=state),self.system() as s:
                s.active=state; result=self.recover(s)
                self.assertEqual(result['observedStates'][state],1)
                self.invariant(s,result)

    def test_unbound_stages_remain_unknown_and_never_query_by_guessed_unit(self):
        for stage,reason in (('legacy','missing_binding'),('dispatch','missing_invocation'),('accepted','missing_invocation')):
            with self.subTest(stage=stage),self.system(stage) as s:
                result=self.recover(s)
                self.assertEqual(result['unknownReasons'][reason],1)
                self.assertEqual(s.reads,[]); self.invariant(s,result)

    def test_empty_and_prepared_are_not_idle_or_permission(self):
        for stage,expected in (('empty',0),('prepared',1)):
            with self.subTest(stage=stage),self.system(stage) as s:
                result=self.recover(s)
                self.assertEqual(result['total'],expected); self.assertEqual(result['prepared'],expected)
                self.assertEqual(s.reads,[]); self.invariant(s,result)

    def test_foreign_boot_candidate_and_manager_are_not_adopted(self):
        for field,value,index,reason in (('boot','e'*32,1,'foreign_registration'),
                ('candidate','e'*40,1,'foreign_registration'),
                ('managerGuid','e'*32,2,'manager_changed'),('managerOwner',':1.7',2,'manager_changed')):
            with self.subTest(field=field),self.system(transform=lambda rows:rows[index].update({field:value})) as s:
                result=self.recover(s)
                self.assertEqual(result['unknownReasons'][reason],1)
                self.assertEqual(s.reads,[]); self.invariant(s,result)

    def test_changed_instance_or_unstable_observation_stays_unknown(self):
        for behavior,reason in (('wrong-path','identity_changed'),('wrong-id','identity_changed'),
                ('replaced','identity_changed'),('late-replace','identity_changed'),('changing','unstable_observation')):
            with self.subTest(behavior=behavior),self.system() as s:
                s.behavior=behavior; result=self.recover(s)
                self.assertEqual(result['unknownReasons'][reason],1)
                self.assertEqual(result['matched'],0); self.invariant(s,result)

    def test_transport_or_invalid_schema_never_returns_partial_success(self):
        for behavior in ('disconnect','not-found','bool','zero','unknown-state','duplicate-json'):
            with self.subTest(behavior=behavior),self.system() as s:
                s.behavior=behavior; self.denied(s)

    def test_closed_origins_at_final_capture_budget_cannot_spawn(self):
        for target in ('journal','manager','registration','pin'):
            with self.subTest(target=target),self.system() as s:
                previous=manager_probe._capture.side_effect; attempted=[]
                closing=s.registration._pin if target=='pin' else getattr(s,target)
                def capture(argv,fd,deadline,guard):
                    if 'GetUnit' not in argv: return previous(argv,fd,deadline,guard)
                    real=manager_probe.time.monotonic
                    clocks=[]
                    def clock():
                        if __import__('sys')._getframe(1).f_code.co_name == 'budget':
                            clocks.append(True)
                            if len(clocks) == 2: closing.close()
                        return real()
                    with patch.object(manager_probe,'time',__import__('types').SimpleNamespace(monotonic=clock)), \
                            patch.object(manager_probe.subprocess,'Popen',side_effect=lambda *a,**kw:attempted.append(True)):
                        return test_xvfb_launch.test_manager_probe.REAL_CAPTURE(argv,fd,deadline,guard)
                with patch.object(manager_probe,'_capture',side_effect=capture): self.denied(s)
                self.assertEqual(attempted,[])

    def test_global_deadline_expiry_during_resource_read_fails_whole_scan(self):
        with self.system() as s:
            now=[100.0]
            s.hook=lambda method,prop:now.__setitem__(0,131.0)
            with patch.object(resource_recovery,'_clock',side_effect=lambda:now[0]): self.denied(s)

    def test_registration_replaced_is_rejected_without_reading_resources(self):
        with self.system() as s:
            original=s.manager._registration
            s.manager._registration=type(original)('a'*40,998)
            try: self.denied(s); self.assertEqual(s.reads,[])
            finally: s.manager._registration=original

    def test_final_journal_check_is_inside_global_budget_even_for_empty_log(self):
        with self.system('empty') as s:
            now=[100.0]; calls=[]; previous=manager_probe._capture.side_effect; pread=s.proxy.pread
            def capture(*args):
                result=previous(*args); calls.append(True); return result
            reached=[]
            def read(fd,*args):
                value=pread(fd,*args)
                if len(calls)>=8 and s.journal._busy and not s.manager._busy:
                    reached.append(True); now[0]=131.0
                return value
            with patch.object(manager_probe,'_capture',side_effect=capture), \
                    patch.object(s.proxy,'pread',side_effect=read), \
                    patch.object(resource_recovery,'_clock',side_effect=lambda:now[0]):
                self.denied(s)
            self.assertTrue(reached,'last native journal check was not exercised')

    def test_no_resource_reads_still_checks_final_revocation(self):
        for target in ('registration','pin','manager','journal'):
            with self.subTest(target=target),self.system('prepared') as s:
                closing=s.registration._pin if target=='pin' else getattr(s,target)
                reached=[]; original=resource_recovery._clock
                def clock():
                    if not s.journal._busy and reached:
                        closing.close()
                    if s.journal._busy: reached.append(True)
                    return original()
                with patch.object(resource_recovery,'_clock',side_effect=clock): self.denied(s)
                self.assertTrue(reached); self.assertEqual(s.reads,[])

    def test_lock_and_owned_fd_survive_close_until_original_read_finishes(self):
        with self.system() as s:
            events=[]; owned=s.journal._fd
            def hook(method,prop):
                if method!='GetUnit': return
                s.journal.close()
                events.append(owned in s.opened)
                try:
                    other=resource_journal.ResourceJournal.open(s.registration)
                    events.append(False); other.close()
                except ValueError: events.append(True)
                events.append(owned in s.opened)
            s.hook=hook; self.denied(s)
            self.assertEqual(events,[True,True,True]); self.assertNotIn(owned,s.opened)

    def test_reentrant_recovery_cannot_release_inflight_lock_or_return_success(self):
        with self.system() as s:
            events=[]; owned=s.journal._fd
            def hook(method,prop):
                if method!='GetUnit': return
                try: self.recover(s); events.append('unexpected-success')
                except ValueError: events.append('denied')
                events.append(owned in s.opened)
            s.hook=hook; self.denied(s)
            self.assertEqual(events,['denied',True]); self.assertNotIn(owned,s.opened)

    def test_full_128_record_capacity_is_classified_not_silently_truncated(self):
        with self.system('empty') as s:
            helper=test_xvfb_launch.LaunchTests()
            counter=1
            for component in ('xvfb','brave','x11vnc','websockify'):
                for slot in range(32):
                    s.journal.prepare(helper.request(component=component,slot=slot,requestId=format(counter,'032x')))
                    counter+=1
            s.before=s.path.read_bytes()
            result=self.recover(s)
            self.assertEqual(result['total'],128); self.assertEqual(result['prepared'],128)
            self.assertEqual(s.reads,[]); self.invariant(s,result)

    def test_clock_rollback_and_nonfinite_values_fail_without_partial_report(self):
        for value in (99.0,float('nan'),float('inf'),True):
            with self.subTest(value=value),self.system() as s:
                values=iter([100.0,value])
                with patch.object(resource_recovery,'_clock',side_effect=lambda:next(values,value)):
                    self.denied(s)
                self.assertEqual(s.reads,[])

    def multiply_observed(self, count):
        def transform(rows):
            original=[row.copy() for row in rows[1:]]
            rows[1:]=[]
            for index in range(1,count+1):
                resource=format(index,'032x'); unit='holaday-pool-xvfb-'+resource+'.service'
                for offset,source in enumerate(original):
                    row=source | {'resource':resource,'revision':4*(index-1)+offset+1}
                    if offset==0: row.update(requestId=format(index,'032x'),capability=format(index,'064x'),slot=index-1)
                    if offset==1: row['unit']=unit
                    if offset==2: row['job']='/org/freedesktop/systemd1/job/'+str(index)
                    rows.append(row)
        return transform

    def test_all_32_observed_slots_are_read_not_only_first_record(self):
        with self.system(transform=self.multiply_observed(32)) as s:
            result=self.recover(s)
            self.assertEqual(result['total'],32); self.assertEqual(result['matched'],32)
            self.assertEqual(len({argv[-1] for method,_,argv in s.reads if method=='GetUnit'}),32)
            self.invariant(s,result)

    def test_later_read_failure_discards_earlier_matched_results(self):
        with self.system(transform=self.multiply_observed(2)) as s:
            def hook(method,prop):
                if sum(method=='GetUnit' for method,_,_ in s.reads)>=2: raise OSError('synthetic')
            s.hook=hook; self.denied(s)
            self.assertEqual(sum(method=='GetUnit' for method,_,_ in s.reads),2)
            count=len(s.reads); self.denied(s); self.assertEqual(len(s.reads),count)

    def test_manager_change_after_observation_cannot_return_success(self):
        with self.system() as s:
            def hook(method,prop):
                if prop=='ActiveState': s.state['owner']=':1.6'
            s.hook=hook; self.denied(s)

    def test_corrupted_or_replaced_journal_is_not_repaired(self):
        for mode in ('corrupt','replace'):
            with self.subTest(mode=mode),self.system() as s:
                if mode=='corrupt': s.path.write_bytes(s.before+b'{partial')
                else:
                    NATIVE.rename(str(s.path),str(s.path)+'.saved')
                    s.path.write_bytes(s.before); NATIVE.chmod(str(s.path),0o600)
                s.before=s.path.read_bytes()
                self.denied(s); self.assertEqual(s.reads,[])

    def test_real_collector_timeouts_use_remaining_whole_scan_budget(self):
        with self.system() as s:
            now=[100.0]; timeouts=[]; exercised=[]
            previous=manager_probe._capture.side_effect
            selector_type=manager_probe.selectors.DefaultSelector
            select=selector_type.select
            def bounded_select(selector,timeout):
                timeouts.append(timeout); return select(selector,timeout)
            def capture(argv,fd,deadline,guard):
                method=argv[11]
                if method in ('GetNameOwner','GetUnit') and method not in exercised:
                    exercised.append(method); now[0]=129.5
                    streams=[]
                    for _ in range(2):
                        read_fd,write_fd=NATIVE.pipe(); NATIVE.close(write_fd)
                        streams.append(NATIVE.fdopen(read_fd,'rb'))
                    def wait(timeout): timeouts.append(timeout); return 0
                    child=SimpleNamespace(stdout=streams[0],stderr=streams[1],wait=wait,poll=lambda:0)
                    # Only the child-process boundary is synthetic; the actual
                    # collector uses real EOF pipes/selector and original guards.
                    with patch.object(manager_probe.subprocess,'Popen',return_value=child), \
                            patch.object(selector_type,'select',bounded_select):
                        test_xvfb_launch.test_manager_probe.REAL_CAPTURE(argv,fd,deadline,guard)
                return previous(argv,fd,deadline,guard)
            with patch.object(resource_recovery,'_clock',side_effect=lambda:now[0]), \
                    patch.object(manager_probe,'_capture',side_effect=capture):
                result=self.recover(s)
            self.assertEqual(exercised,['GetNameOwner','GetUnit'])
            self.assertGreaterEqual(len(timeouts),4)
            self.assertTrue(all(0 < timeout <= 0.5 for timeout in timeouts),timeouts)
            self.invariant(s,result)
