const test = require('brittle')
const Solana = require('./index.js')

test('basic http', async function (t) {
  const solana = new Solana()

  const slot = await solana.getSlot()

  t.is(typeof slot, 'number')
})

test('basic websocket', async function (t) {
  const solana = new Solana()

  await solana.connect()

  const subscription = await solana.send('slotSubscribe')

  t.is(typeof subscription, 'number')

  const lc = t.test('subscription lifecycle')

  lc.plan(1)

  solana.socket.on('message', function onMessage (msg) {
    if (msg.method === 'slotNotification' && msg.params.subscription === subscription) {
      solana.socket.removeListener('message', onMessage)
      lc.pass()
    }
  })

  await lc

  const unsubscribed = await solana.send('slotUnsubscribe', [subscription])

  t.is(unsubscribed, true)

  await solana.disconnect()
})

test('read blocks - start and end', async function (t) {
  const solana = new Solana()
  const currentSlot = await solana.getSlot()

  t.comment('Starting slot:', currentSlot - 5)
  t.comment('Ending slot:', currentSlot)

  const readStream = solana.createBlockStream({
    start: currentSlot - 5,
    end: currentSlot
  })

  for await (const block of readStream) {
    t.comment('Block', block.parentSlot + 1)
  }
})

test('read blocks - start without end (snapshot)', async function (t) {
  const solana = new Solana()
  const currentSlot = await solana.getSlot()

  t.comment('Starting slot:', currentSlot - 5)

  const readStream = solana.createBlockStream({
    start: currentSlot - 5
  })

  for await (const block of readStream) {
    t.comment('Block', block.parentSlot + 1, '/', readStream.length)
  }
})

test.skip('read blocks - start without end (live)', async function (t) {
  const solana = new Solana()

  const currentSlot = await solana.getSlot()

  t.comment('Starting slot:', currentSlot)

  const readStream = solana.createBlockStream({
    start: currentSlot,
    live: true
  })

  for await (const block of readStream) {
    t.comment('Block', block.parentSlot + 1, '/', readStream.length, 'Missing', readStream.length - (block.parentSlot + 1))
  }

  t.comment('Done')
})
