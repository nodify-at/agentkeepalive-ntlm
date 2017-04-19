// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// patch from https://github.com/nodejs/node/blob/v7.2.1/lib/_http_agent.js

'use strict';

const net = require('net');
const util = require('util');
const EventEmitter = require('events');
const debug = util.debuglog('http');

// New Agent code for NTLM Support.

// The largest departure from the previous implementation is that
// an Agent instance holds connections for a variable number of host:ports:cookievalue.
// This helps with native NTLM Support, since the sockets will be authenticated for every user request.


function Agent(options) {
  if (!(this instanceof Agent)) {
    return new Agent(options);
  }

  EventEmitter.call(this);

  const self = this;

  self.defaultPort = 80;
  self.protocol = 'http:';

  self.options = util._extend({}, options);

    // don't confuse net and make it think that we're connecting to a pipe
  self.options.path = null;
  self.requests = {};
  self.sockets = {};
  self.freeSockets = {};
  self.keepAliveMsecs = self.options.keepAliveMsecs || 1000;
  self.keepAlive = self.options.keepAlive || false;
  self.maxSockets = self.options.maxSockets || Agent.defaultMaxSockets;
  self.maxFreeSockets = self.options.maxFreeSockets || 256;
  self.cookieName = self.options.cookieName || ''; // cookie name to uniquely identify a user session.

    // [patch start]
    // free keep-alive socket timeout. By default free socket do not have a timeout.
  self.freeSocketKeepAliveTimeout = self.options.freeSocketKeepAliveTimeout || 0;
    // working socket timeout. By default working socket do not have a timeout.
  self.timeout = self.options.timeout || 0;
    // [patch end]

  self.on('free', function(socket, options) {
    const name = self.getName(options); // + getCookieValue(options);
    debug('agent.on(free)', name);

    if (socket.writable &&
            self.requests[name] && self.requests[name].length) {
            // [patch start]
      debug('continue handle next request');
            // [patch end]
      self.requests[name].shift().onSocket(socket);
      if (self.requests[name].length === 0) {
                // don't leak
        delete self.requests[name];
      }
    } else {
            // If there are no pending requests, then put it in
            // the freeSockets pool, but only if we're allowed to do so.
      const req = socket._httpMessage;
      if (req &&
                req.shouldKeepAlive &&
                socket.writable &&
                self.keepAlive) {
        let freeSockets = self.freeSockets[name];
        const freeLen = freeSockets ? freeSockets.length : 0;
        let count = freeLen;
        if (self.sockets[name]) {
          count += self.sockets[name].length;
        }

        if (count > self.maxSockets || freeLen >= self.maxFreeSockets) {
          socket.destroy();
        } else {
          freeSockets = freeSockets || [];
          self.freeSockets[name] = freeSockets;
          socket.setKeepAlive(true, self.keepAliveMsecs);
          socket.unref();
          socket._httpMessage = null;
          self.removeSocket(socket, options);
          freeSockets.push(socket);

                    // [patch start]
                    // Add a default error handler to avoid Unhandled 'error' event throw on idle socket
                    // https://github.com/node-modules/agentkeepalive/issues/25
                    // https://github.com/nodejs/node/pull/4482 (fixed in >= 4.4.0 and >= 5.4.0)
          if (socket.listeners('error').length === 0) {
            socket.once('error', freeSocketErrorListener);
          }
                    // set free keepalive timer
          socket.setTimeout(self.freeSocketKeepAliveTimeout);
                    // [patch end]
        }
      } else {
        socket.destroy();
      }
    }
  });
}

util.inherits(Agent, EventEmitter);
exports.Agent = Agent;

// [patch start]
function freeSocketErrorListener(err) {
  const socket = this;
  debug('SOCKET ERROR on FREE socket:', err.message, err.stack);
  socket.destroy();
  socket.emit('agentRemove');
}
// [patch end]

Agent.defaultMaxSockets = Infinity;

Agent.prototype.createConnection = net.createConnection;

// Get the key for a given set of request options
Agent.prototype.getName = function getName(options) {
  let name = options.host || 'localhost';

  name += ':';
  if (options.port) {
    name += options.port;
  }

  name += ':';
  if (options.localAddress) {
    name += options.localAddress;
  }


  const cookieVal = (options.cookieName && (options.cookieName !== undefined) && (options.cookieName !== '')) ? getCookieValue(options) : '';
  if (cookieVal !== '' && cookieVal !== undefined) { // add cookie value as part of the name. This helps in associating the socket to an unique user.
    name += ':';
    name += cookieVal;
  }


    // Pacify parallel/test-http-agent-getname by only appending
    // the ':' when options.family is set.
  if (options.family === 4 || options.family === 6) {
    name += ':' + options.family;
  }

  return name;
};

Agent.prototype.addRequest = function addRequest(req, options) {
    // Legacy API: addRequest(req, host, port, localAddress)
  if (typeof options === 'string') {
    options = {
      host: options,
      port: arguments[2],
      localAddress: arguments[3],
    };
  }

  options = util._extend({}, options);
  options = util._extend(options, this.options);

  if (!options.servername) {
    options.servername = options.host;
    const hostHeader = req.getHeader('host');
    if (hostHeader) {
      options.servername = hostHeader.replace(/:.*$/, '');
    }
  }

  const name = this.getName(options);
    //  console.log('Name ===' + name);
  if (!this.sockets[name]) {
    this.sockets[name] = [];
  }

  const freeLen = this.freeSockets[name] ? this.freeSockets[name].length : 0;
  const sockLen = freeLen + this.sockets[name].length;

  if (freeLen) {
        // we have a free socket, so use that.
    const socket = this.freeSockets[name].shift();
    console.log('Free Socket Available - ' + name);
    debug('have free socket');

        // [patch start]
        // remove free socket error event handler
    socket.removeListener('error', freeSocketErrorListener);
        // restart the default timer
    socket.setTimeout(this.timeout);
        // [patch end]

        // don't leak
    if (!this.freeSockets[name].length) {
      delete this.freeSockets[name];
    }

    socket.ref();
    req.onSocket(socket);
    this.sockets[name].push(socket);
  } else if (sockLen < ((this.cookieName === '' || this.cookieName === undefined) ? this.maxSockets : 1)) {
        /* Changed the else condition from sockLen < this.maxSockets to sockLen < 1
  That helps in limiting the socket connections per user to a resource
  'eg - google.com' to just 1. */
    console.log('Reuse socket - ' + name);
    debug('call onSocket', sockLen, freeLen);
        // If we are under maxSockets create a new one.
    this.createSocket(req, options, function(err, newSocket) {
      if (err) {
        process.nextTick(function() {
          req.emit('error', err);
        });
        return;
      }
      req.onSocket(newSocket);
    });
  } else {
    debug('wait for socket');
    console.log('Waiting for socket - ' + name);
        // We are over limit so we'll add it to the queue.
    if (!this.requests[name]) {
      this.requests[name] = [];
    }
    this.requests[name].push(req);
  }
};

Agent.prototype.createSocket = function createSocket(req, options, cb) {
  const self = this;
  options = util._extend({}, options);
  options = util._extend(options, self.options);

  if (!options.servername) {
    options.servername = options.host;
    const hostHeader = req.getHeader('host');
    if (hostHeader) {
      options.servername = hostHeader.replace(/:.*$/, '');
    }
  }

  const name = self.getName(options);
  options._agentKey = name;

  debug('createConnection', name, options);
  options.encoding = null;
  let called = false;
  const newSocket = self.createConnection(options, oncreate);
  if (newSocket) {
    oncreate(null, newSocket);
  }

  function oncreate(err, s) {
    if (called) {
      return;
    }
    called = true;
    if (err) {
      return cb(err);
    }
    if (!self.sockets[name]) {
      self.sockets[name] = [];
    }
    self.sockets[name].push(s);
    debug('sockets', name, self.sockets[name].length);

    function onFree() {
      self.emit('free', s, options);
    }
    s.on('free', onFree);

    function onClose(err) {
      debug('CLIENT socket onClose');
            // This is the only place where sockets get removed from the Agent.
            // If you want to remove a socket from the pool, just close it.
            // All socket errors end in a close event anyway.
      self.removeSocket(s, options);

            // [patch start]
      self.emit('close');
            // [patch end]
    }
    s.on('close', onClose);

        // [patch start]
        // start socket timeout handler
    function onTimeout() {
      debug('CLIENT socket onTimeout');
      s.destroy();
            // Remove it from freeSockets immediately to prevent new requests from being sent through this socket.
      self.removeSocket(s, options);
      self.emit('timeout');
    }
    s.on('timeout', onTimeout);
        // set the default timer
    s.setTimeout(self.timeout);
        // [patch end]

    function onRemove() {
            // We need this function for cases like HTTP 'upgrade'
            // (defined by WebSockets) where we need to remove a socket from the
            // pool because it'll be locked up indefinitely
      debug('CLIENT socket onRemove');
      self.removeSocket(s, options);
      s.removeListener('close', onClose);
      s.removeListener('free', onFree);
      s.removeListener('agentRemove', onRemove);

            // [patch start]
            // remove socket timeout handler
      s.setTimeout(0, onTimeout);
            // [patch end]
    }
    s.on('agentRemove', onRemove);
    cb(null, s);
  }
};

Agent.prototype.removeSocket = function removeSocket(s, options) {
  const name = this.getName(options);
  debug('removeSocket', name, 'writable:', s.writable);
  const sets = [ this.sockets ];

    // If the socket was destroyed, remove it from the free buffers too.
  if (!s.writable) {
    sets.push(this.freeSockets);
  }

  for (let sk = 0; sk < sets.length; sk++) {
    const sockets = sets[sk];

    if (sockets[name]) {
      const index = sockets[name].indexOf(s);
      if (index !== -1) {
        sockets[name].splice(index, 1);
                // Don't leak
        if (sockets[name].length === 0) {
          delete sockets[name];
        }
      }
    }
  }

    // [patch start]
  const freeLen = this.freeSockets[name] ? this.freeSockets[name].length : 0;
  const sockLen = freeLen + this.sockets[name] ? this.sockets[name].length : 0;
    // [patch end]

  if (this.requests[name] && this.requests[name].length && sockLen < this.maxSockets) {
    debug('removeSocket, have a request, make a socket');
    const req = this.requests[name][0];
        // If we have pending requests and a socket gets closed make a new one
    this.createSocket(req, options, function(err, newSocket) {
      if (err) {
        process.nextTick(function() {
          req.emit('error', err);
        });
        return;
      }
      newSocket.emit('free');
    });
  }
};

Agent.prototype.destroy = function destroy() {
  const sets = [ this.freeSockets, this.sockets ];
  for (let s = 0; s < sets.length; s++) {
    const set = sets[s];
    const keys = Object.keys(set);
    for (let v = 0; v < keys.length; v++) {
      const setName = set[keys[v]];
      for (let n = 0; n < setName.length; n++) {
        setName[n].destroy();
      }
    }
  }
};

function getCookie(cookieName) {
  return function(cookie) {
    return cookie.split('=')[0].trim().toString() === cookieName;
  };
}
// extract the cookie value
function getCookieValue(options) {
  let cookieValue = '';

  if (options.headers && options.headers.cookie && options.headers.cookie.split(';').length > 0) {
    const cookie = options.headers.cookie.split(';').find(getCookie(options.cookieName));
    console.log('cookie ======' + cookie);
    if (options.headers.cookie.includes(options.cookieName) && cookie !== undefined && cookie.split('=').length > 0) {
      cookieValue = cookie.split('=')[1];
    }
  }
  return cookieValue;
}

exports.globalAgent = new Agent();
