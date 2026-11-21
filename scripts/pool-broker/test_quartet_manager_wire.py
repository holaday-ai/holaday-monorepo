"""Linux D-Bus seam on the original synthetic manager; real socket byte transport."""
import contextlib
import socket

import manager_probe


@contextlib.contextmanager
def original_manager_wire(s):
    left, right = socket.socketpair()
    channel = s.manager._channel
    previous = {key: getattr(channel, key, None) for key in ('sendall', 'recvmsg', 'fileno', 'settimeout', 'close')}
    s.wire_calls, s.stop_calls, s.ref_units, s.job_wire_mode = [], [], [], 'late'
    serial = 100

    def emit(kind, headers, signature='', values=()):
        nonlocal serial
        serial += 1
        right.sendall(manager_probe._dbus_encode(kind, serial, headers, signature, values))

    def job(job_id, unit, result='done'):
        emit(4, {1: '/org/freedesktop/systemd1', 2: 'org.freedesktop.systemd1.Manager',
                 3: 'JobRemoved', 7: ':1.5'}, 'uoss',
             (job_id, '/org/freedesktop/systemd1/job/' + str(job_id), unit, result))
    s.emit_job = job

    def send(raw):
        if raw == b'BEGIN\r\n': return
        data = manager_probe._dbus_decode(raw)
        fields, values = data['headers'], data['body']
        member, mode = fields[3], s.job_wire_mode
        s.wire_calls.append(member)
        sender = 'org.freedesktop.DBus' if member in ('Hello', 'AddMatch') else ':1.5'
        reply = {5: data['serial'], 7: sender}
        if member == 'Hello': emit(2, reply, 's', (':1.42',))
        elif member in ('AddMatch', 'Subscribe'): emit(2, reply)
        elif member == 'RefUnit':
            s.ref_units.append(values[0]); emit(2, reply)
        elif member == 'Get':
            unit = next(name for name in s.units if fields[1] ==
                '/org/freedesktop/systemd1/unit/' + name.replace('-', '_2d').replace('.', '_2e'))
            prop = values[1]
            kind, value = s.units[unit][prop]
            if kind == 'ay': value = bytes(value)
            if mode == 'rebound' and 'brave-' in unit and prop == 'InvocationID': value = b'\xff' * 16
            emit(2, reply, 'v', ((kind, value),))
        elif member == 'StopUnit':
            unit, policy = values
            assert policy == 'fail'
            s.stop_calls.append(unit)
            job_id = 100 + len(s.stop_calls)
            if mode == 'dependency' and len(s.stop_calls) == 1:
                job(90, 'holaday-pool-brave-' + s.resource + '.service')
            if mode in ('early', 'lost-ack'): job(job_id, unit)
            if mode == 'lost-ack':
                right.shutdown(socket.SHUT_WR); return
            emit(2, reply, 'o', ('/org/freedesktop/systemd1/job/' + str(job_id),))
            if mode != 'early': job(job_id, unit)
            if mode in ('empty', 'removed', 'live', 'restart', 'dependency'):
                s.units[unit].update(ActiveState=('s', 'inactive'), MainPID=('u', 0),
                    ControlGroup=('s', ''), Job=('(uo)', (0, '/')),
                    NRestarts=('u', 1 if mode == 'restart' else 0))
                if len(s.stop_calls) == 5:
                    s.exited = mode != 'live'
                    for _role, _worker, pin, _view in s.live._workers:
                        directory = s.root / ('sys/fs/cgroup/holadaypool.slice/holadaypool-' +
                            s.resource + '.slice/' + pin._record[0])
                        if mode == 'removed':
                            (directory / 'cgroup.events').unlink(); directory.rmdir()
                        else: (directory / 'cgroup.events').write_bytes(b'populated 0\nfrozen 0\n')
        else: raise AssertionError('unexpected fixed manager method: ' + member)

    def close():
        left.close(); right.close(); previous['close']()
    channel.sendall, channel.recvmsg, channel.fileno = send, left.recvmsg, left.fileno
    channel.settimeout, channel.close = left.settimeout, close
    try: yield
    finally:
        close()
        for key, value in previous.items():
            if value is None: delattr(channel, key)
            else: setattr(channel, key, value)
