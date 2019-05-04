'use strict';

const hyperid = require('hyperid');
const querystring = require('querystring');

const HEADER_METHOD = ':method';
const HEADER_SCHEME = ':scheme';
const HEADER_AUTHORITY = ':authority';
const HEADER_PATH = ':path';
const HEADER_STATUS = ':status';

const ID_GENERATOR = hyperid();
const MULTIPLE_HEADER_SEPARATOR = ',';

function outHeaders() {
  const proto = {};

  function split(_name) {
    let value = proto[_name];
    if (typeof value === 'string') {
      value = value.trim().split(MULTIPLE_HEADER_SEPARATOR).map(e => e.trim());
    }

    return value;
  }

  function append(_name, _value) {
    const value = split(_name);
    value.push(_value);
    proto[_name] = value;
  }

  function appendUnique(_name, _value) {
    const set = new Set(split(_name));
    set.add(_value);
    proto[_name] = [...set];
  }

  Object.defineProperties(proto, {
    append: {value: append},
    appendUnique: {value: appendUnique}
  });

  return proto;
}

class PlutonStream {
  constructor(_stream, _headers, _params) {
    const scheme = _headers[HEADER_SCHEME];
    const authority = _headers[HEADER_AUTHORITY];
    const path = _headers[HEADER_PATH];
    const requestUrl = new URL(`${scheme}://${authority}${path}`);
    const query = querystring.parse(requestUrl.query);
    const params = Object.assign({}, _params);

    Object.defineProperties(this, {
      native: {enumerable: true, value: _stream},
      id: {enumerable: true, value: ID_GENERATOR()},
      in: {enumerable: true, value: Object.freeze(_headers)},
      out: {enumerable: true, value: outHeaders()},
      url: {enumerable: true, value: Object.freeze(requestUrl)},
      query: {enumerable: true, value: Object.freeze(query)},
      params: {enumerable: true, value: Object.freeze(params)}
    });

    this.status(200);
  }

  get method() {
    return this.in[HEADER_METHOD];
  }

  get path() {
    return this.url.pathname;
  }

  status(_status) {
    this.out[HEADER_STATUS] = _status;
    return this;
  }

  empty() {
    this.native.respond(this.out);
    this.native.end();
  }

  close(_code) {
    this.native.close(_code);
  }
}

module.exports = PlutonStream;
