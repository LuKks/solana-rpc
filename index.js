const { Readable } = require('streamx')
const fetch = require('like-fetch')
const retry = require('like-retry')
const Xache = require('xache')
const HubSocket = require('./lib/hub-socket.js')

const API_URL = 'https://solana-rpc.publicnode.com'
const API_WS = 'wss://solana-rpc.publicnode.com'

module.exports = class Solana {
  constructor (opts = {}) {
    this.id = 1
    this.socket = new HubSocket(opts.ws || API_WS)

    this._urlIndex = 0
    this.urls = Array.isArray(opts.url) ? opts.url : [opts.url || API_URL]

    this.onAgent = opts.onAgent || null
  }

  connect () {
    return this.socket.connect()
  }

  disconnect () {
    return this.socket.disconnect()
  }

  waitForMessage (cb) {
    return this.socket.waitForMessage(cb)
  }

  async getSlot (opts = {}) {
    return this.request('getSlot', [
      { commitment: opts.commitment || 'finalized' }
    ])
  }

  createBlockStream (opts) {
    return new BlockStream(this, opts)
  }

  async getBlock (blockNumber, opts = {}) {
    return this.request('getBlock', [
      blockNumber,
      {
        encoding: opts.encoding || 'json',
        commitment: opts.commitment || 'finalized', // 'processed' is not supported
        transactionDetails: opts.transactionDetails || 'full',
        maxSupportedTransactionVersion: 0
      }
    ])
  }

  async getBlocks (start, end, opts) {
    if (start === end) {
      return [await this.getBlock(start, opts)]
    }

    const reqs = []

    for (let i = start; i < end; i++) {
      reqs.push(this.getBlock(i, opts))
    }

    return Promise.all(reqs)
  }

  async getTransaction (signature, opts = {}) {
    return this.request('getTransaction', [
      signature,
      {
        encoding: opts.encoding || 'json',
        maxSupportedTransactionVersion: 0
      }
    ])
  }

  async getSignaturesForAddress (address, opts = {}) {
    return this.request('getSignaturesForAddress', [
      address,
      {
        commitment: opts.commitment || 'finalized',
        minContextSlot: opts.minContextSlot,
        limit: opts.limit || 1000,
        before: opts.before, // I.e. signature
        until: opts.until
      }
    ])
  }

  async request (method, params) {
    const data = await this.api({
      jsonrpc: '2.0',
      id: this.id++,
      method,
      params
    })

    return data.result
  }

  async send (method, params, opts = {}) {
    const id = this.id++

    this.socket.send(JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params
    }))

    if (opts.wait === false) {
      return { id }
    }

    const out = await this.socket.waitForMessage(msg => msg.id === id)

    return out.result
  }

  async api (body) {
    for await (const backoff of retry({ max: 3, delay: 1000, strategy: 'linear' })) {
      try {
        const response = await fetch(this._url(), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body),
          agent: this.onAgent ? this.onAgent() : null,
          timeout: 30000
        })

        if (response.status === 402) {
          // Proxy error probably
          throw new Error('Payment required')
        }

        const data = await response.json()

        if (data.error) {
          if (data.error.code === 429) {
            await backoff(new Error(data.error.message))
            continue
          }

          throw new Error(data.error.message)
        }

        return data
      } catch (err) {
        await backoff(err)
      }
    }
  }

  _url () {
    const url = this.urls[this._urlIndex++]

    if (this._urlIndex >= this.urls.length) {
      this._urlIndex = 0
    }

    return url
  }
}

class BlockStream extends Readable {
  constructor (solana, opts = {}) {
    super()

    this.solana = solana

    this.start = opts.start || 0
    this.end = typeof opts.end === 'number' ? opts.end : -1
    this.length = 0
    this.snapshot = !opts.live && opts.snapshot !== false
    this.live = !!opts.live

    this.cache = new Xache({ maxSize: opts.prefetch || 30 })
  }

  _open (cb) {
    this._openp().then(cb, cb)
  }

  _read (cb) {
    this._readp().then(cb, cb)
  }

  async _openp () {
    if (this.end === -1) {
      this.length = await this.solana.getSlot()
    }

    if (this.snapshot && this.end === -1) {
      this.end = this.length
    }
  }

  async _readp () {
    if (this.live) {
      while (this.start > this.length) {
        const currentSlot = await this.solana.getSlot()

        if (this.start === currentSlot) {
          await new Promise(resolve => setTimeout(resolve, 500))
          continue
        }

        this.length = currentSlot
      }
    }

    const end = this.live ? -1 : (this.end === -1 ? this.length : this.end)

    if (end >= 0 && this.start >= end) {
      this.push(null)
      return
    }

    this._prefetchBlocks(this.start, end === -1 ? this.length : end)

    const slot = this.start++
    const block = await this._getBlockWithCache(slot)

    if (!block) {
      throw new Error('Block not available: ' + slot)
    }

    this.push(block)
  }

  _prefetchBlocks (start, end) {
    for (let i = start; i <= end; i++) {
      // Only prefetch concurrently blocks up to max size
      const size = [...this.cache].length

      if (size >= this.cache.maxSize) {
        break
      }

      // Skip if already cached
      if (this.cache.has(i)) {
        continue
      }

      this._getBlockWithCache(i, true).catch(noop)
    }
  }

  async _getBlockWithCache (slot) {
    // Shift value if exists
    if (this.cache.has(slot)) {
      const promise = this.cache.get(slot)

      promise.catch(noop)

      this.cache.delete(slot)

      return promise
    }

    // Fetch
    const promise = this.solana.getBlock(slot)

    promise.catch(noop)

    // Save
    this.cache.set(slot, promise)

    return promise
  }
}

function noop () {}
