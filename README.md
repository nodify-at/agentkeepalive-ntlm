# agentkeepalive-ntlm

[![NPM version][npm-image]][npm-url]
[![build status][travis-image]][travis-url]
[![Appveyor status][appveyor-image]][appveyor-url]
[![Test coverage][codecov-image]][codecov-url]
[![David deps][david-image]][david-url]
[![Known Vulnerabilities][snyk-image]][snyk-url]
[![npm download][download-image]][download-url]

[npm-image]: https://img.shields.io/npm/v/agentkeepalive-ntlm.svg?style=flat
[npm-url]: https://npmjs.org/package/agentkeepalive-ntlm
[travis-image]: https://img.shields.io/travis/node-modules/agentkeepalive-ntlm.svg?style=flat
[travis-url]: https://travis-ci.org/node-modules/agentkeepalive-ntlm
[appveyor-image]: https://ci.appveyor.com/api/projects/status/k7ct4s47di6m5uy2?svg=true
[appveyor-url]: https://ci.appveyor.com/project/fengmk2/agentkeepalive-ntlm
[codecov-image]: https://codecov.io/gh/node-modules/agentkeepalive-ntlm/branch/master/graph/badge.svg
[codecov-url]: https://codecov.io/gh/node-modules/agentkeepalive-ntlm
[david-image]: https://img.shields.io/david/node-modules/agentkeepalive-ntlm.svg?style=flat
[david-url]: https://david-dm.org/node-modules/agentkeepalive-ntlm
[snyk-image]: https://snyk.io/test/npm/agentkeepalive-ntlm/badge.svg?style=flat-square
[snyk-url]: https://snyk.io/test/npm/agentkeepalive-ntlm
[download-image]: https://img.shields.io/npm/dm/agentkeepalive-ntlm.svg?style=flat-square
[download-url]: https://npmjs.org/package/agentkeepalive-ntlm

The Node.js's missing `keep alive` `http.Agent`. Support `http` and `https`. With NTLM Support

## What's different from original `agentkeepalive`?

- takes in a new config parameter 'cookieName' to uniquely identify a usersession. The cookieName
defined has to be present in req.headers. This should ideally be a usersession cookie or can be any cookieName that
uniquely identifies a user.

The main motivation for this fork from `agentkeepalive` was to support user specific NTLM sessions.
For NTLM to work, the TCP connection has to be authorized for a user. When we use the base 'agentkeepalive',
sockets are authorized using a combination of the `host` + `port`. eg `yahoo.com:443`. However if multiple users
are trying to access a NTLM enabled site, the socket connections were getting mixed up between users.

Another issue that was a problem for NTLM was that the socket pool was defaulted to 100 or Infinity. Since NTLM works
on the principal of the same user connecting over a authorized socket, we should reuse the same socket per URL for a user. That means at a given time, for a `host:port:user` combination, there should only be 1 socket alive.
e.g create/reuse 1 socket for `yahoo.com:433:user_1` and create/reuse another socket for `gmail.com:433:user_1`.

## Install

```bash
$ npm install agentkeepalive-ntlm --save
```

## new Agent([options])

* `options` {Object} Set of configurable options to set on the agent.
  Can have the following fields:
  * `keepAlive` {Boolean} Keep sockets around in a pool to be used by
    other requests in the future. Default = `true`.
  * `keepAliveMsecs` {Number} When using HTTP KeepAlive, how often
    to send TCP KeepAlive packets over sockets being kept alive.
    Default = `1000`.  Only relevant if `keepAlive` is set to `true`.
  * `freeSocketKeepAliveTimeout`: {Number} Sets the free socket to timeout
    after `freeSocketKeepAliveTimeout` milliseconds of inactivity on the free socket.
    Default is `15000`.
    Only relevant if `keepAlive` is set to `true`.
  * `timeout`: {Number} Sets the working socket to timeout
    after `timeout` milliseconds of inactivity on the working socket.
    Default is `freeSocketKeepAliveTimeout * 2`.
  * `maxSockets` {Number} Maximum number of sockets to allow per
    host. Default = `Infinity`.
  * `maxFreeSockets` {Number} Maximum number of sockets to leave open
    in a free state. Only relevant if `keepAlive` is set to `true`.
    Default = `256`.
  * `cookieName` {string} The name of a cookie in the http request header that
     clearly identifies a unique user session. Defaults to ''.

## Usage

```js
const http = require('http');
const Agent = require('agentkeepalive-ntlm');

const keepaliveAgentNTLM = new Agent({
  maxSockets: 100,
  maxFreeSockets: 10,
  timeout: 60000,
  freeSocketKeepAliveTimeout: 30000, // free socket keepalive for 30 seconds
  cookieName: 'mycookie'
});

const options = {
  host: 'cnodejs.org',
  port: 80,
  path: '/',
  method: 'GET',
  agent: keepaliveAgentNTLM,
};

const req = http.request(options, res => {
  console.log('STATUS: ' + res.statusCode);
  console.log('HEADERS: ' + JSON.stringify(res.headers));
  res.setEncoding('utf8');
  res.on('data', function (chunk) {
    console.log('BODY: ' + chunk);
  });
});
req.on('error', e => {
  console.log('problem with request: ' + e.message);
});
req.end();

setTimeout(() => {
  console.log('agent status: %j', keepaliveAgentNTLM.getCurrentStatus());
}, 2000);

```

### `agent.getCurrentStatus()`

`agent.getCurrentStatus()` will return a object to show the status of this agent:

```js
{
  createSocketCount: 10,
  closeSocketCount: 5,
  timeoutSocketCount: 0,
  requestCount: 5,
  freeSockets: { 'localhost:57479:': 3 },
  sockets: { 'localhost:57479:': 5 },
  requests: {}
}
```

### Support `https`

```js
const https = require('https');
const HttpsAgent = require('agentkeepalive-ntlm').HttpsAgent;

const keepaliveAgentNTLM = new HttpsAgent();
// https://www.google.com/search?q=nodejs&sugexp=chrome,mod=12&sourceid=chrome&ie=UTF-8
const options = {
  host: 'www.google.com',
  port: 443,
  path: '/search?q=nodejs&sugexp=chrome,mod=12&sourceid=chrome&ie=UTF-8',
  method: 'GET',
  agent: keepaliveAgentNTLM,
};

const req = https.request(options, res => {
  console.log('STATUS: ' + res.statusCode);
  console.log('HEADERS: ' + JSON.stringify(res.headers));
  res.setEncoding('utf8');
  res.on('data', chunk => {
    console.log('BODY: ' + chunk);
  });
});

req.on('error', e => {
  console.log('problem with request: ' + e.message);
});
req.end();

setTimeout(() => {
  console.log('agent status: %j', keepaliveAgentNTLM.getCurrentStatus());
}, 2000);

## License

Copyright © 2017, [Paddy Viswanathan](https://github.com/pappan123).
Released under the [MIT license]
