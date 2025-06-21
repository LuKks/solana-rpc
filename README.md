# solana-rpc

Solana network wrapper to interact with accounts and programs

```
npm i solana-rpc
```

Need support? Join the community: https://lucasbarrena.com

## Usage

```js
const Solana = require('solana-rpc')

const solana = new Solana()

const result = await solana.request('getSlot', [{ commitment: 'finalized' }])
// => 325801337

const slot = await solana.getSlot()
// => 325801337

const block = await solana.getBlock(slot)
// => { parentSlot, blockTime, blockhash, previousBlockhash, ... }

const exampleTx = block.transactions[0]
const tx = await solana.getTransaction(exampleTx.transaction.signatures[0])
// => { meta, transaction, ... }
```

HTTP-based real-time efficient stream of blocks!

```js
const start = await solana.getSlot()
const readStream = solana.createBlockStream({ start, live: true })

for await (const block of readStream) {
  console.log('Block', block.parentSlot + 1, 'Txs', block.transactions.length)
}
```

WebSocket example:

```js
await solana.connect()

const subscription = await solana.send('slotSubscribe')

solana.socket.on('message', function (msg) {
  console.log(msg)
})

await solana.send('slotUnsubscribe', [subscription])

await solana.disconnect()
```

## API

#### `solana = new Solana([options])`

Creates a new Solana instance to interact with the network.

```js
{
  url: 'https://solana-rpc.publicnode.com',
  ws: 'wss://solana-rpc.publicnode.com'
}
```

There is `api.mainnet-beta.solana.com` but it's more rate-limited.

## HTTP API

#### `result = await solana.request(method[, params])`

Send a custom request with parameters.

It automatically retries in case of failures.

#### `slot = await solana.getSlot([options])`

Get the current slot.

Options:

```js
{
  commitment: 'finalized'
}
```

#### `block = await solana.getBlock(blockNumber)`

Get a specific block.

Options:

```js
{
  encoding: 'json',
  commitment: 'finalized',
  transactionDetails: 'full'
}
```

#### `blocks = await solana.getBlocks(start, end[, options])`

Get a range of blocks. Same options as `getBlock`.

`end` is exclusive.

#### `tx = await solana.getTransaction(signature[, options])`

Get a full transaction by hash.

Options:

```js
{
  encoding: 'json'
}
```

#### `signatures = await solana.getSignaturesForAddress(address[, options])`

Get a list of signatures by account address.

Options:

```js
{
  commitment: 'finalized',
  minContextSlot,
  limit: 1000,
  before, // I.e. a signature
  until
}
```

#### `readStream = solana.createBlockStream(options)`

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
const slot = await solana.getSlot()

const liveStream = solana.createBlockStream({
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

#### `await solana.connect()`

Open the WebSocket.

#### `await solana.disconnect()`

Close the WebSocket.

#### `result = await solana.send(method, params[, options]) {

Similar to `solana.request` but uses the WebSocket.

Options:

```js
{
  wait: true // Waits for the confirmation message
}
```

Disabling `wait` makes it return `{ id }` instead of the `result`.

#### `solana.socket.on('open', callback)`

Event for when the socket is connected.

#### `solana.socket.on('close', callback)`

Event for when the socket is disconnected for any reason.

Use this event to manually reconnect with `await solana.connect()`.

You will have to re-subscribe.

#### `solana.socket.on('message', callback)`

Listen for new messages in real-time.

#### `solana.socket.on('error', callback)`

Event for errors in the socket.

#### `await solana.waitForMessage(callback)`

Wait for a specific message.

Example:

```js
const req = await solana.send('slotSubscribe', { wait: false })
const result = await solana.waitForMessage(msg => msg.id === req.id)
```

## License

MIT
