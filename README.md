# PulseMix

PulseMix is a compact C++/GTK desktop experiment for stereo audio playback and visualization. It combines a two-channel level display with left/right volume controls and a soundstage-width control.

## Implemented

- GTK 3 desktop interface
- Stereo channel volume controls
- Soundstage-width adjustment
- Audio-file loading through libsndfile
- Playback through PortAudio
- Live waveform/level visualization

## Dependencies

- A C++17 compiler
- GTK 3 development headers
- PortAudio
- libsndfile

On Debian/Ubuntu:

```bash
sudo apt install build-essential libgtk-3-dev portaudio19-dev libsndfile1-dev
```

## Build and run

```bash
git clone https://github.com/Triplejw/PulseMix.git
cd PulseMix
g++ -std=c++17 pulsemix.cpp -o pulsemix $(pkg-config --cflags --libs gtk+-3.0) -lsndfile -lportaudio
./pulsemix
```

The project is a Linux-oriented prototype. Platform-specific audio-device behavior and packaging have not been tested across macOS and Windows.
