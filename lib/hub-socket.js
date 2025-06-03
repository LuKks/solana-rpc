const { EventEmitter } = require('events')
const WebSocket = require('ws')

module.exports = class HubSocket extends EventEmitter {
  constructor (url) {
    super()

    this._url = url
    this.ws = null

    this._onopen = this._onopen.bind(this)
    this._onmessage = this._onmessage.bind(this)
    this._onclose = this._onclose.bind(this)
    this._onerror = this._onerror.bind(this)

    this._keepAlive = null
    this._sendKeepAlive = this._sendKeepAlive.bind(this)

    this._connecting = null
    this._disconnecting = null
    this._connected = false

    this.on('error', noop)
  }

  get url () {
    return this.ws ? this.ws.url : null
  }

  get readyState () {
    return this.ws ? this.ws.readyState : 0
  }

  async connect () {
    if (this._connecting) return this._connecting
    this._connecting = this._connect()
    return this._connecting
  }

  async disconnect (err) {
    if (this._disconnecting) return this._disconnecting
    this._disconnecting = this._disconnect(err)
    return this._disconnecting
  }

  async _connect () {
    if (this._connected === true) {
      if (this._disconnecting !== null) await this._disconnecting.catch(noop)
      else await this.disconnect().catch(noop)
    }

    try {
      // TODO: Retry
      this.ws = new WebSocket(this._url, {
        headers: {
          // TODO: Origin
          // TODO: User-Agent
          'accept-language': 'en-US,en;q=0.9',
          'cache-control': 'no-cache',
          pragma: 'no-cache',
          'sec-websocket-extensions': 'permessage-deflate; client_max_window_bits',
          'sec-websocket-key': randomBytes(16).toString('base64'),
          'sec-websocket-version': '13',
          'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
        }
      })

      this.ws.on('open', this._onopen)
      this.ws.on('message', this._onmessage)
      this.ws.on('close', this._onclose)
      this.ws.on('error', this._onerror)

      await waitForWebSocket(this.ws)
    } finally {
      this._connecting = null
      this._disconnecting = null
    }

    this._keepAlive = setInterval(this._sendKeepAlive, 15000)
    this._connected = true
  }

  async _disconnect (err) {
    if (this._connected === false && this._connecting !== null) await this._connecting.catch(noop)

    try {
      if (err) throw err

      if (this.ws) {
        if (this.ws.readyState === 0) {
          await waitForWebSocket(this.ws)
        }

        if (this.ws.readyState === 1) {
          this.ws.close()

          // TODO
          if (this.ws.terminate) {
            this.ws.terminate()
          }
        }

        if (this.ws.readyState === 2) {
          await new Promise(resolve => this.ws.once('close', resolve))
        }
      }
    } catch (err) {
      try { this.ws.close() } catch {}
      this._onclose()
      throw err
    } finally {
      this._connected = false
    }
  }

  _onopen () {
    this.emit('open')

    // TODO: Compat, can be removed later
    this.emit('connect')
  }

  _onmessage (msg) {
    // TODO: This is assuming JSON, and waitForMessage also
    const data = JSON.parse(msg)

    this.emit('message', data)
  }

  _onerror (err) {
    this.emit('error', err)
  }

  _onclose (a) {
    this._clearKeepAlive()

    this.ws.removeListener('open', this._onopen)
    this.ws.removeListener('message', this._onmessage)
    this.ws.removeListener('close', this._onclose)
    this.ws.removeListener('error', this._onerror)

    this.emit('close')

    // TODO: Compat, can be removed later
    this.emit('disconnect')
  }

  send (data) {
    if (this.ws.readyState !== 1) throw new Error('Socket is not connected')

    // TODO: JSON
    // TODO: Optional separator
    this.ws.send(data)
  }

  json (data) {
    this.send(JSON.stringify(data))
  }

  _sendKeepAlive () {
    // TODO: This should be configurable
    /* try {
      this.send({ type: 6 })
    } catch {} */
  }

  _clearKeepAlive () {
    if (this._keepAlive === null) return

    clearInterval(this._keepAlive)
    this._keepAlive = null
  }

  waitForMessage (cb) {
    return new Promise((resolve, reject) => {
      const ws = this.ws

      const cleanup = () => {
        this.removeListener('message', onmessage)
        ws.removeListener('close', onclose)
      }

      const timeout = setTimeout(() => {
        cleanup()
        reject(new Error('ACK timed out'))
      }, 60000)

      const onmessage = (msg) => {
        if (!cb(msg)) return

        clearTimeout(timeout)
        cleanup()
        resolve(msg)
      }

      const onclose = () => {
        clearTimeout(timeout)
        cleanup()
        reject(new Error('Connection destroyed'))
      }

      this.on('message', onmessage)
      ws.on('close', onclose)
    })
  }
}

function waitForWebSocket (ws) {
  return new Promise((resolve, reject) => {
    ws.on('open', onopen)
    ws.on('close', onclose)
    ws.on('error', onerror)

    function onopen () {
      cleanup()
      resolve()
    }

    function onclose () {
      cleanup()
      reject(new Error('Socket closed'))
    }

    function onerror (err) {
      cleanup()
      reject(err)
    }

    function cleanup () {
      ws.removeListener('open', onopen)
      ws.removeListener('close', onclose)
      ws.removeListener('error', onerror)
    }
  })
}

function randomBytes (bytes) {
  const arr = new Uint8Array(bytes)

  for (let i = 0; i < bytes; i++) {
    arr[i] = Math.floor(Math.random() * 256)
  }

  return Buffer.from(arr)
}

function noop () {}
