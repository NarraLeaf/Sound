# Behavior

## Preload Mode

Sound's preloading behavior is designed to be simple and efficient.

Sound supports three preload modes:
- "stream": Use `<audio>` element with MediaElementAudioSourceNode to preload the audio.
- "full": Load the entire audio file into memory.
- "auto": Automatically determine the preload mode based on the audio file's size. If it fails to determine the preload mode, it will use "stream" by default.

You can specify the preload mode using the `load` option when playing an audio.  
```ts
const token = await channel.play("path/to/sound.mp3", {
    load: "full",
});
```

If the `auto` mode is used, Sound will send a HEAD request to the server to determine the size of the audio file. If the size is less than 10MB, it
will use "stream" mode. Otherwise, it will use "full" mode.  
If the server does not support HEAD requests or returned invalid response, it will fallback to "stream" mode.

When using `sound.load`, the audio will be forced to be loaded into memory.

### Difference between "stream" and "full"

In stream mode, audio is loaded and played via the `<audio>` element in a streaming manner. The audio element is connected to the Web Audio graph through a MediaElementAudioSourceNode, allowing volume control and other audio processing. The browser only needs to buffer the necessary data to
begin playback, making it suitable for long audio or large files.
Its advantages include low memory usage and simple startup, but its disadvantages are slightly higher playback startup latency and limited precise
control capabilities, making it unsuitable for scenarios requiring millisecond-level triggering.

Full mode loads and decodes the entire audio file into memory at once, making it suitable for short sound effects or interactive scenarios.
Its advantages include extremely low playback latency, high control precision, and the ability to run multiple instances concurrently. However, it consumes significant memory and is not friendly for large files.

In other words, stream mode is better suited for continuous playback of long audio, while full mode is better suited for instant triggering of short
sound effects.

## Audio Control Behaviors

### Volume Control and Transitions

#### Fade Effects
The `fade()` method creates smooth volume transitions over time. Key behaviors:

- **Single Active Fade**: Only one fade effect can be active on a token at a time. Calling `fade()` while another fade is in progress will cancel the previous fade and start the new one.
- **Promise Resolution**: The `finished` Promise resolves when the fade completes naturally, or when `cancel()` or `finish()` is called.
- **Immediate Completion**: A fade with `duration: 0` sets the volume instantly without creating a transition.

#### Volume Control Methods
The `setVolume()`, `mute()`, and `unmute()` methods have specific behaviors regarding ongoing transitions:

- **setVolume()**: Immediately cancels any ongoing fade and sets the volume. If called during a `stop({ fadeDuration })` operation, it cancels the fade-out and immediately stops the token.
- **mute()**: If a fade is in progress, it skips to the fade's target volume, then applies the mute state. This preserves the "fade will reach its target" intuition.
- **unmute()**: Similar to mute, it skips any ongoing fade to its target, then applies the unmute state.

#### Stop with Fade-Out
The `stop({ fadeDuration })` method creates an asynchronous stop operation:

- **Async Nature**: The method returns immediately, but the actual stopping is deferred until the fade completes.
- **Controllable During Fade**: During the fade-out period, the token remains controllable (volume changes, etc.) are allowed.
- **Interruption Handling**: If `setVolume()` is called during fade-out, it cancels the fade and immediately stops the token.

### Playback Control

#### Seek Behavior
- **AudioBufferSourceNode**: Seeking recreates the source node and starts playback from the new position, which may cause a brief interruption.
- **HTMLAudioElement**: Uses the native `currentTime` property for smooth seeking.

#### Rate Control
- **Immediate Application**: Rate changes take effect immediately on the underlying audio source.
- **Buffer Recreation**: For AudioBufferSourceNode, rate changes are applied to the current source node.

### Event System

#### Available Events
- `"ended"`: Fired when playback naturally reaches the end
- `"pause"`: Fired when `pause()` is called
- `"resume"`: Fired when `resume()` is called
- `"stop"`: Fired when `stop()` is called (including fade-out completion)
- `"seek"`: Fired when `seek()` changes the playback position

#### Event Emission
Events are emitted through the internal source controller, with additional state management in the SoundToken class.