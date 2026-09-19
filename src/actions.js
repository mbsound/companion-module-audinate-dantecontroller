const { Regex } = require('@companion-module/base');
const { DANTE_CONST, object2choices, object2PartialChoices, array2choices, ensureChoices } = require('./const');

module.exports = {
	initActions: function () {
		let self = this;
		let actions = {};

		const rawDeviceChoices = ensureChoices(self.devicesChoices, { id: '', label: 'Searching for devices...' });
		const defaultDeviceChoices = [
			{ id: '', label: 'Select a device...' },
			...rawDeviceChoices.filter((c) => c.id !== '')
		];
		const refreshDeviceChoices = [
			{ id: 'all', label: 'All Devices' },
			...rawDeviceChoices.filter((c) => c.id !== '')
		];

		const parseVar = async (context, val) => {
			if (val === null || val === undefined) return '';
			const raw = typeof val === 'object' && 'value' in val ? val.value : val;
			if (typeof raw !== 'string') return raw;
			if (typeof context?.parseVariablesInString === 'function') {
				try {
					return await context.parseVariablesInString(raw);
				} catch (e) {
					return raw;
				}
			}
			return raw;
		};

		const getDeviceRxChoices = (ip, deviceName) => {
			if (self.rxChannelsChoices[deviceName]?.length > 1) {
				return self.rxChannelsChoices[deviceName];
			}
			const dev = self.devicesData[ip];
			if (dev?.rx) {
				const numKeys = Object.keys(dev.rx).map(Number).filter((n) => Number.isInteger(n) && n > 0);
				const count = Math.max(dev.rx.count || 0, numKeys.length > 0 ? Math.max(...numKeys) : 0);
				if (count > 0) {
					const list = [{ id: 0, label: 'None' }, { id: '', label: 'None' }];
					const seenIds = new Set([0, '']);
					for (let i = 1; i <= count; i++) {
						const ch = dev.rx[i];
						const name = ch?.friendlyName || ch?.name;
						const indexString = i.toString().padStart(2, '0');
						const label = (name && name !== String(i) && name !== indexString) ? `${i}: ${name}` : `Channel ${i}`;
						list.push({ id: i, label });
						seenIds.add(i);
						if (!seenIds.has(String(i))) {
							list.push({ id: String(i), label });
							seenIds.add(String(i));
						}
					}
					return list;
				}
			}
			if (self.rxChannelsChoices[deviceName]?.length > 0) {
				return self.rxChannelsChoices[deviceName];
			}
			const fallback = [{ id: 0, label: 'None' }, { id: '', label: 'None' }];
			for (let i = 1; i <= 64; i++) {
				fallback.push({ id: i, label: `Channel ${i}` });
				fallback.push({ id: String(i), label: `Channel ${i}` });
			}
			return fallback;
		};

		const getDeviceTxChoices = (ip, deviceName) => {
			if (self.txChannelsChoices[deviceName]?.length > 1) {
				return self.txChannelsChoices[deviceName];
			}
			const dev = self.devicesData[ip];
			if (dev?.tx) {
				const numKeys = Object.keys(dev.tx).map(Number).filter((n) => Number.isInteger(n) && n > 0);
				const count = Math.max(dev.tx.count || 0, numKeys.length > 0 ? Math.max(...numKeys) : 0);
				if (count > 0) {
					const list = [{ id: 0, label: 'None' }, { id: '', label: 'None' }];
					const seenIds = new Set([0, '']);
					for (let i = 1; i <= count; i++) {
						const ch = dev.tx[i];
						const name = self.getChannelSubscriptionName(ch);
						const indexString = i.toString().padStart(2, '0');
						const label = (name && name !== String(i) && name !== indexString) ? `${i}: ${name}` : `Channel ${i}`;
						list.push({ id: i, label });
						seenIds.add(i);
						if (!seenIds.has(String(i))) {
							list.push({ id: String(i), label });
							seenIds.add(String(i));
						}
					}
					return list;
				}
			}
			if (self.txChannelsChoices[deviceName]?.length > 0) {
				return self.txChannelsChoices[deviceName];
			}
			const fallback = [{ id: 0, label: 'None' }, { id: '', label: 'None' }];
			for (let i = 1; i <= 64; i++) {
				fallback.push({ id: i, label: `Channel ${i}` });
				fallback.push({ id: String(i), label: `Channel ${i}` });
			}
			return fallback;
		};

		// 1. Make Crosspoint
		actions.makeCrosspoint = {
			name: 'Make Crosspoint',
			options: [
				{
					type: 'dropdown',
					label: 'Destination Device',
					id: 'destinationDevice',
					choices: defaultDeviceChoices,
					default: '',
					disableAutoExpression: true
				}
			],
			callback: async function (action, context) {
				try {
					const opt = action.options;
					const destDevRaw = opt.destinationDevice ?? opt.destinationDeviceAddress;
					const srcDevRaw = opt.sourceDevice ?? opt.sourceDeviceName;
					const destDev = (await context?.parseVariablesInString?.(destDevRaw)) ?? destDevRaw;
					const srcDev = (await context?.parseVariablesInString?.(srcDevRaw)) ?? srcDevRaw;

					if (!destDev || destDev === '') {
						self.log('warn', 'Make Crosspoint: Please select a destination device.');
						return;
					}
					if (!srcDev || srcDev === '') {
						self.log('warn', 'Make Crosspoint: Please select a source device.');
						return;
					}

					const destChanRaw = opt['destinationChannel_' + destDev] ?? opt.destinationChannelNumber ?? opt.destinationChannel;
					const destChan = (await context?.parseVariablesInString?.(String(destChanRaw ?? ''))) ?? destChanRaw;

					const srcChanRaw = opt['sourceChannel_' + srcDev] ?? opt.sourceChannelName ?? opt.sourceChannel;
					const srcChan = (await context?.parseVariablesInString?.(String(srcChanRaw ?? ''))) ?? srcChanRaw;

					if (!destChan || destChan === '' || destChan === 0 || destChan === '0') {
						self.log('warn', 'Make Crosspoint: Please select a destination channel.');
						return;
					}
					if (!srcChan || srcChan === '' || srcChan === 0 || srcChan === '0') {
						self.log('warn', 'Make Crosspoint: Please select a source channel.');
						return;
					}

					const srcDevName = self.devicesData[srcDev]?.name || srcDev;
					const sourceChannelObj = self.devicesData[srcDev]?.tx?.[srcChan] || self.findTxChannelByName(srcDev, srcChan);
					let sourceChannelName = self.getChannelSubscriptionName(sourceChannelObj) || srcChan;
					if (typeof sourceChannelName === 'number' || (!isNaN(parseInt(sourceChannelName, 10)) && String(parseInt(sourceChannelName, 10)) === String(sourceChannelName).trim())) {
						const num = parseInt(sourceChannelName, 10);
						sourceChannelName = num.toString().padStart(2, '0');
					}

					self.makeCrosspoint(destDev, String(sourceChannelName), srcDevName, destChan);
				} catch (err) {
					self.log('error', `Error executing Make Crosspoint action: ${err?.message || err}`);
				}
			}
		};

		for (const [ip, device] of Object.entries(self.devicesData)) {
			const rxChoices = getDeviceRxChoices(ip, device.name);
			let nameOption = {
				type: 'dropdown',
				label: 'Destination Channel',
				id: 'destinationChannel_' + ip,
				choices: rxChoices,
				default: rxChoices[1]?.id ?? rxChoices[0]?.id ?? 0,
				isVisibleExpression: `$(options:destinationDevice) == '${ip}'`
			};
			actions.makeCrosspoint.options.push(nameOption);
		}

		actions.makeCrosspoint.options.push({
			type: 'dropdown',
			label: 'Source Device',
			id: 'sourceDevice',
			choices: defaultDeviceChoices,
			default: '',
			disableAutoExpression: true
		});

		for (const [ip, device] of Object.entries(self.devicesData)) {
			const txChoices = getDeviceTxChoices(ip, device.name);
			let nameOption = {
				type: 'dropdown',
				label: 'Source Channel',
				id: 'sourceChannel_' + ip,
				choices: txChoices,
				default: txChoices[1]?.id ?? txChoices[0]?.id ?? 0,
				isVisibleExpression: `$(options:sourceDevice) == '${ip}'`
			};
			actions.makeCrosspoint.options.push(nameOption);
		}

		// 2. Clear Crosspoint
		actions.clearCrosspoint = {
			name: 'Clear Crosspoint',
			options: [
				{
					type: 'dropdown',
					label: 'Destination Device',
					id: 'destinationDevice',
					choices: defaultDeviceChoices,
					default: '',
					disableAutoExpression: true
				}
			],
			callback: async function (action, context) {
				try {
					const opt = action.options;
					const destDevRaw = opt.destinationDevice ?? opt.destinationDeviceAdddress ?? opt.destinationDeviceAddress;
					const destDev = (await context?.parseVariablesInString?.(destDevRaw)) ?? destDevRaw;

					if (!destDev || destDev === '') {
						self.log('warn', 'Clear Crosspoint: Please select a destination device.');
						return;
					}

					const destChanRaw = opt['destinationChannel_' + destDev] ?? opt.destinationChannelNumber ?? opt.destinationChannel;
					const destChan = (await context?.parseVariablesInString?.(String(destChanRaw ?? ''))) ?? destChanRaw;

					if (!destChan || destChan === '' || destChan === 0 || destChan === '0') {
						self.log('warn', 'Clear Crosspoint: Please select a destination channel.');
						return;
					}

					self.clearCrosspoint(destDev, destChan);
				} catch (err) {
					self.log('error', `Error executing Clear Crosspoint action: ${err?.message || err}`);
				}
			}
		};

		for (const [ip, device] of Object.entries(self.devicesData)) {
			const rxChoices = getDeviceRxChoices(ip, device.name);
			let nameOption = {
				type: 'dropdown',
				label: 'Destination Channel',
				id: 'destinationChannel_' + ip,
				choices: rxChoices,
				default: rxChoices[1]?.id ?? rxChoices[0]?.id ?? 0,
				isVisibleExpression: `$(options:destinationDevice) == '${ip}'`
			};
			actions.clearCrosspoint.options.push(nameOption);
		}

		// 3. Select Destination
		actions.selectDestination = {
			name: 'Select Destination',
			options: [
				{
					type: 'dropdown',
					label: 'Destination Device',
					id: 'destinationDevice',
					choices: defaultDeviceChoices,
					default: '',
					disableAutoExpression: true
				}
			],
			callback: async function (action, context) {
				try {
					const opt = action.options;
					const devRaw = opt.destinationDevice;
					const dev = (await context?.parseVariablesInString?.(devRaw)) ?? devRaw;
					if (!dev || dev === '') {
						self.log('warn', 'Select Destination: Please select a destination device.');
						return;
					}
					const chanRaw = opt['destinationChannel_' + dev] ?? opt.destinationChannel;
					const channel = (await context?.parseVariablesInString?.(String(chanRaw ?? ''))) ?? chanRaw;
					if (!channel || channel === '' || channel === 0 || channel === '0') {
						self.log('warn', 'Select Destination: Please select a destination channel.');
						return;
					}
					self.selectDestination(dev, channel);
				} catch (err) {
					self.log('error', `Error executing Select Destination action: ${err?.message || err}`);
				}
			}
		};
		for (const [ip, device] of Object.entries(self.devicesData)) {
			const rxChoices = getDeviceRxChoices(ip, device.name);
			let nameOption = {
				type: 'dropdown',
				label: 'Destination Channel',
				id: 'destinationChannel_' + ip,
				choices: rxChoices,
				default: rxChoices[1]?.id ?? rxChoices[0]?.id ?? 0,
				isVisibleExpression: `$(options:destinationDevice) == '${ip}'`
			};
			actions.selectDestination.options.push(nameOption);
		}

		// 4. Route Source to Selected Destination
		actions.routeSourceToSelectedDestination = {
			name: 'Route Source to Selected Destination',
			options: [
				{
					type: 'dropdown',
					label: 'Source Device',
					id: 'sourceDevice',
					choices: defaultDeviceChoices,
					default: '',
					disableAutoExpression: true
				}
			],
			callback: async function (action, context) {
				try {
					const opt = action.options;
					const devRaw = opt.sourceDevice ?? opt.sourceDeviceName;
					const dev = (await context?.parseVariablesInString?.(devRaw)) ?? devRaw;
					if (!dev || dev === '') {
						self.log('warn', 'Route Source to Selected Destination: Please select a source device.');
						return;
					}
					const chanRaw = opt['sourceChannel_' + dev] ?? opt.sourceChannelName ?? opt.sourceChannel;
					const channel = (await context?.parseVariablesInString?.(String(chanRaw ?? ''))) ?? chanRaw;
					if (!channel || channel === '' || channel === 0 || channel === '0') {
						self.log('warn', 'Route Source to Selected Destination: Please select a source channel.');
						return;
					}
					const sourceChannel = self.devicesData[dev]?.tx?.[channel] || self.findTxChannelByName(dev, channel);
					let sourceChannelName = self.getChannelSubscriptionName(sourceChannel) || channel;
					if (typeof sourceChannelName === 'number' || (!isNaN(parseInt(sourceChannelName, 10)) && String(parseInt(sourceChannelName, 10)) === String(sourceChannelName).trim())) {
						const num = parseInt(sourceChannelName, 10);
						sourceChannelName = num.toString().padStart(2, '0');
					}
					self.routeSourceToSelectedDestination(self.devicesData[dev]?.name || dev, String(sourceChannelName));
				} catch (err) {
					self.log('error', `Error executing Route Source to Selected Destination action: ${err?.message || err}`);
				}
			}
		};
		for (const [ip, device] of Object.entries(self.devicesData)) {
			const txChoices = getDeviceTxChoices(ip, device.name);
			let nameOption = {
				type: 'dropdown',
				label: 'Source Channel',
				id: 'sourceChannel_' + ip,
				choices: txChoices,
				default: txChoices[1]?.id ?? txChoices[0]?.id ?? 0,
				isVisibleExpression: `$(options:sourceDevice) == '${ip}'`
			};
			actions.routeSourceToSelectedDestination.options.push(nameOption);
		}

		// 5. Clear Route on Selected Destination
		actions.clearSelectedDestination = {
			name: 'Clear Route on Selected Destination',
			options: [],
			callback: async function () {
				try {
					self.clearSelectedDestination();
				} catch (err) {
					self.log('error', `Error executing Clear Selected Destination action: ${err?.message || err}`);
				}
			}
		};

		// 6. Batch Route Channels
		actions.batchRoute = {
			name: 'Batch Route Channels (1-to-1 sequential)',
			options: [
				{
					type: 'dropdown',
					label: 'Destination Device',
					id: 'destinationDevice',
					choices: defaultDeviceChoices,
					default: '',
					disableAutoExpression: true
				},
				{
					type: 'number',
					label: 'Start Destination Channel Number',
					id: 'startDestChannel',
					default: 1,
					min: 1,
					max: 512
				},
				{
					type: 'dropdown',
					label: 'Source Device',
					id: 'sourceDevice',
					choices: defaultDeviceChoices,
					default: '',
					disableAutoExpression: true
				},
				{
					type: 'number',
					label: 'Start Source Channel Number',
					id: 'startSourceChannel',
					default: 1,
					min: 1,
					max: 512
				},
				{
					type: 'number',
					label: 'Number of Channels to Route',
					id: 'count',
					default: 8,
					min: 1,
					max: 64
				}
			],
			callback: async function (action, context) {
				try {
					const opt = action.options;
					const destDev = await parseVar(context, opt.destinationDevice);
					const srcDevInput = opt.sourceDevice || opt.sourceDeviceName;
					const srcDev = await parseVar(context, srcDevInput);

					if (!destDev || destDev === '') {
						self.log('warn', 'Batch Route: Please select a destination device.');
						return;
					}
					if (!srcDev || srcDev === '') {
						self.log('warn', 'Batch Route: Please select a source device.');
						return;
					}

					const srcDevName = self.devicesData[srcDev]?.name || srcDev;
					const startDest = parseInt(opt.startDestChannel, 10);
					const startSrc = parseInt(opt.startSourceChannel, 10);
					const count = parseInt(opt.count, 10);

					const routes = [];
					for (let i = 0; i < count; i++) {
						routes.push({
							destinationChannel: startDest + i,
							sourceDeviceName: srcDevName,
							sourceChannelName: String(startSrc + i)
						});
					}
					self.makeBatchCrosspoint(destDev, routes);
				} catch (err) {
					self.log('error', `Error executing Batch Route action: ${err?.message || err}`);
				}
			}
		};

		// 7. Batch Clear Channels
		actions.batchClear = {
			name: 'Batch Clear Channels',
			options: [
				{
					type: 'dropdown',
					label: 'Destination Device',
					id: 'destinationDevice',
					choices: defaultDeviceChoices,
					default: '',
					disableAutoExpression: true
				},
				{
					type: 'number',
					label: 'Start Destination Channel Number',
					id: 'startDestChannel',
					default: 1,
					min: 1,
					max: 512
				},
				{
					type: 'number',
					label: 'Number of Channels to Clear',
					id: 'count',
					default: 8,
					min: 1,
					max: 64
				}
			],
			callback: async function (action, context) {
				try {
					const opt = action.options;
					const destDev = await parseVar(context, opt.destinationDevice);
					if (!destDev || destDev === '') {
						self.log('warn', 'Batch Clear: Please select a destination device.');
						return;
					}
					const startDest = parseInt(opt.startDestChannel, 10);
					const count = parseInt(opt.count, 10);

					const channels = [];
					for (let i = 0; i < count; i++) {
						channels.push(startDest + i);
					}
					self.clearBatchCrosspoint(destDev, channels);
				} catch (err) {
					self.log('error', `Error executing Batch Clear action: ${err?.message || err}`);
				}
			}
		};

		// 8. Set Device Name
		actions.setDeviceName = {
			name: 'Set Device Name',
			options: [
				{
					type: 'dropdown',
					label: 'Device',
					id: 'device',
					choices: defaultDeviceChoices,
					default: '',
					disableAutoExpression: true
				},
				{
					type: 'textinput',
					label: 'New Name',
					id: 'name',
					default: '',
					useVariables: true
				}
			],
			callback: async function (action, context) {
				try {
					const opt = action.options;
					if (!opt.device) {
						self.log('warn', 'Set Device Name: Please select a device.');
						return;
					}
					const name = await parseVar(context, opt.name);
					self.setDeviceName(opt.device, name);
				} catch (err) {
					self.log('error', `Error in Set Device Name: ${err?.message || err}`);
				}
			}
		};

		// 9. Reset Device Name
		actions.resetDeviceName = {
			name: 'Reset Device Name',
			options: [
				{
					type: 'dropdown',
					label: 'Device',
					id: 'device',
					choices: defaultDeviceChoices,
					default: '',
					disableAutoExpression: true
				}
			],
			callback: async function (action, context) {
				try {
					let opt = action.options;
					if (!opt.device) {
						self.log('warn', 'Reset Device Name: Please select a device.');
						return;
					}
					self.resetDeviceName(opt.device);
				} catch (err) {
					self.log('error', `Error in Reset Device Name: ${err?.message || err}`);
				}
			}
		};

		// 10. Set Rx Channel Name
		actions.setRxChannelName = {
			name: 'Set Rx Channel Name',
			options: [
				{
					type: 'dropdown',
					label: 'Device',
					id: 'device',
					choices: defaultDeviceChoices,
					default: '',
					disableAutoExpression: true
				}
			],
			callback: async function (action, context) {
				try {
					const opt = action.options;
					if (!opt.device) {
						self.log('warn', 'Set Rx Channel Name: Please select a device.');
						return;
					}
					const newName = await parseVar(context, opt.newName);
					self.setRxChannelName(opt.device, opt['channel_' + opt.device], newName);
				} catch (err) {
					self.log('error', `Error in Set Rx Channel Name: ${err?.message || err}`);
				}
			}
		};
		for (const [ip, device] of Object.entries(self.devicesData)) {
			const rxChoices = getDeviceRxChoices(ip, device.name);
			let nameOption = {
				type: 'dropdown',
				label: 'Channel',
				id: 'channel_' + ip,
				choices: rxChoices,
				default: rxChoices[1]?.id ?? rxChoices[0]?.id ?? 0,
				isVisibleExpression: `$(options:device) == '${ip}'`
			};
			actions.setRxChannelName.options.push(nameOption);
		}
		actions.setRxChannelName.options.push({
			type: 'textinput',
			label: 'New Name',
			id: 'newName',
			useVariables: true
		});

		// 11. Reset Rx Channel Name
		actions.resetRxChannelName = {
			name: 'Reset Rx Channel Name',
			options: [
				{
					type: 'dropdown',
					label: 'Device',
					id: 'device',
					choices: defaultDeviceChoices,
					default: '',
					disableAutoExpression: true
				}
			],
			callback: async function (action, context) {
				try {
					const opt = action.options;
					if (!opt.device) {
						self.log('warn', 'Reset Rx Channel Name: Please select a device.');
						return;
					}
					self.resetRxChannelName(opt.device, opt['channel_' + opt.device]);
				} catch (err) {
					self.log('error', `Error in Reset Rx Channel Name: ${err?.message || err}`);
				}
			}
		};
		for (const [ip, device] of Object.entries(self.devicesData)) {
			const rxChoices = getDeviceRxChoices(ip, device.name);
			let nameOption = {
				type: 'dropdown',
				label: 'Channel',
				id: 'channel_' + ip,
				choices: rxChoices,
				default: rxChoices[1]?.id ?? rxChoices[0]?.id ?? 0,
				isVisibleExpression: `$(options:device) == '${ip}'`
			};
			actions.resetRxChannelName.options.push(nameOption);
		}

		// 12. Set Tx Channel Name
		actions.setTxChannelName = {
			name: 'Set Tx Channel Name',
			options: [
				{
					type: 'dropdown',
					label: 'Device',
					id: 'device',
					choices: defaultDeviceChoices,
					default: '',
					disableAutoExpression: true
				}
			],
			callback: async function (action, context) {
				try {
					const opt = action.options;
					if (!opt.device) {
						self.log('warn', 'Set Tx Channel Name: Please select a device.');
						return;
					}
					const newName = await parseVar(context, opt.newName);
					self.setTxChannelName(opt.device, opt['channel_' + opt.device], newName);
				} catch (err) {
					self.log('error', `Error in Set Tx Channel Name: ${err?.message || err}`);
				}
			}
		};
		for (const [ip, device] of Object.entries(self.devicesData)) {
			const txChoices = getDeviceTxChoices(ip, device.name);
			let nameOption = {
				type: 'dropdown',
				label: 'Channel',
				id: 'channel_' + ip,
				choices: txChoices,
				default: txChoices[1]?.id ?? txChoices[0]?.id ?? 0,
				isVisibleExpression: `$(options:device) == '${ip}'`
			};
			actions.setTxChannelName.options.push(nameOption);
		}
		actions.setTxChannelName.options.push({
			type: 'textinput',
			label: 'New Name',
			id: 'newName',
			useVariables: true
		});

		// 13. Reset Tx Channel Name
		actions.resetTxChannelName = {
			name: 'Reset Tx Channel Name',
			options: [
				{
					type: 'dropdown',
					label: 'Device',
					id: 'device',
					choices: defaultDeviceChoices,
					default: '',
					disableAutoExpression: true
				}
			],
			callback: async function (action, context) {
				try {
					const opt = action.options;
					if (!opt.device) {
						self.log('warn', 'Reset Tx Channel Name: Please select a device.');
						return;
					}
					self.resetTxChannelName(opt.device, opt['channel_' + opt.device]);
				} catch (err) {
					self.log('error', `Error in Reset Tx Channel Name: ${err?.message || err}`);
				}
			}
		};
		for (const [ip, device] of Object.entries(self.devicesData)) {
			const txChoices = getDeviceTxChoices(ip, device.name);
			let nameOption = {
				type: 'dropdown',
				label: 'Channel',
				id: 'channel_' + ip,
				choices: txChoices,
				default: txChoices[1]?.id ?? txChoices[0]?.id ?? 0,
				isVisibleExpression: `$(options:device) == '${ip}'`
			};
			actions.resetTxChannelName.options.push(nameOption);
		}

		// 14. Set Latency
		actions.setLatency = {
			name: 'Set Latency',
			options: [
				{
					type: 'dropdown',
					label: 'Destination Device',
					id: 'destinationDevice',
					choices: defaultDeviceChoices,
					default: '',
					disableAutoExpression: true
				},
				{
					type: 'textinput',
					label: 'Latency (in ms)',
					id: 'latency',
					default: '1',
					useVariables: true
				}
			],
			callback: async function (action, context) {
				try {
					const opt = action.options;
					if (!opt.destinationDevice) {
						self.log('warn', 'Set Latency: Please select a destination device.');
						return;
					}
					const latency = await parseVar(context, opt.latency);
					self.setLatency(opt.destinationDevice, latency);
				} catch (err) {
					self.log('error', `Error in Set Latency: ${err?.message || err}`);
				}
			}
		};

		// 15. Set Sample Rate
		actions.setSampleRate = {
			name: 'Set Sample Rate',
			options: [
				{
					type: 'dropdown',
					label: 'Device',
					id: 'device',
					choices: defaultDeviceChoices,
					default: '',
					disableAutoExpression: true
				}
			],
			callback: async function (action, context) {
				try {
					const opt = action.options;
					const ip = opt.device;
					if (!ip) {
						self.log('warn', 'Set Sample Rate: Please select a device.');
						return;
					}
					self.setSampleRate(ip, opt['sr_' + ip]);
				} catch (err) {
					self.log('error', `Error in Set Sample Rate: ${err?.message || err}`);
				}
			}
		};
		for (const [ip, device] of Object.entries(self.devicesData)) {
			let srOptions = {
				type: 'dropdown',
				label: 'Sample Rate',
				id: 'sr_' + ip,
				choices: array2choices(device.srOptions, (f) => (f / 1000).toString() + ' kHz'),
				isVisibleExpression: `$(options:device) == '${ip}'`
			};
			actions.setSampleRate.options.push(srOptions);
		}

		// 16. Set Pullup
		actions.setPullup = {
			name: 'Set Sample Rate Pullup',
			options: [
				{
					type: 'dropdown',
					label: 'Device',
					id: 'device',
					choices: defaultDeviceChoices,
					default: '',
					disableAutoExpression: true
				}
			],
			callback: async function (action, context) {
				try {
					const opt = action.options;
					const ip = opt.device;
					if (!ip) {
						self.log('warn', 'Set Sample Rate Pullup: Please select a device.');
						return;
					}
					self.setPullup(ip, opt['pullup_' + ip]);
				} catch (err) {
					self.log('error', `Error in Set Sample Rate Pullup: ${err?.message || err}`);
				}
			}
		};
		for (const [ip, device] of Object.entries(self.devicesData)) {
			let pullupOptions = {
				type: 'dropdown',
				label: 'Sample Rate Pullup',
				id: 'pullup_' + ip,
				choices: object2PartialChoices(DANTE_CONST.PULLUPS, device.pullupOptions),
				isVisibleExpression: `$(options:device) == '${ip}'`
			};
			actions.setPullup.options.push(pullupOptions);
		}

		// 17. Set Encoding
		actions.setEncoding = {
			name: 'Set Encoding',
			options: [
				{
					type: 'dropdown',
					label: 'Device',
					id: 'device',
					choices: defaultDeviceChoices,
					default: '',
					disableAutoExpression: true
				}
			],
			callback: async function (action, context) {
				try {
					const opt = action.options;
					const device = opt.device;
					if (!device) {
						self.log('warn', 'Set Encoding: Please select a device.');
						return;
					}
					self.setEncoding(device, opt['encoding_' + device]);
				} catch (err) {
					self.log('error', `Error in Set Encoding: ${err?.message || err}`);
				}
			}
		};
		for (const [ip, device] of Object.entries(self.devicesData)) {
			let encodingOptions = {
				type: 'dropdown',
				label: 'Encoding',
				id: 'encoding_' + ip,
				choices: object2PartialChoices(DANTE_CONST.ENCODINGS, device.encodingOptions),
				isVisibleExpression: `$(options:device) == '${ip}'`
			};
			actions.setEncoding.options.push(encodingOptions);
		}

		// 18. Set Output Level
		actions.setOutputLevel = {
			name: 'Set Output Level',
			options: [
				{
					type: 'dropdown',
					label: 'Device',
					id: 'device',
					choices: defaultDeviceChoices,
					default: '',
					disableAutoExpression: true
				}
			],
			callback: async function (action, context) {
				try {
					let opt = action.options;
					const dev = opt.device || opt.destinationDevice;
					if (!dev) {
						self.log('warn', 'Set Output Level: Please select a device.');
						return;
					}
					self.setLevel(dev, 'out', opt['channel_' + dev], opt.level);
				} catch (err) {
					self.log('error', `Error in Set Output Level: ${err?.message || err}`);
				}
			}
		};
		for (const [ip, device] of Object.entries(self.devicesData)) {
			const rxChoices = getDeviceRxChoices(ip, device.name);
			let levelOption = {
				type: 'dropdown',
				label: 'Channel',
				id: 'channel_' + ip,
				choices: rxChoices,
				default: rxChoices[1]?.id ?? rxChoices[0]?.id ?? 0,
				isVisibleExpression: `$(options:device) == '${ip}'`
			};
			actions.setOutputLevel.options.push(levelOption);
		}
		actions.setOutputLevel.options.push({
			type: 'dropdown',
			label: 'Level',
			id: 'level',
			choices: object2choices(DANTE_CONST.LEVELS),
			default: 2
		});

		// 19. Refresh Parameters
		actions.refresh = {
			name: 'Refresh Parameters',
			options: [
				{
					type: 'dropdown',
					label: 'Device',
					id: 'device',
					default: 'all',
					choices: refreshDeviceChoices,
					disableAutoExpression: true
				}
			],
			callback: async function (action, context) {
				const opt = action.options;
				const device = (await context?.parseVariablesInString?.(opt.device)) || opt.device;
				if (!device || device === 'all') {
					self.refreshSettings();
					self.refreshArc();
				} else {
					const IP = RegExp(Regex.IP.slice(1, -1));
					const ipaddress = IP.test(device) ? device : (self.findDeviceIpByName(device) || device);
					self.refreshSettings(ipaddress);
					self.refreshArc(ipaddress);
				}
			}
		};

		// 20. Refresh Clock Status
		actions.refreshClock = {
			name: 'Refresh Clock Status',
			options: [
				{
					type: 'dropdown',
					label: 'Device',
					id: 'device',
					default: 'all',
					choices: refreshDeviceChoices,
					disableAutoExpression: true
				}
			],
			callback: async function (action, context) {
				const opt = action.options;
				const device = (await context?.parseVariablesInString?.(opt.device)) || opt.device;
				if (!device || device === 'all') {
					self.refreshClock();
				} else {
					const IP = RegExp(Regex.IP.slice(1, -1));
					const ipaddress = IP.test(device) ? device : (self.findDeviceIpByName(device) || device);
					self.refreshClock(ipaddress);
				}
			}
		};

		self.setActionDefinitions(actions);
	}
};
