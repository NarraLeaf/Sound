# Sound Documentation

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
