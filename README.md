# Sound

[![npm version](https://badge.fury.io/js/%40narraleaf%2Fsound.svg)](https://badge.fury.io/js/%40narraleaf%2Fsound)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)

A lightweight and modern HTML audio management solution, suitable for simple web games.

## @NarraLeaf/Sound

@NarraLeaf/Sound is a compact web audio playback library designed to fulfill specific audio playback requirements through a simple API.  
For instance, web games often require multiple distinct channels to manage sound. Sound provides a modern, elegant, and
intuitive interface to accomplish all of this.

## Documentation

For detailed documentation, please refer to the [documentation](doc/documentation.md).

## Quick Start

### Installation

```bash
npm install @narraleaf/sound
```

### Usage

For detailed documentation, please refer to the [documentation](doc/documentation.md).

To initialize the library:  
```ts
import { Sound } from "@narraleaf/sound";

const sound = new Sound();

await sound.onceReady(); // Wait for the audio context to be ready

// Control master volume
sound.setVolume(0.8); // Set master volume to 80%
console.log(sound.getVolume()); // Get current master volume

// Mute/unmute all audio
sound.mute(); // Mute all audio
sound.mute(false); // Unmute all audio
sound.unmute(); // Unmute all audio
console.log(sound.isMuted()); // Check if muted
```

To create multiple sound channels, you can use the `createChannel` method:  
```ts
const channel = sound.createChannel("channel-name");

const subChannel = channel.createChannel("sub-channel-name", {
    // Only allow 1 token to play at a time
    // If more than 1 token is playing, the oldest token will be stopped immediately
    limit: 1,
}); // Create a sub channel within the parent channel
```

To play a sound:  
```ts
const token = await channel.play("path/to/sound.mp3", {
    volume: 0.5,
    startTime: 1.0,
});
```

To apply effects to an audio:  
```ts
// Fade in
const fadeToken = token.fade(0, 1.0, 1000); // Fade in from 0 to 1.0 in 1000ms
await fadeToken.finished; // Wait for the fade to finish

// Set volume
token.setVolume(0.5); // will stop fading before changing the volume

// Stop
token.stop(); // this token will be cleaned up and cannot be used anymore
```

To apply effects to a channel:
```ts
channel.setVolume(0.5); // The volume of all audio in the channel will be multiplied by the channel's volume.

channel.mute(); // The volume of all audio in the channel will be multiplied by 0.
channel.mute(false); // Unmute the channel
channel.unmute(); // Unmute the channel
```

To cache the audio:  
```ts
const sfx = await sound.load("path/to/sound.mp3");

// Use the sfx
await channel.play(sfx, { /* options */ });

// Unload the sfx
await sfx.unload();
// Note: The `unload` method does not always succeed when multiple tokens are playing the same sfx.
// To force unload the sfx, you can use the `forceUnload` method.
await sfx.forceUnload();
```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
