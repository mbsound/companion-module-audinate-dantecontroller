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

### VideoHub-Style Matrix Routing (Source → Selected Destination)
* **Dedicated Selection Workflow**:
  * **`Select Destination`**: Select an Rx channel on any device as the active destination. The selected button automatically highlights **Orange** (`selected_destination` feedback).
  * **`Route Source to Selected Destination`**: Press any Tx source button to route that channel immediately to the active destination.
  * **`Clear Route on Selected Destination`**: Instantly disconnect the active destination route.
  * **Dynamic Source Feedback**: Source buttons dynamically highlight **Green** (`source_routed_to_selected_destination`) if they are currently feeding the selected destination.

### Multi-Channel Batch Routing (Single UDP Datagram)
* **`Batch Route Channels`**: Routes a range of sequential channels (e.g., 1–8 to 1–8, or 1–16 to 1–16) in a **single UDP packet** using Dante's native array message buffers (`_dgcp_array_msg_buffer_init`). Eliminates switch congestion, packet drops, and audio pops caused by firing multiple sequential single-channel requests.
* **`Batch Clear Channels`**: Cleanly unroutes a block of sequential channels in a single command.

### Granular Diagnostics & Subscription Health Feedback
Upstream only reported a binary "OK or nothing" status. This fork decodes Dante's internal status codes into visual, actionable operator feedbacks (`subscription_status`):
* 🟢 **Connected / OK**: Active, healthy stream (Unicast Dynamic `9`, Multicast Static `10`, or Manual AES67 `14`).
* 🟡 **In Progress / Resolving**: Searching for or negotiating with the transmitter (`1`, `8`).
* 🔴 **Fanout Limit Reached**: Alerts operators when a transmitter has exhausted its hardware unicast flows (`37`), indicating a Multicast Flow is required.
* 🔴 **Clock Domain / Latency Mismatch**: Alerts on PTP sync or latency mismatches (`26`, `27`).
* 🔴 **Format Mismatch**: Alerts on sample rate or bit depth conflicts (`16`, `17`).

### Clock Master Detection & Clock Status Feedback
This fork introduces native ConMon PTP clock inspection (`MESSAGE_TYPE_CLOCKING_STATUS` / opcode `0x0020`), tracking the network's active Clock Master (Grandmaster) and lock state in real time:
* **Dedicated Feedback Button**: Built-in preset button displaying:
  ```
  CLOCK MASTER
  $(dante:clock_grandmaster)
  $(dante:clock_status)
  ```
  Dynamically changes color via the `clock_master_status` feedback:
  * **Green**: Master and slaves locked in sync (`Locked`).
  * **Orange/Amber**: Network settling or clock acquiring sync (`Syncing`).
  * **Red**: PTP sync lost or clock domain fault (`Lost Sync`).
  * **Red**: Multiple conflicting Grandmasters detected on the network (`Multiple Masters Detected!`).
* **Global Clock Variables**: `$(dante:clock_grandmaster)`, `$(dante:clock_status)`, `$(dante:clock_grandmaster_ip)`, and `$(dante:clock_grandmaster_uuid)`.
* **Per-Device Clock Tracking**: `$(dante:<deviceName>_clock_role)` (Leader/Follower/Faulty) and `$(dante:<deviceName>_clock_synced)` (Locked/Syncing/Lost Sync).

### Route Monitor: Alarm When a Tx -> Rx Route Drops
Watch specific transmitter -> receiver channel routes and trigger feedback when one drops:
* **Route Monitor feedback** (`route_monitor`): pick a receiver channel and the transmitter channel it should carry (or click **Learn** to take it from the current routing). The route counts as **down** when any of these is true:
  * the receiver or transmitter goes offline
  * the channel is unsubscribed or re-routed to a different source
  * the subscription reports an error (Unresolved, No Connection, link down, ...)
  * optionally, the audio stays below a silence threshold, e.g. a radio mic that lost its transmitter
* **Alarm delay**: a problem must last a set time (default 3 s) before alarming, so brief re-resolves don't flash the button. An amber "checking" state shows while that delay runs.
* **Status text** (`route_monitor_status`, value feedback): the reason as text ("OK", "Transmitter offline", "Wrong source (Mic-Rx / 02)", ...) for button local variables.
* **Master alarm** (`route_monitor_any_down`) plus variables `route_monitor_status`, `route_monitor_down`, `route_monitor_down_list`.
* **Ready-made presets**: one monitor button per currently connected subscription, already configured (green / amber / red with the status text).
* Devices are matched by **name**, so monitors keep working when a device's IP changes. Every drop and recovery is logged.

### Real-Time Audio Metering Feedbacks (1-Channel & 4-Channel Bridge)
Live peak levels (~0.5 dB resolution) on Stream Deck keys, streamed directly from each device:
* **No Dante Controller required**: the module sends each device the same metering subscription Dante Controller uses, identified by this computer's MAC address. It works whether zero or any number of Dante Controllers are running. If UDP 8751 is already in use on this computer, a free port is used instead.
* **On-Demand Subscription Management**: Devices are only asked to stream meters while a meter feedback (or a route monitor with silence detection) needs them. Streams are stopped about 10 seconds after the last such button is removed, and when the connection is disabled.
* **1-Channel Audio Meter (`metering_1ch`)**:
  * Segmented vertical meter bar with color grading (Green $\to$ Amber $\to$ Orange $\to$ Red Clip).
  * Real-time numeric peak readout in dBFS (e.g. `-14 dB`, `CLIP`, or `MUTE`) and channel label.
  * Decay-mode peak hold indicator.
  * Configurable display modes: Bar + dB Text, Bar Only, or Numeric Readout Only.
* **4-Channel Audio Meter Bridge (`metering_4ch`)**:
  * Renders 4 side-by-side vertical audio meters on a single button key.
  * Bank selection (Channels 1–4, 5–8, 9–12, ..., 61–64) for Rx inputs or Tx outputs.
  * Color-graded bars, peak hold ticks, and channel numbers.
* **Built-in Presets**: Pre-configured buttons under the **Audio Metering** category for instant drag-and-drop deployment.

### Auto-Generated Dynamic Presets
Upstream had an empty preset file. This fork dynamically generates Companion buttons based on discovered devices:
* **Clock Master & Status**: One-touch diagnostic button with real-time name, status tally, and automatic color alerting.
* **Destinations Grid**: One-touch buttons for every discovered Rx channel with integrated selection and status feedback.
* **Sources Grid**: One-touch buttons for every discovered Tx channel that route to the active destination with live route tally.
* **Master Controls**: Pre-configured buttons for "Clear Route" and "Refresh Dante".

### Version 1.2.0-EXPERIMENTAL Fixes
* **Meters work without Dante Controller.** The previous metering requests were never answered with a level stream, so meters only worked when Dante Controller was running on the same machine.
* **Crash-proof packet handling:** a malformed or truncated packet could throw inside a socket handler and crash the module process. Handlers are now guarded and buffer reads are bounds-checked.
* **Channel lists:** Rx/Tx channel parsing no longer truncates a device's channel count when channel groups differ. Channel counts are read as 16-bit.
* **Subscription status:** "connected" now includes self-subscriptions (status 4) and devices that report status 1 with a live flow. Unresolved (status 1) is no longer treated as "pending".
* **"Source Routed to Selected Destination"** feedback read a field that was never set, so it never turned on. It now uses the real subscription data.
* **Clock status** is polled automatically. Before, it only updated when the *Refresh Clock Status* action ran. The grandmaster is also found by its MAC address when it doesn't answer clock queries itself.
* **Less network traffic:** the module previously sent six settings queries to every device every second. Settings now refresh every 5 intervals and version info every 60 (devices also announce changes themselves). Meter subscriptions refresh every 3 s instead of every 200 ms.
* **Discovery:** device IPs come from mDNS address records, so cached answers relayed by this computer's own mDNS responder can't register a phantom device at this computer's IP.
* **Privacy:** removed a hardcoded list of site-specific device names and IPs. The device cache moved out of Companion's data folder to a per-connection file in the OS cache folder (`~/Library/Caches/...` on macOS, `%LOCALAPPDATA%` on Windows, `~/.cache` on Linux). On first start, an existing cache from older versions is read once.
* **Tests:** `npm test` (node:test) covers the protocol, the route monitor and the module's feedbacks against simulated devices.

### Protocol Hardening & Bug Fixes
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

## 4. Installation in Bitfocus Companion

### Pre-built package (recommended)

1. Download the latest `audinate-dantecontroller-<version>.tgz` from the [Releases page](https://github.com/mbsound/companion-module-audinate-dantecontroller/releases).
2. In Companion, open the **Modules** page and choose **Import module package**, then select the downloaded `.tgz`.
3. In the **Connections** tab, add **Audinate Dante Controller** (or switch an existing connection to the imported version).
4. Select your primary Dante network adapter from the interface dropdown.

Versions are tagged `-EXPERIMENTAL` and published as pre-releases.

### From source

1. Clone this repository and build the package:
   ```bash
   git clone https://github.com/mbsound/companion-module-audinate-dantecontroller.git
   cd companion-module-audinate-dantecontroller
   yarn install
   yarn build
   ```
   This writes `audinate-dantecontroller-<version>.tgz`, which you can import as above.
2. Or, to develop against a live copy: in Companion's launcher settings, set the **Developer modules path** to the folder containing this repository.

---

## 5. Development

```bash
# Install dependencies
npm install

# Run the test suite
npm test

# Validate manifest and module structure
npm run check

# Build bundle and package
npm run build

# Format code
npm run format

# Publish a release (CI builds, tests and attaches the .tgz)
git tag v<version from package.json>
git push origin v<version from package.json>
```

---

## 6. License & Acknowledgments

* **License**: MIT
* Based on original work by Cédric Joder and Chris Ritsen's [`network-audio-controller`](https://github.com/chris-ritsen/network-audio-controller).
* Metering-subscription and subscription-status details cross-checked against netaudio (public domain).
* Reverse engineering insights and protocol specifications analyzed from Audinate Dante Controller (`libDanteController`).