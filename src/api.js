const multidns = require('multicast-dns');
const dgram = require("dgram");
const merge = require("./utils/merge");
const { networkInterfaces } = require('os');
const { InstanceStatus, Regex } = require('@companion-module/base')
const {DANTE_CONST, object2choices} = require("./const");
const { loadCache, saveCache } = require("./cache");
const { METERING_PORT, buildMeteringRequest, buildMeteringStop, parseMeteringFrame } = require('./metering');
const { RouteMonitor, specFromOptions } = require('./route-monitor');



// A device is "online" if we've heard anything from it this recently.
const DEVICE_OFFLINE_MS = 8000;
// Metering streams nobody has looked at for this long are stopped.
const METERING_IDLE_MS = 10000;
// Meter subscriptions are refreshed this often (in 100 ms metering ticks).
const METERING_REFRESH_TICKS = 30;

const compareArrays = (a, b) => {
  return JSON.stringify(a) === JSON.stringify(b);
};

//**
//** utils functions to parse dante messages
//**

const intToBuffer = (number, bytes = 2) => {
	if (bytes < 1 || bytes > 8) {
		return;
	}
	const safeNumber = typeof number === 'bigint' ? number : (parseInt(number, 10) || 0);
    let intBuffer = Buffer.alloc(bytes);
	switch (bytes) {
		case 1:
			intBuffer.writeUInt8(Number(safeNumber) & 0xff);
			break;
		case 2:
		case 3:
			intBuffer.writeUInt16BE(Number(safeNumber), bytes - 2);
			break;
		case 4:
		case 5:
		case 6:
		case 7:
			intBuffer.writeUint32BE(Number(safeNumber), bytes - 4);
			break;
		case 8:
			intBuffer.writeBigUInt64BE(BigInt(safeNumber));
			break;
	}
			
    return intBuffer;
};

const bufferToInt = (buffer, offset = 0, bytes = 2) => {
	if (!buffer || offset < 0 || offset + bytes > buffer.length) {
		return bytes === 8 ? 0n : 0;
	}
	switch (bytes) {
		case 1:
			return buffer.readUInt8(offset);
		case 2:
			return buffer.readUInt16BE(offset);
		case 4:
			return buffer.readUint32BE(offset);
		case 8:
			return buffer.readBigUInt64BE(offset);
	}
};

const incrementBE = (buffer) => {
    for (var i = buffer.length - 1; i >= 0; i--) {
        if (buffer[i]++ !== 255) break;
    }
};

const parseString = (buffer, startIndex) => {
  if (!startIndex || startIndex <= 0 || startIndex >= buffer.length) {
    return '';
  }
  const end = buffer.indexOf(0x00, startIndex);
  if (end === -1) {
    return buffer.toString('utf8', startIndex);
  }
  return buffer.toString('utf8', startIndex, end);
};


//** 
//** Dante messages parsing
//**

const parseChannelCount = (reply) => {
    return { tx: {count: bufferToInt(reply, 12)}, rx: {count: bufferToInt(reply, 14)} };
};

const parseTxFriendlyNames = (reply) => {
	const deviceInfo = {};
	deviceInfo.tx = {};
	
	const recCount = reply[11];
	const startIndex = 12;


	// set offsets
	const infoBufferSize = 6;
	const nameNumberOffset = 2;
	const friendlyNameIndexOffset = 4;
	
	// for each channel
	for (let i = 0; i < Math.min(recCount,32) ; i++) {
		// get info chunk of channel
		const infoIndex = startIndex + (infoBufferSize * i);
		const infoBuffer = reply.slice(infoIndex, infoIndex + infoBufferSize);
		// get channel number and byte index of name
		const nameNumber = bufferToInt(infoBuffer, nameNumberOffset);
		const nameIndex = bufferToInt(infoBuffer, friendlyNameIndexOffset);
		if (!nameNumber) continue;
		
		// create return object if needed
		if (deviceInfo.tx[nameNumber] == undefined) {
			deviceInfo.tx[nameNumber]={};
		}
		let returnChannel = deviceInfo.tx[nameNumber];
		returnChannel.number = nameNumber;
		
		// get name
		returnChannel.friendlyName = parseString(reply, nameIndex);
	}
    return deviceInfo;
}

const parseTxChannels = (reply) => {
	const deviceInfo = {};
	deviceInfo.tx = {};
	
	const recCount = reply[11];
	const startIndex = 12;

// set offsets
	const infoBufferSize = 8;
	const nameNumberOffset = 0;
	const sampleRateOffset = 4;
	const nameIndexOffset = 6;
	
	// for each channel
	for (let i = 0; i < Math.min(recCount,32) ; i++) {
		// get info chunk of channel
		const infoIndex = startIndex + (infoBufferSize * i);
		const infoBuffer = reply.slice(infoIndex, infoIndex + infoBufferSize);
		// get channel number and byte index of name
		const nameNumber = bufferToInt(infoBuffer, nameNumberOffset);
		const nameIndex = bufferToInt(infoBuffer, nameIndexOffset);
		if (!nameNumber) continue;
		
		// create return object if needed
		if (deviceInfo.tx[nameNumber] == undefined) {
			deviceInfo.tx[nameNumber]={};
		}
		let returnChannel = deviceInfo.tx[nameNumber];
		returnChannel.number = nameNumber;
		
		// get name
		const channelName = parseString(reply, nameIndex);
		returnChannel.name = channelName;

		// get sampleRate (each record points at its channel group's audio metadata)
		const sampleRateIndex = bufferToInt(infoBuffer, sampleRateOffset);
		returnChannel.sampleRate = bufferToInt(reply, sampleRateIndex, 4) || undefined;
	}
    return deviceInfo;
}

const parseRxChannels = (reply) => {
	const deviceInfo = {};
	deviceInfo.rx = {};
	
	const recCount = reply[11];
	const startIndex = 12;

// set offsets
	const infoBufferSize = 20;
	const nameNumberOffset = 0;
	const sampleRateOffset = 4;
	const nameIndexOffset = 10; 
	const sourceChannelOffset = 6;
	const sourceDeviceOffset = 8;
	const channelStatusOffset =  12;
	const subscriptionStatusOffset = 14;
	
	// for each channel
	for (let i = 0; i < Math.min(recCount,32) ; i++) {
		// get info chunk of channel
		const infoIndex = startIndex + (infoBufferSize * i);
		const infoBuffer = reply.slice(infoIndex, infoIndex + infoBufferSize);
		// get channel number and byte index of name
		const nameNumber = bufferToInt(infoBuffer, nameNumberOffset);
		const nameIndex = bufferToInt(infoBuffer, nameIndexOffset);
		if (!nameNumber) continue;
		
		// create return object if needed
		if (deviceInfo.rx[nameNumber] == undefined) {
			deviceInfo.rx[nameNumber]={};
		}
		let returnChannel = deviceInfo.rx[nameNumber];
		returnChannel.number = nameNumber;
		
		// get name
		const channelName = parseString(reply, nameIndex);
		returnChannel.name = channelName;
		
		// get routing
		const sourceChannelIndex = bufferToInt(infoBuffer, sourceChannelOffset);
		const sourceDeviceIndex = bufferToInt(infoBuffer, sourceDeviceOffset);
		const sampleRateIndex = bufferToInt(infoBuffer, sampleRateOffset);
		returnChannel.sourceDevice = parseString(reply, sourceDeviceIndex);
		// a zero channel pointer means "the Tx channel with the same name as this Rx channel"
		returnChannel.sourceChannel = sourceChannelIndex
			? parseString(reply, sourceChannelIndex)
			: (returnChannel.sourceDevice ? channelName : '');
		returnChannel.channelStatus = bufferToInt(infoBuffer, channelStatusOffset);
		returnChannel.subscriptionStatus = bufferToInt(infoBuffer, subscriptionStatusOffset);
		returnChannel.sampleRate = bufferToInt(reply, sampleRateIndex, 4) || undefined;
	}
    return deviceInfo;
}

const parseDeviceName = (reply) => {
	return {name: parseString(reply, 10)};
}

const parseDeviceSettings = (reply) => {
	const deviceInfo = {};
	const recCount = reply[11];
	const startIndex = 12;
	const infoBufferSize = 4;
	
	for (let i = 0; i < recCount ; i++) {
		// get info chunk
		const infoIndex = startIndex + (infoBufferSize * i);
		if (infoIndex + infoBufferSize > reply.length) break;
		const infoBuffer = reply.slice(infoIndex, infoIndex + infoBufferSize);
		
		const infoCode = infoBuffer.readUInt16BE(0);
		const valueIndex = infoBuffer.readUInt16BE(2);

		switch (infoCode) {
			case 0x8020:
			// Sample rate
				deviceInfo.sr = (valueIndex + 4 <= reply.length) ? reply.readUInt32BE(valueIndex) : undefined;
				break;
				
			case 0x8301 : 
			// Latency 
				deviceInfo.latency = (valueIndex + 4 <= reply.length) ? reply.readUInt32BE(valueIndex)/1000000 : undefined; 
				break;
		}
	}
	return deviceInfo;
}


//**
//** Module API
//**




module.exports = {

	getChannelSubscriptionName: function (channel) {
		return channel?.friendlyName || channel?.name;
	},

	findDeviceIpByName: function (deviceName) {
		if (!deviceName) return;
		for (const [ip, device] of Object.entries(this.devicesData)) {
			if (device?.name == deviceName) {
				return ip;
			}
		}
		const lowerName = String(deviceName).trim().toLowerCase();
		for (const [ip, device] of Object.entries(this.devicesData)) {
			if (device?.name && device.name.trim().toLowerCase() === lowerName) {
				return ip;
			}
		}
	},

	findTxChannelByName: function (deviceIdentifier, channelName) {
		let device = this.devicesData[deviceIdentifier];
		if (!device) {
			const deviceIp = this.findDeviceIpByName(deviceIdentifier);
			device = this.devicesData[deviceIp];
		}
		if (!device?.tx) {
			return;
		}
		for (const [channelNumber, channel] of Object.entries(device.tx)) {
			if (!isNaN(channelNumber) && (
				channel?.name == channelName ||
				channel?.friendlyName == channelName ||
				channelNumber == channelName ||
				channel?.number == channelName
			)) {
				return channel;
			}
		}
	},
	
	findRxChannelByName: function (deviceIdentifier, channelName) {
		let device = this.devicesData[deviceIdentifier];
		if (!device) {
			const deviceIp = this.findDeviceIpByName(deviceIdentifier);
			device = this.devicesData[deviceIp];
		}
		if (!device?.rx) {
			return;
		}
		for (const [channelNumber, channel] of Object.entries(device.rx)) {
			if (!isNaN(channelNumber) && (
				channel?.name == channelName ||
				channel?.friendlyName == channelName ||
				channelNumber == channelName ||
				channel?.number == channelName
			)) {
				return channel;
			}
		}
	},
	
	// Wrap a socket message handler so one malformed packet can't crash the module.
	safeHandler(label, handler) {
		return (msg, rinfo) => {
			try {
				handler.call(this, msg, rinfo);
			} catch (err) {
				this.log('debug', `${label}: ignored malformed packet from ${rinfo?.address}: ${err?.message || err}`);
			}
		};
	},

	isDeviceOnline(device, now = Date.now()) {
		return Boolean(device?.lastSeen) && now - device.lastSeen <= DEVICE_OFFLINE_MS;
	},

	checkConnections() {
		for (const service of ['ARC', 'CMC']) {
			if (!this.activeConnections[service]) {
				if (this.CONNECTED) {
					this.CONNECTED = false;
					this.updateStatus(InstanceStatus.Disconnected);
				}
				return false;
			}
		}
		if (!this.CONNECTED) {
			this.CONNECTED = true;
			this.updateStatus(InstanceStatus.Ok);
		}
		return true
	},
	
		
	initConnection: function () {
		let self = this;
		this.counter = Buffer.from('0000', 'hex');

		this.debug = this.config.verbose;
		this.timeout = parseInt(this.config.timeoutInterval, 10) || 0;
		if (this.timeout > 0 && this.timeout < 15000) {
			this.timeout = 15000;
		}
		this.activeConnections = {};
		self.updateStatus(InstanceStatus.Connecting);
		
		// close existing sockets and mdns if reconfiguring (tell devices to stop
		// streaming meters to the old socket first)
		this.closeSockets();
		if (this.mdns) {
			try { this.mdns.destroy(); } catch (e) {}
			this.mdns = null;
		}

		// create data object
		self.devicesData = {};
		
		// create actions and feedback dropdown choices
		const cached = loadCache(self.id);
		self.devicesChoices = (cached && Array.isArray(cached.devicesChoices) && cached.devicesChoices.length > 0)
			? cached.devicesChoices
			: [];
		self.txChannelsChoices = (cached && cached.txChannelsChoices && typeof cached.txChannelsChoices === 'object')
			? cached.txChannelsChoices
			: {};
		self.rxChannelsChoices = (cached && cached.rxChannelsChoices && typeof cached.rxChannelsChoices === 'object')
			? cached.rxChannelsChoices
			: {};
		self.meteringSubscriptions = {};
		self.lastSeenByName = self.lastSeenByName || {};
		self.routeMonitor = self.routeMonitor || new RouteMonitor();
		self.pollTick = 0;
		self.monitorTick = 0;
		self.meteringNeedsFeedbackCheck = false;
		self.meteringTickCounter = 0;

		// get available Ips
		const nets = networkInterfaces();
		let availableIps = [];
		let availableMacs = {};
		for (const name of Object.keys(nets)) {
			for (const net of nets[name]) { 
        // Skip over non-IPv4 and internal (i.e. 127.0.0.1) addresses
        // 'IPv4' is in Node <= 17, from 18 it's a number 4 or 6
				const familyV4Value = (typeof net.family === 'string') ? 'IPv4' : 4
				if (net.family === familyV4Value && !net.internal) {
					availableIps.push(net.address);
					availableMacs[net.address] = net.mac;
				}
			}
		}
		
	// create communication sockets
		this.sockets = {};
		
		// create Dante ARC socket
		this.sockets.ARC = dgram.createSocket({type: "udp4", reuseAddr: true});
		const arcSocket = this.sockets.ARC;
		
       	arcSocket.on("message", this.safeHandler('ARC', this.parseReply));
   		arcSocket.on("error", (error)=>{
			self.log('error', 'ARC socket: ' + (error?.message || error));
			self.activeConnections.ARC = false;
			if (self.CONNECTED) {
				self.updateStatus(InstanceStatus.Disconnected);
				self.CONNECTED = false;
			}
		});
		
		arcSocket.on("close", ()=> {
			self.log('warn', 'ARC socket closed');
			self.activeConnections.ARC = false;
			if (self.CONNECTED) {
				self.updateStatus(InstanceStatus.Disconnected);
				self.CONNECTED = false;
			}
		});
		
        arcSocket.on("listening", ()=>{
			self.activeConnections.ARC = true;
			self.checkConnections();
		}); 
		
		let boundIp = self.config.ip;
		if (!availableIps.includes(boundIp)) {
			boundIp = availableIps.find(ip => ip.startsWith('169.254.')) || availableIps[0];
			if (boundIp) {
				self.log('info', `Configured IP (${self.config.ip || 'none'}) not available, auto-selecting interface: ${boundIp}`);
			}
		}
		self.boundIp = boundIp;
		self.localIps = new Set(availableIps);

		// bind socket to random port of configured ip address if available
		if (boundIp) {
			arcSocket.bind(0, boundIp);
			this.mac = Buffer.from((availableMacs[boundIp] || '00:00:00:00:00:00').replaceAll(':',''), 'hex'); 
		} else {
			this.log('warn', "No suitable network interface available");
			arcSocket.bind();
			this.mac = Buffer.from('000000000000', 'hex');
		}


		// create Dante settings socket
		this.sockets.SETTINGS = dgram.createSocket({type: "udp4", reuseAddr: true});
		const settingSocket = this.sockets.SETTINGS;
		settingSocket.on("message", this.safeHandler('SETTINGS', this.parseSettingsReply));
		
  		settingSocket.on("error", (error)=>{
			self.log('warn', 'Settings socket notice: ' + (error?.message || error));
			self.activeConnections.SETTINGS = false;
		});
		
		settingSocket.on("close", ()=> {
			self.log('warn', 'Settings socket closed');
			self.activeConnections.SETTINGS = false;
		});
 
		settingSocket.on ("listening", () => {  
			if (boundIp) {
				try { settingSocket.addMembership(DANTE_CONST.MULTICAST_IP.INFO, boundIp); } catch (e) {}
			} else {
				try { settingSocket.addMembership(DANTE_CONST.MULTICAST_IP.INFO); } catch (e) {}
			}
			self.activeConnections.SETTINGS = true;
		});
		
		try {
			settingSocket.bind(DANTE_CONST.PORTS.INFO);
		} catch (e) {
			self.log('warn', 'Settings socket bind notice: ' + (e?.message || e));
		}
		

		// create Dante CMC socket
		this.sockets.CMC = dgram.createSocket({type: "udp4", reuseAddr: true});
		const cmcSocket = this.sockets.CMC;
		cmcSocket.on("message", this.safeHandler('CMC', this.parseCmcReply));
		
  		cmcSocket.on("error", (error)=>{
			self.log('error', 'CMC socket: ' + (error?.message || error));
			self.activeConnections.CMC = false;
			if (self.CONNECTED) {
				self.updateStatus(InstanceStatus.Disconnected);
				self.CONNECTED = false;
			}
		});
		
		cmcSocket.on("close", ()=> {
			self.log('warn', 'CMC socket closed');
			self.activeConnections.CMC = false;
			if (self.CONNECTED) {
				self.updateStatus(InstanceStatus.Disconnected);
				self.CONNECTED = false;
			}
		});
		
		cmcSocket.on("listening", ()=>{
			self.activeConnections.CMC = true;
			self.checkConnections();
		}); 
		
		if (boundIp) {
			cmcSocket.bind({address: boundIp});
		} else {
			cmcSocket.bind();
		}
		
		
		// create Dante heartbeat socket
		this.sockets.HEARTBEAT = dgram.createSocket({type: "udp4", reuseAddr: true});
		const heartbeatSocket = this.sockets.HEARTBEAT;
		heartbeatSocket.on("message", this.safeHandler('HEARTBEAT', this.parseHeartbeatReply));
		
  		heartbeatSocket.on("error", (error)=>{
			self.log('warn', 'Heartbeat socket notice: ' + (error?.message || error));
			self.activeConnections.HEARTBEAT = false;
		});
		
		heartbeatSocket.on("close", ()=> {
			self.log('warn', 'Heartbeat socket closed');
			self.activeConnections.HEARTBEAT = false;
		});
		
		heartbeatSocket.on ("listening", () => {  
			if (boundIp) {
				try { heartbeatSocket.addMembership(DANTE_CONST.MULTICAST_IP.HEARTBEAT, boundIp); } catch (e) {}
			} else {
				try { heartbeatSocket.addMembership(DANTE_CONST.MULTICAST_IP.HEARTBEAT); } catch (e) {}
			}
			self.activeConnections.HEARTBEAT = true;
		});
		
		try {
			heartbeatSocket.bind(DANTE_CONST.PORTS.HEARTBEAT);
		} catch (e) {
			self.log('warn', 'Heartbeat socket bind notice: ' + (e?.message || e));
		}
		
		// Metering listener. Bound exclusively so a Dante Controller on this computer
		// can't take our stream (or we theirs). If 8751 is taken, any free port works:
		// devices send to whichever port the subscription request names.
		this.meteringPort = null;
		const openMeteringSocket = (port) => {
			const meteringSocket = dgram.createSocket({type: "udp4", reuseAddr: false});
			this.sockets.METERING = meteringSocket;
			meteringSocket.on("message", this.safeHandler('METERING', this.parseMeteringSocketReply));
			meteringSocket.on("error", (err) => {
				if (this.sockets.METERING !== meteringSocket) return;
				if (port !== 0 && err.code === 'EADDRINUSE') {
					self.log('info', `Metering port ${port} is in use (probably Dante Controller); using a free port instead`);
					try { meteringSocket.close(); } catch (e) {}
					openMeteringSocket(0);
					return;
				}
				self.log('warn', 'Metering socket: ' + err.message);
			});
			meteringSocket.on("listening", () => {
				const addr = meteringSocket.address();
				self.meteringPort = addr.port;
				self.log('info', `Metering listener on ${addr.address}:${addr.port}`);
			});
			meteringSocket.bind(port, boundIp || undefined);
		};
		openMeteringSocket(METERING_PORT);

		self.setupInterval(); 
		
		if (boundIp) {
			self.mdns = multidns({ bind: '0.0.0.0', interface: boundIp });
		} else {
			self.mdns = multidns({ bind: '0.0.0.0' });
		}
		self.mdns.on('response', self.dante_discovery.bind(this));
		

		// dante devices discover
		this.getMdnsServices();
	},
	
	
	// add device choice item for actions and feedbacks
	insertDeviceChoice: function (deviceIp, deviceName) {
		this.log('info', `INSERT DEVICE : ${deviceName}, ip : ${deviceIp}`);

		const existing = this.devicesChoices.find(d => d.id === deviceIp);
		if (existing) {
			existing.label = deviceName;
		} else {
			this.devicesChoices.push({id: deviceIp, label: deviceName});
		}
		this.devicesChoices.sort((deviceA, deviceB) => {
				return deviceA.label.localeCompare(deviceB.label);
		});
	},
	
	// update device name in dropdown choice
	updateDeviceChoice: function (deviceIp, deviceName) {
		
		this.log('info', 'UPDATE DEVICE NAME : ' + deviceName);
		
		for (let device of this.devicesChoices) {
			if (device.id == deviceIp) {
			  if (device.label != deviceName) {
			    device.label=deviceName;
				this.devicesChoices.sort((deviceA, deviceB) => {
				  return deviceA.label.localeCompare(deviceB.label);
			    });
				this.updateData();
			  }
			  break;
			}
		}
		
		
	},
	
	
	
	// create or update channels name in dropdown choices for either rx or tx (channelType)
	updateChannelChoices: function(deviceIp, channelType) {
		if (!this.devicesData[deviceIp]?.[channelType]) {
			this.log('error', "ERROR : Can't update channelsChoices for device " + deviceIp);
			return;
		}

		let deviceName = this.devicesData[deviceIp].name;
		let ioObject = this.devicesData[deviceIp][channelType];

		const numKeys = Object.keys(ioObject).map(Number).filter(n => Number.isInteger(n) && n > 0);
		const maxKey = numKeys.length > 0 ? Math.max(...numKeys) : 0;
		const count = Math.max(ioObject.count || 0, maxKey);

		let channelChoice = [{ id: 0, label: 'None' }];
		for (let i = 1; i <= count; i++) {
			const indexString = i.toString().padStart(2, '0');
			let channelName = '';
			if (channelType === 'tx') {
				channelName = this.getChannelSubscriptionName(ioObject[i]) || '';
			} else {
				channelName = ioObject[i]?.friendlyName || ioObject[i]?.name || '';
			}
			const label = (channelName && channelName !== String(i) && channelName !== indexString)
				? `${i}: ${channelName}`
				: `Channel ${i}`;
			channelChoice.push({ id: i, label: label });
		}

		const existing = this[channelType + 'ChannelsChoices'][deviceName];
		let changed = !existing || existing.length !== channelChoice.length;
		if (!changed && existing) {
			for (let i = 0; i < channelChoice.length; i++) {
				if (existing[i]?.id !== channelChoice[i]?.id || existing[i]?.label !== channelChoice[i]?.label) {
					changed = true;
					break;
				}
			}
		}

		if (changed) {
			this[channelType + 'ChannelsChoices'][deviceName] = channelChoice;
			this.updateData();
		}
	},

// register dante device
	registerDevice : function (deviceIp, deviceName) {
		this.devicesData[deviceIp] = {name: deviceName, ports:{}, lastSeen: Date.now()};
		const currDevice = this.devicesData[deviceIp];
		this.lastSeenByName[String(deviceName).toLowerCase()] = currDevice.lastSeen;
		
	// timeout function to destroy reference if device is offline too long
		if ((this.timeout > 0) && !currDevice.timeoutArray) {
			// embed timeout object into array to avoid circular references with merge function
			currDevice.timeoutArray = [setTimeout(() => {this.destroyDevice(deviceIp)}, this.timeout)];
		}
		
		this.insertDeviceChoice(deviceIp, deviceName);
		return currDevice;
	},	


// destroy device registration
	destroyDevice : function (deviceIp) {
		const deviceName = this.devicesData[deviceIp]?.name;
		this.log('warn', `${deviceName} (${deviceIp}) is offline. Destroying references`);
		
		// delete channels name choices
		for (const channelType of ['rx', 'tx']) {
			delete this[channelType+'ChannelsChoices'][deviceName];
		} 

		// delete device choice
		for (let i=0; i < this.devicesChoices.length; i++) {
			if (this.devicesChoices[i].id == deviceIp) {
				this.devicesChoices.splice(i, 1);
				break;
			}
		}
		
		//delete timeout
		clearTimeout(this.devicesData[deviceIp]?.timeoutArray?.[0]);
		
		// delete object from devicesData
		delete this.devicesData[deviceIp];

		this.updateData();
	},
	
	
// keep device from being considered offline
	keepAlive: function (deviceIp) {
		const device = this.devicesData[deviceIp];
		if (device) {
			device.lastSeen = Date.now();
			if (device.name) this.lastSeenByName[String(device.name).toLowerCase()] = device.lastSeen;
		}
		const toArray = device?.timeoutArray;
		if (toArray) {
			clearTimeout(toArray[0]);
			if (this.timeout > 0) {
				toArray[0] = setTimeout(() => {this.destroyDevice(deviceIp)}, this.timeout);
			}
		}
	},
			
	


// function handling incoming dante messages
    parseReply: function(reply, rinfo) {
		const self = this;
        const deviceIp = rinfo.address;
        const replySize = rinfo.size;
        let deviceData = {};
    	let updateFlags = [];

        if (this.debug) {
            // Log replies when in debug mode
            this.log('debug', `ARC : Rx (${reply.length}): ${reply.toString("hex")}`);
        }

          if (bufferToInt(reply, 0) == DANTE_CONST.PROTOCOL.CONTROL && replySize === bufferToInt(reply, 2)){
 
			// network is alive
			if (!this.CONNECTED) {
				this.updateStatus(InstanceStatus.Ok);
				this.CONNECTED = true;
			}
			
			// device is online
			this.keepAlive(deviceIp);

            const commandId = bufferToInt(reply, 6);
			
			deviceData[deviceIp] = {};

			switch (commandId) {
				
				// deviceName
				case DANTE_CONST.COMMANDS.MESSAGE_TYPE_NAME_QUERY :
					deviceData[deviceIp] = parseDeviceName(reply);
					let currDevice = deviceData[deviceIp];

					if (this.devicesData[deviceIp]?.name != currDevice.name) {
						this.updateDeviceChoice(deviceIp, currDevice.name);
						updateFlags.push('name');
					}
					
					
					break;
						
						
				// channelCount	
				case DANTE_CONST.COMMANDS.MESSAGE_TYPE_CHANNEL_COUNTS_QUERY: {
					deviceData[deviceIp] = parseChannelCount(reply);
					let currDevice = deviceData[deviceIp];
					
					// if channel count has changed, retrieve channel names
					if (currDevice.rx.count >0 && currDevice.rx.count != this.devicesData[deviceIp]?.rx?.count) {
						updateFlags.push('rxCount');
					}
					if (currDevice.tx.count >0 && currDevice.tx.count != this.devicesData[deviceIp]?.tx?.count) {
						updateFlags.push('txCount');
					}
					break;
				}
					
				// txChannels
				case DANTE_CONST.COMMANDS.MESSAGE_TYPE_TX_CHANNEL_QUERY : {
					deviceData[deviceIp] = parseTxChannels(reply);
					updateFlags.push('tx');
					break;
				}
							
				// txChannelFriendlyNames
				case DANTE_CONST.COMMANDS.MESSAGE_TYPE_TX_CHANNEL_FRIENDLY_NAMES_QUERY: {
					deviceData[deviceIp] = parseTxFriendlyNames(reply);
					updateFlags.push('tx');
					break;
				}
					
				// rxChannels
				case DANTE_CONST.COMMANDS.MESSAGE_TYPE_RX_CHANNEL_QUERY: {
					deviceData[deviceIp] = parseRxChannels(reply);
					updateFlags.push('rx');
					break;
				}
					
				// device settings 
				case DANTE_CONST.COMMANDS.MESSAGE_TYPE_DEVICE_SETTINGS_QUERY: {
					deviceData[deviceIp] = parseDeviceSettings(reply);
					updateFlags.push('info');
					break;
				}
			}
						
			
//			if (this.debug) {
//				// Log parsed device information when in debug mode
//				console.log('DEVICE DATA : ', deviceData);
//			}
			
			// Channel tables are polled regularly; only react when they actually change.
			const channelSnapshot = (dir) => JSON.stringify(this.devicesData[deviceIp]?.[dir] ?? null);
			const before = { rx: channelSnapshot('rx'), tx: channelSnapshot('tx') };
			this.devicesData = merge(this.devicesData, deviceData);
			// update Channels choices for actions, feedbacks & variables
			
			for (const flag of updateFlags) {
				switch (flag) {
					case 'name' : 
						this.updateData();
						break;
					case 'info':
						this.checkVariables(deviceIp, 'sr', 'latency');
						break;
					case 'rx':
					case 'tx':
						if (channelSnapshot(flag) === before[flag]) break;
						this.checkVariables(deviceIp, flag, flag + '_names');
						this.updateChannelChoices(deviceIp, flag);
						this.checkAllFeedbacks();
						break;
					case 'rxCount':
						this.getRxChannels(deviceIp);
						break;
					case 'txCount':
						this.getTxChannels(deviceIp);
						this.getTxChannelFriendlyNames(deviceIp);
						break;
				}
						
			}
        }
    },


// function handling HEARTBEAT messages
    parseHeartbeatReply: function(reply, rinfo) {
		const self = this;
        const deviceIp = rinfo.address;

        if (this.debug) {
            // Log replies when in debug mode
  //          this.log('debug', `HEARTBEAT : Rx (${reply.length}): ${reply.toString("hex")}`);
        }

          if ((bufferToInt(reply, 0) == DANTE_CONST.PROTOCOL.HEARTBEAT) && (rinfo.size === bufferToInt(reply, 2)) && (parseString(reply, 16) == 'Audinate')) {
 
			// network is alive
			if (!this.CONNECTED) {
				this.updateStatus(InstanceStatus.Ok);
				this.CONNECTED = true;
			}
			
			// device is online
			this.keepAlive(rinfo.address);
			const device = this.devicesData[rinfo.address];
			const mac = reply.slice(8, 14).toString('hex');
			if (device && mac !== '000000000000') device.mac = mac;
        }
    },



// function handling incoming dante setting messages (on settings port)
    parseSettingsReply: function(reply, rinfo) {
        const deviceIp = rinfo.address;
        const replySize = rinfo.size;
        let deviceData = {};
    	let updateFlags = [];

		if (this.debug) {
            // Log replies when in debug mode
            this.log('debug', `SETTINGS : Rx (${reply.length}): ${reply.toString("hex")}`);
        }

		if (bufferToInt(reply, 0) == DANTE_CONST.PROTOCOL.SETTINGS && replySize == bufferToInt(reply, 2)) {
		
			// network is alive
			if (!this.CONNECTED) {
				this.updateStatus(InstanceStatus.Ok);
				this.CONNECTED = true;
			}
			
			// device is online
			this.keepAlive(deviceIp);
			const senderMac = reply.slice(8, 14).toString('hex');
			if (this.devicesData[deviceIp] && senderMac !== '000000000000' && senderMac !== 'ffffffffffff') {
				this.devicesData[deviceIp].mac = senderMac;
			}
			const payload = reply.slice(24);
               const commandId = bufferToInt(payload, 2);
               
			deviceData[deviceIp] = {};
			let currDevice = deviceData[deviceIp];
			
			
			switch (commandId) {
				
				case DANTE_CONST.COMMANDS.MESSAGE_TYPE_ENCODING_STATUS : {
				// get encoding setting
					const enc = bufferToInt(payload, 12, 4);
					const encValue = DANTE_CONST.ENCODINGS[enc] ?? enc;
					currDevice.encoding = encValue;
				// mark flag to update variables
					if (this.devicesData[deviceIp]?.encoding != encValue) {
						updateFlags.push('encoding');
					}
				// get encoding options
					let optionsOffset = bufferToInt(payload, 8);
					const optionsNumber = bufferToInt(payload, 10);
					if (optionsNumber && optionsNumber > 0) {
						currDevice.encodingOptions = [];
						for (let i = 0; i < optionsNumber; i++) {
							currDevice.encodingOptions.push (bufferToInt(payload, optionsOffset, 4).toString());
							optionsOffset += 4;
						}
				// mark flag to update variables
						if (!updateFlags.includes('encodingOptions') && !compareArrays(currDevice.encodingOptions, this.devicesData[deviceIp]?.encodingOptions)) {
							updateFlags.push('encodingOptions');
						}
					}
					break;
				}
					
				case DANTE_CONST.COMMANDS.MESSAGE_TYPE_SAMPLE_RATE_STATUS : {
				// get sample rate setting
					const sr = bufferToInt(payload, 12, 4);
					currDevice.sr = sr;
				// mark flag to update variables
					if (this.devicesData[deviceIp]?.sr != sr) {
						updateFlags.push('sr');
					}
				// get sample rate options
					let optionsOffset = bufferToInt(payload, 8);
					const optionsNumber = bufferToInt(payload, 10);
					if (optionsNumber && optionsNumber > 0) {
						currDevice.srOptions = [];
						for (let i = 0; i < optionsNumber; i++) {
							currDevice.srOptions.push(bufferToInt(payload, optionsOffset, 4).toString());
							optionsOffset += 4;
						}
				// mark flag to update variables
						if (!updateFlags.includes('srOptions') && !compareArrays(currDevice.srOptions, this.devicesData[deviceIp]?.srOptions)) {
							updateFlags.push('srOptions');
						}
					}
					break;
				}
							
				case DANTE_CONST.COMMANDS.MESSAGE_TYPE_SAMPLE_RATE_PULLUP_STATUS : {
				// get pullup setting
					const pullup = bufferToInt(payload, 12, 4);
					currDevice.pullup = DANTE_CONST.PULLUPS[pullup];
					currDevice.pullup_string = parseString(payload, 32);
				// mark flag to update variables
					if (this.devicesData[deviceIp]?.pullup != pullup) {
						updateFlags.push('pullup');
					}
				// get pullup options
					let optionsOffset = bufferToInt(payload, 8);
					const optionsNumber = bufferToInt(payload, 10);
					if (optionsNumber && optionsNumber > 0) {
						currDevice.pullupOptions = [];
						for (let i = 0; i < optionsNumber; i++) {
							currDevice.pullupOptions.push(bufferToInt(payload, optionsOffset, 4).toString());
							optionsOffset += 4;
						}
				// mark flag to update variables
						if (!updateFlags.includes('pullupOptions') && !compareArrays(currDevice.pullupOptions, this.devicesData[deviceIp]?.pullupOptions)) {
							updateFlags.push('pullupOptions');
						}
					}
					break;
				}
				
				case DANTE_CONST.COMMANDS.MESSAGE_TYPE_CODEC_STATUS : {
					// currently only handles AVIO 2out
					const channelCount = 2; 
					currDevice.output_levels = [];
					for (let i = 0; i < channelCount; i++) {
						const level = bufferToInt(payload, 24 + i*4, 4)
						currDevice.output_levels.push(DANTE_CONST.LEVELS[level] ?? level);
					// mark flag to update variables
						if (!updateFlags.includes('output_levels') && !compareArrays(currDevice.output_levels, this.devicesData[deviceIp]?.output_levels)) {
							updateFlags.push('output_levels');
						}
					}
					updateFlags.push('output_levels');
					break;
				}

				case DANTE_CONST.COMMANDS.MESSAGE_TYPE_MANF_VERSIONS_STATUS : {
					currDevice.manfShortName = parseString(payload, 8);
					currDevice.manufacturer = parseString(payload, 52);
					currDevice.modelName = parseString(payload, 180);
					currDevice.softwareVersionMajor = bufferToInt(payload, 32, 1);
					currDevice.softwareVersionMinor = bufferToInt(payload, 33, 1);
					currDevice.softwareVersionPatch = bufferToInt(payload, 34, 2);
					currDevice.softwareVersionBuild = bufferToInt(payload, 44, 4);
					currDevice.productVersionMajor = bufferToInt(payload, 308, 1);
					currDevice.productVersionMinor = bufferToInt(payload, 309, 1);
					currDevice.productVersionPatch = bufferToInt(payload, 310, 2);
					currDevice.productVersionString = parseString(payload, 312); 
					updateFlags.push('manf');
					break;
				}
				
				case DANTE_CONST.COMMANDS.MESSAGE_TYPE_VERSIONS_STATUS : {
					currDevice.danteSoftwareVersionMajor = bufferToInt(payload, 8, 1);
					currDevice.danteSoftwareVersionMinor = bufferToInt(payload, 9, 1);
					currDevice.danteSoftwareVersionPatch = bufferToInt(payload, 10, 2);
					currDevice.danteSoftwareVersionBuild = bufferToInt(payload, 40, 4);
					currDevice.hardwareVersionMajor = bufferToInt(payload, 12, 1);
					currDevice.hardwareVersionMinor = bufferToInt(payload, 13, 1);
					currDevice.hardwareVersionPatch = bufferToInt(payload, 14, 2);
					currDevice.hardwareVersionBuild = bufferToInt(payload, 6, 1);
					currDevice.danteModel = parseString (payload, 64);
					break;
				}
				
				case DANTE_CONST.COMMANDS.MESSAGE_TYPE_RX_CHANNEL_CHANGE : {
					this.getRxChannels(deviceIp);
					break;
				}
					
				case DANTE_CONST.COMMANDS.MESSAGE_TYPE_TX_CHANNEL_CHANGE : {
					this.getTxChannels(deviceIp); 
					this.getTxChannelFriendlyNames(deviceIp); 
					break;
				}
					
				case DANTE_CONST.COMMANDS.MESSAGE_TYPE_TX_LABEL_CHANGE : {
					this.getTxChannelFriendlyNames(deviceIp);
					break;
				}
				
				case DANTE_CONST.COMMANDS.MESSAGE_TYPE_PROPERTY_CHANGE : {
					this.getSettings(deviceIp);
					break;
				}

				case DANTE_CONST.COMMANDS.MESSAGE_TYPE_CLOCKING_STATUS :
				case DANTE_CONST.COMMANDS.MESSAGE_TYPE_CLOCKING_CONTROL : {
					if (payload.length >= 16) {
						const clockState = bufferToInt(payload, 8);
						const servoState = bufferToInt(payload, 10);
						const clockSource = bufferToInt(payload, 12);
						const isPreferred = payload[14] !== 0;
						const clockStratum = payload[15];
						const drift = payload.length >= 20 ? bufferToInt(payload, 16, 4) : 0;

						let uuid = '';
						let masterUuid = '';
						let grandmasterUuid = '';

						if (payload.length >= 28) {
							uuid = payload.slice(20, 28).toString('hex');
						}
						if (payload.length >= 36) {
							masterUuid = payload.slice(28, 36).toString('hex');
						}
						if (payload.length >= 44) {
							grandmasterUuid = payload.slice(36, 44).toString('hex');
						}

						const isMaster = (clockState === 5) || (Boolean(uuid) && Boolean(grandmasterUuid) && uuid === grandmasterUuid);

						currDevice.clock = {
							state: clockState,
							servo: servoState,
							clockSource: clockSource,
							isPreferred: isPreferred,
							stratum: clockStratum,
							drift: drift,
							uuid: uuid,
							masterUuid: masterUuid,
							grandmasterUuid: grandmasterUuid,
							isMaster: isMaster
						};

						updateFlags.push('clock');
					}
					break;
				}

			}
			
			this.devicesData = merge(this.devicesData, deviceData);
			if (updateFlags.includes('clock')) {
				this.updateClockMasterStatus();
			}
			this.checkVariables(deviceIp);
			this.checkVariables(deviceIp, ...updateFlags);

			for (const flag of updateFlags) {
				if (flag.slice(-7) == 'Options') {
					this.initActions()
				break;
				}
			}
		}
	},
	
	
// function handling incoming dante cmc messages (on cmc port)
	parseCmcReply : function (reply, rinfo) {
        const deviceIp = rinfo.address;
        const replySize = rinfo.size;
        let deviceData = {};

		if (this.debug) {
            // Log replies when in debug mode
            this.log('debug', `CMC : Rx Info(${reply.length}): ${reply.toString("hex")}`);
        }

		if (bufferToInt(reply, 0) == DANTE_CONST.PROTOCOL.CMC && replySize == bufferToInt(reply,2)) {
			const commandId = bufferToInt(reply, 6);
			deviceData[deviceIp] = {};
			let currDevice = deviceData[deviceIp];
			
			switch (commandId) {
				case 0x1001 : {
					currDevice.ports = {SETTINGS: bufferToInt(reply, 28)};
					if (reply.length >= 18) currDevice.mac = reply.slice(12, 18).toString('hex');
					
					const deviceId = this.devicesData[deviceIp]?.name ?? deviceIp;
					this.log('info', `Port for service SETTINGS of device ${deviceId} is : ${bufferToInt(reply, 28)}`);

					this.devicesData = merge(this.devicesData, deviceData); 
					this.checkVariables(deviceIp); 
					this.refreshSettings(deviceIp);
					break;
				}
			}
			
			this.checkVariables();
		}
	},
	
	

// send dante command to the correct port, according to service id
    sendCommand(command, host, service = "ARC", forcePort) {
        if (this.debug) {
            // Log sent bytes when in debug mode
            this.log('debug', `${service} : Tx (${command.length}): ${command.toString("hex")}`);
        }
		
		// find port
//		if (!port) {
//			if (!this.devicesData[host]?.ports) { 
//				port = DANTE_CONST.PORTS[service];
//			} else {
//				port = this.devicesData[host].ports[service] ?? DANTE_CONST.PORTS[service];
//			}
//		}

		const port = forcePort ?? this.devicesData?.[host]?.ports?.[service] ?? DANTE_CONST.PORTS[service];
		if (port) {	
			this.sockets[service]?.send(command, 0, command.length, port, host); 
		} else {
			const deviceId = this.devicesData[host]?.name ?? host;
			this.log('debug', `Undefined port for service ${service} for device ${deviceId}`); return;
		}
    },



	
// create Dante message
    makeCommand(commandType, commandArguments = Buffer.alloc(2)) {

        const requestFlag = Buffer.from([0x00, 0x00]);
        const commandLength = intToBuffer(commandArguments.length + 11);

		const payload = Buffer.concat([
			intToBuffer(DANTE_CONST.PROTOCOL.CONTROL),
            commandLength,
            this.counter,
            intToBuffer(commandType),
            requestFlag,
            commandArguments,
			Buffer.from([0x00])
        ]);

		incrementBE(this.counter);

        return payload;
    },


	makeSettingCommand(commandType, commandArguments = Buffer.alloc(2)) {
		let commandLength = intToBuffer(commandArguments.length + 28);
		const startBlock = Buffer.from('2a84', "hex");

		const payload = Buffer.concat([
			intToBuffer(DANTE_CONST.PROTOCOL.SETTINGS),
			commandLength,
			this.counter,
			startBlock,
			this.mac,
			Buffer.from('0000', 'hex'),
			DANTE_CONST.AUDINATE_BUFFER,
			intToBuffer(commandType),
			commandArguments
		]);
			
		incrementBE(this.counter);

		return payload;
	},

//**
//** Specific Dante messages
//**

    resetDeviceName(ipaddress) {
        const commandBuffer = this.makeCommand(DANTE_CONST.COMMANDS.setDeviceName);
        this.sendCommand(commandBuffer, ipaddress);
    },

    setDeviceName(ipaddress, name) {
        try {
            const commandBuffer = this.makeCommand(DANTE_CONST.COMMANDS.setDeviceName, Buffer.from(String(name || ''), "ascii"));
            this.sendCommand(commandBuffer, ipaddress);
        } catch (err) {
            this.log('error', `Error setting device name: ${err?.message || err}`);
        }
    },

    setChannelName(ipaddress, channelName = "", channelType = "rx", channelNumber = 0) {
        try {
            const channelNameBuffer = Buffer.from(String(channelName || ''), "ascii");
            let commandBuffer = Buffer.alloc(1);
            let channelNumberBuffer = intToBuffer(parseInt(channelNumber, 10) || 0); 

            if (channelType === "rx") {
                const commandArguments = Buffer.concat([
                    Buffer.from("0401", "hex"),
                    channelNumberBuffer,
                    Buffer.from("001c", "hex"),
                    Buffer.alloc(12),
                    channelNameBuffer,
                ]);
                commandBuffer = this.makeCommand(DANTE_CONST.COMMANDS.MESSAGE_TYPE_RX_CHANNEL_CONTROL, commandArguments);
            } else if (channelType === "tx") {
                const commandArguments = Buffer.concat([
                    Buffer.from("04010000", "hex"),
                    channelNumberBuffer,
                    Buffer.from("0024", "hex"),
                    Buffer.alloc(18),
                    channelNameBuffer,
                ]);
                commandBuffer = this.makeCommand(DANTE_CONST.COMMANDS.MESSAGE_TYPE_TX_CHANNEL_NAMES_CONTROL, commandArguments);
            } else {
                throw new Error("Invalid Channel Type - must be 'tx' or 'rx'");
            }
            this.sendCommand(commandBuffer, ipaddress);
        } catch (err) {
            this.log('error', `Error setting channel name: ${err?.message || err}`);
        }
    },
	
   setRxChannelName(ipaddress, channelNumber, channelName = "") {
        try {
            const channelNameBuffer = Buffer.from(String(channelName || ''), "ascii");
            let commandBuffer = Buffer.alloc(1);
            let channelNumberBuffer = intToBuffer(parseInt(channelNumber, 10) || 0); 

            const commandArguments = Buffer.concat([
                Buffer.from("0401", "hex"),
                channelNumberBuffer,
                Buffer.from("001c", "hex"),
                Buffer.alloc(12),
                channelNameBuffer,
            ]);
            commandBuffer = this.makeCommand(DANTE_CONST.COMMANDS.MESSAGE_TYPE_RX_CHANNEL_CONTROL, commandArguments);
            this.sendCommand(commandBuffer, ipaddress);
        } catch (err) {
            this.log('error', `Error setting RX channel name: ${err?.message || err}`);
        }
    },

    setTxChannelName(ipaddress, channelNumber, channelName = "") {
        try {
            const channelNameBuffer = Buffer.from(String(channelName || ''), "ascii");
            let commandBuffer = Buffer.alloc(1);
            let channelNumberBuffer = intToBuffer(parseInt(channelNumber, 10) || 0); 

            const commandArguments = Buffer.concat([
                Buffer.from("04010000", "hex"),
                channelNumberBuffer,
                Buffer.from("0024", "hex"),
                Buffer.alloc(18),
                channelNameBuffer,
            ]);
            commandBuffer = this.makeCommand(DANTE_CONST.COMMANDS.MESSAGE_TYPE_TX_CHANNEL_NAMES_CONTROL, commandArguments);

            this.sendCommand(commandBuffer, ipaddress);
        } catch (err) {
            this.log('error', `Error setting TX channel name: ${err?.message || err}`);
        }
    },

    resetChannelName(ipaddress, channelType = "rx", channelNumber = 0) {
        this.setChannelName(ipaddress, "", channelType, channelNumber);
    },

    resetRxChannelName(ipaddress, channelNumber = 0) {
        this.setRxChannelName(ipaddress, channelNumber);
    },
	
    resetTxChannelName(ipaddress, channelNumber = 0) {
        this.setTxChannelName(ipaddress, channelNumber);
    },



    makeCrosspoint(destinationDevice, sourceChannelName, sourceDeviceName, destinationChannel) {
		try {
			if (!destinationDevice || destinationDevice === '') {
				this.log('warn', 'Make Crosspoint aborted: No destination device specified');
				return;
			}
			if (!sourceDeviceName || sourceDeviceName === '') {
				this.log('warn', 'Make Crosspoint aborted: No source device specified');
				return;
			}
			if (destinationChannel === undefined || destinationChannel === null || destinationChannel === '' || destinationChannel === 0 || destinationChannel === '0') {
				this.log('warn', 'Make Crosspoint aborted: No destination channel specified');
				return;
			}
			if (sourceChannelName === undefined || sourceChannelName === null || sourceChannelName === '' || sourceChannelName === 0 || sourceChannelName === '0') {
				this.log('warn', 'Make Crosspoint aborted: No source channel specified');
				return;
			}

			// Check if destinationDevice is an IP or a name
			const IP = RegExp(Regex.IP.slice(1,-1));
			const ipaddress = IP.test(destinationDevice) ? destinationDevice : this.findDeviceIpByName(destinationDevice);
			
			if (!ipaddress) {
				this.log('error', "Can't find " + destinationDevice + " IP address");
				return;
			}

			let destChanNum = this.findRxChannelByName(destinationDevice, destinationChannel)?.number ?? destinationChannel;
			destChanNum = parseInt(destChanNum, 10);
			if (isNaN(destChanNum) || destChanNum <= 0) {
				this.log('warn', `Make Crosspoint: Invalid destination channel "${destinationChannel}" for ${destinationDevice}`);
				return;
			}

			// Resolve canonical source device name (must be Dante advertised name, not IP)
			let canonicalSourceDeviceName = sourceDeviceName;
			if (this.devicesData[sourceDeviceName]?.name) {
				canonicalSourceDeviceName = this.devicesData[sourceDeviceName].name;
			} else {
				canonicalSourceDeviceName = String(sourceDeviceName).trim();
			}

			// Resolve canonical source channel subscription name
			const sourceChannel = this.findTxChannelByName(canonicalSourceDeviceName, sourceChannelName) 
				|| this.findTxChannelByName(sourceDeviceName, sourceChannelName);
			
			let sourceSubscriptionName = this.getChannelSubscriptionName(sourceChannel) || sourceChannelName;

			// If sourceSubscriptionName is numeric (e.g. 1 or "1"), format properly
			const numericTxChan = parseInt(sourceSubscriptionName, 10);
			if (!isNaN(numericTxChan) && String(numericTxChan) === String(sourceSubscriptionName).trim()) {
				const srcDevObj = this.devicesData[sourceDeviceName] || this.devicesData[this.findDeviceIpByName(canonicalSourceDeviceName)];
				if (srcDevObj?.tx?.[numericTxChan]?.friendlyName) {
					sourceSubscriptionName = srcDevObj.tx[numericTxChan].friendlyName;
				} else if (srcDevObj?.tx?.[numericTxChan]?.name) {
					sourceSubscriptionName = srcDevObj.tx[numericTxChan].name;
				} else {
					sourceSubscriptionName = numericTxChan.toString().padStart(2, '0');
				}
			}

			sourceSubscriptionName = String(sourceSubscriptionName || '');
			canonicalSourceDeviceName = String(canonicalSourceDeviceName || '');

			if (!sourceSubscriptionName || !canonicalSourceDeviceName) {
				this.log('warn', 'Make Crosspoint aborted: Invalid source channel name or source device name');
				return;
			}

			const sourceChannelNameBuffer = Buffer.from(sourceSubscriptionName, "ascii");
			const sourceDeviceNameBuffer = Buffer.from(canonicalSourceDeviceName, "ascii");

			// 10 bytes DGCP header + 2 bytes count + 6 bytes entry + 4 bytes padding = 22
			const chanNameOffset = 22;
			const devNameOffset = chanNameOffset + sourceChannelNameBuffer.length + 1;

			let commandArguments = Buffer.concat([
				intToBuffer(1, 2), 									// 1 channel subscription
				intToBuffer(destChanNum, 2),			            // destination channel number
				intToBuffer(chanNameOffset, 2), 					// Byte index of source channel Name
				intToBuffer(devNameOffset, 2), 						// Byte index of source device name
				Buffer.alloc(4),									// 4-byte padding
				sourceChannelNameBuffer,							// source channel Name
				Buffer.alloc(1),									// null terminator (\x00)
				sourceDeviceNameBuffer,								// source device name
				Buffer.alloc(1)										// null terminator (\x00)
			]);

			const commandBuffer = this.makeCommand(DANTE_CONST.COMMANDS.subscription, commandArguments);
			this.sendCommand(commandBuffer, ipaddress);

			setTimeout(() => {
				try {
					this.getRxChannels(ipaddress);
				} catch (e) {
					this.log('debug', `Error refreshing RX channels after makeCrosspoint: ${e?.message}`);
				}
			}, 300);
		} catch (err) {
			this.log('error', `Error in makeCrosspoint: ${err?.message || err}`);
		}
    },

    clearCrosspoint(destinationDevice, destinationChannel) {
		try {
			if (!destinationDevice || destinationDevice === '') {
				this.log('warn', 'Clear Crosspoint aborted: No destination device specified');
				return;
			}
			if (destinationChannel === undefined || destinationChannel === null || destinationChannel === '' || destinationChannel === 0 || destinationChannel === '0') {
				this.log('warn', 'Clear Crosspoint aborted: No destination channel specified');
				return;
			}

			const IP = RegExp(Regex.IP.slice(1,-1));
			const ipaddress = IP.test(destinationDevice) ? destinationDevice : this.findDeviceIpByName(destinationDevice);
			
			if (!ipaddress) {
				this.log('error', "Can't find " + destinationDevice + " IP address");
				return;
			}

			let destChanNum = this.findRxChannelByName(destinationDevice, destinationChannel)?.number ?? destinationChannel;
			destChanNum = parseInt(destChanNum, 10);
			if (isNaN(destChanNum) || destChanNum <= 0) {
				this.log('warn', `Clear Crosspoint: Invalid destination channel "${destinationChannel}" for ${destinationDevice}`);
				return;
			}
			
			// Clean Audinate unsubscription: tx_chan offset = 0, tx_device offset = 0
			let commandArguments = Buffer.concat([
				intToBuffer(1, 2), 									// 1 channel subscription
				intToBuffer(destChanNum, 2),			            // destination channel number
				Buffer.from("00000000", "hex"),						// null string offsets (unsubscribes channel)
				Buffer.alloc(4),									// 4-byte padding
			]);

			const commandBuffer = this.makeCommand(DANTE_CONST.COMMANDS.subscription, commandArguments);
			this.sendCommand(commandBuffer, ipaddress);

			setTimeout(() => {
				try {
					this.getRxChannels(ipaddress);
				} catch (e) {
					this.log('debug', `Error refreshing RX channels after clearCrosspoint: ${e?.message}`);
				}
			}, 300);
		} catch (err) {
			this.log('error', `Error in clearCrosspoint: ${err?.message || err}`);
		}
    },

	makeBatchCrosspoint(destinationDevice, routes) {
		try {
			if (!Array.isArray(routes) || routes.length === 0) return;

			const IP = RegExp(Regex.IP.slice(1,-1));
			const ipaddress = IP.test(destinationDevice) ? destinationDevice : this.findDeviceIpByName(destinationDevice);
			if (!ipaddress) {
				this.log('error', "Can't find " + destinationDevice + " IP address");
				return;
			}

			// DGCP header = 10 bytes, count = 2 bytes, each entry = 6 bytes
			const entriesHeaderSize = 10 + 2 + (routes.length * 6);
			// Add 4 bytes padding after entries table
			let currentStringOffset = entriesHeaderSize + 4;

			let entriesBuffers = [];
			let stringPoolBuffers = [];

			for (const route of routes) {
				let rxNum = this.findRxChannelByName(destinationDevice, route.destinationChannel)?.number ?? route.destinationChannel;
				rxNum = parseInt(rxNum, 10);
				if (isNaN(rxNum) || rxNum <= 0) continue;

				const isUnsubscribe = !route.sourceDeviceName || !route.sourceChannelName;

				if (isUnsubscribe) {
					entriesBuffers.push(Buffer.concat([
						intToBuffer(rxNum, 2),
						Buffer.from("00000000", "hex")
					]));
				} else {
					let srcDevName = route.sourceDeviceName;
					if (this.devicesData[srcDevName]?.name) {
						srcDevName = this.devicesData[srcDevName].name;
					} else {
						srcDevName = String(srcDevName).trim();
					}

					const txChan = this.findTxChannelByName(srcDevName, route.sourceChannelName) || this.findTxChannelByName(route.sourceDeviceName, route.sourceChannelName);
					let subChanName = this.getChannelSubscriptionName(txChan) || route.sourceChannelName;

					const numericTxChan = parseInt(subChanName, 10);
					if (!isNaN(numericTxChan) && String(numericTxChan) === String(subChanName).trim()) {
						const srcDevObj = this.devicesData[route.sourceDeviceName] || this.devicesData[this.findDeviceIpByName(srcDevName)];
						if (srcDevObj?.tx?.[numericTxChan]?.friendlyName) {
							subChanName = srcDevObj.tx[numericTxChan].friendlyName;
						} else if (srcDevObj?.tx?.[numericTxChan]?.name) {
							subChanName = srcDevObj.tx[numericTxChan].name;
						} else {
							subChanName = numericTxChan.toString().padStart(2, '0');
						}
					}

					subChanName = String(subChanName || '');
					srcDevName = String(srcDevName || '');

					const chanBuf = Buffer.from(subChanName, "ascii");
					const devBuf = Buffer.from(srcDevName, "ascii");

					const chanOffset = currentStringOffset;
					currentStringOffset += chanBuf.length + 1;
					const devOffset = currentStringOffset;
					currentStringOffset += devBuf.length + 1;

					entriesBuffers.push(Buffer.concat([
						intToBuffer(rxNum, 2),
						intToBuffer(chanOffset, 2),
						intToBuffer(devOffset, 2)
					]));

					stringPoolBuffers.push(chanBuf, Buffer.alloc(1), devBuf, Buffer.alloc(1));
				}
			}

			if (entriesBuffers.length === 0) return;

			let commandArguments = Buffer.concat([
				intToBuffer(entriesBuffers.length, 2),
				...entriesBuffers,
				Buffer.alloc(4),
				...stringPoolBuffers
			]);

			const commandBuffer = this.makeCommand(DANTE_CONST.COMMANDS.subscription, commandArguments);
			this.sendCommand(commandBuffer, ipaddress);

			setTimeout(() => {
				try {
					this.getRxChannels(ipaddress);
				} catch (e) {
					this.log('debug', `Error refreshing RX channels after makeBatchCrosspoint: ${e?.message}`);
				}
			}, 300);
		} catch (err) {
			this.log('error', `Error in makeBatchCrosspoint: ${err?.message || err}`);
		}
	},

	clearBatchCrosspoint(destinationDevice, destinationChannels) {
		try {
			if (!Array.isArray(destinationChannels) || destinationChannels.length === 0) return;
			const routes = destinationChannels.map(ch => ({ destinationChannel: ch, sourceDeviceName: null, sourceChannelName: null }));
			this.makeBatchCrosspoint(destinationDevice, routes);
		} catch (err) {
			this.log('error', `Error in clearBatchCrosspoint: ${err?.message || err}`);
		}
	},

	selectDestination(device, channel) {
		this.selectedDestination = {
			device: device,
			channel: channel,
		};
		this.checkFeedbacks('selected_destination', 'source_routed_to_selected_destination');
		this.checkVariables();
	},

	routeSourceToSelectedDestination(sourceDevice, sourceChannel) {
		if (!this.selectedDestination || !this.selectedDestination.device || !this.selectedDestination.channel) {
			this.log('warn', 'No destination currently selected to route to');
			return;
		}
		this.makeCrosspoint(this.selectedDestination.device, sourceChannel, sourceDevice, this.selectedDestination.channel);
	},

	clearSelectedDestination() {
		if (!this.selectedDestination || !this.selectedDestination.device || !this.selectedDestination.channel) {
			this.log('warn', 'No destination currently selected to clear');
			return;
		}
		this.clearCrosspoint(this.selectedDestination.device, this.selectedDestination.channel);
	},



    getChannelCount(ipaddress) {
        const commandBuffer = this.makeCommand(DANTE_CONST.COMMANDS.channelCount);
        this.sendCommand(commandBuffer, ipaddress);

        return this.devicesData[ipaddress]?.channelCount;
    },

	getTxChannelFriendlyNames(ipaddress) {
		if (!this.devicesData[ipaddress]) { 
			return
		}
		// clear registered friendly names
		const txCount = this.devicesData[ipaddress]?.tx?.count || 16;
		for (let i = 1; i <= txCount; i++) {
			const channel = this.devicesData[ipaddress]?.tx?.[i];
			if (channel) {
				delete channel.friendlyName;
			}
		}
		let commandArguments = Buffer.from("0001000100", "hex");
		const maxPages = Math.ceil(txCount / 32);
		for (let page = 0; page < maxPages; page++) {
			commandArguments.writeUInt8(page * 32 + 1, 3);
			const commandBuffer = this.makeCommand(DANTE_CONST.COMMANDS.MESSAGE_TYPE_TX_CHANNEL_FRIENDLY_NAMES_QUERY, commandArguments);
			this.sendCommand(commandBuffer, ipaddress); 
		}
	},
	
	getTxChannels (ipaddress) {
		let commandArguments = Buffer.from("0001000100", "hex");
		const txCount = this.devicesData[ipaddress]?.tx?.count || 16;
		const maxPages = Math.ceil(txCount / 32);
		for (let page = 0; page < maxPages; page++) {
			commandArguments.writeUInt8(page * 32 + 1, 3);
			const commandBuffer = this.makeCommand(DANTE_CONST.COMMANDS.MESSAGE_TYPE_TX_CHANNEL_QUERY, commandArguments);
			this.sendCommand(commandBuffer, ipaddress);
		}
	},
	
	getRxChannels (ipaddress) {
		let commandArguments = Buffer.from("0001000100", "hex");
		const rxCount = this.devicesData[ipaddress]?.rx?.count || 16;
		const maxPages = Math.ceil(rxCount / 16);
		for (let page = 0; page < maxPages; page++) {
			commandArguments.writeUInt8(page * 16 + 1, 3);
			const commandBuffer = this.makeCommand(DANTE_CONST.COMMANDS.MESSAGE_TYPE_RX_CHANNEL_QUERY, commandArguments);
			this.sendCommand(commandBuffer, ipaddress);
		}
	},

	getDeviceName(ipaddress) {
		const commandBuffer = this.makeCommand(DANTE_CONST.COMMANDS.MESSAGE_TYPE_NAME_QUERY);
		this.sendCommand(commandBuffer, ipaddress);
	},
	
	getSettings(ipaddress) {
		const commandBuffer = this.makeCommand(DANTE_CONST.COMMANDS.MESSAGE_TYPE_DEVICE_SETTINGS_QUERY)
		this.sendCommand(commandBuffer, ipaddress);
	},
	
	
	setLatency(ipaddress, latency) {
		let commandArguments = Buffer.from("050382050020021100108301002400000000000000000000000000000000", "hex");
		commandArguments.writeUInt32BE(latency*1000000,22);
		commandArguments.writeUInt32BE(latency*1000000,26);
		const commandBuffer = this.makeCommand(DANTE_CONST.COMMANDS.MESSAGE_TYPE_DEVICE_SETTINGS_CONTROL, commandArguments)
		this.sendCommand(commandBuffer, ipaddress);
	},

	setSampleRate(ipaddress, sampleRate) {
		const flag = intToBuffer(sampleRate > 0 ? 1 : 0, 4);
		const commandArguments = Buffer.concat ([
			Buffer.from ('00000064', 'hex'),
			flag,
			intToBuffer(sampleRate, 4)
			]);
		const commandBuffer = this.makeSettingCommand(DANTE_CONST.COMMANDS.MESSAGE_TYPE_SAMPLE_RATE_CONTROL, commandArguments); 
		this.sendCommand(commandBuffer, ipaddress, 'SETTINGS');
	},	
	
	getSampleRate (ipaddress) {
		this.setSampleRate(ipaddress, 0)
	},
	
	setPullup (ipaddress, pullup) {
		const flag = intToBuffer(3, 4);
		const commandArguments = Buffer.concat ([
			Buffer.from ('00000064', 'hex'),
			flag,
			intToBuffer(pullup, 4),
			intToBuffer(0, 2)
			]);
		const commandBuffer = this.makeSettingCommand(DANTE_CONST.COMMANDS.MESSAGE_TYPE_SAMPLE_RATE_PULLUP_CONTROL, commandArguments); 
		this.sendCommand(commandBuffer, ipaddress, 'SETTINGS');
	},
	
	getPullup (ipaddress) {
		const flag = intToBuffer(0, 4);
		const commandArguments = Buffer.concat ([
			Buffer.from ('00000064', 'hex'),
			flag,
			intToBuffer(0, 4)
			]);
		const commandBuffer = this.makeSettingCommand(DANTE_CONST.COMMANDS.MESSAGE_TYPE_SAMPLE_RATE_PULLUP_CONTROL, commandArguments); 
		this.sendCommand(commandBuffer, ipaddress, 'SETTINGS');
	},
	
	setEncoding(ipaddress, encoding) {
		const flag = intToBuffer(encoding >0 ? 1 : 0, 4);
		const commandArguments = Buffer.concat ([
			Buffer.from ('00000064', 'hex'),
			flag,
			intToBuffer(encoding, 4)
			]);

		const commandBuffer = this.makeSettingCommand(DANTE_CONST.COMMANDS.MESSAGE_TYPE_ENCODING_CONTROL, commandArguments); 
		this.sendCommand(commandBuffer, ipaddress, 'SETTINGS');
	},

	getEncoding(ipaddress) {
		this.setEncoding(ipaddress, 0);
	},

	setLevel(ipaddress, direction= 'out', channelNumber, levelSetting) {
		const commandArguments = Buffer.concat ([
			Buffer.from('00000000', 'hex'),
			Buffer.from('00010001', 'hex'),
			Buffer.from('000c0010', 'hex'),
			Buffer.from('02010000', 'hex'),
			intToBuffer(channelNumber, 4),
			intToBuffer(levelSetting, 4)
		]);
		
		const commandBuffer = this.makeSettingCommand(DANTE_CONST.COMMANDS.MESSAGE_TYPE_CODEC_CONTROL, commandArguments);
		this.sendCommand(commandBuffer, ipaddress, 'SETTINGS');
	},
	
	getLevel(ipaddress) {
		const commandBuffer = this.makeSettingCommand(DANTE_CONST.COMMANDS.MESSAGE_TYPE_CODEC_CONTROL, intToBuffer(0, 4));
		this.sendCommand(commandBuffer, ipaddress, 'SETTINGS');
	},

	getManfVersion(ipaddress) {
		const commandBuffer = this.makeSettingCommand(DANTE_CONST.COMMANDS.MESSAGE_TYPE_MANF_VERSIONS_QUERY, intToBuffer(0, 4));
		this.sendCommand(commandBuffer, ipaddress, 'SETTINGS');
	},
	
	getVersion(ipaddress) {
		const commandBuffer = this.makeSettingCommand(DANTE_CONST.COMMANDS.MESSAGE_TYPE_VERSIONS_QUERY, intToBuffer(0, 4));
		this.sendCommand(commandBuffer, ipaddress, 'SETTINGS');
	},

	getClocking(ipaddress) {
		const commandBuffer = this.makeSettingCommand(DANTE_CONST.COMMANDS.MESSAGE_TYPE_CLOCKING_STATUS, intToBuffer(0, 4));
		this.sendCommand(commandBuffer, ipaddress, 'SETTINGS');
	},

	refreshClock(deviceIp) {
		const ipArray = deviceIp ? [deviceIp] : Object.keys(this.devicesData);
		for (const ip of ipArray) {
			this.getClocking(ip);
		}
	},

	nextSequence() {
		const seq = this.counter.readUInt16BE(0);
		incrementBE(this.counter);
		return seq;
	},

	// Ask a device to stream its meters to us. Metering feedbacks call this each time
	// they render; streams are refreshed while wanted and stopped once unused.
	subscribeMetering(deviceIp) {
		if (!deviceIp) return;
		this.meteringSubscriptions = this.meteringSubscriptions || {};
		let sub = this.meteringSubscriptions[deviceIp];
		if (!sub) {
			sub = this.meteringSubscriptions[deviceIp] = { wantedAt: 0, sentAt: 0, deviceName: null };
		}
		sub.wantedAt = Date.now();
		if (!sub.sentAt) this.sendMeteringRequest(deviceIp, sub);
	},

	sendMeteringRequest(deviceIp, sub) {
		const device = this.devicesData[deviceIp];
		if (!device?.name || !this.meteringPort || !this.boundIp || !this.isDeviceOnline(device)) return;
		if (sub.deviceName && sub.deviceName !== device.name) this.sendMeteringStop(deviceIp, sub);
		const packet = buildMeteringRequest(this.nextSequence(), {
			deviceName: device.name,
			subscriberIp: this.boundIp,
			mac: this.mac,
			port: this.meteringPort,
		});
		this.sendCommand(packet, deviceIp, 'CMC');
		if (!sub.sentAt) this.log('info', `Subscribing to metering for ${device.name} (${deviceIp})`);
		sub.sentAt = Date.now();
		sub.deviceName = device.name;
	},

	sendMeteringStop(deviceIp, sub) {
		if (!sub?.sentAt || !sub.deviceName || !this.meteringPort) return;
		const packet = buildMeteringStop(this.nextSequence(), { deviceName: sub.deviceName, mac: this.mac, port: this.meteringPort });
		this.sendCommand(packet, deviceIp, 'CMC');
		sub.sentAt = 0;
	},

	unsubscribeMetering(deviceIp) {
		const sub = this.meteringSubscriptions?.[deviceIp];
		if (!sub) return;
		this.sendMeteringStop(deviceIp, sub);
		delete this.meteringSubscriptions[deviceIp];
	},

	stopAllMetering() {
		for (const ip of Object.keys(this.meteringSubscriptions || {})) {
			this.unsubscribeMetering(ip);
		}
	},

	// Close sockets, giving queued sends (metering unsubscribes) a moment to leave.
	closeSockets() {
		if (!this.sockets) return;
		if (this.sockets.CMC) this.stopAllMetering();
		const old = this.sockets;
		this.sockets = {};
		for (const [name, socket] of Object.entries(old)) {
			if (name === 'CMC') continue;
			try { socket.close(); } catch (e) {}
		}
		if (old.CMC) {
			setTimeout(() => {
				try { old.CMC.close(); } catch (e) {}
			}, 250);
		}
	},

	parseMeteringSocketReply(reply, rinfo) {
		const frame = parseMeteringFrame(reply);
		const device = this.devicesData[rinfo.address];
		if (!frame || !device) return;
		this.keepAlive(rinfo.address);
		if (!device.metering) device.metering = { tx: {}, rx: {} };

		const now = Date.now();
		const record = (direction, levels) => {
			const meters = device.metering[direction];
			levels.forEach((peak, i) => {
				const prevHold = meters[i + 1]?.peakHold ?? 254;
				meters[i + 1] = { peak, peakHold: Math.min(peak, prevHold), updatedAt: now };
			});
		};
		record('tx', frame.tx);
		record('rx', frame.rx);
		this.meteringNeedsFeedbackCheck = true;
	},

	processMeteringTick() {
		const now = Date.now();
		this.meteringTickCounter = (this.meteringTickCounter || 0) + 1;

		// 1. Refresh wanted streams; stop ones no feedback has asked for recently.
		if (this.meteringTickCounter % METERING_REFRESH_TICKS === 0) {
			for (const [ip, sub] of Object.entries(this.meteringSubscriptions || {})) {
				if (now - sub.wantedAt > METERING_IDLE_MS) {
					this.unsubscribeMetering(ip);
				} else {
					this.sendMeteringRequest(ip, sub);
				}
			}
			// Re-run meter feedbacks so they renew their interest (and re-subscribe
			// to devices that have come back online).
			this.meteringNeedsFeedbackCheck = true;
		}

		// 2. Slowly decay peak hold for active channels
		for (const dev of Object.values(this.devicesData || {})) {
			if (dev?.metering) {
				for (const dir of ['tx', 'rx']) {
					for (const ch of Object.values(dev.metering[dir] || {})) {
						if (ch.peakHold !== undefined && ch.peakHold < 254) {
							ch.peakHold = Math.min(254, ch.peakHold + 2);
							this.meteringNeedsFeedbackCheck = true;
						}
					}
				}
			}
		}

		// 3. Trigger throttled feedback updates
		if (this.meteringNeedsFeedbackCheck) {
			this.meteringNeedsFeedbackCheck = false;
			this.checkFeedbacks('metering_1ch', 'metering_4ch');
		}
	},

	getSettingsPort (ipaddress) { 
		const commandBuffer = Buffer.concat([
			intToBuffer(0x1200, 2),
			intToBuffer(20), // command size
			this.counter,
			intToBuffer(0x1001),
			intToBuffer(0x0000),
			intToBuffer(0x3520),
			this.mac,
			intToBuffer(0x0000)
			]);			

		this.sendCommand(commandBuffer, ipaddress, 'CMC');
		
		incrementBE(this.counter);
	},
	
	
	
	dante_discovery: function(response, rinfo) { 
		// Address records in the same response tell us the device's real IP. Without
		// one, the sender is assumed to be the device -- unless the sender is this
		// computer, whose own mDNS responder can relay cached answers for others.
		const addresses = {};
		for (const type of ['answers', 'additionals']) {
			for (const record of response[type] || []) {
				if (record.type === 'A' && record.name) addresses[String(record.name).toLowerCase()] = record.data;
			}
		}
		for (const type of ['answers', 'additionals']) {
			response[type]?.forEach((answer) => {
				const name = answer.name;
				// get devices and services names and port
				if (answer.type == 'PTR' && DANTE_CONST.SERVICES_ARRAY.includes(name)) { 
					this.mdns.query({
						questions:[{
							name: answer.data,
							type:'SRV',
						}]
					}); 
				} else if (answer.type == 'SRV') {
					// register services and port
					for (const [id, danteService] of Object.entries(DANTE_CONST.SERVICES)) { 
						const dotIndex = name.indexOf('.');
						const deviceName = name.slice(0, dotIndex);
						const serviceName = name.slice(dotIndex + 1);

						if (serviceName == danteService) { 
							const target = String(answer.data?.target || '').toLowerCase();
							const deviceIp = addresses[target] || (this.localIps?.has(rinfo.address) ? null : rinfo.address);
							if (!deviceIp) continue;
							let currDevice = this.devicesData[deviceIp];
							
							if (currDevice) {
								this.keepAlive(deviceIp);
							} else {
						// create data object if needed
								currDevice = this.registerDevice(deviceIp, deviceName);				
								this.updateData();
							}
							
							if (currDevice.name != deviceName) {
								currDevice.name = deviceName;
								this.updateDeviceChoice(deviceIp, deviceName); 
								this.updateData();
							}
							if (!currDevice.ports) {
								currDevice.ports = {};
							}
							
							if (currDevice.ports[id] != answer.data.port) { 
		
								this.log('info', `Port for service ${id} of device ${deviceName} is : ${answer.data.port}`);						
								currDevice.ports[id] = answer.data.port;
								
								switch (id) {
									case 'ARC' : 
										this.getChannelCount(deviceIp);
										this.getSettings(deviceIp);
										break;
										
									case 'CMC' :
										this.getSettingsPort(deviceIp);
									break;
								}
							}
						}
					}
				}	
			});
		} 
	},
	
	
	
	setupInterval: function() {
		let self = this;
	
		self.stopInterval();
	
		// Discovery every interval; device settings every 5th interval; versions
		// (which rarely change) every 60th; clock status every 3rd. Devices also push
		// change notifications, so this mainly catches anything missed.
		if (self.config.interval > 0) {
			self.INTERVAL = setInterval(() => {
				self.pollTick = (self.pollTick || 0) + 1;
				self.getMdnsServices();
				if (self.pollTick % 5 === 1) self.refreshSettings(undefined, { versions: self.pollTick % 60 === 1 });
				if (self.pollTick % 3 === 1) self.refreshClock();
			}, self.config.interval);
			self.log('info', 'Starting Update Interval: Every ' + self.config.interval + 'ms');
		}

		if (self.METERING_INTERVAL !== null && self.METERING_INTERVAL !== undefined) {
			clearInterval(self.METERING_INTERVAL);
			self.METERING_INTERVAL = null;
		}
		self.METERING_INTERVAL = setInterval(() => {
			self.processMeteringTick();
		}, 100);

		if (self.MONITOR_INTERVAL) clearInterval(self.MONITOR_INTERVAL);
		self.MONITOR_INTERVAL = setInterval(() => {
			try {
				self.routeMonitorTick();
			} catch (err) {
				self.log('error', 'Route monitor: ' + (err?.message || err));
			}
		}, 1000);
	},
	
	stopInterval: function() {
		let self = this;
	
		if (self.INTERVAL !== null && self.INTERVAL !== undefined) {
			self.log('info', 'Stopping Update Interval.');
			clearInterval(self.INTERVAL);
			self.INTERVAL = null;
		}

		if (self.METERING_INTERVAL !== null && self.METERING_INTERVAL !== undefined) {
			clearInterval(self.METERING_INTERVAL);
			self.METERING_INTERVAL = null;
		}

		if (self.MONITOR_INTERVAL) {
			clearInterval(self.MONITOR_INTERVAL);
			self.MONITOR_INTERVAL = null;
		}
	},
	
	refreshSettings: function(deviceIp, { versions = true } = {}) {
		const ipArray = deviceIp ? [deviceIp] : Object.keys(this.devicesData);
		for (const ip of ipArray) {
			if (!this.devicesData[ip]?.ports?.SETTINGS) continue;
			this.getSampleRate(ip);
			this.getPullup(ip);
			this.getEncoding(ip);
			this.getLevel(ip);
			if (versions) {
				this.getVersion(ip);
				this.getManfVersion(ip);
			}
		}
	},
	
	refreshArc:  function(deviceIp) {
		const ipArray = deviceIp ? [deviceIp] : Object.keys(this.devicesData);
		for (const ip of ipArray) {
			if (!this.devicesData[ip]?.ports?.ARC) continue;
			this.getDeviceName(ip);
			this.getSettings(ip);
			this.getRxChannels(ip);
			this.getTxChannels(ip);
			this.getTxChannelFriendlyNames(ip);
		}
	},
	
	getMdnsServices: async function () {

		if (this.debug) {
		this.log('debug', 'Mdns discovery');
		}
		
		let questions = []; 
		for (const service of DANTE_CONST.SERVICES_ARRAY) {
			questions.push ({
				name: service, 
				type: 'PTR',
			});
		}
		
		this.mdns?.query({
			questions: questions
		});

	},

	updateClockMasterStatus: function() {
		let grandmasters = [];
		let anySyncing = false;
		let anyLostSync = false;
		let totalDevicesWithClock = 0;

		for (const [ip, dev] of Object.entries(this.devicesData)) {
			if (!dev.clock) continue;
			totalDevicesWithClock++;
			if (dev.clock.isMaster) {
				if (!grandmasters.includes(ip)) {
					grandmasters.push(ip);
				}
			}
			if (dev.clock.servo === 2) anySyncing = true;
			if (dev.clock.servo === 1 || dev.clock.servo === 0 || dev.clock.state === 1) anyLostSync = true;
		}

		const gmUuids = {};
		for (const [ip, dev] of Object.entries(this.devicesData)) {
			const gm = dev.clock?.grandmasterUuid;
			if (gm && gm !== '0000000000000000') {
				gmUuids[gm] = (gmUuids[gm] || 0) + 1;
			}
		}

		// If no device directly flagged as master, find the device whose clock identity
		// is the reported grandmaster. PTP identities are the device MAC followed by
		// 0000, so this also works when the leader itself doesn't answer clock queries.
		if (grandmasters.length === 0) {
			for (const gm of Object.keys(gmUuids)) {
				const gmMac = gm.slice(0, 12);
				for (const [ip, dev] of Object.entries(this.devicesData)) {
					if ((dev.clock?.uuid && dev.clock.uuid === gm) || dev.mac === gmMac) {
						if (!grandmasters.includes(ip)) grandmasters.push(ip);
					}
				}
			}
		}

		let masterDeviceName = 'Searching...';
		let masterDeviceIp = 'None';
		let masterUuid = 'None';
		let statusText = 'Searching...';
		let statusState = 'unknown';

		if (grandmasters.length > 1) {
			const distinctUuids = new Set(grandmasters.map((ip) => this.devicesData[ip]?.clock?.uuid).filter(Boolean));
			if (distinctUuids.size > 1) {
				masterDeviceName = grandmasters.map((ip) => this.devicesData[ip]?.name || ip).join(', ');
				statusText = 'Multiple Masters Detected!';
				statusState = 'multiple_masters';
			} else {
				const primaryGm = grandmasters[0];
				masterDeviceName = this.devicesData[primaryGm]?.name || primaryGm;
				masterDeviceIp = primaryGm;
				masterUuid = this.devicesData[primaryGm]?.clock?.uuid || 'None';
			}
		}

		if (statusState !== 'multiple_masters') {
			if (grandmasters.length === 1) {
				const gmIp = grandmasters[0];
				const gmDev = this.devicesData[gmIp];
				masterDeviceName = gmDev?.name || gmIp;
				masterDeviceIp = gmIp;
				masterUuid = gmDev?.clock?.uuid || 'None';

				if (anyLostSync) {
					statusText = 'Lost Sync';
					statusState = 'error';
				} else if (anySyncing || gmDev.clock?.servo === 2) {
					statusText = 'Syncing';
					statusState = 'syncing';
				} else {
					statusText = 'Locked';
					statusState = 'locked';
				}
			} else if (totalDevicesWithClock > 0) {
				const reportedGmUuids = Object.keys(gmUuids);
				if (reportedGmUuids.length === 1) {
					const gmUuid = reportedGmUuids[0];
					masterDeviceName = `Clock (${gmUuid.slice(-8).toUpperCase()})`;
					masterUuid = gmUuid;
					if (anyLostSync) {
						statusText = 'Lost Sync';
						statusState = 'error';
					} else if (anySyncing) {
						statusText = 'Syncing';
						statusState = 'syncing';
					} else {
						statusText = 'Locked';
						statusState = 'locked';
					}
				} else if (reportedGmUuids.length > 1) {
					masterDeviceName = reportedGmUuids.map((u) => u.slice(-8).toUpperCase()).join(', ');
					statusText = 'Multiple Masters Detected!';
					statusState = 'multiple_masters';
				} else if (anyLostSync) {
					statusText = 'Sync Fault';
					statusState = 'error';
				} else if (anySyncing) {
					statusText = 'Syncing';
					statusState = 'syncing';
				} else {
					statusText = 'Searching...';
					statusState = 'unknown';
				}
			}
		}

		this.clockMasterData = {
			masterName: masterDeviceName,
			masterIp: masterDeviceIp,
			masterUuid: masterUuid,
			status: statusText,
			state: statusState
		};

		this.checkVariables(undefined, 'clock');
		this.checkFeedbacks('clock_master_status');
	},
	
	// ---- Route monitoring ----------------------------------------------------

	/** Name-indexed view of the network for route evaluation. */
	routeNetwork() {
		const now = Date.now();
		const byName = new Map();
		for (const [ip, dev] of Object.entries(this.devicesData)) {
			if (dev?.name) byName.set(String(dev.name).toLowerCase(), { ...dev, ip, online: this.isDeviceOnline(dev, now) });
		}
		return {
			getDevice: (name) => {
				const key = String(name ?? '').trim().toLowerCase();
				if (byName.has(key)) return byName.get(key);
				// Seen before but since removed: known to be offline.
				return this.lastSeenByName?.[key] ? { name, online: false } : null;
			},
			statusName: (code) => DANTE_CONST.SUBSCRIPTION_STATUS_NAMES[code],
		};
	},

	/** Name of the transmitter currently feeding a monitored receive channel. */
	routeSourceDeviceName(spec) {
		const rxIp = this.findDeviceIpByName(spec.rx.device);
		const source = this.devicesData[rxIp]?.rx?.[spec.rx.channel]?.sourceDevice;
		if (source === '.') return spec.rx.device;
		return source || spec.tx?.device || null;
	},

	/** Called from the route feedbacks: evaluate, track state, report transitions. */
	evaluateRouteMonitor(feedbackId, options) {
		const spec = specFromOptions(options);
		if (!spec) {
			this.removeRouteMonitor(feedbackId);
			return null;
		}
		const result = this.routeMonitor.update(feedbackId, spec, this.routeNetwork());

		if (spec.silence) {
			for (const name of [spec.rx.device, this.routeSourceDeviceName(spec)]) {
				const ip = name && this.findDeviceIpByName(name);
				if (ip) this.subscribeMetering(ip);
			}
		}

		if (result.changed) {
			if (result.down) {
				this.log('warn', `Route DOWN: ${result.label} -- ${result.reason}`);
			} else {
				this.log('info', `Route restored: ${result.label}`);
			}
			this.updateRouteMonitorVariables();
			this.checkFeedbacks('route_monitor_any_down');
		}
		return result;
	},

	removeRouteMonitor(feedbackId) {
		if (this.routeMonitor?.remove(feedbackId)) {
			this.updateRouteMonitorVariables();
			this.checkFeedbacks('route_monitor_any_down');
		}
	},

	routeMonitorTick() {
		if (!this.routeMonitor?.entries.size) return;
		this.monitorTick = (this.monitorTick || 0) + 1;

		// Keep monitored data fresh: receivers' subscription tables, and a cheap
		// query to each transmitter so an offline one is noticed within seconds.
		if (this.monitorTick % 2 === 0) {
			const receivers = new Set();
			const transmitters = new Set();
			for (const entry of this.routeMonitor.entries.values()) {
				receivers.add(entry.spec.rx.device.toLowerCase());
				const source = this.routeSourceDeviceName(entry.spec);
				if (source) transmitters.add(source.toLowerCase());
			}
			for (const [ip, dev] of Object.entries(this.devicesData)) {
				const key = String(dev?.name || '').toLowerCase();
				if (receivers.has(key)) this.getRxChannels(ip);
				else if (transmitters.has(key)) this.getDeviceName(ip);
			}
		}

		this.checkFeedbacks('route_monitor', 'route_monitor_status', 'route_monitor_any_down');
		this.updateRouteMonitorVariables();
	},

	updateRouteMonitorVariables() {
		const { total, down } = this.routeMonitor.summary();
		const values = {
			route_monitor_total: total,
			route_monitor_down: down.length,
			route_monitor_down_list: down.map((e) => `${e.label}: ${e.reason}`).join('; ') || 'None',
			route_monitor_status: total === 0 ? 'No routes monitored' : down.length ? `${down.length} DOWN` : 'All OK',
		};
		const signature = JSON.stringify(values);
		if (signature === this._routeMonitorVariables) return;
		this._routeMonitorVariables = signature;
		try {
			this.setVariableValues(values);
		} catch (err) {
			this.log('debug', 'Route monitor variables: ' + (err?.message || err));
		}
	},

	updateData: function (bytes) {
		let self = this;
		if (this._updateDataTimer) {
			clearTimeout(this._updateDataTimer);
		}
		this._updateDataTimer = setTimeout(() => {
			this._updateDataTimer = null;
			try {
				saveCache(this.id, {
					devicesChoices: this.devicesChoices,
					txChannelsChoices: this.txChannelsChoices,
					rxChannelsChoices: this.rxChannelsChoices,
				});
				this.initActions();
				this.initVariables();
				this.checkVariables();
				this.initFeedbacks();
				this.checkAllFeedbacks();
				this.initPresets();
			} catch (err) {
				this.log?.('error', 'Error in updateData: ' + (err?.message || err));
			}
		}, 300);
	},
}
