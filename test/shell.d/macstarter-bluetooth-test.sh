#!/bin/bash

set -euo pipefail

source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/base-test.sh"

run_node_test <<'JS'
const bluetooth = requireFromRoot('extras/macstarter.bluetooth/Model.js')

assertEqual(bluetooth.upowerAddress('hid-04:4b:ed:eb:f5:10-battery-144'), '044bedebf510', 'macstarter reads a lowercase hid- address')
assertEqual(bluetooth.upowerAddress('hid-04:4B:ED:EB:F5:10-battery-144'), '044bedebf510', 'macstarter reads an uppercase hid- address')
assertEqual(bluetooth.upowerAddress('/org/freedesktop/UPower/devices/touchpad_hid_04o4boedoebof5o10_battery_144'), '044bedebf510', 'macstarter reads the colon-as-o address in a UPower object path')
assertEqual(bluetooth.upowerAddress('hid-F0T5474067XG9KPAV-battery-144'), '', 'macstarter leaves a serial HID supply unmatched')

// James's live pair. The trackpad's BlueZ alias is not the UPower model, and
// the address case does not match the hid- path. The keyboard path is a serial.
const trackpad = {
  name: 'James Caudill\u2019s Trackpad',
  address: '04:4B:ED:EB:F5:10',
  connected: true,
  batteryAvailable: false
}
const readouts = bluetooth.batteryReadouts([trackpad], [
  { type: 14, model: 'Apple Inc. Magic Trackpad', percentage: 0.39, state: 2, nativePath: 'hid-04:4b:ed:eb:f5:10-battery-144', powerSupply: false },
  { type: 6, model: 'Apple Inc. Magic Keyboard', percentage: 0.49, state: 1, nativePath: 'hid-F0T5474067XG9KPAV-battery-144', powerSupply: false }
])
assertDeepEqual(readouts.map((entry) => [entry.name, entry.percentage, entry.charge, entry.matched]), [
  ['James Caudill\u2019s Trackpad', 39, 'discharging', true],
  ['Apple Inc. Magic Keyboard', 49, 'charging', false]
], 'macstarter attaches the trackpad supply to its BlueZ row and leaves the keyboard serial unmatched')
assertEqual(
  bluetooth.formatBatteryStatus(bluetooth.deviceRow(trackpad, bluetooth.batteryForAddress(readouts, trackpad.address))),
  '39%',
  'macstarter shows the trackpad percentage on its row without a discharging label'
)
assertEqual(
  bluetooth.formatBatteryTooltip(readouts),
  'James Caudill\u2019s Trackpad 39%\nApple Inc. Magic Keyboard 49% · Charging',
  'macstarter hover names the trackpad and only marks the keyboard charging'
)
JS
