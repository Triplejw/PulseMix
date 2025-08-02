# PulseMix 🎛️🎵

**PulseMix** is a cross-platform audio visualizer and stereo mixer built with GTK and C++. It provides a minimalist yet powerful interface to monitor and adjust stereo audio output in real-time.

## 🔧 Features
- 🎚️ Left/Right channel volume control
- 🌌 Wide soundstage slider
- 🎧 Real-time waveform visualization
- 🛠️ Built using PortAudio, libsndfile, and GTK

## 📸 Screenshots
*(Add screenshots of your app UI here)*

## 🚀 Getting Started

### Prerequisites
- GTK 3
- PortAudio
- libsndfile

### Build Instructions
```bash
g++ main.cpp -o pulsemix `pkg-config --cflags --libs gtk+-3.0` -lsndfile -lportaudio
