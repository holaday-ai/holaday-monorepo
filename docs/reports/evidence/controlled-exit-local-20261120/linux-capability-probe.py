#!/usr/bin/env python3
"""Read-only lab inventory. Never exit authority, permission or production verification."""
import json,os,platform,sys
if len(sys.argv)!=1:raise SystemExit('No arguments, targets, commands, paths or credentials are accepted.')
r={'schemaVersion':1,'kind':'read-only-nonproduction-linux-capability-inventory','platform':platform.system(),'machine':platform.machine(),'uid':getattr(os,'getuid',lambda:None)(),'createsResources':False,'changesPrivileges':False,'opensNetwork':False,'signalsProcesses':False,'exitProofAccepted':False,'productionAccepted':False,'reasons':[]}
if sys.platform!='linux':r['reasons'].append('Linux kernel/systemd/cgroup v2 are not available on this host')
else:
 import fcntl,select,stat,subprocess
 def read(path,limit):
  fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
  try:
   data=os.read(fd,limit+1)
   if len(data)>limit:raise ValueError('bounded read exceeded')
   return data.decode('ascii').strip()
  finally:os.close(fd)
 try:r['pid1']=read('/proc/1/comm',256)
 except OSError as e:r['pid1Error']=type(e).__name__
 r['systemdIsPid1']=r.get('pid1')=='systemd'
 try:
  fd=os.pidfd_open(os.getpid(),0)
  try:
   p=select.poll();p.register(fd,select.POLLIN|select.POLLHUP|select.POLLERR)
   r['ownPidfdAvailable']=not bool(p.poll(0)) and bool(fcntl.fcntl(fd,fcntl.F_GETFD)&fcntl.FD_CLOEXEC)
  finally:os.close(fd)
 except (OSError,AttributeError) as e:r['ownPidfdAvailable']=False;r['pidfdError']=type(e).__name__
 try:
  fd=os.open('/sys/fs/cgroup',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)
  try:r['cgroupMountReadOnly']=bool(os.fstatvfs(fd).f_flag&os.ST_RDONLY)
  finally:os.close(fd)
  r['cgroupV2Controllers']=read('/sys/fs/cgroup/cgroup.controllers',4096).split()
  r['cgroupV2Visible']=True
 except (OSError,ValueError) as e:r['cgroupV2Visible']=False;r['cgroupError']=type(e).__name__
 for name,path in [('systemd','/usr/lib/systemd/systemd'),('busctl','/usr/bin/busctl')]:
  try:
   v=subprocess.run([path,'--version'],capture_output=True,timeout=3,check=True,env={'PATH':'/usr/bin:/bin','LANG':'C'},stdin=subprocess.DEVNULL)
   if len(v.stdout)+len(v.stderr)>8192:raise ValueError('version output exceeded bound')
   r[name+'Version']=v.stdout.decode('utf-8','strict').splitlines()[0]
  except (OSError,ValueError,subprocess.SubprocessError) as e:r[name+'VersionError']=type(e).__name__
 r['reasons'].append('Inventory does not certify original manager, isolated target ownership, sealed native bundle, five-unit stop jobs or terminal group state')
r['credentialsRead']=False;r['modelCalls']=0;r['kmsCalls']=0
print(json.dumps(r,ensure_ascii=False,indent=2))
