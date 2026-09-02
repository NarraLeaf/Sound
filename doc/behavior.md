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
will use "full" mode. Otherwise, it will use "stream" mode.  
If the server does not support HEAD requests or returned an invalid response, it will fall back to "stream" mode.

Only `http:` and `https:` sources are asked. The others are decided without a request:

- `data:` and `blob:` sources are already in memory, so there is nothing to stream and decoding is
  the only cost — those use "full" mode.
- Any other scheme — an application's own protocol such as `app://`, or `file:` — cannot be counted
  on to answer a HEAD at all, and a handler that does not implement it may answer by serving the
  whole file. Those take the documented fallback, "stream", without a request.

An application serving its assets over a custom protocol therefore gets streaming for everything
under `auto`, which is right for music and wrong for short effects. **Say which one you want**: an
explicit `load: "full"` or `load: "stream"` is honoured as given and never sends a request.

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

The one thing full mode can express that stream mode cannot is a **loop region**. A decoded buffer
repeats a marked section of itself sample-accurately (`startTime`, `loopStart`, `endTime`); an
`<audio>` element only repeats the whole file, so a streamed token ignores `endTime` and
`loopStart` when it loops.

## The Audio Cache

Every clip played in full mode is decoded once and kept in a per-`Sound` cache, keyed by the path it
was loaded from. A decoded clip is a float32 PCM buffer whose size has nothing to do with the size
of the file: a five-minute 44.1 kHz stereo track is about 106 MB decoded whatever it was encoded as.
So what the cache keeps, and for how long, is the difference between a game that holds a few tens of
megabytes and one that grows for the length of a session.

Two counts decide when a clip is let go:

- **references**, held by callers — `sound.load(path)` and `cachedAudio.retain()` each add one,
  `sound.release(path)` and `cachedAudio.release()` each give one back;
- **playing tokens** — a token holds the clip from the moment it starts to the moment it stops or
  reaches its end.

When both reach zero the decoded buffer is dropped and the entry leaves the cache. A short
`SoundOptions.cacheReleaseDelay` keeps it for that long first, so a clip replayed in quick
succession is not fetched and decoded again each time; `0`, the default, drops it at once.

Playing **by path** takes no reference of its own, so `channel.play("hit.wav", {load: "full"})`
leaves nothing behind once its token stops. Take a reference only for a clip that must stay warm
between plays — a scene's sound effects, say — and give it back when the scene is over.

Dropping a buffer never cuts off a token that is already playing it: a source node holds its own
reference to the buffer it was given, so `forceUnload()` and an expiring grace delay both leave
running tokens alone and only prevent new ones from starting off that handle.

`sound.getCacheStats()` reports what is held right now — how many clips, how many are in flight, and
how many bytes of PCM the decoded ones occupy.

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