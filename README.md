# Pluton

Pluton is an HTTP/2 only server.

## Usage

```js
'use strict';

const fs = require('fs').promises;
const pluton = require('./deps/pluton');
const plutonIo = require('./deps/pluton-io');
const plutonCors = require('./deps/pluton-cors');

(async () => {
  const server = pluton({
    https: {
      key: await fs.readFile('pkey.pem'),
      cert: fs.readFile('cert.pem')
    }
  });

  server.setNotFoundHandler(_stream => {
    _stream.log.error({stream: _stream}, 'not found');
    _stream.status(404).type('text/html').send('<h1>Not found</h1>');
  });

  server.setErrorHandler((_error, _stream) => {
    _stream.log.error({error: _error, stream: _stream}, 'internal server error');
    _stream.status(500).type('text/html').send('<h1>Internal server error</h1>');
  });

  plutonIo(server, {});
  plutonCors(server, {
    origin: '*'
  });

  server.get('/', _stream => {
    _stream.status(200).type('text/html').send('<h1>Mellow world!</h1>');
  });

  const child = server.child('/meta');

  child.use(_stream => {
    _stream.out['x-server'] = 'pluton';
  });

  child.get('/', _stream => {
    _stream.status(200).type('text/html').send('<h1>Meta</h1>');
  });

  child.get('/foo', _stream => {
    _stream.status(200).type('text/html').send('<h1>Foo</h1>');
  });

  child.get('/bar/:p', _stream => {
    _stream.status(200).type('text/html').send(`<h1>Bar ${_stream.params.p}</h1>`);
  });

  child.post('/post', async _stream => {
    const body = await _stream.body();
    _stream.status(200).type('text/plain').send(body.toString());
  });

  await server.listen(8080);
})()
  .catch(e => console.error(e));
```

## Plugins

* [IO](https://github.com/bhamon/pluton-io)
* [CORS](https://github.com/bhamon/pluton-cors)
* [JWT](https://github.com/bhamon/pluton-jwt)
* [GraphQL](https://github.com/bhamon/pluton-graphql)
