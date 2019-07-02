'use strict';

const http2 = require('http2');
const pino = require('pino');

const modelRouter = require('./router');

function defaultNotFoundHandler(_stream) {
  _stream.log.error({stream: _stream}, 'not found');
  _stream.close(http2.constants.NGHTTP2_INTERNAL_ERROR);
}

function defaultErrorHandler(_error, _stream) {
  _stream.log.error({error: _error, stream: _stream}, 'internal server error');
  _stream.close(http2.constants.NGHTTP2_INTERNAL_ERROR);
}

function factory(_config) {
  const config = Object.assign({
    log: pino({
      serializers: {
        error: e => ({
          type: e.constructor.name,
          message: e.message,
          stack: e.stack
        }),
        stream: s => ({
          id: s.id,
          headers: s.in
        })
      }
    })
  }, _config);

  const proto = modelRouter();
  let server = null;

  proto.decorate('log', {get: () => config.log});
  proto.decorateStream('log', {get: () => config.log});
  proto.setNotFoundHandler(defaultNotFoundHandler);
  proto.setErrorHandler(defaultErrorHandler);

  function listen(_options) {
    if (server) {
      close();
    }

    server = config.https ? http2.createSecureServer(config.https) : http2.createServer();

    function onError(_error) {
      config.log.error({error: _error}, 'HTTP/2 server error caught');
    }

    function onSessionError(_error) {
      config.log.error({error: _error}, 'HTTP/2 session error caught');
    }

    function onUnknownProtocol(_socket) {
      config.log.error('Failed to negociate an allowed protocol');
      _socket.destroy();
    }

    function onStream(_stream, _headers) {
      function onStreamError(_error) {
        config.log.error({error: _error}, 'HTTP/2 stream error caught');
      }

      _stream.on('error', onStreamError);

      proto.lookup(_stream, _headers)
        .catch(_error => {
          config.log.error({error: _error}, 'uncaught error');
        })
        .finally(() => {
          _stream.off('error', onStreamError);
        });
    }

    return new Promise((resolve, reject) => {
      function onListening() {
        server.off('listening', onListening);
        server.off('error', reject);
        server.on('error', onError);
        server.on('sessionError', onSessionError);
        server.on('unknownProtocol', onUnknownProtocol);
        server.on('stream', onStream);
        resolve();
      }

      server.on('error', reject);
      server.on('listening', onListening);
      server.listen(_options);
    });
  }

  function close() {
    if (!server) {
      return;
    }

    server.close();
    server = null;
  }

  Object.defineProperties(proto, {
    log: {enumerable: true, value: config.log},
    listen: {enumerable: true, value: listen},
    close: {enumerable: true, value: close}
  });

  return proto;
}

module.exports = factory;
