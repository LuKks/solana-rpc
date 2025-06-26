const test = require('brittle')
const RPC = require('./index.js')

test('basic http', async function (t) {
  const rpc = new RPC()

  const slot = await rpc.getSlot()

  t.is(typeof slot, 'number')
})

test('basic websocket', async function (t) {
  const rpc = new RPC()

  await rpc.connect()

  const subscription = await rpc.send('slotSubscribe')

  t.is(typeof subscription, 'number')

  const lc = t.test('subscription lifecycle')

  lc.plan(1)

  rpc.socket.on('message', function onMessage (msg) {
    if (msg.method === 'slotNotification' && msg.params.subscription === subscription) {
      rpc.socket.removeListener('message', onMessage)
      lc.pass()
    }
  })

  await lc

  const unsubscribed = await rpc.send('slotUnsubscribe', [subscription])

  t.is(unsubscribed, true)

  await rpc.disconnect()
})

test.skip('on account change', async function (t) {
  t.plan(1)

  const rpc = new RPC()

  await rpc.connect()

  const poolAddress = 'AMb79jvh2q7F8RRheMWp8VcWAnMj1bgzWqhKbMpXniE5'

  const subscriptionId = await rpc.onAccountChange(poolAddress, function (accountInfo, context) {
    t.comment(accountInfo, context)
  })

  // ...

  await rpc.accountUnsubscribe(subscriptionId)
})

test('read blocks - start and end', async function (t) {
  const rpc = new RPC()
  const currentSlot = await rpc.getSlot()

  t.comment('Starting slot:', currentSlot - 5)
  t.comment('Ending slot:', currentSlot)

  const readStream = rpc.createBlockStream({
    start: currentSlot - 5,
    end: currentSlot
  })

  for await (const block of readStream) {
    t.comment('Block', block.parentSlot + 1)
  }
})

test('read blocks - start without end (snapshot)', async function (t) {
  const rpc = new RPC()
  const currentSlot = await rpc.getSlot()

  t.comment('Starting slot:', currentSlot - 5)

  const readStream = rpc.createBlockStream({
    start: currentSlot - 5
  })

  for await (const block of readStream) {
    t.comment('Block', block.parentSlot + 1, '/', readStream.length)
  }
})

test.skip('read blocks - start without end (live)', { timeout: 5 * 60 * 1000 }, async function (t) {
  const rpc = new RPC()

  const currentSlot = await rpc.getSlot()

  t.comment('Starting slot:', currentSlot)

  const readStream = rpc.createBlockStream({
    start: currentSlot - 10000,
    live: true
  })

  for await (const block of readStream) {
    if (block === Symbol.for('solana-block-missing')) {
      continue
    }

    const missing = readStream.length - block.slot

    t.comment('Block', block.parentSlot + 1, '/', readStream.length, 'Missing', missing)
  }

  t.comment('Done')
})
