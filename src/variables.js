module.exports = {
	initVariables: function () {
		let self = this;

		let variables = [];
		
		variables.push({variableId: 'devices', name: 'Dante Devices'});
		variables.push({variableId: 'clock_grandmaster', name: 'Dante Clock Grandmaster Device'});
		variables.push({variableId: 'clock_status', name: 'Dante Clock Status'});
		variables.push({variableId: 'clock_grandmaster_ip', name: 'Dante Clock Grandmaster IP'});
		variables.push({variableId: 'clock_grandmaster_uuid', name: 'Dante Clock Grandmaster UUID'});
		variables.push({variableId: 'selected_destination_device', name: 'Selected Destination Device'});
		variables.push({variableId: 'selected_destination_channel', name: 'Selected Destination Channel'});
		variables.push({variableId: 'selected_destination_source', name: 'Source Routed to Selected Destination'});
		variables.push({variableId: 'selected_destination_status', name: 'Subscription Status of Selected Destination'});
		
		for (const [ip, device] of Object.entries(self.devicesData)) {
			variables.push({variableId: device.name + '_ip', name: 'Ip address of ' + device.name});
			variables.push({variableId: device.name + '_tx', name: 'Number of outputs for ' + device.name});
			variables.push({variableId: device.name + '_tx_names', name: 'Output names for ' + device.name});
			variables.push({variableId: device.name + '_rx', name: 'Number of inputs for ' + device.name});
			variables.push({variableId: device.name + '_rx_names', name: ' Input names for ' + device.name});
			variables.push({variableId: device.name + '_sr', name: 'Sample rate of ' + device.name});
			variables.push({variableId: device.name + '_pullup', name: 'Sample rate pullup of ' + device.name});
			variables.push({variableId: device.name + '_latency', name: 'Latency of ' + device.name + ' (in ms)'});
			variables.push({variableId: device.name + '_encoding', name: 'Encoding of ' + device.name});
			variables.push({variableId: device.name + '_output_levels', name: 'Output levels of ' + device.name});
			variables.push({variableId: device.name + '_model_name', name: 'Model name of ' + device.name});
			variables.push({variableId: device.name + '_product_version', name: 'Product version of ' + device.name});
			variables.push({variableId: device.name + '_clock_role', name: 'Clock role of ' + device.name});
			variables.push({variableId: device.name + '_clock_synced', name: 'Clock sync status of ' + device.name});
		}
			
		self.setVariableDefinitions(variables);
	},

	checkVariables: function (ipAddress, ...variableTypes) {
		let self = this;
		const variableValues = {devices:[]};

		if(!(variableTypes?.length > 0)) {
		  variableTypes = ['ip', 'rx', 'tx', 'rx_names', 'tx_names', 'sr', 'latency', 'encoding', 'output_levels', 'manf', 'clock'];
		}

		for (const [ip, device] of Object.entries(self.devicesData)) { 
			let deviceName = device?.name;
			if (deviceName) {
				variableValues.devices.push(deviceName);
				
				if (ip == ipAddress || !ipAddress) {
					for (let variableType of variableTypes) {
						switch (variableType) {
							case 'devices' :
								if (!variableValues.devices) {
									variableValues.devices = [];
								}
							variableValues.devices.push(deviceName);
							break;
					
							case 'ip' :
								variableValues[deviceName + '_ip'] = ip;
								break;
						
							case 'rx':
							case 'tx':
								variableValues[deviceName + '_' + variableType] = device[variableType]?.count;
								break;
								
							case 'rx_names':
							case 'tx_names':
								let channelArray = variableValues[deviceName + '_' + variableType] = [];
								const channelType = variableType.slice(0, 2);
								for (let i=0; i < device[channelType]?.count; i++) {
									const channel = device[channelType][i+1];
									channelArray[i] = channelType == 'tx' ? self.getChannelSubscriptionName(channel) : channel?.name;
								};
								break;
							
							case 'sr':
							case 'latency':
							case 'encoding':
							case 'pullup':
							case 'output_levels': 
								variableValues[deviceName + '_' + variableType] = device[variableType];
								break;
								
							case 'manf':
								variableValues[deviceName + '_model_name'] = device.modelName; 
								let versionString = device.productVersionString ? device.productVersionString : ''+device.productVersionMajor+'.'+ device.productVersionMinor+ '.'+ device.productVersionPatch;
								variableValues[deviceName + '_product_version'] = versionString;
								break;

							case 'clock':
								if (device.clock) {
									const role = device.clock.isMaster ? 'Leader' : (device.clock.state === 8 ? 'Follower' : (device.clock.state === 1 ? 'Faulty' : 'Unknown'));
									const sync = device.clock.servo === 3 ? 'Locked' : (device.clock.servo === 2 ? 'Syncing' : 'Lost Sync');
									variableValues[deviceName + '_clock_role'] = role;
									variableValues[deviceName + '_clock_synced'] = sync;
								}
								break;
								
						}
					}
				}
			}
		}

		// Update global clock grandmaster variables
		const clockData = self.clockMasterData || {
			masterName: 'Searching...',
			masterIp: 'None',
			masterUuid: 'None',
			status: 'Searching...',
			state: 'unknown'
		};
		variableValues['clock_grandmaster'] = clockData.masterName || 'Searching...';
		variableValues['clock_status'] = clockData.status || 'Searching...';
		variableValues['clock_grandmaster_ip'] = clockData.masterIp || 'None';
		variableValues['clock_grandmaster_uuid'] = clockData.masterUuid || 'None';

		// Update selected destination variables
		if (self.selectedDestination) {
			const selDev = self.selectedDestination.device;
			const selChan = self.selectedDestination.channel;
			const { Regex } = require('@companion-module/base');
			const IP = RegExp(Regex.IP.slice(1, -1));
			const destIp = IP.test(selDev) ? selDev : self.findDeviceIpByName(selDev);
			const devName = self.devicesData[destIp]?.name || selDev;
			const rxChan = self.findRxChannelByName(destIp, selChan) ?? self.devicesData[destIp]?.rx?.[selChan];
			const chanName = rxChan?.friendlyName || rxChan?.name || selChan;

			variableValues['selected_destination_device'] = devName;
			variableValues['selected_destination_channel'] = chanName;

			if (rxChan?.sourceDevice && rxChan?.sourceChannel) {
				variableValues['selected_destination_source'] = `${rxChan.sourceDevice} / ${rxChan.sourceChannel}`;
			} else {
				variableValues['selected_destination_source'] = 'Unrouted';
			}

			const { DANTE_CONST } = require('./const');
			const statusCode = rxChan?.subscriptionStatus ?? 0;
			variableValues['selected_destination_status'] = DANTE_CONST.SUBSCRIPTION_STATUS_NAMES?.[statusCode] || `Status ${statusCode}`;
		} else {
			variableValues['selected_destination_device'] = 'None';
			variableValues['selected_destination_channel'] = 'None';
			variableValues['selected_destination_source'] = 'None';
			variableValues['selected_destination_status'] = 'None';
		}

		try {
			self.setVariableValues(variableValues);
		}
		catch(error) {
			self.log('error', 'Error setting variables: ' + error);
		}
	}
}
