"""One fixed, journal-first Xvfb dispatch. No readiness or terminal authority."""
import hashlib
import json
import re

import installation
import manager_probe
from protocol import CreateRequest, _identifier, _unique_object, _reject_constant
from resource_journal import ResourceJournal

_SERVICE = 'org.freedesktop.systemd1'
_OBJECT = '/org/freedesktop/systemd1'
_UNIT = _SERVICE + '.Unit'
_PROPERTIES = 'org.freedesktop.DBus.Properties'


def _deny():
    try:
        raise ValueError('POOL_BROKER_XVFB_UNPROVEN') from None
    except ValueError as error:
        error.__context__ = None
        raise


def _message(raw, signature):
    if type(raw) is not bytes or not 1 <= len(raw) <= 16384:
        raise ValueError()
    message=json.loads(raw, object_pairs_hook=_unique_object, parse_constant=_reject_constant)
    if (type(message) is not dict or set(message) != {'type','data'}
            or message['type'] != signature or type(message['data']) is not list or len(message['data']) != 1):
        raise ValueError()
    return message['data'][0]


def _template(unit, slot, identity):
    auth='/etc/holaday-pool-broker/xauthority/slot-' + str(slot) + '.auth'
    argv=('/usr/bin/Xvfb', ':'+str(100+slot), '-screen', '0', '1280x800x24',
          '-nolisten', 'tcp', '-auth', '${CREDENTIALS_DIRECTORY}/xauthority')
    properties=(
        ('Type','s','exec'), ('User','s',str(identity.browser_uid)), ('Group','s',str(identity.browser_gid)),
        ('SupplementaryGroups','as','0'), ('Restart','s','no'), ('KillMode','s','control-group'),
        ('RemainAfterExit','b','true'), ('NoNewPrivileges','b','true'), ('Delegate','b','false'),
        ('CapabilityBoundingSet','t','0'), ('AmbientCapabilities','t','0'),
        ('PrivateTmp','b','true'), ('PrivateNetwork','b','true'), ('PrivateDevices','b','true'),
        ('ProtectControlGroups','b','true'), ('ProtectSystem','s','strict'), ('ProtectHome','s','yes'),
        ('StandardOutput','s','null'), ('StandardError','s','null'),
        ('MemoryMax','t','268435456'), ('TasksMax','t','128'), ('TimeoutStopUSec','t','5000000'),
        ('LoadCredential','a(ss)','1','xauthority',auth),
        ('ExecStart','a(sasb)','1','/usr/bin/Xvfb',str(len(argv)),*argv,'false'))
    return ('ssa(sv)a(sa(sv))',unit,'fail',str(len(properties)),
            *(item for prop in properties for item in prop),'0')


def launch_xvfb(journal, manager, request):
    """Same-registration transaction; never connected to the public runtime socket yet."""
    try:
        if (type(journal) is not ResourceJournal or type(manager) is not manager_probe.SystemManagerProbe
                or type(request) is not CreateRequest or request.component != 'xvfb'
                or journal._registration is not manager._registration or journal._pin is not manager._pin):
            raise ValueError()

        def operation():
            handle=journal.prepare(request)

            def dispatch():
                journal._local()
                resource=next((key for key,value in journal._handles.items() if value is handle),None)
                if resource is None or journal._resources[resource]['state'] != 'prepared':
                    raise ValueError()
                manager._probe()
                identity=manager._io(installation.inspect_installation, manager._candidate)
                manifest=json.loads(manager._manifest_raw, object_pairs_hook=_unique_object,
                                    parse_constant=_reject_constant)
                tool=manifest['tools']['/usr/bin/Xvfb']
                if type(tool) is not dict or set(tool) != {'resolved','sha256'} or tool['resolved'] != '/usr/bin/Xvfb':
                    raise ValueError()
                digest=_identifier(tool['sha256'],64)
                executable=manager._walk('/usr/bin/Xvfb',0o755)
                auth=manager._walk('/etc/holaday-pool-broker/xauthority/slot-'+str(request.slot)+'.auth',0o600)

                def guard():
                    journal._guard()
                    manager._guard()
                    # The credential is NEVER read, hashed, serialized or output.
                    if not 0 < manager._metadata(auth,0o600).st_size <= 65536:
                        raise ValueError()
                    if hashlib.sha256(manager._read(executable,134217728)).hexdigest() != digest:
                        raise ValueError()
                    manager._remaining()

                def call(path, interface, method, args, signature):
                    guard()
                    argv=('/proc/self/fd/'+str(manager._tool),
                        '--address=unix:path=/run/dbus/system_bus_socket,guid='+manager._guid,
                        '--json=short','--no-pager','--auto-start=no','--allow-interactive-authorization=no',
                        '--timeout=2s','call',manager._owner,path,interface,method,*args)
                    raw=manager._io(manager_probe._capture,argv,manager._tool,manager._deadline,manager._live_budget)
                    result=_message(raw,signature)
                    guard()
                    return result

                unit='holaday-pool-xvfb-'+resource+'.service'
                guard()
                journal._append({'action':'dispatch','resource':resource,'unit':unit,
                    'managerGuid':manager._guid,'managerOwner':manager._owner})
                job=call(_OBJECT,_SERVICE+'.Manager','StartTransientUnit',_template(unit,request.slot,identity),'o')
                if (type(job) is not str or re.fullmatch(r'/org/freedesktop/systemd1/job/[1-9][0-9]{0,9}',job) is None
                        or int(job.rsplit('/',1)[1]) > 4294967295):
                    raise ValueError()
                journal._append({'action':'accepted','resource':resource,'job':job})
                expected=_OBJECT+'/unit/'+unit.replace('-','_2d').replace('.','_2e')
                if call(_OBJECT,_SERVICE+'.Manager','GetUnit',('s',unit),'o') != expected:
                    raise ValueError()

                def property_value(name, signature):
                    value=call(expected,_PROPERTIES,'Get',('ss',_UNIT,name),'v')
                    if type(value) is not dict or set(value) != {'type','data'} or value['type'] != signature:
                        raise ValueError()
                    return value['data']

                if property_value('Id','s') != unit:
                    raise ValueError()
                def invocation_id():
                    value=property_value('InvocationID','ay')
                    if (type(value) is not list or len(value) != 16
                            or any(type(byte) is not int or not 0 <= byte <= 255 for byte in value)):
                        raise ValueError()
                    return _identifier(bytes(value).hex(),32)

                encoded=invocation_id()
                if invocation_id() != encoded:
                    raise ValueError()
                manager._probe()
                guard()
                journal._append({'action':'observe','resource':resource,'invocation':encoded})
                guard()
                return {'state':'observed','groupExitProven':False}
            return journal._run(dispatch)
        return manager._run(operation, journal._alive)
    except Exception:
        _deny()
