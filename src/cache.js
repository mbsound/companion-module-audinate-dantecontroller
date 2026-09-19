const fs = require('fs');
const path = require('path');
const os = require('os');

const FALLBACK_DEVICES = [
	{ id: '169.254.247.125', label: 'BRIDGE-CT-P57-A' },
	{ id: '169.254.49.154', label: 'BS-8f78b9' },
	{ id: '169.254.169.33', label: 'D64R-A-VV-ULTRIX-RECORDS' },
	{ id: '169.254.122.231', label: 'D64R-A-VV-UTILITY' },
	{ id: '169.254.62.39', label: 'DIGIFACE-D3-A-MAIN' },
	{ id: '169.254.240.103', label: 'DIGIFACE-D3-B-BACKUP' },
	{ id: '169.254.172.59', label: 'PWSArtist-DANTE-1-Bay-10' },
	{ id: '169.254.231.97', label: 'PWSNY-A32Pro-1024Rack02' },
	{ id: '169.254.146.114', label: 'PWSNY-AVIO-Bluetooth-1024Rack02' },
	{ id: '169.254.57.16', label: 'WES-PB-MacBook-Air' },
	{ id: '169.254.101.123', label: 'Y001-Rio3224-A2world' },
	{ id: '169.254.154.141', label: 'Y001-Yamaha-CSD-R7-HY1-8423ac' },
	{ id: '169.254.232.127', label: 'Y002-Yamaha-Rio1608-VV' },
];

function getCachePath() {
	const homedir = os.homedir() || process.env.HOME || '/Users/mattbell';
	const companionDir = path.join(homedir, 'Library', 'Application Support', 'companion');
	if (fs.existsSync(companionDir)) {
		return path.join(companionDir, 'dante-devices-cache.json');
	}
	const directPath = '/Users/mattbell/Library/Application Support/companion/dante-devices-cache.json';
	if (fs.existsSync(directPath)) {
		return directPath;
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
