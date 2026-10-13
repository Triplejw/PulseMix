#include "pulsemix/dsp.hpp"
#include <array>

namespace {
struct Processor {
  pulsemix::Engine engine;
  std::array<float, 2048> left{}, right{};
  explicit Processor(float sample_rate) : engine(sample_rate) {}
};
}
extern "C" {
Processor* dsp_create(float sample_rate) { return new Processor(sample_rate); }
void dsp_destroy(Processor* p) { delete p; }
float* dsp_left(Processor* p) { return p->left.data(); }
float* dsp_right(Processor* p) { return p->right.data(); }
void dsp_set(Processor* p, float master, float left, float right, float balance, float width,
             float low, float mid, float high, int bypass, int limiter) {
  p->engine.set_parameters({master, left, right, balance, width, low, mid, high,
                            bypass != 0, limiter != 0});
}
void dsp_reset(Processor* p) { p->engine.reset(); }
void dsp_process(Processor* p, int frames) {
  if (frames > 0 && frames <= 2048) p->engine.process(p->left.data(), p->right.data(), frames);
}
}
