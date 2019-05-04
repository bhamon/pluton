'use strict';

class PlutonHttpError extends Error {
  constructor(_status, _message) {
    super(_message);

    this.status = _status;
  }
}

module.exports = PlutonHttpError;
