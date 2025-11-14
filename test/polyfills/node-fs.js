/**
 * Minimal `node:fs` polyfill for Cloudflare Workers Vitest harness.
 * Provides no-op implementations just sufficient for TypeScript runtime.
 */

function noop() {}

function returnFalse() {
  return false;
}

function returnEmptyString() {
  return '';
}

function returnZero() {
  return 0;
}

function statResult() {
  return {
    isSymbolicLink: returnFalse,
    isDirectory: returnFalse,
    isFile: () => true,
    size: 0,
    mtimeMs: 0,
    ctimeMs: 0,
    birthtimeMs: 0,
  };
}

const realpathSync = Object.assign((path) => path, {
  native: (path) => path,
});

function readFileSync(path, encoding) {
  if (encoding === 'utf8' || encoding === 'utf-8') {
    return '';
  }
  return new Uint8Array();
}

function writeFileSync() {}
function mkdirSync() {}
function readdirSync() {
  return [];
}

function statSync() {
  return statResult();
}

function lstatSync() {
  return statResult();
}

function existsSync() {
  return false;
}

function unlinkSync() {}

function watch() {
  return {
    close: noop,
  };
}

function watchFile() {}
function unwatchFile() {}

function readlinkSync(path) {
  return path;
}

const promises = {
  readFile: async () => new Uint8Array(),
  writeFile: async () => undefined,
  mkdir: async () => undefined,
  stat: async () => statResult(),
};

const target = {
  realpathSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  statSync,
  lstatSync,
  existsSync,
  unlinkSync,
  watch,
  watchFile,
  unwatchFile,
  readlinkSync,
  promises,
};

const fsProxy = new Proxy(target, {
  get(targetObj, prop) {
    if (prop === 'default') {
      return fsProxy;
    }
    if (prop === 'realpathSync') {
      return realpathSync;
    }
    return Reflect.get(targetObj, prop, targetObj);
  },
});

module.exports = fsProxy;
module.exports.default = fsProxy;
module.exports.promises = promises;
module.exports.realpathSync = realpathSync;
module.exports.readFileSync = readFileSync;
module.exports.writeFileSync = writeFileSync;
module.exports.mkdirSync = mkdirSync;
module.exports.readdirSync = readdirSync;
module.exports.statSync = statSync;
module.exports.lstatSync = lstatSync;
module.exports.existsSync = existsSync;
module.exports.unlinkSync = unlinkSync;
module.exports.watch = watch;
module.exports.watchFile = watchFile;
module.exports.unwatchFile = unwatchFile;
module.exports.readlinkSync = readlinkSync;
