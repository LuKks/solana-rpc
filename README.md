# solana-rpc

Solana network wrapper to interact with accounts and programs

```
npm i solana-rpc
```

Need support? Join the community: https://lucasbarrena.com

## Usage

```js
const RPC = require('solana-rpc')

const rpc = new RPC()

const result = await rpc.request('getSlot', [{ commitment: 'processed' }])
// => 325801337

const slot = await rpc.getSlot()
// => 325801337

const block = await rpc.getBlock(slot)
// => { parentSlot, blockTime, blockhash, previousBlockhash, ... }

const exampleTx = block.transactions[0]
const tx = await rpc.getTransaction(exampleTx.transaction.signatures[0])
// => { meta, transaction, ... }
```

HTTP-based real-time efficient stream of blocks!

```js
const start = await rpc.getSlot()
const readStream = rpc.createBlockStream({ start, live: true })

for await (const block of readStream) {
  console.log('Block', block.parentSlot + 1, 'Txs', block.transactions.length)
}
```

WebSocket example:

```js
await rpc.connect()

const subscription = await rpc.send('slotSubscribe')

rpc.socket.on('message', function (msg) {
  console.log(msg)
})

await rpc.send('slotUnsubscribe', [subscription])

await rpc.disconnect()
```

## API

#### `rpc = new RPC([options])`

Creates a new Solana instance to interact with the network.

```js
{
  url: 'https://solana-rpc.publicnode.com',
  ws: 'wss://solana-rpc.publicnode.com',
  commitment: 'processed' // 'confirmed' or 'finalized'
}
```

There is `api.mainnet-beta.solana.com` but it's more rate-limited.

## HTTP API

#### `result = await rpc.request(method[, params])`

Send a custom request with parameters.

It automatically retries in case of failures.

#### `slot = await rpc.getSlot([options])`

Get the current slot.

Options:

```js
{
  commitment
}
```

#### `block = await rpc.getBlock(blockNumber)`

Get a specific block.

Options:

```js
{
  encoding: 'json',
  commitment, // 'confirmed' or 'finalized'
  transactionDetails: 'full'
}
```

#### `blocks = await rpc.getBlocks(start, end[, options])`

Get a range of blocks. Same options as `getBlock`.

`end` is exclusive.

#### `tx = await rpc.getTransaction(signature[, options])`

Get a full transaction by hash.

Options:

```js
{
  encoding: 'json'
}
```

#### `signatures = await rpc.getSignaturesForAddress(address[, options])`

Get a list of signatures by account address.

Options:

```js
{
  commitment, // 'confirmed' or 'finalized'
  minContextSlot,
  limit: 1000,
  before, // I.e. a signature
  until
}
```

#### `readStream = rpc.createBlockStream(options)`

Get a range of blocks by a HTTP-based stream efficiently.

Options:

```js
{
  start: 0, // Must set a slot
  end: -1,
  snapshot: true, // Reads until current slot
  live: false,
  prefetch: 30
}
```

Example of live reading without stopping:

```js
const slot = await rpc.getSlot()

const liveStream = rpc.createBlockStream({
  start: slot,
  live: true
})

for await (const block of liveStream) {
  if (block === Symbol.for('solana-block-missing')) {
    continue
  }

  // ...
}
```

## WebSocket API

#### `await rpc.connect()`

Open the WebSocket.

#### `await rpc.disconnect()`

Close the WebSocket.

#### `result = await rpc.send(method, params[, options])`

Similar to `rpc.request` but uses the WebSocket.

Options:

```js
{
  wait: true // Waits for the confirmation message
}
```

Disabling `wait` makes it return `{ id }` instead of the `result`.

#### `rpc.socket.on('open', callback)`

Event for when the socket is connected.

#### `rpc.socket.on('close', callback)`

Event for when the socket is disconnected for any reason.

Use this event to manually reconnect with `await rpc.connect()`.

You will have to re-subscribe.

#### `rpc.socket.on('message', callback)`

Listen for new messages in real-time.

#### `rpc.socket.on('error', callback)`

Event for errors in the socket.

#### `await rpc.waitForMessage(callback)`

Wait for a specific message.

Example:

```js
const req = await rpc.send('slotSubscribe', { wait: false })
const result = await rpc.waitForMessage(msg => msg.id === req.id)
```

## License

MIT
