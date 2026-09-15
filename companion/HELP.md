# Audinate Dante Controller

This module controls Dante audio devices and routing in local networks directly over the Dante protocol.

## Config

* Select network interface (Primary Dante network)
* Set poll interval time to discover from network
* Set response time before considering a device offline

## Actions

### Router / Matrix Control
* **Select Destination**: Sets the active destination channel for matrix routing (supports dropdown and manual/variable input).
* **Route Source to Selected Destination**: Routes the chosen source channel directly to whichever destination is currently selected.
* **Clear Route on Selected Destination**: Disconnects/unroutes the currently selected destination.
* **Batch Route Channels**: Sequentially routes a block of consecutive channels (e.g. 1–8 to 1–8) in a single packet.
* **Batch Clear Channels**: Disconnects a block of consecutive channels in a single packet.

### Direct Crosspoint Actions
* **Make Crosspoint**: Direct 1-to-1 patch (Text input with Companion variable support).
* **Make Crosspoint (drop down)**: Direct 1-to-1 patch with auto-populated dropdowns.
* **Clear Crosspoint**: Disconnects a destination channel (Text input with variable support).
* **Clear Crosspoint (drop down)**: Disconnects a destination channel via dropdown.

### Device & Channel Management
* **Set / Reset Device Name**
* **Set / Reset Tx Channel Name**
* **Set / Reset Rx Channel Name**
* **Set Sample Rate** (Standard rates or custom Hz)
* **Set Sample Rate Pullup**
* **Set Latency** (in ms)
* **Set Encoding** (PCM16, PCM24, PCM32)
* **Set Output Level** (for AVIO 2out)
* **Refresh Network Devices**
* **Refresh Clock Status**

## Presets

* **Router Controls**: One-button actions to clear selected route or refresh network discovery.
* **Clock Master & Status**: Button displaying current PTP Grandmaster name and lock state (`$(dante:clock_grandmaster)` / `$(dante:clock_status)`), dynamically colored Green (Locked), Orange (Syncing), or Red (Lost Sync / Split Master).
* **Destinations (per device)**: Buttons for all discovered Rx channels. Pressing a destination selects it (highlights orange) and shows whether it is connected (green) or errored (red).
* **Sources (per device)**: Buttons for all discovered Tx channels. Pressing a source routes it to the selected destination and highlights green when active.

## Feedbacks

* **Clock Master & Sync Status**: Dynamic styling based on network clock health:
  * *Clock Locked / In Sync (Normal)*: Master and slaves locked in sync (Green).
  * *Syncing / Acquiring*: Clock settling or acquiring sync (Orange/Amber).
  * *Lost Sync / Clock Fault*: PTP sync loss or unlocked state (Red).
  * *Multiple Grandmasters Detected*: Multiple devices acting as Grandmaster / split clock domain (Red).
  * *Any Error / Warning*: Triggered on syncing, lost sync, or multiple masters.
* **Selected Destination**: Highlights the button (orange) if this destination is currently selected as the routing target.
* **Source Routed to Selected Destination**: Highlights the button (green) if this source is currently feeding the selected destination.
* **Subscription Status / Diagnostics**: Detailed visual diagnostics:
  * *Connected / OK*: Unicast or multicast flow healthy (Green).
  * *In Progress / Resolving*: Discovering target name (Yellow).
  * *Fanout Limit Reached*: Transmitter out of unicast flows (Red).
  * *Clock Domain / Latency Mismatch*: PTP sync or latency error (Red).
  * *Format Mismatch*: Sample rate or bit depth mismatch (Red).
  * *Any Error*: Highlights if the route is unestablished or failed.
* **Change background if crosspoint is active** (Legacy direct crosspoint feedback).

## Variables

### Global, Router & Clock
* `devices`: List of discovered Dante device names
* `clock_grandmaster`: Name of the active Dante Clock Master (PTP Grandmaster)
* `clock_status`: Overall network clock status (Locked, Syncing, Lost Sync, Multiple Masters)
* `clock_grandmaster_ip`: IP address of the active Clock Master
* `clock_grandmaster_uuid`: PTP Clock UUID (EUI-64) of the active Clock Master
* `selected_destination_device`: Name of currently selected destination device
* `selected_destination_channel`: Name of currently selected destination channel
* `selected_destination_source`: Name of source currently routed to the selected destination
* `selected_destination_status`: Human-readable subscription health description

### Per Device
* `$(dante:<deviceName>_ip)`: Device IP address
* `$(dante:<deviceName>_clock_role)`: Clock role of device (Leader, Follower, Faulty)
* `$(dante:<deviceName>_clock_synced)`: Device clock lock state (Locked, Syncing, Lost Sync)
* `$(dante:<deviceName>_rx)` / `$(dante:<deviceName>_tx)`: Channel counts
* `$(dante:<deviceName>_rx_names)` / `$(dante:<deviceName>_tx_names)`: Channel labels
* `$(dante:<deviceName>_sr)`: Current sample rate
* `$(dante:<deviceName>_latency)`: Configured device latency
* `$(dante:<deviceName>_encoding)`: Current bit depth
* `$(dante:<deviceName>_model_name)` / `$(dante:<deviceName>_product_version)`: Hardware details
