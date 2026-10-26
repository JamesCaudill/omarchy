function deviceLabel(device) {
  if (!device) return ""
  return String(device.deviceName || device.name || "").trim()
}

function toArray(values) {
  if (!values) return []
  if (Array.isArray(values)) return values.slice()

  var length = Number(values.length || 0)
  if (!isFinite(length) || length <= 0) return []

  var list = []
  for (var i = 0; i < length; i++) list.push(values[i])
  return list
}

function isUuidLike(value) {
  var text = String(value || "").trim()
  if (text === "") return false
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)
    || /^[0-9a-f]{32}$/i.test(text)
    || /^0x[0-9a-f]{4,32}$/i.test(text)
    || /^0000[0-9a-f]{4}-0000-1000-8000-00805f9b34fb$/i.test(text)
}

function isAddressLike(value) {
  var text = String(value || "").trim()
  return /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(text)
}

function normalizedAddress(value) {
  return String(value || "").trim().toLowerCase().replace(/[^0-9a-f]/g, "")
}

function hasHumanName(device) {
  var label = deviceLabel(device)
  return label !== "" && !isUuidLike(label) && !isAddressLike(label)
}

function nodeProps(node) {
  return node && node.ready && node.properties ? node.properties : {}
}

function nodeText(node) {
  var props = nodeProps(node)
  return [
    node ? node.name : "",
    node ? node.description : "",
    node ? node.nickname : "",
    node ? node.nick : "",
    props["node.name"],
    props["node.description"],
    props["node.nick"],
    props["device.name"],
    props["device.description"],
    props["device.product.name"],
    props["device.alias"],
    props["device.string"],
    props["api.bluez5.address"],
    props["bluez5.address"],
    props["media.name"]
  ].join(" ").toLowerCase()
}

function bluetoothSinkMatchesDevice(node, device) {
  if (!node || !node.isSink || node.isStream || !device) return false

  var address = normalizedAddress(device.address)
  var text = nodeText(node)
  if (address !== "" && normalizedAddress(text).indexOf(address) !== -1) return true

  var label = deviceLabel(device).toLowerCase()
  return label !== "" && text.indexOf(label) !== -1
}

function sortedByLabel(devices) {
  var list = toArray(devices)
  list.sort(function(a, b) { return deviceLabel(a).localeCompare(deviceLabel(b)) })
  return list
}

// UPower D-Bus Device.Type / Device.State. Quickshell exposes the same numbers.
// Peripheral types are the ones a person charges beside the laptop: keyboards,
// mice, trackpads, headsets. The laptop battery and the line-power supply are
// not in this set, so they never land on the Bluetooth icon.
var UPOWER_STATE = {
  unknown: 0,
  charging: 1,
  discharging: 2,
  empty: 3,
  full: 4,
  pendingCharge: 5,
  pendingDischarge: 6
}

var PERIPHERAL_TYPES = {
  5: true, // mouse
  6: true, // keyboard
  7: true, // pda
  8: true, // phone
  9: true, // media player
  10: true, // tablet
  12: true, // gaming input
  13: true, // pen
  14: true, // touchpad
  17: true, // headset
  18: true, // speakers
  19: true, // headphones
  21: true, // other audio
  22: true, // remote control
  26: true, // wearable
  27: true, // toy
  28: true // bluetooth generic
}

function isHexChar(ch) {
  var code = ch.charCodeAt(0)
  return (code >= 48 && code <= 57) || (code >= 97 && code <= 102) || (code >= 65 && code <= 70)
}

// Six octets starting at `start`, separated by one character. UPower writes a
// HID address as hid-04:4b:ed:eb:f5:10-battery, underscores the same pairs in
// a BlueZ object path, and turns each colon into "o" when it builds a D-Bus
// object path (04:4b becomes 04o4b) because ":" is not legal in a path.
function macAt(text, start, separator) {
  var parts = ""
  var index = start
  for (var n = 0; n < 6; n++) {
    if (index + 1 >= text.length) return ""
    var a = text.charAt(index)
    var b = text.charAt(index + 1)
    if (!isHexChar(a) || !isHexChar(b)) return ""
    parts += a.toLowerCase() + b.toLowerCase()
    index += 2
    if (n < 5) {
      if (text.charAt(index) !== separator) return ""
      index += 1
    }
  }
  return parts
}

function boundedMac(text, separator) {
  // 12 hex digits and 5 separators.
  for (var i = 0; i + 16 < text.length; i++) {
    if (i > 0 && isHexChar(text.charAt(i - 1))) continue
    var address = macAt(text, i, separator)
    if (!address) continue
    var end = i + 17
    if (end < text.length && isHexChar(text.charAt(end))) continue
    return address
  }
  return ""
}

// BlueZ object paths look like /org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF. A kernel
// HID supply embeds the same address with colons, dashes, or underscores, and
// the address comparison is case-insensitive either way.
function upowerAddress(nativePath) {
  var text = String(nativePath || "")
  var separators = [":", "-", "_", "o"]
  for (var s = 0; s < separators.length; s++) {
    var found = boundedMac(text, separators[s])
    if (found) return found
  }
  return ""
}

function chargeKind(state) {
  var value = Number(state)
  if (value === UPOWER_STATE.charging || value === UPOWER_STATE.pendingCharge) return "charging"
  if (value === UPOWER_STATE.discharging || value === UPOWER_STATE.pendingDischarge) return "discharging"
  if (value === UPOWER_STATE.full) return "full"
  if (value === UPOWER_STATE.empty) return "empty"
  return ""
}

function percentageOf(fraction) {
  var value = Number(fraction)
  if (!isFinite(value)) return null
  var percentage = Math.round(value * 100)
  if (percentage < 0 || percentage > 100) return null
  return percentage
}

function isPeripheral(device) {
  if (!device || device.powerSupply || device.isLaptopBattery) return false
  return !!PERIPHERAL_TYPES[Number(device.type)]
}

// A missing UPower reading is percentage 0 and state Unknown. A battery that
// is actually empty reports Empty or Discharging, so 0% still counts there.
function hasReading(device) {
  var percentage = percentageOf(device.percentage)
  if (percentage === null) return false
  if (chargeKind(device.state)) return true
  return percentage > 0 && Number(device.state) === UPOWER_STATE.unknown
}

function peripheralFrom(device) {
  var percentage = percentageOf(device.percentage)
  var nativePath = String(device.nativePath || "")
  var serial = String(device.serial || "")
  return {
    name: String(device.model || "").trim(),
    address: upowerAddress(nativePath) || upowerAddress(serial),
    nativePath: nativePath,
    serial: serial,
    percentage: percentage,
    charge: chargeKind(device.state)
  }
}

// Exact, case-insensitive. Also "Magic Trackpad" inside "Apple Inc. Magic
// Trackpad": the shorter side has to be more than one word, so a bare
// "Trackpad" does not claim every trackpad UPower can see.
function namesMatch(left, right) {
  var a = String(left || "").trim().toLowerCase()
  var b = String(right || "").trim().toLowerCase()
  if (a === "" || b === "") return false
  if (a === b) return true
  var shorter = a.length <= b.length ? a : b
  var longer = a.length <= b.length ? b : a
  if (shorter.indexOf(" ") === -1) return false
  return longer.length > shorter.length && longer.slice(-(shorter.length + 1)) === " " + shorter
}

// Last word, when it is a kind of device. "James Caudill’s Keyboard" and
// "Apple Inc. Magic Keyboard" share one, and a HID supply named only by its
// serial has no address to match on. Two supplies of that kind stay unmatched.
var PRODUCT_TOKENS = { keyboard: true, trackpad: true, mouse: true }

function productToken(name) {
  var parts = String(name || "").trim().toLowerCase().split(/\s+/)
  if (parts.length < 2) return ""
  var last = parts[parts.length - 1].replace(/[^a-z]/g, "")
  return PRODUCT_TOKENS[last] ? last : ""
}

function deviceNames(device) {
  var names = []
  function add(value) {
    var text = String(value || "").trim()
    if (text && names.indexOf(text) === -1) names.push(text)
  }
  add(deviceLabel(device))
  add(device && device.name)
  add(device && device.deviceName)
  return names
}

// One UPower object per Bluetooth address. HID and BlueZ can both publish the
// same device; keep the one that knows whether it is charging.
function dedupePeripherals(list) {
  var byAddress = {}
  var result = []
  for (var i = 0; i < list.length; i++) {
    var item = list[i]
    if (!item.address) {
      result.push(item)
      continue
    }
    var previous = byAddress[item.address]
    if (previous === undefined) {
      byAddress[item.address] = result.length
      result.push(item)
      continue
    }
    if (!result[previous].charge && item.charge) result[previous] = item
  }
  return result
}

// Connected Bluetooth devices first, enriched from UPower when the address or
// (failing that) the model name matches. UPower is the reading that carries
// charging state, and it is also how a keyboard on a cable reports — that
// device is not connected in BlueZ, so it stays an unmatched row. BlueZ
// Battery1 is the fallback for a device UPower has never seen; that interface
// is empty unless bluetoothd was started with Experimental.
function batteryReadouts(bluetoothDevices, upowerDevices) {
  var peripherals = []
  var upower = toArray(upowerDevices)
  for (var i = 0; i < upower.length; i++) {
    if (!isPeripheral(upower[i]) || !hasReading(upower[i])) continue
    peripherals.push(peripheralFrom(upower[i]))
  }
  peripherals = dedupePeripherals(peripherals)

  var used = {}
  var entries = []
  var connected = deviceLists(bluetoothDevices).connected

  // Address equality first. Failing that, the 12 hex digits of the BlueZ
  // address anywhere in the native path or serial — colons and dashes
  // disappear once non-hex characters are stripped, and an uppercase BlueZ
  // address compares the same as the lowercase hid- path.
  function findByAddress(address) {
    var want = normalizedAddress(address)
    if (want.length !== 12) return -1
    var loose = -1
    for (var index = 0; index < peripherals.length; index++) {
      if (used[index]) continue
      var peripheral = peripherals[index]
      if (peripheral.address === want) return index
      if (loose !== -1) continue
      var folded = normalizedAddress(String(peripheral.nativePath || "") + String(peripheral.serial || ""))
      if (folded.indexOf(want) !== -1) loose = index
    }
    return loose
  }

  // -2 is ambiguous: more than one unused address-less supply hit. Callers
  // treat that as no match rather than guessing a battery.
  function findUnused(match) {
    var found = -1
    for (var index = 0; index < peripherals.length; index++) {
      if (used[index] || peripherals[index].address) continue
      if (!match(peripherals[index])) continue
      if (found !== -1) return -2
      found = index
    }
    return found
  }

  function findByName(device) {
    var labels = deviceNames(device)
    var byName = findUnused(function(peripheral) {
      for (var n = 0; n < labels.length; n++) {
        if (namesMatch(peripheral.name, labels[n])) return true
      }
      return false
    })
    if (byName !== -1) return byName < 0 ? -1 : byName

    var tokens = []
    for (var t = 0; t < labels.length; t++) {
      var token = productToken(labels[t])
      if (token && tokens.indexOf(token) === -1) tokens.push(token)
    }
    if (!tokens.length) return -1
    var byToken = findUnused(function(peripheral) {
      var token = productToken(peripheral.name)
      return token !== "" && tokens.indexOf(token) !== -1
    })
    return byToken < 0 ? -1 : byToken
  }

  // A keyboard UPower publishes twice — once from BlueZ, once from HID with
  // no address — is one device. Fold the address-less twin when the level
  // agrees, and keep its charging state if that is the copy that has one.
  function absorbNamelessTwin(entry) {
    for (var index = 0; index < peripherals.length; index++) {
      if (used[index] || peripherals[index].address) continue
      if (!namesMatch(peripherals[index].name, entry.name)) continue
      if (peripherals[index].percentage !== entry.percentage) continue
      if (!entry.charge && peripherals[index].charge) entry.charge = peripherals[index].charge
      used[index] = true
    }
  }

  for (var c = 0; c < connected.length; c++) {
    var device = connected[c]
    var label = deviceLabel(device)
    var byAddress = findByAddress(device.address)
    var matchIndex = byAddress >= 0 ? byAddress : findByName(device)
    if (matchIndex >= 0) {
      var match = peripherals[matchIndex]
      used[matchIndex] = true
      var entry = {
        name: label || match.name,
        address: normalizedAddress(device.address),
        percentage: match.percentage,
        charge: match.charge,
        matched: true
      }
      if (byAddress >= 0) absorbNamelessTwin(entry)
      entries.push(entry)
      continue
    }
    if (!device.batteryAvailable) continue
    var bluez = percentageOf(device.battery)
    if (bluez === null) continue
    entries.push({
      name: label,
      address: normalizedAddress(device.address),
      percentage: bluez,
      charge: "",
      matched: true
    })
  }

  for (var u = 0; u < peripherals.length; u++) {
    if (used[u]) continue
    entries.push({
      name: peripherals[u].name,
      address: peripherals[u].address,
      percentage: peripherals[u].percentage,
      charge: peripherals[u].charge,
      matched: false
    })
  }

  entries.sort(function(a, b) {
    if (a.percentage !== b.percentage) return a.percentage - b.percentage
    return String(a.name).localeCompare(String(b.name))
  })
  return entries
}

function headlineBattery(entries) {
  return entries && entries.length ? entries[0] : null
}

function unmatchedBatteries(entries) {
  var list = []
  for (var i = 0; i < (entries || []).length; i++) {
    if (!entries[i].matched) list.push(entries[i])
  }
  return list
}

function batteryForAddress(entries, address) {
  var want = normalizedAddress(address)
  if (!want) return null
  for (var i = 0; i < (entries || []).length; i++) {
    if (entries[i].matched && entries[i].address === want) return entries[i]
  }
  return null
}


// Only a device that is charging gets a state word. The plugin keeps these
// words in English: it runs on the installed 4.0.6 shell and does not use
// the catalog.
function chargeLabel(charge) {
  if (charge === "charging") return "Charging"
  return ""
}

function formatBatteryStatus(entry) {
  if (!entry || entry.percentage === undefined || entry.percentage === null) return ""
  var percentage = String(entry.percentage)
  if (chargeLabel(entry.charge)) return percentage + "% · " + chargeLabel(entry.charge)
  return percentage + "%"
}

function formatBatteryLine(entry) {
  if (!entry) return ""
  var name = entry.name || "Device"
  var percentage = String(entry.percentage)
  if (chargeLabel(entry.charge)) return name + " " + percentage + "% · " + chargeLabel(entry.charge)
  return name + " " + percentage + "%"
}

function formatBatteryTooltip(entries) {
  var lines = []
  var list = entries || []
  for (var i = 0; i < list.length; i++) lines.push(formatBatteryLine(list[i]))
  return lines.join("\n")
}

// Primitives-only projection of a BlueZ device for list-model rows. Holding
// the Device QObject in model data puts a live wrapper into every delegate's
// var property, and BlueZ churn (discovery timeouts, unpair) can destroy the
// object while a delegate is still incubating, which segfaults quickshell.
// Actions resolve the backend object via Panel.deviceFor(). `battery` is the
// matching readout, when there is one, so the row can show UPower's level
// without holding the UPower object either.
function deviceRow(d, battery) {
  if (!d) return null
  var fromBattery = !!(battery && battery.percentage !== undefined && battery.percentage !== null)
  var reported = fromBattery ? Math.round(Number(battery.percentage)) : (d.batteryAvailable ? Math.round(Number(d.battery) * 100) : null)
  if (reported !== null && (!isFinite(reported) || reported < 0 || reported > 100)) reported = null
  var row = {
    address: d.address || "",
    name: d.name || "",
    deviceName: d.deviceName || "",
    connected: !!d.connected,
    state: d.state !== undefined ? d.state : -1,
    batteryAvailable: reported !== null,
    battery: reported !== null ? reported / 100 : 0,
    percentage: reported,
    charge: fromBattery && reported !== null && battery.charge ? battery.charge : "",
    batteryText: "",
    pairing: !!d.pairing
  }
  row.batteryText = reported !== null ? formatBatteryStatus(row) : ""
  return row
}

function deviceLists(devices) {
  var values = toArray(devices)
  var connected = []
  var known = []
  var discovered = []

  for (var i = 0; i < values.length; i++) {
    var d = values[i]
    if (!d || !hasHumanName(d)) continue
    if (d.connected) connected.push(d)
    else if (d.paired || d.bonded || d.trusted) known.push(d)
    else discovered.push(d)
  }

  return {
    connected: sortedByLabel(connected),
    known: sortedByLabel(known),
    discovered: sortedByLabel(discovered)
  }
}

function cloneMap(map) {
  var next = ({})
  for (var key in map || {}) next[key] = map[key]
  return next
}

function pendingAction(actions, address) {
  return address && actions && actions[address] ? actions[address] : ""
}

function withPendingAction(actions, address, action) {
  var next = cloneMap(actions)
  if (!address) return next
  if (action) next[address] = action
  else delete next[address]
  return next
}

function visibleSections(lists, discovering) {
  var sections = []
  if (lists && lists.connected && lists.connected.length > 0) sections.push("connected")
  if (lists && lists.known && lists.known.length > 0) sections.push("known")
  if (discovering && lists && lists.discovered && lists.discovered.length > 0) sections.push("discovered")
  return sections
}

function sectionDevices(lists, section) {
  if (!lists) return []
  if (section === "connected") return lists.connected || []
  if (section === "known") return lists.known || []
  if (section === "discovered") return lists.discovered || []
  return []
}

if (typeof module !== "undefined") {
  module.exports = {
    deviceLabel: deviceLabel,
    toArray: toArray,
    isUuidLike: isUuidLike,
    isAddressLike: isAddressLike,
    normalizedAddress: normalizedAddress,
    hasHumanName: hasHumanName,
    nodeProps: nodeProps,
    nodeText: nodeText,
    bluetoothSinkMatchesDevice: bluetoothSinkMatchesDevice,
    sortedByLabel: sortedByLabel,
    deviceRow: deviceRow,
    deviceLists: deviceLists,
    upowerAddress: upowerAddress,
    batteryReadouts: batteryReadouts,
    headlineBattery: headlineBattery,
    unmatchedBatteries: unmatchedBatteries,
    batteryForAddress: batteryForAddress,
    formatBatteryStatus: formatBatteryStatus,
    formatBatteryLine: formatBatteryLine,
    formatBatteryTooltip: formatBatteryTooltip,
    cloneMap: cloneMap,
    pendingAction: pendingAction,
    withPendingAction: withPendingAction,
    visibleSections: visibleSections,
    sectionDevices: sectionDevices
  }
}
