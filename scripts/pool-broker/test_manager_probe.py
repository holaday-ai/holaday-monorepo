"""Real registration and temporary files; Linux socket/busctl boundaries are synthetic."""
import contextlib
import hashlib
import json
import os
import socket
import stat
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import launch_listener
import test_launch_listener

try:
    import manager_probe
except ModuleNotFoundError as error:
    if error.name != 'manager_probe': raise
    manager_probe = None

NATIVE = SimpleNamespace(**vars(os))


class ProbeTests(unittest.TestCase):
    @contextlib.contextmanager
    def system(self):
        self.assertIsNotNone(manager_probe, 'authenticated manager producer missing')
        with tempfile.TemporaryDirectory(prefix='holaday-manager-') as directory:
            root = Path(directory)
            package = root / ('usr/local/lib/holaday-pool-broker/releases/' + 'a' * 40)
            package.mkdir(parents=True)
            tool = root / 'usr/bin/busctl'
            tool.parent.mkdir()
            tool.write_bytes(b'synthetic trusted tool, not executed')
            tool.chmod(0o755)
            manifest = {'version': 1, 'status': 'linux-verified', 'candidate': 'a' * 40,
                'architecture': 'x86_64', 'files': {}, 'tools': {'/usr/bin/busctl': {
                    'resolved': '/usr/bin/busctl', 'sha256': hashlib.sha256(tool.read_bytes()).hexdigest()}}}
            (package/'native-build-manifest.json').write_text(json.dumps(manifest))
            (package/'native-build-manifest.json').chmod(0o644)
            (root/'run/dbus').mkdir(parents=True)
            with test_launch_listener.ListenerTests().system() as base, contextlib.ExitStack() as stack:
                listener = launch_listener.RootLaunchListener.open('a'*40)
                listener.accept_once()
                proxy=SimpleNamespace(**vars(NATIVE)); opened=set()
                def open_file(name, flags, *args, **kwargs):
                    fd=NATIVE.open(str(root) if name=='/' else name,flags,*args,**kwargs)
                    opened.add(fd); return fd
                def close(fd): opened.remove(fd); NATIVE.close(fd)
                def info(value):
                    return SimpleNamespace(st_mode=value.st_mode, st_uid=0, st_gid=0, st_nlink=value.st_nlink,
                        st_dev=value.st_dev, st_ino=value.st_ino, st_size=value.st_size)
                proxy.open,proxy.close=open_file,close
                proxy.fstat=lambda fd:info(NATIVE.fstat(fd))
                endpoint=SimpleNamespace(st_mode=stat.S_IFSOCK|0o666,st_uid=0,st_gid=0,st_nlink=1,st_dev=1,st_ino=88)
                proxy.stat=lambda name,**kw: endpoint if name=='system_bus_socket' else info(NATIVE.stat(name,**kw))
                proxy.listxattr=lambda fd:[]
                proxy.uname=lambda:SimpleNamespace(machine='x86_64')
                class Channel:
                    def __init__(self): self.data=b'OK '+b'd'*32+b'\r\n';self.sent=b'';self.closed=False
                    def settimeout(self,value): self.timeout=value
                    def connect(self,path): self.path=path
                    def getsockopt(self,*args): return __import__('struct').pack('=iII',42,102,102)
                    def sendall(self,data): self.sent+=data
                    def recv(self,count): part=self.data[:min(count,3)];self.data=self.data[len(part):];return part
                    def close(self): self.closed=True
                channel=Channel(); calls=[]; state={'owner':':1.5','uid':0,'pid':1}
                def capture(argv,fd,remaining,*scope):
                    calls.append((argv,fd))
                    self.assertGreater(remaining,0)
                    self.assertIn('--address=unix:path=/run/dbus/system_bus_socket,guid='+'d'*32,argv)
                    self.assertIn('--auto-start=no',argv)
                    self.assertIn('--allow-interactive-authorization=no',argv)
                    if 'GetNameOwner' in argv:
                        result={'type':'s','data':[state['owner']]}
                    elif 'GetConnectionUnixUser' in argv:
                        self.assertEqual(argv[-1],':1.5'); result={'type':'u','data':[state['uid']]}
                    elif 'GetConnectionUnixProcessID' in argv:
                        self.assertEqual(argv[-1],':1.5'); result={'type':'u','data':[state['pid']]}
                    else: self.fail('unexpected manager method')
                    return json.dumps(result).encode()
                stack.enter_context(patch.object(manager_probe,'os',proxy))
                stack.enter_context(patch.object(manager_probe,'Socket',return_value=channel))
                stack.enter_context(patch.object(manager_probe,'_capture',side_effect=capture))
                yield SimpleNamespace(registration=listener._registration,channel=channel,calls=calls,
                    state=state,proxy=proxy,endpoint=endpoint,tool=tool,root=root,opened=opened)
                listener.close()
                self.assertEqual(opened,set())

    def denied(self,call):
        with self.assertRaises(ValueError) as caught: call()
        self.assertEqual(str(caught.exception),'POOL_BROKER_MANAGER_UNPROVEN')
        self.assertIsNone(caught.exception.__context__)

    def test_real_producer_binds_auth_guid_and_manager_connection(self):
        with self.system() as s:
            probe=manager_probe.SystemManagerProbe.open(s.registration)
            self.assertEqual(probe.probe(),{'reachable':True,'managerBound':True,'groupExitProven':False})
            self.assertEqual(s.channel.sent,b'\x00AUTH EXTERNAL 30\r\n')
            self.assertEqual(len(s.calls),8)
            probe.close();self.assertTrue(s.channel.closed)

    def test_wrong_auth_and_kernel_credentials_never_call_busctl(self):
        for wrong in (b'OK '+b'0'*32+b'\r\n',b'REJECTED EXTERNAL\r\n',b'OK '+b'd'*32+b'xx',b''):
            with self.system() as s:
                s.channel.data=wrong
                self.denied(lambda:manager_probe.SystemManagerProbe.open(s.registration))
                self.assertEqual(s.calls,[])

    def test_non_system_manager_credentials_are_rejected(self):
        for field,value in (('uid',998),('pid',42),('uid',False),('pid',True),('owner','org.freedesktop.systemd1')):
            with self.system() as s:
                s.state[field]=value
                self.denied(lambda:manager_probe.SystemManagerProbe.open(s.registration))

    def test_manager_replacement_poisoned_without_accepting_new_owner(self):
        with self.system() as s:
            probe=manager_probe.SystemManagerProbe.open(s.registration)
            s.state['owner']=':1.6'
            self.denied(probe.probe)
            self.denied(probe.probe)

    def test_socket_replacement_and_tool_change_are_rejected(self):
        for field in ('socket','tool','registration'):
            with self.system() as s:
                probe=manager_probe.SystemManagerProbe.open(s.registration)
                if field=='socket': s.endpoint.st_ino+=1
                elif field=='tool': s.tool.write_bytes(b'changed')
                else:s.registration.close()
                previous=len(s.calls)
                self.denied(probe.probe)
                self.assertEqual(len(s.calls),previous)

    def test_duplicate_json_keys_or_extra_payload_is_rejected(self):
        for raw in (b'{"type":"s","type":"s","data":[":1.5"]}',b'{"type":"s","data":[":1.5"],"extra":0}',b''):
            with self.system() as s, patch.object(manager_probe,'_capture',return_value=raw):
                self.denied(lambda:manager_probe.SystemManagerProbe.open(s.registration))

    def test_reentrant_close_defers_owned_fds_until_capture_returns(self):
        with self.system() as s:
            probe=manager_probe.SystemManagerProbe.open(s.registration)
            def interrupted(*args):
                probe.close()
                self.assertTrue(s.opened)
                self.assertFalse(s.channel.closed)
                return b'{"type":"s","data":[":1.5"]}'
            with patch.object(manager_probe,'_capture',side_effect=interrupted):
                self.denied(probe.probe)
            self.assertTrue(s.channel.closed)

    def test_root_directory_replacement_is_detected_before_next_call(self):
        with self.system() as s:
            probe=manager_probe.SystemManagerProbe.open(s.registration)
            parent=s.root/'run/dbus'
            NATIVE.rename(str(parent),str(parent)+'.old')
            NATIVE.mkdir(str(parent))
            previous=len(s.calls)
            self.denied(probe.probe)
            self.assertEqual(len(s.calls),previous)

    def test_bad_peer_structure_or_metadata_is_rejected(self):
        for change in ('peer','owner','mode'):
            with self.system() as s:
                if change=='peer': s.channel.getsockopt=lambda *args:b'bad'
                elif change=='owner': s.endpoint.st_uid=998
                else: s.endpoint.st_mode=stat.S_IFREG|0o666
                self.denied(lambda:manager_probe.SystemManagerProbe.open(s.registration))
                self.assertEqual(s.calls,[])

    def test_tool_hash_and_manifest_not_verified_prevent_any_bus_connection(self):
        for change in ('hash','status'):
            with self.system() as s:
                if change=='hash': s.tool.write_bytes(b'wrong')
                else:
                    path=s.root/('usr/local/lib/holaday-pool-broker/releases/'+'a'*40+'/native-build-manifest.json')
                    document=json.loads(path.read_text());document['status']='unverified';path.write_text(json.dumps(document))
                self.denied(lambda:manager_probe.SystemManagerProbe.open(s.registration))
                self.assertEqual(s.calls,[])

    def test_expired_io_and_close_failure_do_not_report_success(self):
        with self.system() as s:
            probe=manager_probe.SystemManagerProbe.open(s.registration)
            previous=manager_probe.time.monotonic()
            def expires(*args):
                manager_probe.time.monotonic=lambda:previous+10
                return b'{"type":"s","data":[":1.5"]}'
            with patch.object(manager_probe.time,'monotonic',return_value=previous), patch.object(manager_probe,'_capture',side_effect=expires):
                self.denied(probe.probe)
        with self.system() as s:
            probe=manager_probe.SystemManagerProbe.open(s.registration)
            original=s.proxy.close
            def close(fd): original(fd);raise OSError('private synthetic close')
            s.proxy.close=close
            self.denied(probe.close)

    def test_auth_send_refreshes_budget_after_connect(self):
        with self.system() as s:
            now=[manager_probe.time.monotonic()]
            original=s.channel.connect
            def delayed(path): original(path);now[0]+=4
            s.channel.connect=delayed
            send=s.channel.sendall
            def sendall(data):
                self.assertLessEqual(s.channel.timeout,1)
                send(data)
            s.channel.sendall=sendall
            with patch.object(manager_probe.time,'monotonic',side_effect=lambda:now[0]):
                probe=manager_probe.SystemManagerProbe.open(s.registration)
                probe.close()

    def test_close_at_capture_entry_prevents_popen(self):
        with self.system() as s:
            probe=manager_probe.SystemManagerProbe.open(s.registration)
            now=manager_probe.time.monotonic()
            def revoked(): probe.close();return now
            with patch.object(manager_probe.time,'monotonic',side_effect=revoked), patch.object(manager_probe.subprocess,'Popen') as popen:
                # Exercise the real collector, not the synthetic bus program.
                try: REAL_CAPTURE(('/proc/self/fd/'+str(probe._tool),),probe._tool,probe._deadline,probe._remaining)
                except Exception: pass
                popen.assert_not_called()

    def test_capture_old_absolute_deadline_never_starts_child(self):
        self.assertIsNotNone(manager_probe)
        with patch.object(manager_probe.subprocess,'Popen') as popen:
            with self.assertRaises(Exception):
                REAL_CAPTURE(('/usr/bin/busctl',),3,manager_probe.time.monotonic()-1,lambda:1)
            popen.assert_not_called()


class CaptureTests(unittest.TestCase):
    def collect(self,argv,fd,seconds):
        deadline=manager_probe.time.monotonic()+seconds
        return manager_probe._capture(argv,fd,deadline,lambda:deadline-manager_probe.time.monotonic())

    def test_real_child_receives_only_minimal_environment(self):
        self.assertIsNotNone(manager_probe,'bounded busctl collector missing')
        with open(sys.executable,'rb') as tool:
            result=self.collect((sys.executable,'-c',
                # Python locale coercion / macOS runtime may add these two,
                # independently of the Popen environment supplied by the broker.
                'import os,json;print(json.dumps(sorted(k for k in os.environ if k not in ("LC_CTYPE","__CF_USER_TEXT_ENCODING"))))'),tool.fileno(),2)
            self.assertEqual(json.loads(result),['LANG','PATH'])
    def test_real_child_requires_both_exit_and_pipe_eof(self):
        self.assertIsNotNone(manager_probe,'bounded busctl collector missing')
        with open(sys.executable,'rb') as tool:
            argv=(sys.executable,'-c','import sys;sys.stdout.write("bounded")')
            result=self.collect(argv,tool.fileno(),2)
            self.assertEqual(result,b'bounded')

    def test_real_child_rejects_stderr_overflow_nonzero_and_timeout(self):
        self.assertIsNotNone(manager_probe,'bounded busctl collector missing')
        for code in ('import sys;sys.stderr.write("private")','print("x"*17000)',
                     'raise SystemExit(2)','import time;time.sleep(2)',
                     'import os,time;os.close(1);os.close(2);time.sleep(2)'):
            with open(sys.executable,'rb') as tool:
                with self.assertRaises(Exception):
                    self.collect((sys.executable,'-c',code),tool.fileno(),0.2)

    def test_pipe_close_error_still_closes_both_actual_streams_once(self):
        self.assertIsNotNone(manager_probe)
        original=manager_probe.subprocess.Popen
        closed=[]
        class Stream:
            def __init__(self,stream,label):self.stream,self.label=stream,label
            def fileno(self):return self.stream.fileno()
            def close(self):
                closed.append(self.label);self.stream.close()
                if self.label=='stdout':raise OSError('synthetic close')
        def spawn(*args,**kwargs):
            child=original(*args,**kwargs)
            child.stdout=Stream(child.stdout,'stdout');child.stderr=Stream(child.stderr,'stderr')
            return child
        with open(sys.executable,'rb') as tool, patch.object(manager_probe.subprocess,'Popen',side_effect=spawn):
            with self.assertRaises(Exception):self.collect((sys.executable,'-c','print("ok")'),tool.fileno(),2)
        self.assertEqual(closed,['stdout','stderr'])


REAL_CAPTURE = manager_probe._capture if manager_probe else None

if __name__=='__main__': unittest.main()
