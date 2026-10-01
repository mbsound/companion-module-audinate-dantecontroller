const test = require('node:test')
const assert = require('node:assert/strict')
const { buildMeteringRequest, buildMeteringStop, parseMeteringFrame } = require('../src/metering')
const { byteToDbfs } = require('../src/utils/meter-graphics')

// Dante Controller's own metering request to a Shure AD4D, from the
// public-domain netaudio project's capture fixture (client identifier bytes
// 10-17 and one padding byte were anonymised in the fixture).
const CONTROLLER_METERING_START =
	'1200004225c730100000020000000000000100000004001000020012000a616434640030000100010016' +
	'0001222f00010000c000020a222f000000000000222f0000'

test('metering request matches Dante Controller byte-for-byte', () => {
	const generated = buildMeteringRequest(0x25c7, {
		deviceName: 'ad4d',
		subscriberIp: '192.0.2.10',
		mac: Buffer.from('020000000001', 'hex'),
		port: 8751,
	})
	const captured = Buffer.from(CONTROLLER_METERING_START, 'hex')
	assert.equal(generated.length, captured.length)
	for (let i = 0; i < captured.length; i++) {
		if ((i >= 10 && i < 18) || i === 0x23) continue
		assert.equal(generated[i], captured[i], `byte 0x${i.toString(16)}`)
	}
})

test('stop request keeps the subscription identity and clears destinations', () => {
	const opts = { deviceName: 'Stagebox-1', subscriberIp: '169.254.1.1', mac: Buffer.alloc(6, 1), port: 8751 }
	const start = buildMeteringRequest(1, opts)
	const stop = buildMeteringStop(1, opts)
	assert.deepEqual(stop.subarray(0, -16), start.subarray(0, -16))
	assert.ok(stop.subarray(-16).every((b) => b === 0))
})

function frame(version, tx, rx) {
	const counts = version === 3 ? Buffer.from([0, 0, tx.length, 0, rx.length]) : Buffer.from([tx.length, rx.length])
	const buf = Buffer.concat([Buffer.alloc(16), Buffer.from('Audinate'), Buffer.from([version]), counts, Buffer.from([...tx, ...rx])])
	buf.writeUInt16BE(0xffff, 0)
	buf.writeUInt16BE(buf.length, 2)
	Buffer.from('000edd000001', 'hex').copy(buf, 8)
	return buf
}

test('parses v2 and v3 frames', () => {
	assert.deepEqual(parseMeteringFrame(frame(2, [10, 254], [0])), { mac: '000edd000001', tx: [10, 254], rx: [0] })
	assert.deepEqual(parseMeteringFrame(frame(3, [5, 6], [7])), { mac: '000edd000001', tx: [5, 6], rx: [7] })
})

test('rejects malformed frames', () => {
	const good = frame(2, [1, 2], [3])
	const badLength = Buffer.from(good)
	badLength.writeUInt16BE(good.length + 1, 2)
	assert.equal(parseMeteringFrame(badLength), null)
	assert.equal(parseMeteringFrame(good.subarray(0, 20)), null)
	assert.equal(parseMeteringFrame(Buffer.from('xxAudinate\x01\x01\x01\x05\x05')), null)
	assert.equal(parseMeteringFrame(null), null)
})

test('level bytes convert to dBFS', () => {
	assert.equal(byteToDbfs(0), 0)
	assert.equal(byteToDbfs(1), 0)
	assert.equal(byteToDbfs(41), -20)
	assert.equal(byteToDbfs(121), -60)
	assert.equal(byteToDbfs(253), -126)
	assert.equal(byteToDbfs(254), -Infinity)
})
