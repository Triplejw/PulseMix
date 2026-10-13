#include "pulsemix/dsp.hpp"
#include <sndfile.h>
#include <algorithm>
#include <array>
#include <cmath>
#include <iomanip>
#include <iostream>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
using File = std::unique_ptr<SNDFILE, decltype(&sf_close)>;
constexpr int block_size = 2048;
constexpr sf_count_t max_frames = 12000000;
File open_input(const char* path, SF_INFO& info) {
  File file(sf_open(path, SFM_READ, &info), sf_close);
  if (!file) throw std::runtime_error(sf_strerror(nullptr));
  const int format = info.format & SF_FORMAT_TYPEMASK;
  if (format != SF_FORMAT_WAV && format != SF_FORMAT_WAVEX && format != SF_FORMAT_FLAC)
    throw std::runtime_error("Only WAV and FLAC files are supported");
  if (info.channels < 1 || info.channels > 2)
    throw std::runtime_error("Only mono and stereo files are supported");
  if (info.samplerate < 8000 || info.samplerate > 192000 || info.frames <= 0 ||
      info.frames > max_frames || info.frames > static_cast<sf_count_t>(info.samplerate) * 300)
    throw std::runtime_error("Audio must be nonempty, <=5 minutes, <=12 million frames, and 8–192 kHz");
  return file;
}
void analyze(SNDFILE* file, const SF_INFO& info) {
  const int buckets = static_cast<int>(std::min<sf_count_t>(1024, info.frames));
  std::vector<std::array<float, 4>> waveform(buckets, {0, 0, 0, 0});
  std::array<float, block_size * 2> buffer{};
  std::array<double, 2> square{}, peak{};
  double cross = 0;
  sf_count_t total = 0, frames;
  while ((frames = sf_readf_float(file, buffer.data(), block_size)) > 0) {
    for (sf_count_t i = 0; i < frames; ++i) {
      const float l = buffer[i * info.channels];
      const float r = buffer[i * info.channels + (info.channels == 2 ? 1 : 0)];
      if (!std::isfinite(l) || !std::isfinite(r)) throw std::runtime_error("Non-finite audio samples");
      const int bucket = std::min(buckets - 1, static_cast<int>((total + i) * buckets / info.frames));
      auto& w = waveform[bucket];
      w[0] = std::min(w[0], l); w[1] = std::max(w[1], l);
      w[2] = std::min(w[2], r); w[3] = std::max(w[3], r);
      square[0] += static_cast<double>(l) * l; square[1] += static_cast<double>(r) * r;
      peak[0] = std::max(peak[0], static_cast<double>(std::abs(l)));
      peak[1] = std::max(peak[1], static_cast<double>(std::abs(r)));
      cross += static_cast<double>(l) * r;
    }
    total += frames;
  }
  if (sf_error(file) || total != info.frames) throw std::runtime_error("Incomplete audio data");
  const double energy = std::sqrt(square[0] * square[1]);
  std::cout << std::setprecision(9) << "{\"sample_rate\":" << info.samplerate
            << ",\"channels\":" << info.channels << ",\"frames\":" << total
            << ",\"duration\":" << static_cast<double>(total) / info.samplerate
            << ",\"peak\":[" << peak[0] << ',' << peak[1] << "],\"rms\":["
            << std::sqrt(square[0] / total) << ',' << std::sqrt(square[1] / total)
            << "],\"correlation\":" << (energy > 0 ? cross / energy : 0) << ",\"waveform\":[";
  for (int i = 0; i < buckets; ++i) {
    if (i) std::cout << ',';
    const auto& w = waveform[i];
    std::cout << '[' << w[0] << ',' << w[1] << ',' << w[2] << ',' << w[3] << ']';
  }
  std::cout << "]}\n";
}
void render(SNDFILE* input, const SF_INFO& info, const char* output, const pulsemix::Parameters& p) {
  SF_INFO out_info{};
  out_info.samplerate = info.samplerate; out_info.channels = 2;
  out_info.format = SF_FORMAT_WAV | SF_FORMAT_FLOAT;
  File file(sf_open(output, SFM_WRITE, &out_info), sf_close);
  if (!file) throw std::runtime_error(sf_strerror(nullptr));
  pulsemix::Engine engine(static_cast<float>(info.samplerate));
  engine.set_parameters(p); engine.reset();
  std::array<float, block_size * 2> input_buffer{}, output_buffer{};
  std::array<float, block_size> left{}, right{};
  sf_count_t frames, total = 0;
  while ((frames = sf_readf_float(input, input_buffer.data(), block_size)) > 0) {
    for (sf_count_t i = 0; i < frames; ++i) {
      left[i] = input_buffer[i * info.channels];
      right[i] = input_buffer[i * info.channels + (info.channels == 2 ? 1 : 0)];
    }
    engine.process(left.data(), right.data(), static_cast<std::size_t>(frames));
    for (sf_count_t i = 0; i < frames; ++i) {
      output_buffer[2 * i] = left[i]; output_buffer[2 * i + 1] = right[i];
    }
    if (sf_writef_float(file.get(), output_buffer.data(), frames) != frames)
      throw std::runtime_error("Could not write complete output");
    total += frames;
  }
  if (sf_error(input) || total != info.frames) throw std::runtime_error("Incomplete audio data");
  sf_write_sync(file.get());
}
float number(const char* value, float low, float high) {
  std::size_t used = 0;
  const std::string text(value);
  const float n = std::stof(text, &used);
  if (used != text.size() || !std::isfinite(n) || n < low || n > high)
    throw std::runtime_error("Invalid processing parameter");
  return n;
}
}
int main(int argc, char** argv) {
  try {
    if (argc < 3) throw std::runtime_error("Usage: pulsemix analyze INPUT | render INPUT OUTPUT [master left right balance width low mid high bypass guard]");
    SF_INFO info{};
    auto input = open_input(argv[2], info);
    const std::string command(argv[1]);
    if (command == "analyze" && argc == 3) analyze(input.get(), info);
    else if (command == "render" && (argc == 4 || argc == 14)) {
      pulsemix::Parameters p;
      if (argc == 14) {
        p = {number(argv[4], -60, 12), number(argv[5], -60, 6), number(argv[6], -60, 6),
             number(argv[7], -1, 1), number(argv[8], 0, 2), number(argv[9], -12, 12),
             number(argv[10], -12, 12), number(argv[11], -12, 12),
             number(argv[12], 0, 1) != 0, number(argv[13], 0, 1) != 0};
      }
      render(input.get(), info, argv[3], p);
    } else throw std::runtime_error("Invalid command or parameter count");
    return 0;
  } catch (const std::exception& e) {
    std::cerr << e.what() << '\n';
    return 1;
  }
}
