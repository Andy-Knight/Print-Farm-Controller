import test from 'node:test';
import assert from 'node:assert/strict';
import {
  configuredDiscoverySubnet,
  discoverySubnetHosts,
  parseDiscoverySubnet
} from '../src/discovery-network.js';
import { getBroadcastAddresses } from '../src/discovery.js';
import { localDiscoveryCandidates } from '../src/moonraker-discovery.js';

test('parses and normalizes a configured /24 discovery subnet', () => {
  const subnet = parseDiscoverySubnet('192.168.50.123/24');
  assert.equal(subnet.cidr, '192.168.50.0/24');
  assert.equal(subnet.network, '192.168.50.0');
  assert.equal(subnet.broadcast, '192.168.50.255');
  assert.equal(subnet.firstHost, '192.168.50.1');
  assert.equal(subnet.lastHost, '192.168.50.254');
  assert.equal(subnet.hostCount, 254);
});

test('configured discovery subnet is optional and rejects unbounded ranges', () => {
  assert.equal(configuredDiscoverySubnet({}), null);
  assert.throws(
    () => parseDiscoverySubnet('192.168.0.0/21'),
    /prefix must be between \/22 and \/30/i
  );
  assert.throws(
    () => parseDiscoverySubnet('not-a-subnet'),
    /CIDR notation/i
  );
});

test('configured subnet supplies its directed broadcast for FlashForge discovery', () => {
  const addresses = getBroadcastAddresses({
    interfaces:{},
    env:{ DISCOVERY_SUBNET:'192.168.77.0/24' }
  });
  assert.deepEqual(addresses.sort(), ['192.168.77.255', '255.255.255.255'].sort());
});

test('configured subnet supplies bounded host candidates for Snapmaker discovery', () => {
  const candidates = localDiscoveryCandidates({}, {
    env:{ DISCOVERY_SUBNET:'192.168.88.0/24' }
  });
  assert.equal(candidates.length, 254);
  assert.equal(candidates.includes('192.168.88.1'), true);
  assert.equal(candidates.includes('192.168.88.254'), true);
  assert.equal(candidates.includes('192.168.88.0'), false);
  assert.equal(candidates.includes('192.168.88.255'), false);
});

test('subnet host expansion supports smaller bounded CIDR ranges', () => {
  assert.deepEqual(
    discoverySubnetHosts(parseDiscoverySubnet('10.20.30.8/29')),
    ['10.20.30.9', '10.20.30.10', '10.20.30.11', '10.20.30.12', '10.20.30.13', '10.20.30.14']
  );
});

test('native interface discovery remains active alongside an explicit subnet', () => {
  const candidates = localDiscoveryCandidates({
    Ethernet:[{
      family:'IPv4',
      internal:false,
      address:'192.168.1.20',
      netmask:'255.255.255.0'
    }]
  }, {
    env:{ DISCOVERY_SUBNET:'192.168.2.0/24' }
  });

  assert.equal(candidates.includes('192.168.1.1'), true);
  assert.equal(candidates.includes('192.168.1.20'), false);
  assert.equal(candidates.includes('192.168.1.254'), true);
  assert.equal(candidates.includes('192.168.2.1'), true);
  assert.equal(candidates.includes('192.168.2.254'), true);
  assert.equal(candidates.length, 507);
});
