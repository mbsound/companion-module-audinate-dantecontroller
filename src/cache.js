const fs = require('fs');
const path = require('path');
const os = require('os');

const FALLBACK_DEVICES = [];

function getCachePath() {
	const homedir = os.homedir() || process.env.HOME || '';
	const companionDir = path.join(homedir, 'Library', 'Application Support', 'companion');
	if (fs.existsSync(companionDir)) {
		return path.join(companionDir, 'dante-devices-cache.json');
	}
	return path.join(__dirname, '..', 'dante-devices-cache.json');
}

function loadCache() {
	let devices = [...FALLBACK_DEVICES];
	let tx = {};
	let rx = {};
	try {
		const filePath = getCachePath();
		if (fs.existsSync(filePath)) {
			const raw = fs.readFileSync(filePath, 'utf8');
			const parsed = JSON.parse(raw);
			if (parsed && typeof parsed === 'object') {
				if (Array.isArray(parsed.devicesChoices) && parsed.devicesChoices.length > 0) {
					for (const dev of parsed.devicesChoices) {
						if (!devices.find((d) => d.id === dev.id)) {
							devices.push(dev);
						}
					}
				}
				if (parsed.txChannelsChoices) tx = parsed.txChannelsChoices;
				if (parsed.rxChannelsChoices) rx = parsed.rxChannelsChoices;
			}
		}
	} catch (e) {
		// ignore load errors
	}
	devices.sort((a, b) => (a.label || '').localeCompare(b.label || ''));
	return {
		devicesChoices: devices,
		txChannelsChoices: tx,
		rxChannelsChoices: rx,
	};
}

function saveCache(data) {
	try {
		const filePath = getCachePath();
		let existing = loadCache() || {};
		let mergedDevices = [...(data.devicesChoices || [])];
		if (Array.isArray(existing.devicesChoices)) {
			for (const dev of existing.devicesChoices) {
				if (!mergedDevices.find((d) => d.id === dev.id)) {
					mergedDevices.push(dev);
				}
			}
		}
		mergedDevices.sort((a, b) => (a.label || '').localeCompare(b.label || ''));

		const mergedData = {
			devicesChoices: mergedDevices,
			txChannelsChoices: { ...(existing.txChannelsChoices || {}), ...(data.txChannelsChoices || {}) },
			rxChannelsChoices: { ...(existing.rxChannelsChoices || {}), ...(data.rxChannelsChoices || {}) },
		};
		fs.writeFileSync(filePath, JSON.stringify(mergedData, null, 2), 'utf8');
	} catch (e) {
		// ignore save errors
	}
}

module.exports = {
	FALLBACK_DEVICES,
	getCachePath,
	loadCache,
	saveCache,
};
