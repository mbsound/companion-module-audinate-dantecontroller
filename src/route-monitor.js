// Route monitoring: is a specific Transmitter -> Receiver channel route alive?
//
// evaluateRoute() is a pure snapshot check. RouteMonitor adds the time-based
// parts (grace period before alarming, silence detection) and keeps one entry
// per Companion feedback instance.

const { byteToDbfs } = require('./utils/meter-graphics')

// Rx subscription states that mean audio is flowing:
// 4 = subscribed to own Tx (loopback), 9 = dynamic, 10 = static, 14 = manual.
const CONNECTED_STATUSES = new Set([4, 9, 10, 14])
// Some devices report status 1 with receiver status 0x0101 for a live dynamic flow.
const RX_STATUS_DYNAMIC_FLOW = 0x0101

const UNKNOWN_GRACE_MS = 15000 // how long "no data yet" is tolerated before alarming
const LEVEL_STALE_MS = 2000

const REF_SEPARATOR = '::'

function isRxConnected(channel) {
	if (!channel) return false
	const status = channel.subscriptionStatus
	return CONNECTED_STATUSES.has(status) || (status === 1 && channel.channelStatus === RX_STATUS_DYNAMIC_FLOW)
}

/** 'Stagebox-1::3' -> { device: 'Stagebox-1', channel: 3 } */
function parseChannelRef(value) {
	if (typeof value !== 'string') return null
	const at = value.lastIndexOf(REF_SEPARATOR)
	if (at <= 0) return null
	const device = value.slice(0, at).trim()
	const channel = parseInt(value.slice(at + REF_SEPARATOR.length), 10)
	if (!device || !Number.isInteger(channel) || channel < 1) return null
	return { device, channel }
}

function formatChannelRef(device, channel) {
	return `${device}${REF_SEPARATOR}${channel}`
}

const norm = (s) => String(s ?? '').trim().toLowerCase()

/** Names a receiver may use to refer to a transmitter channel. */
function txChannelAliases(txDevice, channelNumber) {
	const aliases = [String(channelNumber), String(channelNumber).padStart(2, '0')]
	const ch = txDevice?.tx?.[channelNumber]
	if (ch?.friendlyName) aliases.push(ch.friendlyName)
	if (ch?.name) aliases.push(ch.name)
	return aliases.map(norm)
}

/**
 * @param {{rx: {device: string, channel: number}, tx: {device: string, channel: number} | null}} spec
 * @param {{getDevice: (name: string) => object | null, statusName: (code: number) => string}} net
 *   getDevice returns { name, online, rx, tx, metering } (online = recently heard from), or null if never seen.
 * @returns {{status: 'ok' | 'fault' | 'unknown', reason: string, source: string | null}}
 */
function evaluateRoute(spec, net) {
	const rxDev = net.getDevice(spec.rx.device)
	if (!rxDev) return { status: 'unknown', reason: 'Receiver not found', source: null }
	if (!rxDev.online) return { status: 'fault', reason: 'Receiver offline', source: null }

	const ch = rxDev.rx?.[spec.rx.channel]
	if (!ch || ch.subscriptionStatus === undefined) {
		return { status: 'unknown', reason: 'Waiting for channel data', source: null }
	}
	if (!ch.sourceDevice || !ch.sourceChannel) {
		return { status: 'fault', reason: 'Not subscribed', source: null }
	}

	const sourceDeviceName = ch.sourceDevice === '.' ? rxDev.name : ch.sourceDevice
	const source = `${sourceDeviceName} / ${ch.sourceChannel}`

	if (spec.tx) {
		const expectedTx = net.getDevice(spec.tx.device)
		const deviceMatches = norm(sourceDeviceName) === norm(spec.tx.device)
		const channelMatches = txChannelAliases(expectedTx, spec.tx.channel).includes(norm(ch.sourceChannel))
		if (!deviceMatches || !channelMatches) {
			return { status: 'fault', reason: `Wrong source (${source})`, source }
		}
	}

	if (!isRxConnected(ch)) {
		const status = ch.subscriptionStatus
		const name = status === 1 ? 'Unresolved' : net.statusName(status)
		return { status: 'fault', reason: name || `Not connected (status ${status})`, source }
	}

	const txDev = net.getDevice(sourceDeviceName)
	if (txDev && !txDev.online) return { status: 'fault', reason: 'Transmitter offline', source }

	return { status: 'ok', reason: 'OK', source }
}

/** Latest level (dBFS) for the route: receiver's own meter, else the transmitter's. */
function routeLevel(spec, net, now) {
	const fresh = (m) => (m && now - m.updatedAt <= LEVEL_STALE_MS ? byteToDbfs(m.peak) : null)
	const rxDev = net.getDevice(spec.rx.device)
	const rxLevel = fresh(rxDev?.metering?.rx?.[spec.rx.channel])
	if (rxLevel !== null) return rxLevel

	const ch = rxDev?.rx?.[spec.rx.channel]
	const txDev = ch?.sourceDevice ? net.getDevice(ch.sourceDevice === '.' ? rxDev.name : ch.sourceDevice) : null
	if (!txDev?.tx) return null
	const wanted = norm(ch.sourceChannel)
	for (const num of Object.keys(txDev.tx)) {
		if (isNaN(num)) continue
		if (txChannelAliases(txDev, Number(num)).includes(wanted)) return fresh(txDev.metering?.tx?.[num])
	}
	return null
}

/** Build a normalised spec from feedback options; null if the receive channel isn't set. */
function specFromOptions(options) {
	const rx = parseChannelRef(options?.rxChannel)
	if (!rx) return null
	const graceSeconds = Number(options.graceSeconds)
	const silenceSeconds = Number(options.silenceSeconds)
	const silenceThreshold = Number(options.silenceThreshold)
	return {
		rx,
		tx: parseChannelRef(options.txChannel),
		graceMs: Math.max(0, isFinite(graceSeconds) ? graceSeconds : 3) * 1000,
		silence: options.checkSignal
			? {
					thresholdDb: isFinite(silenceThreshold) ? silenceThreshold : -60,
					ms: Math.max(1, isFinite(silenceSeconds) ? silenceSeconds : 10) * 1000,
				}
			: null,
	}
}

function specKey(spec) {
	const tx = spec.tx ? formatChannelRef(spec.tx.device, spec.tx.channel) : '*'
	const silence = spec.silence ? `${spec.silence.thresholdDb}@${spec.silence.ms}` : '-'
	return `${formatChannelRef(spec.rx.device, spec.rx.channel)}<-${tx}|${spec.graceMs}|${silence}`.toLowerCase()
}

function describeSpec(spec) {
	const rx = `${spec.rx.device} ch ${spec.rx.channel}`
	return spec.tx ? `${spec.tx.device} ch ${spec.tx.channel} -> ${rx}` : `${rx} (any source)`
}

class RouteMonitor {
	constructor() {
		this.entries = new Map() // feedback id -> entry
	}

	/**
	 * Evaluate one monitored route and update its timers.
	 * @returns entry with { down, reason, changed }
	 */
	update(id, spec, net, now = Date.now()) {
		const key = specKey(spec)
		let entry = this.entries.get(id)
		if (!entry || entry.key !== key) {
			entry = { id, key, spec, label: describeSpec(spec), down: false, reason: 'Starting', since: now }
			entry.faultSince = null
			entry.unknownSince = null
			entry.lastSignalAt = now
			this.entries.set(id, entry)
		}

		const result = evaluateRoute(spec, net)
		let down = false
		let reason = result.reason

		if (result.status === 'ok') {
			entry.faultSince = null
			entry.unknownSince = null
		} else if (result.status === 'fault') {
			entry.unknownSince = null
			if (entry.faultSince === null) entry.faultSince = now
			down = now - entry.faultSince >= spec.graceMs
		} else {
			entry.faultSince = null
			if (entry.unknownSince === null) entry.unknownSince = now
			down = now - entry.unknownSince >= Math.max(UNKNOWN_GRACE_MS, spec.graceMs)
		}

		if (spec.silence && result.status === 'ok') {
			const level = routeLevel(spec, net, now)
			if (level === null) {
				if (now - entry.lastSignalAt >= spec.silence.ms) {
					down = true
					reason = 'No level data'
				}
			} else if (level > spec.silence.thresholdDb) {
				entry.lastSignalAt = now
			} else if (now - entry.lastSignalAt >= spec.silence.ms) {
				down = true
				reason = `No signal for ${Math.round((now - entry.lastSignalAt) / 1000)} s`
			}
		} else {
			entry.lastSignalAt = now
		}

		const changed = down !== entry.down
		entry.down = down
		entry.reason = down || result.status === 'ok' ? reason : `${reason} (checking)`
		entry.source = result.source
		entry.healthy = result.status === 'ok' && !down
		if (changed) entry.since = now
		return { ...entry, changed }
	}

	remove(id) {
		return this.entries.delete(id)
	}

	/** Unique routes (several buttons may watch the same one). */
	summary() {
		const byKey = new Map()
		for (const entry of this.entries.values()) {
			const existing = byKey.get(entry.key)
			if (!existing || entry.down) byKey.set(entry.key, entry)
		}
		const routes = [...byKey.values()]
		return { total: routes.length, down: routes.filter((e) => e.down) }
	}
}

module.exports = {
	CONNECTED_STATUSES,
	isRxConnected,
	parseChannelRef,
	formatChannelRef,
	evaluateRoute,
	routeLevel,
	specFromOptions,
	specKey,
	describeSpec,
	RouteMonitor,
	UNKNOWN_GRACE_MS,
}
