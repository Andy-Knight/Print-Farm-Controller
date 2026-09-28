function ipv4Parts(address) {
  const parts = String(address || '').trim().split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    throw new Error(`Invalid IPv4 address: ${address}`);
  }
  return parts;
}

function ipv4ToInt(address) {
  const [a, b, c, d] = ipv4Parts(address);
  return ((((a * 256) + b) * 256 + c) * 256 + d) >>> 0;
}

function intToIpv4(value) {
  const n = Number(value) >>> 0;
  return [
    (n >>> 24) & 255,
    (n >>> 16) & 255,
    (n >>> 8) & 255,
    n & 255
  ].join('.');
}

export function parseDiscoverySubnet(value) {
  const text = String(value || '').trim();
  if (!text) return null;

  const match = /^([^/]+)\/(\d{1,2})$/.exec(text);
  if (!match) {
    throw new Error('DISCOVERY_SUBNET must use IPv4 CIDR notation, for example 192.168.1.0/24');
  }

  const prefix = Number(match[2]);
  if (!Number.isInteger(prefix) || prefix < 22 || prefix > 30) {
    throw new Error('DISCOVERY_SUBNET prefix must be between /22 and /30 to keep LAN scanning bounded');
  }

  const addressInt = ipv4ToInt(match[1]);
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  const networkInt = (addressInt & mask) >>> 0;
  const broadcastInt = (networkInt | (~mask >>> 0)) >>> 0;
  const hostCount = Math.max(0, broadcastInt - networkInt - 1);

  return Object.freeze({
    cidr:`${intToIpv4(networkInt)}/${prefix}`,
    prefix,
    network:intToIpv4(networkInt),
    broadcast:intToIpv4(broadcastInt),
    hostCount,
    firstHost:hostCount ? intToIpv4(networkInt + 1) : null,
    lastHost:hostCount ? intToIpv4(broadcastInt - 1) : null,
    networkInt,
    broadcastInt
  });
}

export function configuredDiscoverySubnet(env = process.env) {
  return parseDiscoverySubnet(env?.DISCOVERY_SUBNET);
}

export function discoverySubnetHosts(subnet) {
  const parsed = typeof subnet === 'string' ? parseDiscoverySubnet(subnet) : subnet;
  if (!parsed) return [];

  const hosts = [];
  for (let value = parsed.networkInt + 1; value < parsed.broadcastInt; value++) {
    hosts.push(intToIpv4(value));
  }
  return hosts;
}
