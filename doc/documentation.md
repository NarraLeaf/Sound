# Sound Documentation

## Table of Contents

- [Sound](#sound)
  - [constructor(options?: SoundOptions)](#constructoroptions-soundoptions)
  - [onceReady(): Promise<this>](#onceready-promise-this)
  - [setVolume(volume: number): this](#setvolumevolume-number-this)
  - [mute(): this](#mute-this)
  - [mute(muted: boolean): this](#mute-muted-boolean-this)
  - [unmute(): this](#unmute-this)
  - [createChannel(name: string, options?: ChannelOptions): Channel](#createchannelname-string-options-channeloptions-channel)
  - [getChannel(name: string): Channel | null](#getchannelname-string-channel--null)
  - [load(path: string): Promise<CachedAudio>](#loadpath-string-promise-cachedaudio)
  - [destroy(): void](#destroy-void)
  - [play(path: string | CachedAudio, options?: PlayOptions): Promise<SoundToken>](#playpath-string--cachedaudio-options-playoptions-promise)
  - [getTokens(): SoundToken[]](#gettokens-soundtoken)
- [Channel](#channel)
  - [play(path: string | CachedAudio, options?: PlayOptions): Promise<SoundToken>](#channel)
  - [createChannel(name: string, options?: ChannelOptions): Channel](#createchannelname-string-options-channeloptions-channel-1)
  - [getChannel(name: string): Channel | null](#getchannelname-string-channel--null-1)
  - [setVolume(volume: number): this](#setvolumevolume-number-this-1)
  - [getVolume(): number](#getvolume-number-1)
  - [mute(): this](#mute-this-1)
  - [mute(muted: boolean): this](#mute-muted-boolean-this-1)
  - [unmute(): this](#unmute-this-1)
  - [isMuted(): boolean](#ismuted-boolean-1)
  - [remove(): this](#remove-this)
  - [getTokens(): SoundToken[]](#gettokens-soundtoken-1)
- [CachedAudio](#cachedaudio)
  - [unload(): Promise<void>](#unload-promise-void)
  - [forceUnload(): Promise<void>](#forceunload-promise-void)
  - [isAlive(): boolean](#isalive-boolean)
  - [raw(): AudioBuffer](#raw-audiobuffer)
- [SoundToken](#soundtoken)
  - [stop(StopOptions?: StopOptions): this](#stopstopoptions-stopoptions-this)
  - [setVolume(volume: number): this](#setvolumevolume-number-this-2)
  - [getVolume(): number](#getvolume-number-2)
  - [mute(): this](#mute-this-2)
  - [mute(muted: boolean): this](#mute-muted-boolean-this-2)
  - [unmute(): this](#unmute-this-2)
  - [setRate(rate: number): this](#setraterate-number-this)
  - [getRate(): number](#getrate-number)
  - [seek(time: number): this](#seektime-number-this)
  - [getCurrentTime(): number](#getcurrenttime-number)
  - [getDuration(): number](#getduration-number)
  - [pause(): this](#pause-this)
  - [resume(): this](#resume-this)
  - [isPlaying(): boolean](#isplaying-boolean)
  - [isPaused(): boolean](#ispaused-boolean)
  - [fade(from: number, to: number, duration: number): FadeToken](#fadefrom-number-to-number-duration-number-fadetoken)
  - [on(event: string, callback: Function): this](#onevent-string-callback-function-this)
  - [off(event: string, callback: Function): this](#offevent-string-callback-function-this)
  - [once(event: string, callback: Function): this](#onceevent-string-callback-function-this)

## Sound

`Sound` is the main class that manages the audio context and the sound channels. It also has a "master volume" that can be used to control
the volume of all audio in the sound context.

### constructor(options?: SoundOptions)

Creates a new `Sound` instance.

Options can be a `SoundOptions` object:  
```ts
interface SoundOptions {
    /**
     * The volume of the sound context.
     * @default 1
     * @range [0, 1]
     */
    volume?: number;
}
```

### onceReady(): Promise<this>

Wait for the audio context to be ready.

```ts
const sound = await new Sound().onceReady();
```

### setVolume(volume: number): this

Set the volume of all the audio managed by the current `Sound` instance. The volume is a number between 0 and 1.

```ts
sound.setVolume(0.5);
```

### getVolume(): number

Get the volume of the current `Sound` instance.

### mute(): this

Mute all the audio managed by the current `Sound` instance.

### mute(muted: boolean): this

Mute or unmute all the audio managed by the current `Sound` instance.

```ts
sound.mute(false); // Unmute all the audio
```

### unmute(): this

Unmute all the audio managed by the current `Sound` instance.

```ts
sound.unmute();
```

### isMuted(): boolean

Check if the current `Sound` instance is muted.

### createChannel(name: string, options?: ChannelOptions): Channel

Create a new channel. If a channel with the same name already exists, an error will be thrown.

```ts
const channel = sound.createChannel("channel-name", {
    // The volume of the channel.
    // @default 1
    // @range [0, 1]
    volume?: number;
});
```

The `ChannelOptions` is defined as follows:
```ts
interface ChannelOptions {
    /**
     * The volume of the channel.
     * @default 1
     * @range [0, 1]
     */
    volume?: number;
    /**
     * The limit of the number of tokens that can play at the same time.
     * @default Infinity
     * @range [1, Infinity]
     */
    limit?: number;
}
```

### getChannel(name: string): Channel | null

Get a channel by name. Returns the channel if it exists, otherwise returns null.

```ts
const channel = sound.getChannel("channel-name");
if (channel) {
    channel.play("path/to/sound.mp3");
}
```

### load(path: string): Promise<CachedAudio>

Load a sound file and cache it.

```ts
const cachedAudio = await sound.load("path/to/sound.mp3");

someChannel.play(cachedAudio, { /* options */ }); // Play the cached audio
```

### destroy(): void

Destroy the current audio context. The sound will be unloaded and cannot be used anymore. All tokens playing will be stopped immediately.

```ts
sound.destroy();

sound.createChannel("channel-name", { /* ... */ }); // This will throw an error
channel.play(/* ... */); // This will throw an error
```

### play(path: string | CachedAudio, options?: PlayOptions): Promise<SoundToken>

Play the audio directly without using a channel.

```ts
const token = await sound.play("path/to/sound.mp3", { /* options */ });
```

The volume of the token will be only depending on the master volume, which is the volume of the `Sound` instance.

The `PlayOptions` is defined as follows:  
```ts
interface PlayOptions {
    /**
     * The volume of the token.
     * @default 1
     * @range [0, 1]
     */
    volume?: number;
    /**
     * The start time of the token. The token will start playing from the start time.
     * @default 0
     * @range [0, Infinity]
     */
    startTime?: number;
    /**
     * The end time of the token. When the token reaches the end time, it will be stopped automatically.  
     * When the `loop` option is true, the token will loop back to the start time.
     * @default Infinity
     * @range (startTime, Infinity]
     */
    endTime?: number;
    /**
     * The rate of the token.
     * @default 1
     * @range (0, Infinity]
     */
    rate?: number;
    /**
     * Specify the loading mode. 
     * @default "auto"
     * @enum ["stream", "full", "auto"]
     * - "stream": Use `<audio>` element to play the audio.
     * - "full": Load the entire audio file into memory.
     * - "auto": Automatically determine the loading mode based on the audio file's size. If it fails to determine the loading mode, it will use "stream" by default. For more details, please refer to [Behavior](https://github.com/NarraLeaf/Sound/blob/master/doc/behavior.md).
     */
    load?: "stream" | "full" | "auto";
    /**
     * Loop the token.
     * @default false
     */
    loop?: boolean;
}
```

### getTokens(): SoundToken[]

Get all currently playing sound tokens managed by this Sound instance.

```ts
const tokens = sound.getTokens();
tokens.forEach(token => {
    token.stop({ fadeDuration: 1000 });
});
```

## Channel

`Channel` is a class that manages a channel of audio. It can be used to play audio and apply effects to it.  
Channels can be nested to create a tree of channels.

For example, the following code creates a tree of channels:
```ts
const sound = new Sound();
const channel = sound.createChannel("channel-name", { volume: 0.5 });
const subChannel = channel.createChannel("sub-channel-name", { volume: 0.5 });

const token = await subChannel.play("path/to/sound.mp3");
```  
The sound will be played at 50% x 50% = 25% volume.

### play(path: string | CachedAudio, options?: PlayOptions): Promise<SoundToken>

Play a sound. The Channel will load the sound file and play it.

### createChannel(name: string, options?: ChannelOptions): Channel

Create a new sub-channel. If a channel with the same name already exists, an error will be thrown.

```ts
const subChannel = channel.createChannel("sub-channel-name", {
    volume: 0.5,
    limit: 1
});
```

### getChannel(name: string): Channel | null

Get a sub-channel by name. Returns the sub-channel if it exists, otherwise returns null.

```ts
const subChannel = channel.getChannel("sub-channel-name");
if (subChannel) {
    subChannel.play("path/to/sound.mp3");
}
```

### setVolume(volume: number): this

Set the volume of the current `Channel`. The volume is a number between 0 and 1.

```ts
channel.setVolume(0.5);
```

### getVolume(): number

Get the volume of the current `Channel`.

### mute(): this

Mute the current `Channel`.

```ts
channel.mute();
```

### mute(muted: boolean): this

Mute or unmute the current `Channel`.

```ts
channel.mute(false); // Unmute the channel
```

### unmute(): this

Unmute the current `Channel`.

```ts
channel.unmute();
```

### isMuted(): boolean

Check if the current `Channel` is muted.

### remove(): this

Remove the current `Channel` from the `Sound` instance. The channel will be destroyed and cannot be used anymore.

```ts
channel.remove(); // Remove the channel from the sound instance

channel.play(/* ... */); // This will throw an error
```

### getTokens(): SoundToken[]

Get all currently playing sound tokens managed by this Channel instance, including tokens from all sub-channels.

```ts
const tokens = channel.getTokens();
tokens.forEach(token => {
    token.setVolume(0.5);
});
```

## CachedAudio

`CachedAudio` is a class that represents a cached sound file. It can be used to play the cached audio.

### unload(): Promise<void>

Unload the cached audio. This method will unload the audio only if there are no tokens playing the audio. This method will silently fail if the action
is not successful.

```ts
await cachedAudio.unload();

if (cachedAudio.isAlive()) {
    console.log("Cached audio is still alive, some tokens are still playing it");
}
```

### forceUnload(): Promise<void>

Force unload the cached audio. This method will unload the audio even if there are tokens playing the audio. 

```ts
await cachedAudio.forceUnload();
```

### isAlive(): boolean

Check if the cached audio is alive.

```ts
if (cachedAudio.isAlive()) {
    cachedAudio.unload(); // Unload the cached audio if it is alive
}
```

### raw(): AudioBuffer

Get the raw audio buffer of the cached audio.

## SoundToken

`SoundToken` is a class that represents a token that is playing a sound. It can be used to control the playback of the sound.

### stop(StopOptions?: StopOptions): this

Stop the token. The token will be cleaned up and cannot be used anymore.

```ts
token.stop(); // Stop immediately
token.stop({ fadeDuration: 1000 }); // Stop with a fade out with 1000ms duration
```

The `StopOptions` is defined as follows:  
```ts
interface StopOptions {
    /**
     * The duration of the fade out. When specified, the token will fade out to 0 over the duration.
     * @default 0
     * @range [0, Infinity]
     */
    fadeDuration?: number;
}
```

### setVolume(volume: number): this

Set the volume of the token. The volume is a number between 0 and 1. This method will stop any ongoing fade effect and set the volume immediately.

```ts
token.setVolume(0.5); // Set volume to 50%
```

### getVolume(): number

Get the current volume of the token.

```ts
const volume = token.getVolume(); // Returns a number between 0 and 1
```

### mute(): this

Mute the token.

```ts
token.mute();
```

### mute(muted: boolean): this

Mute or unmute the token.

```ts
token.mute(false); // Unmute the token
```

### unmute(): this

Unmute the token.

```ts
token.unmute();
```

### isMuted(): boolean

Check if the token is muted.

```ts
const isMuted = token.isMuted(); // Returns true if the token is muted
```

### setRate(rate: number): this

Set the playback rate of the token. The rate is a number greater than 0, where 1 is normal speed.

```ts
token.setRate(1.5); // Play at 1.5x speed
token.setRate(0.5); // Play at half speed
```

### getRate(): number

Get the current playback rate of the token.

```ts
const rate = token.getRate(); // Returns the current playback rate
```

### seek(time: number): this

Seek to a specific time in the audio. The time is in seconds.

```ts
token.seek(10.5); // Jump to 10.5 seconds into the audio
token.seek(0);    // Jump to the beginning
```

### getCurrentTime(): number

Get the current playback position in seconds.

```ts
const currentTime = token.getCurrentTime(); // Returns current position in seconds
```

### getDuration(): number

Get the total duration of the audio in seconds.

```ts
const duration = token.getDuration(); // Returns total duration in seconds
```

### pause(): this

Pause the token. The token can be resumed later.

```ts
token.pause();
```

### resume(): this

Resume playback of a paused token.

```ts
token.resume();
```

### isPlaying(): boolean

Check if the token is currently playing.

```ts
if (token.isPlaying()) {
    console.log("Token is playing");
}
```

### isPaused(): boolean

Check if the token is currently paused.

```ts
if (token.isPaused()) {
    console.log("Token is paused");
}
```

### fade(from: number, to: number, duration: number): FadeToken

Create a fade effect on the token's volume. Returns a `FadeToken` that can be used to control the fade.

```ts
// Fade in from 0 to 1.0 over 1000ms
const fadeToken = token.fade(0, 1.0, 1000);
await fadeToken.finished; // Wait for fade to complete

// Fade out from current volume to 0 over 500ms
token.fade(token.getVolume(), 0, 500);
```

To cancel a fade, you can call the `cancel` method on the `FadeToken`.

```ts
fadeToken.cancel();
```

The `FadeToken` is defined as follows:
```ts
interface FadeToken {
    /**
     * Wait for the fade to complete.
     */
    finished: Promise<void>;
    /**
     * Cancel the fade.
     */
    cancel(): void;
    /**
     * Finish the fade immediately.
     */
    finish(): void;
}
```

### on(event: string, callback: Function): this

Add an event listener to the token.

Available events:
- `"ended"`: Fired when the token finishes playing
- `"pause"`: Fired when the token is paused
- `"resume"`: Fired when the token resumes playing
- `"stop"`: Fired when the token is stopped
- `"seek"`: Fired when the token seeks to a new position

```ts
token.on("ended", () => {
    console.log("Playback ended");
});

token.on("pause", () => {
    console.log("Playback paused");
});

token.on("resume", () => {
    console.log("Playback resumed");
});
```

### off(event: string, callback: Function): this

Remove an event listener from the token.

```ts
const onEnded = () => console.log("Playback ended");

token.on("ended", onEnded);
// Later...
token.off("ended", onEnded);
```

### once(event: string, callback: Function): this

Add a one-time event listener to the token. The listener will be automatically removed after the event fires once.

```ts
token.once("ended", () => {
    console.log("Playback ended (this will only log once)");
});
```
