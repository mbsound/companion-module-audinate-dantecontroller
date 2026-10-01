const test = require('node:test')
const assert = require('node:assert/strict')
const {
	isRxConnected,
	parseChannelRef,
	evaluateRoute,
	specFromOptions,
	RouteMonitor,
	UNKNOWN_GRACE_MS,
} = require('../src/route-monitor')

const statusName = (code) => ({ 15: 'No Connection', 29: 'Rx Link Down' })[code]

function network(devices) {
	const byName = new Map(devices.map((d) => [d.name.toLowerCase(), d]))
	return { getDevice: (name) => byName.get(String(name).toLowerCase()) ?? null, statusName }
}

function healthyNetwork(overrides = {}) {
	const tx = { name: 'Mic-Rx', online: true, tx: { 1: { name: '01', friendlyName: 'Lead Vox' } }, metering: { tx: {} } }
	const rx = {
		name: 'Console',
		online: true,
		rx: { 3: { name: 'In 3', sourceDevice: 'Mic-Rx', sourceChannel: 'Lead Vox', subscriptionStatus: 9, channelStatus: 0 } },
		metering: { rx: {} },
	}
	Object.assign(rx.rx[3], overrides.rxChannel)
	Object.assign(tx, overrides.tx)
	Object.assign(rx, overrides.rx)
	return { net: network([tx, rx].filter((d) => !d.gone)), tx, rx }
}

const spec = (extra = {}) =>
	specFromOptions({ rxChannel: 'Console::3', txChannel: 'Mic-Rx::1', graceSeconds: 2, ...extra })

test('parses channel references', () => {
	assert.deepEqual(parseChannelRef('Stagebox-1::12'), { device: 'Stagebox-1', channel: 12 })
	assert.deepEqual(parseChannelRef('Odd::Name::2'), { device: 'Odd::Name', channel: 2 })
	assert.equal(parseChannelRef('Stagebox-1'), null)
	assert.equal(parseChannelRef('::3'), null)
	assert.equal(parseChannelRef('Box::0'), null)
	assert.equal(parseChannelRef(undefined), null)
})

test('connected states, including status 1 with a live dynamic flow', () => {
	for (const s of [4, 9, 10, 14]) assert.equal(isRxConnected({ subscriptionStatus: s }), true, `status ${s}`)
	assert.equal(isRxConnected({ subscriptionStatus: 1, channelStatus: 0x0101 }), true)
	assert.equal(isRxConnected({ subscriptionStatus: 1, channelStatus: 0 }), false)
	assert.equal(isRxConnected({ subscriptionStatus: 15 }), false)
})

test('healthy route', () => {
	const { net } = healthyNetwork()
	assert.deepEqual(evaluateRoute(spec(), net), { status: 'ok', reason: 'OK', source: 'Mic-Rx / Lead Vox' })
})

test('the transmitter channel can be referenced by default name, friendly name or number', () => {
	for (const sourceChannel of ['Lead Vox', '01', '1', 'lead vox']) {
		const { net } = healthyNetwork({ rxChannel: { sourceChannel } })
		assert.equal(evaluateRoute(spec(), net).status, 'ok', sourceChannel)
	}
})

test('each way a route can drop', () => {
	const cases = [
		[{ rx: { online: false } }, 'Receiver offline'],
		[{ tx: { online: false } }, 'Transmitter offline'],
		[{ rxChannel: { subscriptionStatus: 1 } }, 'Unresolved'],
		[{ rxChannel: { subscriptionStatus: 15 } }, 'No Connection'],
		[{ rxChannel: { subscriptionStatus: 0, sourceDevice: '', sourceChannel: '' } }, 'Not subscribed'],
		[{ rxChannel: { sourceDevice: 'Other-Box' } }, 'Wrong source (Other-Box / Lead Vox)'],
		[{ rxChannel: { sourceChannel: 'Backup Vox' } }, 'Wrong source (Mic-Rx / Backup Vox)'],
	]
	for (const [overrides, reason] of cases) {
		const { net } = healthyNetwork(overrides)
		assert.deepEqual([evaluateRoute(spec(), net).status, evaluateRoute(spec(), net).reason], ['fault', reason])
	}
})

test('"any source" only requires the subscription to stay connected', () => {
	const { net } = healthyNetwork({ rxChannel: { sourceDevice: 'Other-Box' } })
	assert.equal(evaluateRoute(specFromOptions({ rxChannel: 'Console::3', txChannel: '' }), net).status, 'ok')
})

test('a self-subscription (".") resolves to the receiver itself', () => {
	const rx = {
		name: 'Console',
		online: true,
		tx: { 5: { name: '05' } },
		rx: { 3: { sourceDevice: '.', sourceChannel: '05', subscriptionStatus: 4 } },
	}
	const s = specFromOptions({ rxChannel: 'Console::3', txChannel: 'Console::5' })
	assert.equal(evaluateRoute(s, network([rx])).status, 'ok')
})

test('unknown receiver / missing data is "unknown", not an instant fault', () => {
	assert.equal(evaluateRoute(spec(), network([])).status, 'unknown')
	const { net } = healthyNetwork({ rx: { rx: {} } })
	assert.equal(evaluateRoute(spec(), net).reason, 'Waiting for channel data')
})

test('grace period: a brief drop does not alarm, a sustained one does', () => {
	const monitor = new RouteMonitor()
	const healthy = healthyNetwork().net
	const dropped = healthyNetwork({ rxChannel: { subscriptionStatus: 1 } }).net
	const s = spec({ graceSeconds: 2 })

	assert.equal(monitor.update('fb1', s, healthy, 0).down, false)
	let r = monitor.update('fb1', s, dropped, 1000)
	assert.equal(r.down, false)
	assert.match(r.reason, /checking/)
	assert.equal(monitor.update('fb1', s, healthy, 1500).down, false, 'recovered within grace')

	monitor.update('fb1', s, dropped, 2000)
	r = monitor.update('fb1', s, dropped, 4000)
	assert.equal(r.down, true)
	assert.equal(r.changed, true)
	assert.equal(r.reason, 'Unresolved')

	r = monitor.update('fb1', s, healthy, 5000)
	assert.equal(r.down, false)
	assert.equal(r.changed, true)
})

test('missing data alarms only after the startup window', () => {
	const monitor = new RouteMonitor()
	const s = spec({ graceSeconds: 0 })
	assert.equal(monitor.update('fb', s, network([]), 0).down, false)
	assert.equal(monitor.update('fb', s, network([]), UNKNOWN_GRACE_MS - 1).down, false)
	assert.equal(monitor.update('fb', s, network([]), UNKNOWN_GRACE_MS).down, true)
})

test('silence detection uses the receiver meter, falling back to the transmitter', () => {
	const s = spec({ checkSignal: true, silenceThreshold: -50, silenceSeconds: 5 })
	const monitor = new RouteMonitor()
	const { net, rx, tx } = healthyNetwork()

	rx.metering.rx[3] = { peak: 41, updatedAt: 0 } // -20 dBFS
	assert.equal(monitor.update('fb', s, net, 0).down, false)

	rx.metering.rx[3] = { peak: 254, updatedAt: 4000 } // silent
	assert.equal(monitor.update('fb', s, net, 4000).down, false)
	const r = monitor.update('fb', { ...s }, net, 5500)
	assert.equal(r.down, true)
	assert.match(r.reason, /No signal/)

	// Receiver stops reporting levels: the transmitter's meter is used instead.
	delete rx.metering.rx[3]
	tx.metering.tx[1] = { peak: 21, updatedAt: 6000 } // -10 dBFS
	assert.equal(monitor.update('fb', s, net, 6000).down, false)
})

test('changing a feedback\'s options resets its state; summary de-duplicates routes', () => {
	const monitor = new RouteMonitor()
	const dropped = healthyNetwork({ rx: { online: false } }).net
	monitor.update('a', spec({ graceSeconds: 0 }), dropped, 0)
	monitor.update('b', spec({ graceSeconds: 0 }), dropped, 0)
	assert.equal(monitor.summary().total, 1)
	assert.equal(monitor.summary().down.length, 1)

	const r = monitor.update('a', spec({ graceSeconds: 30 }), dropped, 1)
	assert.equal(r.down, false, 'new options start a fresh grace period')
	assert.equal(monitor.summary().total, 2)

	monitor.remove('a')
	monitor.remove('b')
	assert.deepEqual(monitor.summary(), { total: 0, down: [] })
})
