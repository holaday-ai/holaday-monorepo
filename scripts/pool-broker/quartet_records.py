"""Strict v2 whole-group records in the original single-writer journal."""
import json
import re

from installation import _id
from protocol import _identifier
from quartet_protocol import decode_quartet_request

ROLES = ('anchor', 'xvfb', 'brave', 'x11vnc', 'websockify')


def replay(row, resources, requests):
    if row.get('action') == 'prepare':
        return replay_prepare(row, resources, requests)
    if row.get('action') in ('create_offer', 'create_accept'):
        return replay_create_offer(row, resources)
    if row.get('action') == 'group_ready':
        return replay_group_ready(row, resources)
    if row.get('action') in ('material_claim', 'material_ready'):
        return replay_material(row, resources)
    if row.get('action') in ('credential_claim', 'credential_ready'):
        return replay_credential(row, resources)
    if row.get('action') in ('endpoint_claim', 'endpoint_ready'):
        return replay_endpoints(row, resources)
    if row.get('action') in ('egress_claim', 'egress_ready'):
        return replay_egress(row, resources)
    if row.get('action') == 'role_grant':
        return replay_grant(row, resources)
    if row.get('action') in ('bridge_offer', 'bridge_commit'):
        return replay_bridge(row, resources)
    if row.get('action') in ('probe_open', 'probe_accept', 'protocol_command', 'protocol_observed', 'protocol_complete'):
        return replay_protocol(row, resources)
    common = {'version', 'revision', 'action', 'resource', 'role'}
    resource, role = row.get('resource'), row.get('role')
    if (type(resource) is not str or resource not in resources
            or resources[resource]['version'] != 2 or type(role) is not str or role not in ROLES):
        raise ValueError()
    group = resources[resource]
    roles = group['roles']
    if row['action'] == 'role_dispatch':
        binding = {'unit', 'managerGuid', 'managerOwner'}
        material = group.get('material')
        if material is not None and (material['state'] != 'ready'
                or material.get('credentials', {}).get(role, {}).get('state') != 'ready'
                or material['managerGuid'] != row.get('managerGuid') or material['managerOwner'] != row.get('managerOwner')
                or any(not value.get('granted', False) for value in roles.values())):
            raise ValueError()
        if (set(row) != common | binding or role in roles
                or role != ROLES[len(roles)] or any(value['state'] != 'observed' for value in roles.values())
                or row['unit'] != 'holaday-pool-' + role + '-' + resource + '.service'
                or type(row['managerOwner']) is not str or len(row['managerOwner']) > 64
                or re.fullmatch(r':[0-9]+\.[0-9]+', row['managerOwner']) is None):
            raise ValueError()
        _identifier(row['managerGuid'], 32)
        if any(value['managerGuid'] != row['managerGuid'] or value['managerOwner'] != row['managerOwner']
               for value in roles.values()):
            raise ValueError()
        roles[role] = {key: row[key] for key in binding} | {'state': 'dispatching'}
        group['state'] = 'dispatching'
    elif row['action'] == 'role_accepted':
        if (set(row) != common | {'job'} or role not in roles or roles[role]['state'] != 'dispatching'
                or type(row['job']) is not str
                or re.fullmatch(r'/org/freedesktop/systemd1/job/[1-9][0-9]{0,9}', row['job']) is None
                or int(row['job'].rsplit('/', 1)[1]) > 4294967295
                or any(value.get('job') == row['job'] for value in roles.values())):
            raise ValueError()
        roles[role].update(state='accepted', job=row['job'])
    elif row['action'] == 'role_observe':
        if (set(row) != common | {'invocation'} or role not in roles or roles[role]['state'] != 'accepted'):
            raise ValueError()
        _identifier(row['invocation'], 32)
        if any(value.get('invocation') == row['invocation'] for value in roles.values()):
            raise ValueError()
        roles[role].update(state='observed', invocation=row['invocation'])
        if len(roles) == len(ROLES) and all(value['state'] == 'observed' for value in roles.values()):
            group['state'] = 'observed'
    else:
        raise ValueError()


def replay_material(row, resources):
    common = {'version', 'revision', 'action', 'resource'}
    resource = row.get('resource')
    if type(resource) is not str or resource not in resources or resources[resource]['version'] != 2:
        raise ValueError()
    group = resources[resource]
    if row['action'] == 'material_claim':
        if (set(row) != common | {'rootfsDigest', 'managerGuid', 'managerOwner'}
                or group['state'] != 'prepared' or group['roles'] or 'material' in group
                or 'createOffer' in group and group['createOffer']['state'] != 'accepted'
                or type(row['managerOwner']) is not str or len(row['managerOwner']) > 64
                or re.fullmatch(r':[0-9]+\.[0-9]+', row['managerOwner']) is None):
            raise ValueError()
        _identifier(row['rootfsDigest'], 64)
        _identifier(row['managerGuid'], 32)
        group['material'] = {key: row[key] for key in ('rootfsDigest', 'managerGuid', 'managerOwner')}
        group['material']['state'] = 'claimed'
        group['state'] = 'material_claimed'
    elif (set(row) == common and group.get('material', {}).get('state') == 'claimed'
          and group['state'] == 'material_claimed' and not group['roles']):
        group['material']['state'] = 'ready'
        group['state'] = 'material_prepared'
    else:
        raise ValueError()


def replay_group_ready(row, resources):
    resource = row.get('resource')
    if (set(row) != {'version', 'revision', 'action', 'resource', 'preparedDigest'}
            or type(resource) is not str or resource not in resources or resources[resource]['version'] != 2):
        raise ValueError()
    _identifier(row['preparedDigest'], 64)
    group = resources[resource]
    protocol = group.get('protocol', {})
    if (group['state'] != 'observed' or group.get('createOffer', {}).get('preparedDigest') != row['preparedDigest']
            or any(group.get(name, {}).get('state') != state for name, state in
                (('createOffer', 'accepted'), ('material', 'ready'), ('endpoints', 'ready'),
                 ('egress', 'ready'), ('bridge', 'committed'), ('protocol', 'complete')))
            or set(group.get('roles', {})) != set(ROLES)
            or any(role.get('state') != 'observed' or role.get('granted') is not True for role in group['roles'].values())
            or set(protocol.get('stages', {})) != {'1', '2', '3', '4'}
            or any(stage.get('state') != 'observed' for stage in protocol['stages'].values())):
        raise ValueError()
    group['state'] = 'ready'
    # Historical fact only; never reconstruct a live owner, lease, or groupExit.


def replay_create_offer(row, resources):
    resource, action = row.get('resource'), row.get('action')
    fields = {'version', 'revision', 'action', 'resource', 'preparedDigest'}
    if action == 'create_offer': fields.add('nonceDigest')
    if (set(row) != fields or type(resource) is not str or resource not in resources
            or resources[resource]['version'] != 2): raise ValueError()
    group = resources[resource]
    if group['state'] != 'prepared' or group['roles'] or 'material' in group: raise ValueError()
    _identifier(row['preparedDigest'], 64)
    if action == 'create_offer':
        _identifier(row['nonceDigest'], 64)
        if ('createOffer' in group or any(value.get('createOffer', {}).get(key) == row[key]
                for value in resources.values() for key in ('preparedDigest', 'nonceDigest'))): raise ValueError()
        group['createOffer'] = {'state': 'offered', 'preparedDigest': row['preparedDigest'],
                                'nonceDigest': row['nonceDigest']}
    elif action == 'create_accept':
        offer = group.get('createOffer', {})
        if offer.get('state') != 'offered' or offer.get('preparedDigest') != row['preparedDigest']: raise ValueError()
        offer['state'] = 'accepted'
    else: raise ValueError()
    # Application reservation only; this cannot make material, roles or ready.


def replay_endpoints(row, resources):
    resource = row.get('resource')
    if (set(row) != {'version', 'revision', 'action', 'resource'}
            or type(resource) is not str or resource not in resources or resources[resource]['version'] != 2):
        raise ValueError()
    group = resources[resource]
    if (group['state'] != 'material_prepared' or group['roles']
            or group.get('material', {}).get('state') != 'ready' or group['material'].get('credentials')):
        raise ValueError()
    if row['action'] == 'endpoint_claim' and 'endpoints' not in group:
        group['endpoints'] = {'state': 'claimed'}
    elif row['action'] == 'endpoint_ready' and group.get('endpoints', {}).get('state') == 'claimed':
        group['endpoints']['state'] = 'ready'
    else:
        raise ValueError()
    # Material fact only. It cannot reconstruct original listeners or readiness.


def replay_egress(row, resources):
    common = {'version', 'revision', 'action', 'resource'}
    resource = row.get('resource')
    if type(resource) is not str or resource not in resources or resources[resource]['version'] != 2:
        raise ValueError()
    group = resources[resource]
    if (group['state'] != 'material_prepared' or group['roles']
            or group.get('material', {}).get('state') != 'ready' or group['material'].get('credentials')
            or group.get('endpoints', {}).get('state') != 'ready'):
        raise ValueError()
    if row['action'] == 'egress_claim' and set(row) == common and 'egress' not in group:
        group['egress'] = {'state': 'claimed'}
    elif (row['action'] == 'egress_ready' and set(row) == common | {'leafDevice', 'leafInode', 'challengeDigest'}
            and group.get('egress', {}).get('state') == 'claimed'):
        if (type(row['leafDevice']) is not int or not 0 <= row['leafDevice'] <= 18446744073709551615
                or type(row['leafInode']) is not int or not 0 < row['leafInode'] <= 18446744073709551615):
            raise ValueError()
        _identifier(row['challengeDigest'], 64)
        group['egress'].update(state='ready', leafDevice=row['leafDevice'], leafInode=row['leafInode'],
                              challengeDigest=row['challengeDigest'])
    else:
        raise ValueError()
    # Durable material fact only; never reconstruct an original O_PATH or process.


def replay_credential(row, resources):
    common = {'version', 'revision', 'action', 'resource', 'role'}
    resource, role = row.get('resource'), row.get('role')
    if (type(resource) is not str or resource not in resources or resources[resource]['version'] != 2
            or type(role) is not str or role not in ROLES):
        raise ValueError()
    group = resources[resource]
    material = group.get('material', {})
    if material.get('state') != 'ready':
        raise ValueError()
    if role != 'anchor' and 'endpoints' in group and group.get('bridge', {}).get('state') != 'committed':
        raise ValueError()
    credentials = material.setdefault('credentials', {})
    if row['action'] == 'credential_claim':
        if (set(row) != common or role in credentials or len(credentials) >= len(ROLES)
                or role != ROLES[len(credentials)] or role in group['roles']
                or any(not group['roles'].get(previous, {}).get('granted', False)
                       for previous in ROLES[:len(credentials)])):
            raise ValueError()
        credentials[role] = {'state': 'claimed'}
    elif (set(row) == common | {'bindingDigest'} and role in credentials
          and credentials[role]['state'] == 'claimed' and role not in group['roles']):
        _identifier(row['bindingDigest'], 64)
        credentials[role].update(state='ready', bindingDigest=row['bindingDigest'])
    else:
        raise ValueError()


def replay_grant(row, resources):
    fields = {'version', 'revision', 'action', 'resource', 'role', 'invocation', 'bindingDigest', 'challengeDigest'}
    resource, role = row.get('resource'), row.get('role')
    if (set(row) != fields or type(resource) is not str or resource not in resources
            or resources[resource]['version'] != 2 or type(role) is not str or role not in ROLES):
        raise ValueError()
    group = resources[resource]
    material, worker = group.get('material', {}), group['roles'].get(role, {})
    credential = material.get('credentials', {}).get(role, {})
    if (material.get('state') != 'ready' or credential.get('state') != 'ready'
            or worker.get('state') != 'observed' or worker.get('granted', False)
            or worker.get('invocation') != row['invocation'] or credential.get('bindingDigest') != row['bindingDigest']
            or any(worker.get(key) != material.get(key) for key in ('managerGuid', 'managerOwner'))):
        raise ValueError()
    _identifier(row['invocation'], 32)
    _identifier(row['bindingDigest'], 64)
    _identifier(row['challengeDigest'], 64)
    if any(value.get('challengeDigest') == row['challengeDigest'] for item in resources.values()
           for value in item.get('roles', {}).values()):
        raise ValueError()
    worker.update(granted=True, challengeDigest=row['challengeDigest'])
    # This is consumed/possibly delivered, not ready or a reconstructible lease.


def replay_bridge(row, resources):
    fields = {'version', 'revision', 'action', 'resource', 'invocation', 'challengeDigest', 'endpointDigest'}
    resource = row.get('resource')
    if (set(row) != fields or type(resource) is not str or resource not in resources
            or resources[resource]['version'] != 2):
        raise ValueError()
    group = resources[resource]
    anchor = group['roles'].get('anchor', {})
    if (group.get('endpoints', {}).get('state') != 'ready' or set(group['roles']) != {'anchor'}
            or not anchor.get('granted') or anchor.get('invocation') != row['invocation']
            or set(group.get('material', {}).get('credentials', {})) != {'anchor'}):
        raise ValueError()
    for key, length in (('invocation', 32), ('challengeDigest', 64), ('endpointDigest', 64)):
        _identifier(row[key], length)
    evidence = {key: row[key] for key in ('invocation', 'challengeDigest', 'endpointDigest')}
    if row['action'] == 'bridge_offer' and 'bridge' not in group:
        if any(item.get('bridge', {}).get('challengeDigest') == row['challengeDigest']
               or any(role.get('challengeDigest') == row['challengeDigest'] for role in item.get('roles', {}).values())
               for item in resources.values()):
            raise ValueError()
        group['bridge'] = evidence | {'state': 'offered'}
    elif row['action'] == 'bridge_commit' and group.get('bridge') == evidence | {'state': 'offered'}:
        group['bridge']['state'] = 'committed'
    else:
        raise ValueError()
    # Consumed records never recreate the original anchor or transferred FDs.


def replay_protocol(row, resources):
    common = {'version', 'revision', 'action', 'resource'}
    fields = {'stage', 'role', 'invocation', 'pid', 'challengeDigest', 'totalDeadlineNs', 'phaseDeadlineNs',
              'clockDevice', 'clockInode'}
    resource, stage, role = row.get('resource'), row.get('stage'), row.get('role')
    if (set(row) != common | fields or type(resource) is not str or resource not in resources
            or resources[resource]['version'] != 2 or type(stage) is not int or stage not in range(5)
            or type(role) is not str or role != ROLES[stage]): raise ValueError()
    for name, lower, upper in (('pid', 2, 2147483647), ('totalDeadlineNs', 1, 2**63 - 1),
            ('phaseDeadlineNs', 1, row['totalDeadlineNs']), ('clockDevice', 0, 2**64 - 1), ('clockInode', 1, 2**64 - 1)):
        value = row[name]
        if type(value) is not int or type(upper) is not int or not lower <= value <= upper: raise ValueError()
    _identifier(row['invocation'], 32)
    _identifier(row['challengeDigest'], 64)
    group = resources[resource]
    worker = group['roles'].get(role, {})
    if (worker.get('state') != 'observed' or not worker.get('granted')
            or worker.get('invocation') != row['invocation']): raise ValueError()
    evidence = {key: row[key] for key in fields}
    protocol = group.get('protocol')
    action = row['action']
    if action == 'probe_open':
        if (stage != 0 or protocol is not None or set(group['roles']) != {'anchor'}
                or any(group.get(name, {}).get('state') != state for name, state in
                    (('material', 'ready'), ('endpoints', 'ready'), ('egress', 'ready'), ('bridge', 'committed')))): raise ValueError()
    else:
        if (type(protocol) is not dict or any(row[key] != protocol[key] for key in
                ('totalDeadlineNs', 'clockDevice', 'clockInode'))): raise ValueError()
        if action == 'probe_accept':
            if stage != 0 or protocol != evidence | {'state': 'offered', 'stages': {}}: raise ValueError()
            protocol['state'] = 'accepted'
            return
        if protocol['state'] != 'accepted' or stage not in range(1, 5): raise ValueError()
        stages = protocol['stages']
        key = str(stage)
        if action == 'protocol_command':
            if (key in stages or len(stages) != stage - 1 or set(group['roles']) != set(ROLES[:stage + 1])
                    or any(value['state'] != 'observed' for value in stages.values())
                    or any(value.get('pid') == row['pid'] for value in [protocol, *stages.values()])): raise ValueError()
        elif action == 'protocol_observed':
            if stages.get(key) != evidence | {'state': 'commanded'}: raise ValueError()
            stages[key]['state'] = 'observed'
            return
        elif action == 'protocol_complete':
            if stage != 4 or len(stages) != 4 or stages.get(key) != evidence | {'state': 'observed'}: raise ValueError()
            protocol['state'] = 'complete'
            return
        else: raise ValueError()
    # A fresh command's nonce cannot collide with any earlier role or probe.
    for item in resources.values():
        earlier = list(item.get('roles', {}).values()) + [item.get('bridge', {}), item.get('protocol', {})]
        earlier += list(item.get('protocol', {}).get('stages', {}).values())
        if any(value.get('challengeDigest') == row['challengeDigest'] for value in earlier): raise ValueError()
    if action == 'probe_open': group['protocol'] = evidence | {'state': 'offered', 'stages': {}}
    else: protocol['stages'][str(stage)] = evidence | {'state': 'commanded'}
    # These consumed observations never produce ready, a lease, or group exit.


def replay_prepare(row, resources, requests):
    fields = {'version', 'revision', 'action', 'resource', 'component', 'requestId', 'boot', 'slot',
              'candidate', 'capability', 'egressCapability', 'uid', 'gid', 'policyDigest'}
    if (set(row) != fields or row['action'] != 'prepare' or row['component'] != 'quartet'
            or not _id(row['uid']) or row['uid'] == 998 or not _id(row['gid']) or row['gid'] == 998):
        raise ValueError()
    for key, length in (('resource', 32), ('candidate', 40), ('capability', 64),
                        ('egressCapability', 64), ('policyDigest', 64)):
        _identifier(row[key], length)
    request = decode_quartet_request(json.dumps({key: row[key] for key in
        ('version', 'requestId', 'boot', 'slot')} | {'action': 'create'}).encode())
    key = (request.boot, request.request_id)
    groups = [value for value in resources.values() if value['component'] == 'quartet']
    tokens = {value['capability'] for value in resources.values()} | {value['egressCapability'] for value in groups}
    if (row['resource'] in resources or key in requests or len(groups) >= 32
            or len(resources) + 3 * len(groups) + 4 > 128
            or row['capability'] == row['egressCapability']
            or row['capability'] in tokens or row['egressCapability'] in tokens
            or any(value['slot'] == request.slot for value in resources.values())
            or any(value['uid'] == row['uid'] or value['gid'] == row['gid']
                   or value['policyDigest'] != row['policyDigest'] for value in groups)):
        raise ValueError()
    resources[row['resource']] = row | {'state': 'prepared', 'roles': {}}
    requests[key] = row['resource']


def legacy_prepare_allowed(row, resources):
    groups = [value for value in resources.values() if value['component'] == 'quartet']
    if (len(resources) + 3 * len(groups) >= 128
            or any(value['slot'] == row['slot'] or row['capability'] in
                   (value['capability'], value['egressCapability']) for value in groups)):
        raise ValueError()
