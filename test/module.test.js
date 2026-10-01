// Module-level behaviour through the real feedback / preset / variable code,
// with simulated devices (see helpers/fake-instance.js).

const test = require('node:test')
const assert = require('node:assert/strict')
const { createInstance } = require('./helpers/fake-instance')

function network() {
	return {
		'169.254.1.10': {
			name: 'Mic-Rx',
			ports: { ARC: 4440, CMC: 8800 },
			tx: { count: 2, 1: { number: 1, name: '01', friendlyName: 'Lead Vox' }, 2: { number: 2, name: '02' } },
			rx: { count: 0 },
		},
		'169.254.1.20': {
			name: 'Console',
			ports: { ARC: 4440, CMC: 8800 },
			tx: { count: 0 },
			rx: {
				count: 2,
				1: { number: 1, name: 'In 1', sourceDevice: 'Mic-Rx', sourceChannel: 'Lead Vox', subscriptionStatus: 9, channelStatus: 0 },
				2: { number: 2, name: 'In 2', sourceDevice: '', sourceChannel: '', subscriptionStatus: 0, channelStatus: 0 },
			},
		},
	}
}

const routeOptions = (extra = {}) => ({
	rxChannel: 'Console::1',
	txChannel: 'Mic-Rx::1',
	graceSeconds: 0,
	checkSignal: false,
	silenceThreshold: -60,
	silenceSeconds: 10,
	...extra,
})

test('route monitor feedbacks: healthy, then down when the transmitter vanishes, then restored', () => {
	const inst = createInstance({ devices: network() })
	const down = inst.addFeedback('route_monitor', routeOptions({ when: 'down' }))
	const up = inst.addFeedback('route_monitor', routeOptions({ when: 'up' }))
	const text = inst.addFeedback('route_monitor_status', routeOptions())
	const master = inst.addFeedback('route_monitor_any_down', {})

	inst.routeMonitorTick()
	assert.deepEqual([down.value, up.value, text.value, master.value], [false, true, 'OK', false])
	assert.equal(inst.variableValues.route_monitor_status ?? 'All OK', 'All OK')

	// Transmitter stops answering; the receiver loses the subscription.
	inst.devicesData['169.254.1.10'].lastSeen = Date.now() - 60000
	inst.devicesData['169.254.1.20'].rx[1].subscriptionStatus = 1
	inst.routeMonitorTick()
	assert.deepEqual([down.value, up.value, text.value, master.value], [true, false, 'Unresolved', true])
	assert.equal(inst.variableValues.route_monitor_down, 1)
	assert.match(inst.variableValues.route_monitor_down_list, /Mic-Rx ch 1 -> Console ch 1: Unresolved/)
	assert.ok(inst.logs.some((l) => l.level === 'warn' && /Route DOWN/.test(l.message)))

	inst.devicesData['169.254.1.10'].lastSeen = Date.now()
	inst.devicesData['169.254.1.20'].rx[1].subscriptionStatus = 9
	inst.routeMonitorTick()
	assert.deepEqual([down.value, up.value, text.value, master.value], [false, true, 'OK', false])
	assert.equal(inst.variableValues.route_monitor_status, 'All OK')
	assert.ok(inst.logs.some((l) => /Route restored/.test(l.message)))
})

test('a transmitter that is still subscribed but offline is reported as such', () => {
	const inst = createInstance({ devices: network() })
	const text = inst.addFeedback('route_monitor_status', routeOptions())
	inst.devicesData['169.254.1.10'].lastSeen = Date.now() - 60000
	inst.routeMonitorTick()
	assert.equal(text.value, 'Transmitter offline')
})

test('removing a feedback stops monitoring that route', () => {
	const inst = createInstance({ devices: network() })
	const fb = inst.addFeedback('route_monitor', routeOptions({ when: 'down' }))
	assert.equal(inst.routeMonitor.summary().total, 1)
	inst.removeFeedback(fb)
	assert.equal(inst.routeMonitor.summary().total, 0)
	assert.equal(inst.variableValues.route_monitor_status, 'No routes monitored')
})

test('learn fills in the expected transmitter from the current routing', () => {
	const inst = createInstance({ devices: network() })
	const learn = inst.definitions.feedbacks.route_monitor.learn
	assert.deepEqual(learn({ options: { rxChannel: 'Console::1' } }), { txChannel: 'Mic-Rx::1' })
	assert.equal(learn({ options: { rxChannel: 'Console::2' } }), undefined, 'unsubscribed channel')
	assert.ok(inst.logs.some((l) => /not subscribed/.test(l.message)))
})

test('route dropdowns list channels by device name and channel number', () => {
	const inst = createInstance({ devices: network() })
	const opts = inst.definitions.feedbacks.route_monitor.options
	const rx = opts.find((o) => o.id === 'rxChannel').choices.map((c) => c.id)
	const tx = opts.find((o) => o.id === 'txChannel').choices
	assert.deepEqual(rx, ['', 'Console::1', 'Console::2'])
	assert.deepEqual(tx.map((c) => c.id), ['', 'Mic-Rx::1', 'Mic-Rx::2'])
	assert.equal(tx[1].label, 'Mic-Rx > 1: Lead Vox')
})

test('a ready-made preset is generated for each live subscription', () => {
	const inst = createInstance({ devices: network() })
	const { structure, defs } = inst.definitions.presets
	const section = structure.find((s) => s.name === 'Route Monitor: Console')
	assert.ok(section, 'route monitor section for the receiver')
	assert.equal(section.definitions.length, 1, 'only the subscribed channel')
	const preset = defs[section.definitions[0]]
	assert.equal(preset.name, 'In 1 <- Mic-Rx / Lead Vox')
	assert.deepEqual(
		preset.feedbacks.map((f) => [f.options.rxChannel, f.options.txChannel, f.options.when]),
		[
			['Console::1', 'Mic-Rx::1', 'up'],
			['Console::1', 'Mic-Rx::1', 'checking'],
			['Console::1', 'Mic-Rx::1', 'down'],
		],
	)
	assert.equal(preset.localVariables[0].feedbackId, 'route_monitor_status')
	assert.ok(defs.route_monitor_master)
})

test('the existing routing feedback now matches by real subscription fields', () => {
	const inst = createInstance({ devices: network() })
	inst.selectedDestination = { device: '169.254.1.20', channel: 1 }
	const fb = inst.addFeedback('source_routed_to_selected_destination', {
		sourceDevice: '169.254.1.10',
		'sourceChannel_169.254.1.10': 1,
	})
	assert.equal(fb.value, true)
	inst.devicesData['169.254.1.20'].rx[1].sourceChannel = '02'
	assert.equal(inst.runFeedback(fb), false)
})

test('subscription status conditions use the correct status groups', () => {
	const inst = createInstance({ devices: network() })
	const check = (status, condition, extra = {}) => {
		Object.assign(inst.devicesData['169.254.1.20'].rx[1], { subscriptionStatus: status, channelStatus: 0, ...extra })
		return inst.runFeedback(
			inst.addFeedback('subscription_status', { destinationDevice: '169.254.1.20', 'destinationChannel_169.254.1.20': 1, condition }),
		)
	}
	assert.equal(check(9, 'ok'), true)
	assert.equal(check(4, 'ok'), true, 'subscribed to own Tx')
	assert.equal(check(1, 'ok', { channelStatus: 0x0101 }), true, 'status 1 with live flow')
	assert.equal(check(1, 'pending'), false, 'unresolved is an error, not pending')
	assert.equal(check(1, 'error'), true)
	assert.equal(check(8, 'pending'), true)
	assert.equal(check(37, 'fanout_limit'), true)
})

test('malformed packets are ignored instead of crashing the module', () => {
	const inst = createInstance({ devices: network() })
	const handlers = ['parseReply', 'parseSettingsReply', 'parseCmcReply', 'parseHeartbeatReply', 'parseMeteringSocketReply']
	const junk = [Buffer.alloc(0), Buffer.from([0x27, 0x29, 0x00, 0x0e, 0, 0, 0x30, 0, 0, 0, 0, 5]), Buffer.alloc(400, 0xff)]
	for (const name of handlers) {
		const handler = inst.safeHandler(name, inst[name])
		for (const buf of junk) assert.doesNotThrow(() => handler(buf, { address: '169.254.1.20', size: buf.length }), name)
	}
})

test('metering subscriptions go straight to the device and are stopped when unused', () => {
	const inst = createInstance({ devices: network() })
	inst.boundIp = '169.254.9.1'
	inst.meteringPort = 8751
	inst.subscribeMetering('169.254.1.20')
	const start = inst.sent.find((s) => s.service === 'CMC')
	assert.ok(start, 'request sent')
	assert.equal(start.command.readUInt16BE(6), 0x3010)
	assert.ok(start.command.includes(Buffer.from('Console\0')))
	assert.ok(start.command.subarray(-16).some((b) => b !== 0), 'has our address')

	inst.sent = []
	inst.meteringSubscriptions['169.254.1.20'].wantedAt = Date.now() - 60000
	inst.meteringTickCounter = 29
	inst.processMeteringTick()
	const stop = inst.sent.find((s) => s.service === 'CMC')
	assert.ok(stop, 'stop sent')
	assert.ok(stop.command.subarray(-16).every((b) => b === 0), 'destination cleared')
	assert.deepEqual(inst.meteringSubscriptions, {})
})

test('the clock leader is found by MAC even when it does not answer clock queries', () => {
	const devices = network()
	devices['169.254.1.10'].mac = '000edd000002'
	devices['169.254.1.20'].clock = { isMaster: false, uuid: '000edd0000010000', grandmasterUuid: '000edd0000020000', servo: 3, state: 8 }
	const inst = createInstance({ devices })
	inst.updateClockMasterStatus()
	assert.equal(inst.clockMasterData.masterName, 'Mic-Rx')
	assert.equal(inst.clockMasterData.status, 'Locked')
})
