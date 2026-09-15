const { combineRgb } = require('@companion-module/base');
const { Regex } = require('@companion-module/base')

module.exports = {
	initFeedbacks: function () {
		let self = this;
		let feedbacks = {};

		const foregroundColor = combineRgb(255, 255, 255) // White
		const backgroundColorRed = combineRgb(255, 0, 0) // Red
		
		
		feedbacks['routing_bg'] = {
			type: 'boolean',
			name: 'Change background color by destination',
			description: 'If the specified source channel specified is routed to the correct output, change background color of the button',
			defaultStyle: {
            color: combineRgb(0, 0, 0),
				bgcolor: combineRgb(255, 255, 0),
			},
			options: [
				{
					type: 'dropdown',
					label: 'Destination Device',
					id: 'destinationDevice',
					choices: self.devicesChoices
				}		
			],
			callback: (feedback) => {
				let opt = feedback.options;
				if (opt.destinationDevice && self.devicesData[opt.destinationDevice]?.rx && opt.sourceDevice) {
					let destinationChannel = self.devicesData[opt.destinationDevice].rx[opt['destinationChannel_'+opt.destinationDevice]];
					const selectedSourceChannel = opt['sourceChannel_'+opt.sourceDevice];
					const sourceChannel = self.devicesData[opt.sourceDevice]?.tx?.[selectedSourceChannel] || self.findTxChannelByName(opt.sourceDevice, selectedSourceChannel);
					const normalizeName = (name) => String(name ?? '').trim().toLowerCase();
					const destinationSourceChannelName = normalizeName(destinationChannel?.sourceChannel);
					const sourceChannelCandidates = [selectedSourceChannel, self.getChannelSubscriptionName(sourceChannel), sourceChannel?.name, sourceChannel?.friendlyName]
						.filter(Boolean)
						.map((name) => normalizeName(name));
					if (sourceChannel?.number != undefined) {
						const number = parseInt(sourceChannel.number, 10);
						if (!isNaN(number)) {
							sourceChannelCandidates.push(String(number), String(number).padStart(2, '0'));
						}
					}
					const sourceChannelMatches = sourceChannelCandidates.includes(destinationSourceChannelName);
					const destinationSourceDeviceName = normalizeName(destinationChannel?.sourceDevice);
					const selectedSourceDeviceName = normalizeName(self.devicesData[opt.sourceDevice]?.name);
					const sourceDeviceMatches = destinationSourceDeviceName == selectedSourceDeviceName ||
						(destinationSourceDeviceName == '.' && opt.destinationDevice == opt.sourceDevice);
					const subscriptionOk = ([9, 10, 14].includes(destinationChannel?.subscriptionStatus));
					return sourceDeviceMatches && sourceChannelMatches && subscriptionOk;
				}	
			},
		}
		
		
		for (const [ip, device] of Object.entries(self.devicesData)) {
			let nameOption = {
				type: 'dropdown',
				label: 'Destination channel',
				id: 'destinationChannel_'+ ip,
				choices: this.rxChannelsChoices[device.name],
				isVisibleData : ip,
				isVisible: (options, deviceIp) => { return (options.destinationDevice == deviceIp);}
			}
			feedbacks.routing_bg.options.push(nameOption);
		}
		
		feedbacks.routing_bg.options.push({
					type: 'dropdown',
					label: 'Source Device',
					id: 'sourceDevice',
					choices: this.devicesChoices
				})
	
		for (const [ip, device] of Object.entries(self.devicesData)) {
			let nameOption = {
				type: 'dropdown',
				label: 'Source channel',
				id: 'sourceChannel_'+ ip,
				choices: this.txChannelsChoices[device.name],
				isVisibleData : ip,
				isVisible: (options, deviceIp) => { return (options.sourceDevice == deviceIp);}
			}
			feedbacks.routing_bg.options.push(nameOption);
		}	
		
	feedbacks['routing_bg_manual'] = {
		type: 'boolean',
		name: 'Change background color by destination (manual)',
		description: 'If the specified source channel specified is routed to the correct output, change background color of the button',
		defaultStyle: {
           color: combineRgb(0, 0, 0),
			bgcolor: combineRgb(255, 255, 0),
		},
		options: [
			{
				type: 'textinput',
				label: 'Source Channel Name',
				id: 'sourceChannelName',
				default: 'Input 1',
				useVariables: true
			},
			{
				type: 'textinput',
				label: 'Source Device Name',
				id: 'sourceDeviceName',
				default: 'MyDanteDeviceName',
				useVariables: true
			},
			{
				type: 'textinput',
				label: 'Destination Channel',
				tooltip: 'Enter either channel name or channel number',
				id: 'destinationChannelId',
				default: '1',
				useVariables: true
			},
			{
				type: 'textinput',
				label: 'Destination Device',
				tooltip: 'Enter either device name or device IP',
				id: 'destinationDeviceId',
				default: 'MyDanteDevice',
				useVariables: true
			},	
		],
		callback: async function (feedback, context) {
			const opt = feedback.options;
			const sourceChannelName = await context.parseVariablesInString(opt.sourceChannelName);
			const sourceDeviceName = await context.parseVariablesInString(opt.sourceDeviceName);
			const destinationChannelId = await context.parseVariablesInString(opt.destinationChannelId);
			const destinationDeviceId = await context.parseVariablesInString(opt.destinationDeviceId);

			// Check if destinationDeviceId is an IP or a name
			const IP = RegExp(Regex.IP.slice(1,-1));
			const destinationDeviceIp = IP.test(destinationDeviceId) ? destinationDeviceId : self.findDeviceIpByName(destinationDeviceId);
			
			if (destinationDeviceIp && sourceDeviceName && self.devicesData[destinationDeviceIp]?.rx) {
				const destinationChannel = self.findRxChannelByName(destinationDeviceIp, destinationChannelId) ?? self.devicesData[destinationDeviceIp].rx[destinationChannelId];
				if (destinationChannel == undefined) {
					return
				}
				
				const sourceChannel = self.findTxChannelByName(sourceDeviceName, sourceChannelName);
				const normalizeName = (name) => String(name ?? '').trim().toLowerCase();
				const destinationSourceChannelName = normalizeName(destinationChannel?.sourceChannel);
				const sourceChannelCandidates = [sourceChannelName, self.getChannelSubscriptionName(sourceChannel), sourceChannel?.name, sourceChannel?.friendlyName]
					.filter(Boolean)
					.map((name) => normalizeName(name));
				if (sourceChannel?.number != undefined) {
					const number = parseInt(sourceChannel.number, 10);
					if (!isNaN(number)) {
						sourceChannelCandidates.push(String(number), String(number).padStart(2, '0'));
					}
				}
				
				const sourceChannelMatches = sourceChannelCandidates.includes(destinationSourceChannelName);
				const destinationSourceDeviceName = normalizeName(destinationChannel?.sourceDevice);
				const selectedSourceDeviceName = normalizeName(sourceDeviceName);
				const sourceDeviceMatches = destinationSourceDeviceName == selectedSourceDeviceName ||
					(destinationSourceDeviceName == '.' && self.devicesData[destinationDeviceIp]?.name == sourceDeviceName);
				const subscriptionOk = ([9, 10, 14].includes(destinationChannel?.subscriptionStatus));
				return sourceDeviceMatches && sourceChannelMatches && subscriptionOk;
			}
		},
	};

	feedbacks['selected_destination'] = {
		type: 'boolean',
		name: 'Selected Destination (Router Matrix)',
		description: 'Indicates if this destination channel is currently selected as the routing target',
		defaultStyle: {
			color: combineRgb(255, 255, 255),
			bgcolor: combineRgb(255, 128, 0), // Orange
		},
		options: [
			{
				type: 'dropdown',
				label: 'Destination Device',
				id: 'destinationDevice',
				choices: self.devicesChoices
			}
		],
		callback: (feedback) => {
			if (!self.selectedDestination) return false;
			const opt = feedback.options;
			const targetChannel = opt['destinationChannel_' + opt.destinationDevice];
			const devMatch = (self.selectedDestination.device === opt.destinationDevice ||
				self.findDeviceIpByName(self.selectedDestination.device) === opt.destinationDevice ||
				self.devicesData[opt.destinationDevice]?.name === self.selectedDestination.device);
			const chanMatch = String(self.selectedDestination.channel) === String(targetChannel);
			return devMatch && chanMatch;
		}
	};
	for (const [ip, device] of Object.entries(self.devicesData)) {
		feedbacks.selected_destination.options.push({
			type: 'dropdown',
			label: 'Destination channel',
			id: 'destinationChannel_' + ip,
			choices: self.rxChannelsChoices[device.name],
			isVisibleData: ip,
			isVisible: (options, deviceIp) => options.destinationDevice == deviceIp
		});
	}

	feedbacks['selected_destination_manual'] = {
		type: 'boolean',
		name: 'Selected Destination (Router Matrix - manual)',
		description: 'Indicates if this destination is currently selected using text/variables',
		defaultStyle: {
			color: combineRgb(255, 255, 255),
			bgcolor: combineRgb(255, 128, 0),
		},
		options: [
			{
				type: 'textinput',
				label: 'Destination Device',
				id: 'destinationDevice',
				default: '',
				useVariables: true
			},
			{
				type: 'textinput',
				label: 'Destination Channel',
				id: 'destinationChannel',
				default: '1',
				useVariables: true
			}
		],
		callback: async (feedback, context) => {
			if (!self.selectedDestination) return false;
			const dev = await context.parseVariablesInString(feedback.options.destinationDevice);
			const chan = await context.parseVariablesInString(feedback.options.destinationChannel);
			const devMatch = (self.selectedDestination.device === dev ||
				self.findDeviceIpByName(self.selectedDestination.device) === dev ||
				self.findDeviceIpByName(dev) === self.selectedDestination.device);
			const chanMatch = String(self.selectedDestination.channel) === String(chan);
			return devMatch && chanMatch;
		}
	};

	feedbacks['source_routed_to_selected_destination'] = {
		type: 'boolean',
		name: 'Source Routed to Selected Destination (Router Matrix)',
		description: 'Indicates if this source channel is currently routed to the selected destination',
		defaultStyle: {
			color: combineRgb(255, 255, 255),
			bgcolor: combineRgb(0, 180, 0), // Green
		},
		options: [
			{
				type: 'dropdown',
				label: 'Source Device',
				id: 'sourceDevice',
				choices: self.devicesChoices
			}
		],
		callback: (feedback) => {
			if (!self.selectedDestination) return false;
			const opt = feedback.options;
			const selectedSourceChannel = opt['sourceChannel_' + opt.sourceDevice];
			
			const IP = RegExp(Regex.IP.slice(1, -1));
			const destIp = IP.test(self.selectedDestination.device) ? self.selectedDestination.device : self.findDeviceIpByName(self.selectedDestination.device);
			if (!destIp || !self.devicesData[destIp]?.rx) return false;

			const destChan = self.findRxChannelByName(destIp, self.selectedDestination.channel) ?? self.devicesData[destIp].rx[self.selectedDestination.channel];
			if (!destChan) return false;

			const sourceChannel = self.devicesData[opt.sourceDevice]?.tx?.[selectedSourceChannel] || self.findTxChannelByName(opt.sourceDevice, selectedSourceChannel);
			const normalizeName = (name) => String(name ?? '').trim().toLowerCase();
			const destinationSourceChannelName = normalizeName(destChan?.sourceChannel);
			const sourceChannelCandidates = [selectedSourceChannel, self.getChannelSubscriptionName(sourceChannel), sourceChannel?.name, sourceChannel?.friendlyName]
				.filter(Boolean)
				.map((name) => normalizeName(name));
			if (sourceChannel?.number != undefined) {
				const num = parseInt(sourceChannel.number, 10);
				if (!isNaN(num)) {
					sourceChannelCandidates.push(String(num), String(num).padStart(2, '0'));
				}
			}

			const sourceMatches = sourceChannelCandidates.includes(destinationSourceChannelName);
			const destDevName = normalizeName(destChan?.sourceDevice);
			const srcDevName = normalizeName(self.devicesData[opt.sourceDevice]?.name);
			const deviceMatches = destDevName === srcDevName || (destDevName === '.' && destIp === opt.sourceDevice);
			const subscriptionOk = ([9, 10, 14].includes(destChan?.subscriptionStatus));

			return deviceMatches && sourceMatches && subscriptionOk;
		}
	};
	for (const [ip, device] of Object.entries(self.devicesData)) {
		feedbacks.source_routed_to_selected_destination.options.push({
			type: 'dropdown',
			label: 'Source channel',
			id: 'sourceChannel_' + ip,
			choices: self.txChannelsChoices[device.name],
			isVisibleData: ip,
			isVisible: (options, deviceIp) => options.sourceDevice == deviceIp
		});
	}

	feedbacks['subscription_status'] = {
		type: 'boolean',
		name: 'Subscription Status / Diagnostics',
		description: 'Change button style based on Dante subscription health (Connected, Resolving, Fanout Limit Exceeded, Error)',
		defaultStyle: {
			color: combineRgb(255, 255, 255),
			bgcolor: combineRgb(200, 0, 0), // Red default for errors
		},
		options: [
			{
				type: 'dropdown',
				label: 'Destination Device',
				id: 'destinationDevice',
				choices: self.devicesChoices
			},
			{
				type: 'dropdown',
				label: 'Status Condition',
				id: 'condition',
				default: 'error',
				choices: [
					{ id: 'ok', label: 'Connected / OK (Unicast or Multicast)' },
					{ id: 'pending', label: 'In Progress / Resolving' },
					{ id: 'fanout_limit', label: 'Fanout Limit Reached (No Flows Left)' },
					{ id: 'clock_error', label: 'Clock Domain / Latency Mismatch' },
					{ id: 'format_error', label: 'Format / Rate Mismatch' },
					{ id: 'error', label: 'Any Error / Unresolved' }
				]
			}
		],
		callback: (feedback) => {
			const opt = feedback.options;
			const destChanId = opt['destinationChannel_' + opt.destinationDevice];
			const IP = RegExp(Regex.IP.slice(1, -1));
			const destIp = IP.test(opt.destinationDevice) ? opt.destinationDevice : self.findDeviceIpByName(opt.destinationDevice);
			if (!destIp || !self.devicesData[destIp]?.rx) return false;

			const destChan = self.findRxChannelByName(destIp, destChanId) ?? self.devicesData[destIp].rx[destChanId];
			if (!destChan) return false;

			const status = destChan.subscriptionStatus;
			if (status === undefined || status === 0) return false; // Not subscribed

			switch (opt.condition) {
				case 'ok':
					return [9, 10, 14].includes(status);
				case 'pending':
					return [1, 8].includes(status);
				case 'fanout_limit':
					return status === 37;
				case 'clock_error':
					return [26, 27].includes(status);
				case 'format_error':
					return [16, 17].includes(status);
				case 'error':
				default:
					return ![0, 9, 10, 14].includes(status);
			}
		}
	};
	for (const [ip, device] of Object.entries(self.devicesData)) {
		feedbacks.subscription_status.options.push({
			type: 'dropdown',
			label: 'Destination channel',
			id: 'destinationChannel_' + ip,
			choices: self.rxChannelsChoices[device.name],
			isVisibleData: ip,
			isVisible: (options, deviceIp) => options.destinationDevice == deviceIp
		});
	}
		self.setFeedbackDefinitions(feedbacks);
	}
}
