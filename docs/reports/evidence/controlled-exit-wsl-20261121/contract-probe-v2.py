"""Bounded synthetic systemd/cgroup measurements; never production exit authority."""
import errno,json,os,pathlib,select,secrets,socket,stat,struct,sys,time,traceback

if sys.platform!='linux' or os.environ.get('WSL_DISTRO_NAME')!='Holaday-ExitLab' or os.getuid()!=0:
    raise SystemExit('Only the explicitly approved new lab controller is accepted')
if pathlib.Path('/proc/1/comm').read_text().strip()!='systemd':raise SystemExit('systemd must be PID1')

import dbus
from dbus.mainloop.glib import DBusGMainLoop
from gi.repository import GLib
DBusGMainLoop(set_as_default=True)
bus=dbus.SystemBus(private=True)
owner=str(bus.get_name_owner('org.freedesktop.systemd1'))
daemon=dbus.Interface(bus.get_object('org.freedesktop.DBus','/org/freedesktop/DBus'),'org.freedesktop.DBus')
if int(daemon.GetConnectionUnixProcessID(owner))!=1:raise SystemExit('Original manager is not PID1')
manager=dbus.Interface(bus.get_object(owner,'/org/freedesktop/systemd1'),'org.freedesktop.systemd1.Manager')
manager_fd=os.pidfd_open(1,0)
boot=pathlib.Path('/proc/sys/kernel/random/boot_id').read_text().strip()
nonce=secrets.token_hex(6)
base=pathlib.Path('/var/lib/holaday-exitlab')
base.mkdir(mode=0o755,exist_ok=True)
if base.is_symlink() or base.stat().st_uid!=0:raise SystemExit('Lab directory ownership unproven')
run=base/nonce;run.mkdir(mode=0o755)
report={'kind':'synthetic-original-systemd-job-cgroup-contract','probeRevision':2,'nonce':nonce,
        'managerOwner':owner,'busId':str(daemon.GetId()),'kernelBootId':boot,
        'distro':'Holaday-ExitLab','unitMemoryMaxBytes':67108864,'unitTasksMax':16,
        'unitCPUQuotaPercent':25,'unitRuntimeMaxSeconds':20,'cases':[],
        'productionAccepted':False,'exitProofAccepted':False,'slotReusePermitted':False,
        'reapOfAllDescendantsProven':False,'modelCalls':0,'kmsCalls':0,'errors':[],
        'dispatchAttempts':[],'acceptedCreateJobs':[]}

WORKER=r'''
import json,os,signal,socket,sys,time
path,mode,nonce=sys.argv[1:]
def connect(role):
 s=socket.socket(socket.AF_UNIX,socket.SOCK_SEQPACKET)
 s.settimeout(10);s.connect(path)
 s.send(json.dumps({'nonce':nonce,'role':role}).encode())
 if s.recv(1)!=b'G':raise SystemExit(3)
 s.settimeout(None)
 return s
def hold():
 while True:time.sleep(1)
s=connect('leader')
if mode=='double_fork':
 child=os.fork()
 if child==0:
  s.close();os.setsid();middle=connect('intermediate')
  grand=os.fork()
  if grand==0:
   middle.close();signal.signal(signal.SIGTERM,signal.SIG_IGN)
   last=connect('grandchild');last.send(b'ARMED');hold()
  os._exit(0)
 os._exit(0)
elif mode=='term_fork':
 def term(_sig,_frame):
  child=os.fork()
  if child==0:
   s.close();signal.signal(signal.SIGTERM,signal.SIG_IGN)
   late=connect('late-child');late.send(b'ARMED');hold()
  os._exit(0)
 signal.signal(signal.SIGTERM,term)
elif mode=='ignore_term':signal.signal(signal.SIGTERM,signal.SIG_IGN)
s.send(b'ARMED');hold()
'''
worker=run/'worker.py';worker.write_text(WORKER);worker.chmod(0o644)
units=[];jobs={};allowed_names=set();context=GLib.MainContext.default()

def exited(fd):
 p=select.poll();p.register(fd,select.POLLIN|select.POLLHUP|select.POLLERR)
 return bool(p.poll(0))

def guard():
 if str(bus.get_name_owner('org.freedesktop.systemd1'))!=owner or exited(manager_fd):
  raise RuntimeError('Original manager identity changed')
 if pathlib.Path('/proc/sys/kernel/random/boot_id').read_text().strip()!=boot:
  raise RuntimeError('Kernel boot identity changed')

def removed(jid,path,name,result):
 if str(name) in allowed_names:
  jobs[str(path)]={'id':int(jid),'path':str(path),'unit':str(name),'result':str(result),'observedMonotonic':time.monotonic()}

bus.add_signal_receiver(removed,signal_name='JobRemoved',dbus_interface='org.freedesktop.systemd1.Manager',
                        bus_name=owner,path='/org/freedesktop/systemd1')
manager.Subscribe()

def pump(predicate,seconds=8):
 end=time.monotonic()+seconds
 while True:
  guard()
  while context.pending():context.iteration(False)
  for unit in units:unit.receive()
  if predicate():return
  if time.monotonic()>end:raise TimeoutError('Bounded original-job/peer observation expired')
  time.sleep(.01)

def native_value(v):
 if isinstance(v,dbus.Boolean):return bool(v)
 if isinstance(v,(dbus.UInt32,dbus.UInt64,dbus.Int32,dbus.Int64)):return int(v)
 if isinstance(v,(dbus.Array,list,tuple)):return [native_value(x) for x in v]
 return str(v)

class Unit:
 def __init__(self,label,mode):
  self.label=label;self.mode=mode;self.name='holaday-exitlab-'+nonce+'-'+label+'.service'
  self.listener=socket.socket(socket.AF_UNIX,socket.SOCK_SEQPACKET|socket.SOCK_CLOEXEC)
  self.socketpath=str(run/(label+'.sock'));self.listener.bind(self.socketpath)
  os.chmod(self.socketpath,0o666);self.listener.listen(8);self.listener.setblocking(False)
  self.peers=[];self.pins=[];self.dirfd=None;self.eventfd=None;self.cg=None;self.invocation=None
  self.stopped=False;self.result={'label':label,'mode':mode,'unit':self.name,'peers':[]}
  props={'Description':dbus.String('Holaday synthetic exit contract '+nonce),
   'Type':dbus.String('exec'),'User':dbus.String('nobody'),'Group':dbus.String('nogroup'),
   'Restart':dbus.String('no'),'RemainAfterExit':dbus.Boolean(mode=='double_fork'),
   'KillMode':dbus.String('control-group'),'SendSIGKILL':dbus.Boolean(True),
   'TimeoutStopUSec':dbus.UInt64(2000000),'RuntimeMaxUSec':dbus.UInt64(20000000),
   'MemoryMax':dbus.UInt64(67108864),'TasksMax':dbus.UInt64(16),
   'CPUQuotaPerSecUSec':dbus.UInt64(250000),'NoNewPrivileges':dbus.Boolean(True),
   'PrivateNetwork':dbus.Boolean(True),'PrivateTmp':dbus.Boolean(True),
   'ProtectSystem':dbus.String('strict'),'ProtectHome':dbus.String('yes'),
   'ExecStart':dbus.Array([dbus.Struct((dbus.String('/usr/bin/python3'),
       dbus.Array(['/usr/bin/python3',str(worker),self.socketpath,mode,nonce],signature='s'),
       dbus.Boolean(False)),signature='sasb')],signature='(sasb)')}
  allowed_names.add(self.name)
  # mode fail refuses pre-existing objects. No caller-selected unit/PID/path is accepted.
  report['dispatchAttempts'].append({'unit':self.name,'mode':'fail','monotonic':time.monotonic()})
  self.start_job=str(manager.StartTransientUnit(self.name,'fail',
    dbus.Array([dbus.Struct((k,v),signature='sv') for k,v in props.items()],signature='(sv)'),
    dbus.Array([],signature='(sa(sv))')))
  report['acceptedCreateJobs'].append({'unit':self.name,'originalJob':self.start_job})
  manager.RefUnit(self.name)
  self.object_path=str(manager.GetUnit(self.name))
  self.props=dbus.Interface(bus.get_object(owner,self.object_path),'org.freedesktop.DBus.Properties')
  units.append(self);report['cases'].append(self.result)
  pump(lambda:self.start_job in jobs)
  start=jobs[self.start_job]
  if start['unit']!=self.name or start['result']!='done':raise RuntimeError('Original start job failed')
  self.cg=str(self.props.Get('org.freedesktop.systemd1.Service','ControlGroup'))
  if self.cg!='/system.slice/'+self.name:raise RuntimeError('Unexpected owned cgroup path')
  self.invocation=bytes(self.props.Get('org.freedesktop.systemd1.Unit','InvocationID')).hex()
  if len(self.invocation)!=32 or self.invocation=='0'*32:raise RuntimeError('Original invocation unavailable')
  self.dirfd=os.open('/sys/fs/cgroup'+self.cg,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)
  self.eventfd=os.open('cgroup.events',os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=self.dirfd)
  self.cginode=os.fstat(self.dirfd).st_ino
  self.result.update({'startJob':start,'unitObject':self.object_path,'invocationBefore':self.invocation,
                      'cgroupBefore':self.cg,'cgroupInode':self.cginode,'heldBefore':self.held()})
  pump(lambda:any(p['role']=='leader' for p in self.pins))
  for conn,pin in self.peers:
   if pin['role']=='leader':conn.send(b'G');pin['released']=True
  expected={'leader','intermediate','grandchild'} if mode=='double_fork' else {'leader'}
  pump(lambda:expected.issubset({p['role'] for p in self.pins}) and
       (any(p.get('armed') for p in self.pins) if mode=='double_fork' else self.pins[0].get('armed',False)))
  if mode=='double_fork':
   pump(lambda:all(exited(p['pidfd']) for p in self.pins if p['role'] in ('leader','intermediate')))
   if exited(next(p['pidfd'] for p in self.pins if p['role']=='grandchild')):raise RuntimeError('Grandchild exited before explicit stop')
  self.result['beforeStop']=self.snapshot()

 def receive(self):
  while True:
   try:conn,_=self.listener.accept()
   except BlockingIOError:break
   conn.settimeout(1)
   pid,uid,gid=struct.unpack('3i',conn.getsockopt(socket.SOL_SOCKET,socket.SO_PEERCRED,12))
   msg=json.loads(conn.recv(256).decode('ascii'))
   if msg.get('nonce')!=nonce or uid!=65534 or gid!=65534 or msg.get('role') not in {'leader','intermediate','grandchild','late-child'}:
    conn.close();raise RuntimeError('Unexpected kernel peer or handshake')
   # Every worker creates its own new connection; no inherited peer identity is adopted.
   pfd=os.pidfd_open(pid,0)
   procfd=os.open('/proc/'+str(pid),os.O_RDONLY|os.O_DIRECTORY|os.O_CLOEXEC)
   def pr(name):
    f=os.open(name,os.O_RDONLY|os.O_CLOEXEC,dir_fd=procfd)
    try:return os.read(f,16384).decode('ascii')
    finally:os.close(f)
   cg=pr('cgroup').strip()
   expected=self.cg or str(self.props.Get('org.freedesktop.systemd1.Service','ControlGroup'))
   if cg!='0::'+expected or exited(pfd):raise RuntimeError('Original kernel peer does not belong to original group')
   status=pr('status');starttime=pr('stat').rsplit(')',1)[1].split()[19]
   capeff=next(line.split(':',1)[1].strip() for line in status.splitlines() if line.startswith('CapEff:'))
   netns=os.readlink('ns/net',dir_fd=procfd)
   if 'NoNewPrivs:\t1' not in status or int(capeff,16)!=0 or netns==os.readlink('/proc/self/ns/net'):
    raise RuntimeError('Owned worker privilege/network preconditions failed')
   pin={'role':msg['role'],'pid':pid,'uid':uid,'gid':gid,'pidfd':pfd,'procfd':procfd,
        'starttime':starttime,'cgroup':cg,'armed':False,'released':False,
        'noNewPrivileges':True,'capEff':capeff,'privateNetworkNamespace':netns}
   self.pins.append(pin);self.peers.append((conn,pin));conn.setblocking(False)
   if pin['role']!='leader':conn.send(b'G');pin['released']=True
  for conn,pin in self.peers:
   try:
    message=conn.recv(256)
    if message==b'ARMED':pin['armed']=True
    elif message==b'':pin['originalPeerEOF']=True
    else:raise RuntimeError('Unexpected original worker message')
   except BlockingIOError:pass

 def held(self):
  if self.dirfd is None:return None
  out={'inode':os.fstat(self.dirfd).st_ino,'nlink':os.fstat(self.dirfd).st_nlink}
  try:os.lseek(self.eventfd,0,0);out['events']=os.read(self.eventfd,4096).decode('ascii').strip()
  except OSError as e:out['eventsReadError']={'errno':e.errno,'name':errno.errorcode.get(e.errno)}
  return out

 def snapshot(self):
  out={'held':self.held(),'managerStillOriginal':str(bus.get_name_owner('org.freedesktop.systemd1'))==owner}
  for interface,fields in [('Unit',['ActiveState','SubState','InvocationID','Job']),('Service',['MainPID','Result','ExecMainCode','ExecMainStatus','ControlGroup','NRestarts'])]:
   for field in fields:
    try:
     v=self.props.Get('org.freedesktop.systemd1.'+interface,field)
     out[field]=bytes(v).hex() if field=='InvocationID' else native_value(v)
    except dbus.DBusException as e:out[field+'Error']=e.get_dbus_name()
  try:out['currentPathInode']=os.stat('/sys/fs/cgroup'+self.cg,follow_symlinks=False).st_ino
  except OSError as e:out['currentPathError']={'errno':e.errno,'name':errno.errorcode.get(e.errno)}
  out['peers']=[{k:v for k,v in p.items() if k not in ('pidfd','procfd')}|
                {'originalPidfdReadable':exited(p['pidfd'])} for p in self.pins]
  return out

 def stop(self):
  guard()
  if bytes(self.props.Get('org.freedesktop.systemd1.Unit','InvocationID')).hex()!=self.invocation:
   raise RuntimeError('Original invocation changed before stop')
  if os.fstat(self.dirfd).st_ino!=self.cginode:raise RuntimeError('Original cgroup reference changed')
  self.result['stopRequestedMonotonic']=time.monotonic()
  self.stop_job=str(manager.StopUnit(self.name,'fail'))
  self.result['stopJobAck']=self.stop_job
  pump(lambda:self.stop_job in jobs)
  original=jobs[self.stop_job]
  if original['unit']!=self.name or original['result']!='done':raise RuntimeError('Original stop job did not finish done')
  pump(lambda:all(exited(p['pidfd']) for p in self.pins))
  if self.mode=='term_fork' and not any(p['role']=='late-child' for p in self.pins):
   raise RuntimeError('Stop-time fork peer was not pinned; no substitute pass')
  self.result['stopJob']=original;self.result['afterStop']=self.snapshot()
  self.result['stopElapsedSeconds']=time.monotonic()-self.result['stopRequestedMonotonic']
  self.result['measuredOriginalJobAndPinnedWorkersExited']=True;self.stopped=True

try:
 for mode in ['basic','double_fork','ignore_term','term_fork']:
  current=Unit(mode,mode);current.stop()
 a=Unit('isolation-a','basic');b=Unit('isolation-b','basic')
 b_before=b.snapshot();a.stop();b_after=b.snapshot()
 untouched=all(not exited(p['pidfd']) for p in b.pins) and b_after.get('InvocationID')==b_before.get('InvocationID') and b_after.get('ActiveState')=='active'
 report['twoGroupOriginalBUnchangedWhileAStopped']=untouched
 if not untouched:raise RuntimeError('Other owned synthetic group changed')
 b.stop();report['allRequestedMeasurementsCollected']=True
except Exception as e:
 report['errors'].append({'type':type(e).__name__,'message':str(e)[:600],'traceback':traceback.format_exc()[-2500:]})
 report['allRequestedMeasurementsCollected']=False
finally:
 stopped={u.name for u in units if u.stopped}
 report['unfinishedOwnedUnits']=[v['unit'] for v in report['dispatchAttempts'] if v['unit'] not in stopped]
 report['unknownObjectsNotRetried']=True
 report['notes']=['Only fixed nonce-owned transient units were started/stopped; no general unit/PID scans or signals.',
                  'Held cgroup read failures and zero/changed InvocationID are raw measurements, never success authority.',
                  'Lab workers use nobody, not the product B2 slot policy; no native bundle or five-unit production acceptance.',
                  'RuntimeMax20s bounds owned workers even on measurement failure; no ambiguous stop dispatch is retried.']
 (run/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps(report,ensure_ascii=False,indent=2),flush=True)
 for u in units:
  for conn,p in u.peers:conn.close()
  for p in u.pins:
   os.close(p['pidfd']);os.close(p['procfd'])
  if u.eventfd is not None:os.close(u.eventfd)
  if u.dirfd is not None:os.close(u.dirfd)
  u.listener.close()
 os.close(manager_fd);bus.close()
raise SystemExit(0 if report.get('allRequestedMeasurementsCollected') else 2)
