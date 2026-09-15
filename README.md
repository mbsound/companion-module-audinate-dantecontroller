# Bitfocus Companion Module: Audinate Dante Controller (Enhanced Edition)

A high-performance Bitfocus Companion module for discovery, monitoring, and routing control of **Audinate Dante** audio devices directly over the Dante network protocol without requiring Dante Controller to be running.

Forked and modernized from [`bitfocus/companion-module-audinate-dantecontroller`](https://github.com/bitfocus/companion-module-audinate-dantecontroller).

---

## 1. Core Functionality

This module interfaces directly with Dante hardware on your local network using standard Multicast DNS (`_netaudio-arc._udp`) and Dante's native UDP control protocol (DGCP / ARCP).

* **Direct Receiver-Driven Routing**: Establishes (`0x3010`) and breaks audio subscriptions directly at the receiver endpoint.
* **Auto-Discovery**: Continuously monitors the network for Dante hardware, automatically populating devices and channel lists.
* **Device Configuration**:
  * Set / Reset Device Names
  * Set / Reset Transmit (Tx) & Receive (Rx) Channel Labels
  * Adjust Sample Rates (44.1 kHz, 48 kHz, 88.2 kHz, 96 kHz, 192 kHz, or custom rates)
  * Set Pullup/Pulldown (+4.1667%, +0.1%, -0.1%, -4%)
  * Set Device Latency (0.25 ms, 0.5 ms, 1.0 ms, 2.0 ms, 5.0 ms)
  * Set Audio Encoding Bit Depth (PCM16, PCM24, PCM32)
  * Control Output Levels (specifically for Audinate AVIO 2out adapters)
* **Real-time Variables**: Exposes device status, IP addresses, channel counts, channel names, and clock/format properties as dynamic Companion variables.

---

## 2. Enhancements Over Upstream (Fork Features)

This fork introduces significant architectural upgrades, professional matrix routing workflows, multi-channel batch operations, protocol hardening, and granular diagnostic feedbacks that were absent in the upstream release:

### 🎛️ VideoHub-Style Matrix Routing (Source → Selected Destination)
* **Dedicated Selection Workflow**:
  * **`Select Destination`**: Select an Rx channel on any device as the active destination. The selected button automatically highlights **Orange** (`selected_destination` feedback).
  * **`Route Source to Selected Destination`**: Press any Tx source button to route that channel immediately to the active destination.
  * **`Clear Route on Selected Destination`**: Instantly disconnect the active destination route.
  * **Dynamic Source Feedback**: Source buttons dynamically highlight **Green** (`source_routed_to_selected_destination`) if they are currently feeding the selected destination.

### ⚡ Multi-Channel Batch Routing (Single UDP Datagram)
* **`Batch Route Channels`**: Routes a range of sequential channels (e.g., 1–8 to 1–8, or 1–16 to 1–16) in a **single UDP packet** using Dante's native array message buffers (`_dgcp_array_msg_buffer_init`). Eliminates switch congestion, packet drops, and audio pops caused by firing multiple sequential single-channel requests.
* **`Batch Clear Channels`**: Cleanly unroutes a block of sequential channels in a single command.

### 🩺 Granular Diagnostics & Subscription Health Feedback
Upstream only reported a binary "OK or nothing" status. This fork decodes Dante's internal status codes into visual, actionable operator feedbacks (`subscription_status`):
* 🟢 **Connected / OK**: Active, healthy stream (Unicast Dynamic `9`, Multicast Static `10`, or Manual AES67 `14`).
* 🟡 **In Progress / Resolving**: Searching for or negotiating with the transmitter (`1`, `8`).
* 🔴 **Fanout Limit Reached**: Alerts operators when a transmitter has exhausted its hardware unicast flows (`37`), indicating a Multicast Flow is required.
* 🔴 **Clock Domain / Latency Mismatch**: Alerts on PTP sync or latency mismatches (`26`, `27`).
* 🔴 **Format Mismatch**: Alerts on sample rate or bit depth conflicts (`16`, `17`).

### 🚀 Auto-Generated Dynamic Presets
Upstream had an empty preset file. This fork dynamically generates Companion buttons based on discovered devices:
* **Destinations Grid**: One-touch buttons for every discovered Rx channel with integrated selection and status feedback.
* **Sources Grid**: One-touch buttons for every discovered Tx channel that route to the active destination with live route tally.
* **Master Controls**: Pre-configured buttons for "Clear Route" and "Refresh Dante".

### 🛡️ Protocol Hardening & Bug Fixes
* **Dynamic String Offsets**: Replaced fragile, static byte offsets with dynamic string pool serializers that follow Dante's 10-byte DGCP header format (`_arcp_204_rx_sub_req_alloc_str`).
* **Clean Unsubscription Framing**: Replaced hardcoded packet capture dumps (`005c006d`) in `clearCrosspoint` with standard zeroed string offset framing (`tx_chan_offset = 0`, `tx_device_offset = 0`).
* **Crash Fixes**: Resolved upstream `ReferenceError` bugs (e.g., unhandled `DestinationDevice` casing and `destinationDeviceIP` reference errors).
* **Companion v3 Standards**: Upgraded to `@companion-module/base` `^2.1.3` and `@companion-module/tools` `^3.1.0`, adding the required `"type": "connection"` manifest declaration.

---

## 3. How Matrix Routing Works

1. Create a row or grid of **Destination buttons** using the preset or `Select Destination` action.
2. Create a row or grid of **Source buttons** using the preset or `Route Source to Selected Destination` action.
3. Add a **Clear Route** button using `Clear Route on Selected Destination`.
4. **Operation**:
   - Tap a Destination button → Button turns **Orange**.
   - All Source buttons update their tallies; the currently connected Source turns **Green**.
   - Tap any Source button → The route is made immediately, and the tally updates.

---

## 4. Local Installation in Bitfocus Companion

To use this enhanced module in Bitfocus Companion:

1. Clone or download this repository:
   ```bash
   git clone https://github.com/mbsound/companion-module-audinate-dantecontroller.git
   cd companion-module-audinate-dantecontroller
   npm install
   npm run build
   ```
2. Open **Bitfocus Companion** in your browser (`http://localhost:8000`).
3. Navigate to **Settings** → **Developer Modules**.
4. Add the path to this folder in the **Extra module path** field.
5. In the **Connections** tab, search for **Audinate Dante Controller** and add the connection.
6. Select your primary Dante network adapter from the interface dropdown.

---

## 5. Development

```bash
# Install dependencies
npm install

# Validate manifest and module structure
npm run check

# Build bundle and package
npm run build

# Format code
npm run format
```

---

## 6. License & Acknowledgments

* **License**: MIT
* Based on original work by Cédric Joder and Chris Ritsen's [`network-audio-controller`](https://github.com/chris-ritsen/network-audio-controller).
* Reverse engineering insights and protocol specifications analyzed from Audinate Dante Controller (`libDanteController`).