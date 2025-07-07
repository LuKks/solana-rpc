const fetch = require('like-fetch')
const retry = require('like-retry')
const HubSocket = require('./lib/hub-socket.js')

const API_URL = 'solana-rpc.publicnode.com'

module.exports = class SolanaRPC {
  constructor (url, opts = {}) {
    if (isOptions(url)) {
      opts = url
      url = opts.url || null
    }

    // Compat
    if (typeof url === 'string' && typeof opts === 'string') {
      opts = { commitment: opts }
    }

    if (!url) url = opts.url || process.env.SOLANA_RPC || API_URL
    if (!Array.isArray(url)) url = [url]

    url = url.filter(Boolean).map(url => url.includes('://') ? url : 'https://' + url)

    const ws = opts.ws || url[0].replace(/^http/, 'ws')

    this.id = 1

    this._urlIndex = 0
    this.urls = url

    this.socket = new HubSocket(ws)

    this.agent = opts.agent || null
    this.commitment = opts.commitment || 'processed'

    this._subscriptions = new Map()
  }

  // Compat
  static clusterApiUrl (cluster) {
    const CLUSTERS = {
      'mainnet-beta': 'api.mainnet-beta.solana.com',
      testnet: 'api.testnet.solana.com',
      devnet: 'api.devnet.solana.com'
    }

    const hostname = CLUSTERS[cluster || 'mainnet-beta']

    if (!hostname) {
      throw new Error('Unknown cluster: ' + cluster)
    }

    return 'https://' + hostname
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
      { commitment: opts.commitment || this.commitment }
    ])
  }

  createBlockStream (opts) {
    return new BlockStream(this, opts)
  }

  async getBlock (blockNumber, opts = {}) {
    const commitment = opts.commitment || (this.commitment === 'processed' ? 'confirmed' : this.commitment)

    return this.request('getBlock', [
      blockNumber,
      {
        encoding: opts.encoding || 'json',
        commitment, // Commitment 'processed' is not supported
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

  async sendTransaction (tx, opts = {}) {
    const signature = await this.request('sendTransaction', [
      maybeEncodeTransaction(tx),
      {
        encoding: opts.encoding || 'base64',
        skipPreflight: true,
        preflightCommitment: 'confirmed'
      }
    ])

    if (opts.confirmed) {
      await this.confirmTransaction(signature)
    } else if (opts.finalized) {
      await this.confirmTransaction(signature, { commitment: 'finalized' })
    }

    return signature
  }

  async getTransaction (signature, opts = {}) {
    const commitment = opts.commitment || (this.commitment === 'processed' ? 'confirmed' : this.commitment)

    return this.request('getTransaction', [
      signature,
      {
        encoding: opts.encoding || 'json',
        commitment, // Commitment 'processed' is not supported
        maxSupportedTransactionVersion: 0
      }
    ])
  }

  async confirmTransaction (signature, opts = {}) {
    for (let i = 0; i < 30; i++) {
      const tx = await this.getTransaction(signature, opts)

      if (tx) {
        if (tx.meta.err) {
          // TODO
          console.error(tx.meta.err)

          throw new Error('Confirmation failed: ' + signature)
        }

        return tx
      }

      await new Promise(resolve => setTimeout(resolve, 1000))
    }

    throw new Error('Confirmation timeout: ' + signature)
  }

  async getSignaturesForAddress (address, opts = {}) {
    const commitment = opts.commitment || (this.commitment === 'processed' ? 'confirmed' : this.commitment)

    return this.request('getSignaturesForAddress', [
      address,
      {
        commitment,
        minContextSlot: opts.minContextSlot,
        limit: opts.limit || 1000,
        before: opts.before, // I.e. signature
        until: opts.until
      }
    ])
  }

  async getAllSignaturesForAddress (address, opts = {}) {
    let before = opts.before || null

    const all = []

    while (true) {
      const signatures = await this.getSignaturesForAddress(address, { limit: 1000, before })

      if (signatures.length === 0) {
        // TODO: Sometimes RPC might return 0 but it does have txs
        // I think it might only happen when using 'before' so it's ok for now
        break
      }

      all.push(...signatures)

      before = signatures[signatures.length - 1].signature

      if (signatures.length !== 1000) {
        break
      }

      if (opts.max && all.length >= opts.max) {
        break
      }
    }

    return all
  }

  async getAccountInfo (address, opts = {}) {
    const result = await this.request('getAccountInfo', [
      address,
      {
        encoding: opts.encoding || 'base64',
        commitment: opts.commitment || this.commitment
      }
    ])

    if (opts.encoding === 'jsonParsed') {
      return result.value
    }

    if (!result.value) {
      return null
    }

    return {
      data: Buffer.from(result.value.data[0], result.value.data[1]),
      executable: result.value.executable,
      lamports: result.value.lamports,
      owner: result.value.owner,
      rentEpoch: result.value.rentEpoch,
      space: result.value.space
    }
  }

  async getParsedAccountInfo (address, opts = {}) {
    return this.getAccountInfo(address, { ...opts, encoding: 'jsonParsed' })
  }

  async getBalance (owner, opts = {}) {
    const result = await this.request('getBalance', [
      owner,
      {
        commitment: opts.commitment || this.commitment
      }
    ])

    return result.value
  }

  async getTokenAccountsByOwner (owner, opts = {}) {
    const result = await this.request('getTokenAccountsByOwner', [
      owner,
      {
        mint: opts.mint,
        programId: opts.programId
      },
      {
        commitment: opts.commitment || this.commitment,
        encoding: opts.encoding || 'json'
      }
    ])

    return result.value
  }

  async getLatestBlockhash (opts = {}) {
    const result = await this.request('getLatestBlockhash', [{
      commitment: opts.commitment || this.commitment
    }])

    return result.value
  }

  async getTokenAccountsByOwner (owner, filter = {}, opts = {}) {
    const result = await this.request('getTokenAccountsByOwner', [
      owner,
      {
        ...filter,
        programId: filter.programId || 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
      },
      {
        commitment: opts.commitment || this.commitment,
        encoding: opts.encoding || 'base64',
        ...opts
      }
    ])

    return result.value
  }

  async _subscribe (method, params) {
    for await (const backoff of retry({ max: 5 })) {
      const id = await this.send(method, params)

      if (!id) {
        await backoff(new Error('Failed to subscribe'))
        continue
      }

      return id
    }
  }

  async logsSubscribe (mentions, opts = {}) {
    if (!Array.isArray(mentions)) mentions = [mentions]

    const id = await this._subscribe('logsSubscribe', [
      { mentions },
      { commitment: opts.commitment || this.commitment }
    ])

    return id
  }

  async blockSubscribe (mentions, opts = {}) {
    const commitment = opts.commitment || (this.commitment === 'processed' ? 'confirmed' : this.commitment)

    let params = null

    if (mentions === 'all') {
      params = 'all'
    } else if (mentions && typeof mentions === 'object' && mentions.mentionsAccountOrProgram) {
      params = mentions
    } else if (mentions && typeof mentions === 'string') {
      params = { mentionsAccountOrProgram: mentions }
    } else {
      throw new Error('Param is required')
    }

    const id = await this._subscribe('blockSubscribe', [
      params,
      {
        commitment,
        encoding: opts.encoding || 'json',
        transactionDetails: opts.transactionDetails || 'full',
        maxSupportedTransactionVersion: 0,
        showRewards: true
      }
    ])

    return id
  }

  async onAccountChange (address, cb, opts = {}) {
    const id = await this._subscribe('accountSubscribe', [
      address,
      {
        commitment: opts.commitment || this.commitment,
        encoding: opts.encoding || 'base64'
      }
    ])

    this.socket.on('message', onMessage)

    this._subscriptions.set(id, onMessage)

    return id

    function onMessage (msg) {
      if (msg.method === 'accountNotification' && msg.params.subscription === id) {
        cb(msg.params.result.value, msg.params.result.context)
      }
    }
  }

  async accountUnsubscribe (id) {
    const onMessage = this._subscriptions.get(id)

    if (!onMessage) {
      throw new Error('Subscription not found: ' + id)
    }

    this._subscriptions.delete(id)

    this.socket.removeListener('message', onMessage)

    await this.send('accountUnsubscribe', [id])
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

    if (out.error) {
      const err = new Error(out.error.message)
      err.code = out.error.code
      throw err
    }

    return out.result
  }

  async api (body) {
    let error = null

    for await (const backoff of retry({ max: 3, delay: 1000, strategy: 'linear' })) {
      try {
        const response = await fetch(this._url(), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body),
          agent: typeof this.agent === 'function' ? this.agent() : this.agent,
          timeout: 30000
        })

        if (response.status === 402) {
          // Proxy error probably
          error = new Error('Payment required')
          break
        }

        const data = await response.json()

        if (data.error) {
          if (data.error.code === 429) {
            await backoff(new Error(data.error.message))
            continue
          }

          if (data.error.code === -32602) {
            error = new Error(data.error.message + (data.error.data ? (': ' + data.error.data) : ''))
            break
          }

          if (data.error.code === -32701) {
            // "no available nodes found for platform solana-rpc"
            await backoff(new Error(data.error.message))
            continue
          }

          error = new Error(data.error.message)
          error.code = data.error.code

          break
        }

        if (data.code && data.message) {
          if (data.code === -32007) {
            await backoff(new Error(data.message))
            continue
          }

          error = new Error(data.message)
          error.code = data.code

          break
        }

        return data
      } catch (err) {
        await backoff(err)
      }
    }

    throw error || new Error('Unknown error')
  }

  _url () {
    const url = this.urls[this._urlIndex++]

    if (this._urlIndex >= this.urls.length) {
      this._urlIndex = 0
    }

    return url
  }
}

class BlockStream {
  constructor (solana, opts = {}) {
    this.solana = solana

    this.start = opts.start || 0
    this.end = typeof opts.end === 'number' ? opts.end : -1
    this.length = 0
    this.snapshot = !opts.live && opts.snapshot !== false
    this.live = !!opts.live

    this.getBlock = opts.getBlock || noopAsync

    this.inflight = new Map()
    this.concurrency = opts.prefetch || 20

    this.slot = 0
  }

  [Symbol.asyncIterator] () {
    return this._stream()
  }

  async * _stream () {
    await this._openp()

    while (true) {
      const block = await this._readp()

      if (block === -1) {
        return
      }

      yield block
    }
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
      return -1
    }

    this._maybePrefetch()

    const slot = this.start++
    let block = null

    try {
      block = await this._getBlockWithCache(slot)

      // We actually allow null blocks if it was skipped as per the catch below
      if (!block) {
        throw new Error('Block not available: ' + slot)
      }

      // Due skipped/missing blocks you can't rely on parentSlot
      block.slot = slot
    } catch (err) {
      if (err.message.includes('was skipped, or missing due to ledger jump to recent snapshot')) {
        block = Symbol.for('solana-block-missing')
      } else {
        throw err
      }
    }

    return block
  }

  _maybePrefetch () {
    if (this.inflight.length >= 100) {
      return
    }

    const max = Math.min(this.end === -1 ? this.length : this.end, this.concurrency)

    for (let i = 0; i < max; i++) {
      const slot = this.start + i

      if (!this.inflight.has(slot)) {
        this._getBlockWithCache(slot, true).catch(noop)
      }
    }
  }

  async _getBlockWithCache (slot) {
    // Shift value if exists
    if (this.inflight.has(slot)) {
      const promise = this.inflight.get(slot)

      promise.catch(noop)

      this.inflight.delete(slot)

      return promise
    }

    // Fetch
    const promise = this.getBlock(slot).then(block => block || this.solana.getBlock(slot))

    promise.catch(noop).finally(() => {
      this._maybePrefetch()
    })

    // Save
    this.inflight.set(slot, promise)

    return promise
  }
}

function maybeEncodeTransaction (tx) {
  if (typeof tx === 'object' && tx && tx.serialize) {
    const serialized = tx.serialize()
    const encoded = Buffer.from(serialized).toString('base64')

    return encoded
  }

  return tx
}

function isOptions (opts) {
  return typeof opts === 'object' && opts && !isBuffer(opts)
}

function isBuffer (value) {
  return Buffer.isBuffer(value) || value instanceof Uint8Array
}

function noop () {}

async function noopAsync () {}
