// Remembers discovered devices and channel names between restarts, so action and
// feedback dropdowns stay populated while devices are offline. One file per
// Companion connection, in the operating system's standard cache location.

const fs = require('fs')
const path = require('path')
const os = require('os')

const APP_DIR = 'companion-module-audinate-dantecontroller'

function cacheDir() {
	const home = os.homedir()
	if (process.platform === 'darwin') return path.join(home, 'Library', 'Caches', APP_DIR)
	if (process.platform === 'win32') {
		return path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), APP_DIR)
	}
	return path.join(process.env.XDG_CACHE_HOME || path.join(home, '.cache'), APP_DIR)
}

function getCachePath(instanceId) {
	const safeId = String(instanceId || 'default').replace(/[^A-Za-z0-9_-]/g, '_')
	return path.join(cacheDir(), `devices-${safeId}.json`)
}

// Where versions up to 1.1.3 kept a single shared cache (read once as a fallback).
const LEGACY_CACHE = path.join(os.homedir(), 'Library', 'Application Support', 'companion', 'dante-devices-cache.json')

const empty = () => ({ devicesChoices: [], txChannelsChoices: {}, rxChannelsChoices: {} })

function readJson(file) {
	return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function loadCache(instanceId) {
	try {
		const file = getCachePath(instanceId)
		const parsed = fs.existsSync(file) ? readJson(file) : fs.existsSync(LEGACY_CACHE) ? readJson(LEGACY_CACHE) : null
		if (!parsed || typeof parsed !== 'object') return empty()
		return {
			devicesChoices: Array.isArray(parsed.devicesChoices)
				? parsed.devicesChoices.filter((d) => d && d.id && d.label)
				: [],
			txChannelsChoices: parsed.txChannelsChoices && typeof parsed.txChannelsChoices === 'object' ? parsed.txChannelsChoices : {},
			rxChannelsChoices: parsed.rxChannelsChoices && typeof parsed.rxChannelsChoices === 'object' ? parsed.rxChannelsChoices : {},
		}
	} catch (e) {
		return empty()
	}
}

/** Merge newly discovered data into the cache (devices that went offline are kept). */
function saveCache(instanceId, data) {
	try {
		const existing = loadCache(instanceId)
		const devices = new Map(existing.devicesChoices.map((d) => [d.id, d]))
		for (const dev of data.devicesChoices || []) devices.set(dev.id, dev)

		const merged = {
			devicesChoices: [...devices.values()].sort((a, b) => String(a.label).localeCompare(String(b.label))),
			txChannelsChoices: { ...existing.txChannelsChoices, ...(data.txChannelsChoices || {}) },
			rxChannelsChoices: { ...existing.rxChannelsChoices, ...(data.rxChannelsChoices || {}) },
		}
		const file = getCachePath(instanceId)
		fs.mkdirSync(path.dirname(file), { recursive: true })
		fs.writeFileSync(file, JSON.stringify(merged, null, 2), 'utf8')
	} catch (e) {
		// The cache is a convenience; failing to write it is not an error.
	}
}

module.exports = { getCachePath, loadCache, saveCache }
