'use strict';

const http2 = require('http2');
const fmw = require('find-my-way');

const modelStream = require('./stream');
const modelHttpError = require('./httpError');

const PATH_SEPARATOR = '/';

const SYMBOL_ROUTER = Symbol('router');
const SYMBOL_PROTO_STREAM = Symbol('protoStream');
const SYMBOL_PREFIX = Symbol('prefix');
const SYMBOL_MIDDLEWARES = Symbol('middlewares');
const SYMBOL_ERROR_HANDLER = Symbol('errorHandler');
const SYMBOL_HANDLE_ERROR = Symbol('handleError');
const SYMBOL_EXEC_HANDLER = Symbol('execHandler');
const SYMBOL_EXEC_MIDDLEWARES = Symbol('execMiddlewares');
const SYMBOL_EXEC_ROUTE = Symbol('execRoute');
const SYMBOL_WRAP_ROUTE = Symbol('wrapRoute');
const SYMBOL_WRAP_HANDLER = Symbol('wrapHandler');

const HEADER_ACCEPT_VERSION = 'accept-version';

function decorate(_proto, _key, _value) {
  if (typeof _value === 'object' && _value.get) {
    Object.defineProperty(_proto, _key, {
      enumerable: true,
      get: _value.get,
      set: _value.set
    });
  } else {
    _proto[_key] = _value;
  }
}

function joinPath(_prefix, _path) {
  if (_prefix[0] !== PATH_SEPARATOR) {
    _prefix = `${PATH_SEPARATOR}${_prefix}`;
  }

  if (_path && _prefix.substr(-1) !== PATH_SEPARATOR) {
    _prefix = `${_prefix}${PATH_SEPARATOR}`;
  }

  if (_path[0] === PATH_SEPARATOR) {
    _path = _path.substr(1);
  }

  return `${_prefix}${_path}`;
}

class PlutonRouter {
  constructor(_router, _protoStream = modelStream, _prefix = '') {
    class protoStream extends _protoStream {
      constructor(_stream, _headers, _params) {
        super(_stream, _headers, _params);
      }
    }

    Object.defineProperties(this, {
      [SYMBOL_ROUTER]: {value: _router},
      [SYMBOL_PROTO_STREAM]: {value: protoStream},
      [SYMBOL_PREFIX]: {value: _prefix},
      [SYMBOL_MIDDLEWARES]: {value: []},
      [SYMBOL_ERROR_HANDLER]: {writable: true, value: null}
    });
  }

  decorate(_key, _value) {
    decorate(this.constructor.prototype, _key, _value);
  }

  decorateStream(_key, _value) {
    decorate(this[SYMBOL_PROTO_STREAM].prototype, _key, _value);
  }

  setErrorHandler(_handler) {
    this[SYMBOL_ERROR_HANDLER] = _handler;
  }

  use(_middleware) {
    if (typeof _middleware !== 'function') {
      throw new Error('Invalid middleware');
    }

    const middleware = this[SYMBOL_WRAP_HANDLER](_middleware);
    this[SYMBOL_MIDDLEWARES].push(middleware);
  }

  on(_method, _path, _options, _handler) {
    if (typeof _options === 'function') {
      _handler = _options;
      _options = {};
    }

    const path = joinPath(this[SYMBOL_PREFIX], _path);
    const handler = this[SYMBOL_WRAP_ROUTE](_handler);
    this[SYMBOL_ROUTER].on(_method, path, _options, handler);
  }

  all(_path, _handler) {
    const path = joinPath(this[SYMBOL_PREFIX], _path);
    const handler = this[SYMBOL_WRAP_ROUTE](_handler);
    this[SYMBOL_ROUTER].all(path, handler);
  }

  options(_path, _options, _handler) {
    this.on('OPTIONS', _path, _options, _handler);
  }

  get(_path, _options, _handler) {
    this.on('GET', _path, _options, _handler);
  }

  post(_path, _options, _handler) {
    this.on('POST', _path, _options, _handler);
  }

  put(_path, _options, _handler) {
    this.on('PUT', _path, _options, _handler);
  }

  delete(_path, _options, _handler) {
    this.on('DELETE', _path, _options, _handler);
  }

  async [SYMBOL_HANDLE_ERROR](_ex, _stream) {
    if (!this[SYMBOL_ERROR_HANDLER]) {
      throw _ex;
    }

    const res = this[SYMBOL_ERROR_HANDLER](_ex, _stream);
    if (res instanceof Promise) {
      await res;
    }
  }

  async [SYMBOL_EXEC_HANDLER](_handler, _stream) {
    try {
      let res = _handler(_stream);
      if (res instanceof Promise) {
        res = await res;
      }

      return res;
    } catch (ex) {
      await this[SYMBOL_HANDLE_ERROR](ex, _stream);
    }
  }

  async [SYMBOL_EXEC_MIDDLEWARES](_stream) {
    for (let middleware of this[SYMBOL_MIDDLEWARES]) {
      const res = await middleware(_stream);
      if (res === false) {
        return;
      }
    }
  }

  async [SYMBOL_EXEC_ROUTE](_stream, _handler) {
    await this[SYMBOL_EXEC_MIDDLEWARES](_stream);
    await this[SYMBOL_EXEC_HANDLER](_handler, _stream);
  }

  [SYMBOL_WRAP_HANDLER](_handler) {
    return async _stream => {
      await this[SYMBOL_EXEC_HANDLER](_handler, _stream);
    };
  }

  [SYMBOL_WRAP_ROUTE](_handler) {
    return async (_stream, _headers, _params) => {
      const stream = new this[SYMBOL_PROTO_STREAM](_stream, _headers, _params);
      await this[SYMBOL_EXEC_ROUTE](stream, _handler);
    };
  }

  child(_childPrefix) {
    const self = this;
    class protoChild extends this.constructor {
      constructor(_router, _protoStream, _prefix) {
        super(_router, _protoStream, _prefix);
      }

      async [SYMBOL_EXEC_MIDDLEWARES](_stream) {
        await self[SYMBOL_EXEC_MIDDLEWARES](_stream);
        await super[SYMBOL_EXEC_MIDDLEWARES](_stream);
      }

      async [SYMBOL_EXEC_HANDLER](_handler, _stream) {
        try {
          return await super[SYMBOL_EXEC_HANDLER](_handler, _stream);
        } catch (ex) {
          await self[SYMBOL_HANDLE_ERROR](ex, _stream);
        }
      }
    }

    return new protoChild(
      this[SYMBOL_ROUTER],
      this[SYMBOL_PROTO_STREAM],
      joinPath(this[SYMBOL_PREFIX], _childPrefix)
    );
  }
}

function factory(_config) {
  const config = Object.assign({
    ignoreTrailingSlash: true
  }, _config);

  let notFoundHandler = null;
  const proto = new PlutonRouter(fmw({
    ignoreTrailingSlash: config.ignoreTrailingSlash
  }));

  function setNotFoundHandler(_handler) {
    const handler = proto[SYMBOL_WRAP_HANDLER](_handler);
    notFoundHandler = handler;
  }

  async function lookup(_stream, _headers) {
    const method = _headers[http2.constants.HTTP2_HEADER_METHOD];
    const path = _headers[http2.constants.HTTP2_HEADER_PATH];
    const version = _headers[HEADER_ACCEPT_VERSION];
    const route = proto[SYMBOL_ROUTER].find(method, path, version);
    if (!route) {
      const stream = new proto[SYMBOL_PROTO_STREAM](_stream, _headers);
      await notFoundHandler(stream);
      return;
    }

    await route.handler(_stream, _headers, route.params);
  }

  Object.defineProperties(proto, {
    setNotFoundHandler: {enumerable: true, value: setNotFoundHandler},
    lookup: {enumerable: true, value: lookup}
  });

  proto.setNotFoundHandler(() => {
    throw new modelHttpError(404, 'not found');
  });

  return proto;
}

module.exports = factory;
