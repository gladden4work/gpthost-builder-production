/**
 * Minimal `node:os` polyfill for Cloudflare Workers Vitest harness.
 * Provides deterministic values so TypeScript and other Node-targeted
 * libraries can run inside the worker runtime without native bindings.
 */

const EOL = '\n';

function platform() {
  return 'linux';
}

function type() {
  return 'Linux';
}

function release() {
  return '5.0.0-workers';
}

function arch() {
  return 'x64';
}

function tmpdir() {
  return '/tmp';
}

function homedir() {
  return '/home/worker';
}

function hostname() {
  return 'worker-runtime';
}

function cpus() {
  return [
    {
      model: 'Cloudflare-Worker-CPU',
      speed: 2400,
      times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
    },
  ];
}

function totalmem() {
  return 512 * 1024 * 1024; // 512MB typical memory limit
}

function freemem() {
  return 256 * 1024 * 1024;
}

function loadavg() {
  return [0, 0, 0];
}

function uptime() {
  return 0;
}

function networkInterfaces() {
  return {};
}

function userInfo() {
  return {
    username: 'worker',
    homedir: homedir(),
    shell: '/bin/false',
  };
}

const constants = {
  UV_UDP_REUSEADDR: 4,
};

const version = () => '0.0.0-workers';

const devNull = '/dev/null';

const os = {
  EOL,
  platform,
  type,
  release,
  arch,
  tmpdir,
  homedir,
  hostname,
  cpus,
  totalmem,
  freemem,
  loadavg,
  uptime,
  networkInterfaces,
  userInfo,
  constants,
  version,
  devNull,
};

module.exports = os;
module.exports.default = os;
module.exports.EOL = EOL;
module.exports.platform = platform;
module.exports.type = type;
module.exports.release = release;
module.exports.arch = arch;
module.exports.tmpdir = tmpdir;
module.exports.homedir = homedir;
module.exports.hostname = hostname;
module.exports.cpus = cpus;
module.exports.totalmem = totalmem;
module.exports.freemem = freemem;
module.exports.loadavg = loadavg;
module.exports.uptime = uptime;
module.exports.networkInterfaces = networkInterfaces;
module.exports.userInfo = userInfo;
module.exports.constants = constants;
module.exports.version = version;
module.exports.devNull = devNull;
