// Dante metering: subscription requests and level-frame parsing.
//
// A device is asked (CMC 0x3010 on UDP 8800) to stream its meters to
// subscriberIp:port. The layout matches Dante Controller's own request, as
// documented by the public-domain netaudio project. Each subscriber is keyed
// by its MAC, so this works with or without any number of Dante Controllers
// running on the network.

const METERING_PORT = 8751

const u16 = (value) => {
	const buf = Buffer.alloc(2)
	buf.writeUInt16BE(value & 0xffff)
	return buf
}

const ipv4ToBuffer = (ip) => {
	const parts = String(ip || '').split('.').map((x) => parseInt(x, 10))
	if (parts.length !== 4 || parts.some((x) => isNaN(x) || x < 0 || x > 255)) return Buffer.alloc(4)
	return Buffer.from(parts)
}

function buildMeteringRequest(seq, { deviceName, subscriberIp, mac, port = METERING_PORT }) {
	let name = Buffer.from(String(deviceName) + '\0', 'ascii')
	if (name.length % 2) name = Buffer.concat([name, Buffer.alloc(1)])
	const nameField = name.length + 0x0a
	const channelField = name.length + 0x0c

	const body = Buffer.concat([
		u16(0x3010),
		u16(0),
		u16(0),
		mac,
		u16(0),
		u16(4),
		u16(nameField),
		u16(2),
		u16(channelField),
		u16(0x000a),
		name,
		u16(1),
		u16(1),
		u16(channelField + 4),
		u16(1),
		u16(port),
		// destinations (last 16 bytes) — all zero means "stop"
		u16(1),
		u16(0),
		ipv4ToBuffer(subscriberIp),
		u16(port),
		Buffer.alloc(6),
		u16(port),
		Buffer.alloc(2),
	])
	return Buffer.concat([u16(0x1200), u16(body.length + 6), u16(seq), body])
}

function buildMeteringStop(seq, { deviceName, mac, port = METERING_PORT }) {
	const pkt = buildMeteringRequest(seq, { deviceName, subscriberIp: null, mac, port })
	pkt.fill(0, pkt.length - 16)
	return pkt
}

// Level frame: 0xFFFF, length, seq, 0, sender EUI-64 (8 bytes), "Audinate",
// then version (1-2: u8 counts at 25/26, levels from 27; 3: u16 counts at
// 26/28, levels from 30), Tx levels, Rx levels.
function parseMeteringFrame(buf) {
	if (!Buffer.isBuffer(buf) || buf.length < 27) return null
	if (buf.readUInt16BE(0) !== 0xffff || buf.readUInt16BE(2) !== buf.length) return null
	if (buf.toString('latin1', 16, 24) !== 'Audinate') return null

	const version = buf[24]
	let numTx
	let numRx
	let start
	if (version === 1 || version === 2) {
		numTx = buf[25]
		numRx = buf[26]
		start = 27
	} else if (version === 3 && buf.length >= 30) {
		numTx = buf.readUInt16BE(26)
		numRx = buf.readUInt16BE(28)
		start = 30
	} else {
		return null
	}
	if (start + numTx + numRx > buf.length) return null

	return {
		mac: buf.subarray(8, 14).toString('hex'),
		tx: Array.from(buf.subarray(start, start + numTx)),
		rx: Array.from(buf.subarray(start + numTx, start + numTx + numRx)),
	}
}

module.exports = { METERING_PORT, buildMeteringRequest, buildMeteringStop, parseMeteringFrame }
