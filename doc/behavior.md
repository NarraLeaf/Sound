# Behavior

## Preload Mode

Sound's preloading behavior is designed to be simple and efficient.

Sound supports three preload modes:
- "stream": Use `<audio>` element to preload the audio.
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

In stream mode, audio is loaded and played via the `<audio>` element in a streaming manner. The browser only needs to buffer the necessary data to
begin playback, making it suitable for long audio or large files.
Its advantages include low memory usage and simple startup, but its disadvantages are slightly higher playback startup latency and limited precise
control capabilities, making it unsuitable for scenarios requiring millisecond-level triggering.

Full mode loads and decodes the entire audio file into memory at once, making it suitable for short sound effects or interactive scenarios.
Its advantages include extremely low playback latency, high control precision, and the ability to run multiple instances concurrently. However, it consumes significant memory and is not friendly for large files.

In other words, stream mode is better suited for continuous playback of long audio, while full mode is better suited for instant triggering of short
sound effects.
