// Turns the macOS IAC Driver on (the same as ticking "Device is online" in Audio MIDI Setup) and
// lists the MIDI destinations apps can then see. Undo it in Audio MIDI Setup › MIDI Studio.
// Usage: swift tools/iac-online.swift
import CoreMIDI

func name(_ o: MIDIObjectRef) -> String {
  var s: Unmanaged<CFString>?
  MIDIObjectGetStringProperty(o, kMIDIPropertyName, &s)
  return (s?.takeRetainedValue() as String?) ?? "?"
}

var found = false
for i in 0..<MIDIGetNumberOfDevices() {
  let d = MIDIGetDevice(i)
  guard name(d) == "IAC Driver" else { continue }
  found = true
  let status = MIDIObjectSetIntegerProperty(d, kMIDIPropertyOffline, 0)
  print(status == noErr ? "IAC Driver is online." : "Could not turn the IAC Driver on (error \(status)); use Audio MIDI Setup.")
}
if !found { print("No IAC Driver found; open Audio MIDI Setup › MIDI Studio.") }
print("MIDI destinations now:")
for i in 0..<MIDIGetNumberOfDestinations() { print(" -", name(MIDIGetDestination(i))) }
