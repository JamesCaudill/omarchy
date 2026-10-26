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
  bluetooth.deviceRow(trackpad, bluetooth.batteryForAddress(readouts, trackpad.address)).batteryText,
  '39%',
  'macstarter shows the trackpad percentage on its row without a discharging label'
)

// The keyboard's HID supply is a serial, so the address cannot match. On
// Bluetooth the alias is "Name’s Keyboard"; on the cable BlueZ only says Paired.
const keyboardAddress = '90:9C:4A:11:22:33'
const supplies = [
  { type: 14, model: 'Apple Inc. Magic Trackpad', percentage: 0.39, state: 2, nativePath: 'hid-04:4b:ed:eb:f5:10-battery-144', powerSupply: false },
  { type: 6, model: 'Apple Inc. Magic Keyboard', percentage: 0.49, state: 1, nativePath: 'hid-F0T5474067XG9KPAV-battery-144', powerSupply: false }
]
const keyboardBluetooth = {
  name: 'James Caudill\u2019s Keyboard',
  address: keyboardAddress,
  connected: true,
  paired: true,
  batteryAvailable: false
}
const onBluetooth = bluetooth.batteryReadouts([trackpad, keyboardBluetooth], supplies)
assertDeepEqual(onBluetooth.map((entry) => [entry.name, entry.percentage, entry.charge, entry.matched]), [
  ['James Caudill\u2019s Trackpad', 39, 'discharging', true],
  ['James Caudill\u2019s Keyboard', 49, 'charging', true]
], 'macstarter attaches a connected keyboard alias to the serial HID supply')
assertEqual(bluetooth.unmatchedBatteries(onBluetooth).length, 0, 'a connected keyboard is not also listed under BATTERIES')
assertEqual(
  bluetooth.deviceRow(keyboardBluetooth, bluetooth.batteryForAddress(onBluetooth, keyboardAddress)).batteryText,
  '49% · Charging',
  'macstarter shows the connected keyboard charge on its row'
)

const keyboardPaired = {
  name: 'James Caudill\u2019s Keyboard',
  address: keyboardAddress,
  connected: false,
  paired: true,
  batteryAvailable: false
}
const onCable = bluetooth.batteryReadouts([trackpad, keyboardPaired], supplies)
assertEqual(bluetooth.batteryForAddress(onCable, keyboardAddress), null, 'a paired keyboard on the cable is not attached to the BlueZ row')
assertDeepEqual(bluetooth.unmatchedBatteries(onCable).map((entry) => [entry.name, entry.percentage, entry.charge]), [
  ['Apple Inc. Magic Keyboard', 49, 'charging']
], 'the cable keyboard stays a BATTERIES row')

const namedKeyboard = {
  name: 'James Caudill\u2019s Keyboard',
  deviceName: 'Magic Keyboard',
  address: keyboardAddress,
  connected: true,
  batteryAvailable: false
}
const preferred = bluetooth.batteryReadouts([namedKeyboard], [
  { type: 6, model: 'Apple Inc. Magic Keyboard', percentage: 0.49, state: 1, nativePath: 'hid-F0T5474067XG9KPAV-battery-144', powerSupply: false },
  { type: 6, model: 'Office Keyboard', percentage: 0.12, state: 2, nativePath: 'hid-OTHERSERIAL99-battery-144', powerSupply: false }
])
const preferredBattery = bluetooth.batteryForAddress(preferred, keyboardAddress)
assertDeepEqual(preferredBattery ? [preferredBattery.percentage, preferredBattery.charge] : null, [49, 'charging'], 'the Magic Keyboard name wins over a second keyboard supply')
assertEqual(bluetooth.unmatchedBatteries(preferred).length, 1, 'the other keyboard supply stays unmatched')

const ambiguous = bluetooth.batteryReadouts([keyboardBluetooth], [
  { type: 6, model: 'Apple Inc. Magic Keyboard', percentage: 0.49, state: 1, nativePath: 'hid-F0T5474067XG9KPAV-battery-144', powerSupply: false },
  { type: 6, model: 'Office Keyboard', percentage: 0.12, state: 2, nativePath: 'hid-OTHERSERIAL99-battery-144', powerSupply: false }
])
assertEqual(bluetooth.batteryForAddress(ambiguous, keyboardAddress), null, 'two keyboard supplies do not guess which row they belong to')
assertEqual(
  bluetooth.formatBatteryTooltip(readouts),
  'James Caudill\u2019s Trackpad 39%\nApple Inc. Magic Keyboard 49% · Charging',
  'macstarter hover names the trackpad and only marks the keyboard charging'
)
JS
