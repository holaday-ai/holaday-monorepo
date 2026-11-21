import hashlib,json,os,pathlib,platform,select,subprocess,sys,time

if sys.platform!='linux' or os.environ.get('WSL_DISTRO_NAME')!='Holaday-ExitLab':
    raise SystemExit('Only the explicitly named new WSL lab is accepted')
if os.getuid()!=0:raise SystemExit('Lab setup inventory expects the lab controller')

def read(path,limit=8192):
    with open(path,'r',encoding='ascii') as f:
        data=f.read(limit+1)
    if len(data)>limit:raise ValueError('bounded read exceeded')
    return data.strip()

r={'kind':'holaday-isolated-wsl-lab-inventory','nonce':'holaday-exitlab-20261121-a1',
   'platform':platform.platform(),'machine':platform.machine(),'pid1Comm':read('/proc/1/comm'),
   'kernelBootId':read('/proc/sys/kernel/random/boot_id'),
   'distro':os.environ['WSL_DISTRO_NAME'],'uid':os.getuid(),
   'exitProofAccepted':False,'productionAccepted':False,'modelCalls':0,'kmsCalls':0}
fd=os.pidfd_open(os.getpid(),0)
try:
    p=select.poll();p.register(fd,select.POLLIN|select.POLLERR|select.POLLHUP)
    r['ownPidfdOpen']=True;r['ownPidfdNotExited']=not bool(p.poll(0))
finally:os.close(fd)
r['controllers']=read('/sys/fs/cgroup/cgroup.controllers').split()
r['ownCgroup']=read('/proc/self/cgroup')
r['namespaceLinks']={n:os.readlink('/proc/self/ns/'+n) for n in ['cgroup','pid','mnt','net']}
r['wslConf']=read('/etc/wsl.conf')
for tool in ['/usr/bin/python3','/usr/bin/systemctl','/usr/bin/busctl','/usr/bin/systemd-run']:
    p=pathlib.Path(tool);r.setdefault('tools',{})[tool]={'exists':p.is_file()}
    if p.is_file():r['tools'][tool]['sha256']=hashlib.sha256(p.read_bytes()).hexdigest()
try:
    import dbus
    from dbus.mainloop.glib import DBusGMainLoop
    from gi.repository import GLib
    DBusGMainLoop(set_as_default=True)
    bus=dbus.SystemBus(private=True)
    owner=str(bus.get_name_owner('org.freedesktop.systemd1'))
    daemon=dbus.Interface(bus.get_object('org.freedesktop.DBus','/org/freedesktop/DBus'),'org.freedesktop.DBus')
    manager_pid=int(daemon.GetConnectionUnixProcessID(owner))
    props=dbus.Interface(bus.get_object(owner,'/org/freedesktop/systemd1'),'org.freedesktop.DBus.Properties')
    version=str(props.Get('org.freedesktop.systemd1.Manager','Version'))
    r['manager']={'busId':str(daemon.GetId()),'owner':owner,'pid':manager_pid,'version':version,
                  'originalPidfdAvailable':False}
    mfd=os.pidfd_open(manager_pid,0)
    try:r['manager']['originalPidfdAvailable']=True
    finally:os.close(mfd)
    r['dbusPythonAvailable']=True;r['glibAvailable']=True
    bus.close()
except Exception as e:r['managerError']={'type':type(e).__name__,'message':str(e)[:500]}
r['platformPrerequisitesObserved']=bool(r['pid1Comm']=='systemd' and r.get('manager',{}).get('pid')==1 and r.get('ownPidfdNotExited') and r.get('controllers'))
print(json.dumps(r,ensure_ascii=False,indent=2))
raise SystemExit(0 if r['platformPrerequisitesObserved'] else 2)
