#include "pulsemix/dsp.hpp"
#include <cmath>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <vector>

void check(bool condition, const char* message) {
  if (!condition) throw std::runtime_error(message);
}
void near(float actual, float expected, const char* message, float tolerance = 2e-5f) {
  check(std::abs(actual - expected) < tolerance, message);
}
double tone_energy(float frequency, float eq_db, int band) {
  pulsemix::Engine engine(48000);
  pulsemix::Parameters p;
  p.limiter = false;
  if (band == 0) p.low_db = eq_db;
  if (band == 1) p.mid_db = eq_db;
  if (band == 2) p.high_db = eq_db;
  engine.set_parameters(p); engine.reset();
  std::vector<float> l(48000), r(48000);
  for (int i = 0; i < 48000; ++i) l[i] = r[i] = 0.1f * std::sin(2 * 3.141592653589793 * frequency * i / 48000);
  engine.process(l.data(), r.data(), l.size());
  double energy = 0;
  for (int i = 24000; i < 48000; ++i) energy += l[i] * l[i];
  return energy;
}
int main() {
  try {
    pulsemix::Engine engine(48000);
    float l[] = {0.2f, -0.8f, 0, 0.5f}, r[] = {-0.4f, 0.1f, 0, 0.5f};
    engine.process(l, r, 4);
    near(l[0], 0.2f, "Neutral processing changes left signal");
    near(r[1], 0.1f, "Neutral processing changes right signal");
    pulsemix::Parameters p;
    p.width = 0;
    engine.set_parameters(p); engine.reset();
    engine.process(l, r, 4);
    for (int i = 0; i < 4; ++i) near(l[i], r[i], "Width zero must produce mono");
    p.width = 2; p.limiter = false;
    engine.set_parameters(p); engine.reset();
    float a = 0.25f, b = -0.25f;
    engine.process(&a, &b, 1);
    near(a, 0.5f, "Width must amplify side signal"); near(b, -0.5f, "Side symmetry");
    p.width = 1; p.master_db = -6.0206f;
    engine.set_parameters(p); engine.reset();
    a = b = 0.5f; engine.process(&a, &b, 1);
    near(a, 0.25f, "dB gain conversion");
    p.balance = 1;
    engine.set_parameters(p); engine.reset();
    a = b = 0.5f; engine.process(&a, &b, 1);
    near(a, 0, "Right balance must mute left"); near(b, 0.25f, "Balance must preserve right");
    p = {}; p.master_db = 12; p.limiter = true;
    engine.set_parameters(p); engine.reset();
    a = 0.8f; b = 0.4f; engine.process(&a, &b, 1);
    near(a, 1, "Peak guard must bound output"); near(b, 0.5f, "Guard must preserve stereo ratio");
    p.bypass = true; engine.set_parameters(p); engine.reset();
    a = 0.3f; b = -0.2f; engine.process(&a, &b, 1);
    near(a, 0.3f, "Bypass must preserve input"); near(b, -0.2f, "Bypass right");
    p = {}; engine.set_parameters(p); engine.reset();
    p.master_db = -60; engine.set_parameters(p);
    a = b = 0.5f; engine.process(&a, &b, 1);
    check(a > 0.49f, "Live gain change must be smoothed");
    std::vector<float> silent_l(48000), silent_r(48000);
    engine.reset(); engine.process(silent_l.data(), silent_r.data(), silent_l.size());
    for (float sample : silent_l) near(sample, 0, "Silence must remain silent");
    a = std::numeric_limits<float>::quiet_NaN(); b = 0;
    engine.process(&a, &b, 1); check(std::isfinite(a), "Non-finite samples must not poison DSP");
    for (int band = 0; band < 3; ++band) {
      const float frequency = band == 0 ? 40 : band == 1 ? 1000 : 12000;
      const double flat = tone_energy(frequency, 0, band);
      check(tone_energy(frequency, 6, band) > flat * 2.5, "EQ boost response");
      check(tone_energy(frequency, -6, band) < flat * 0.4, "EQ cut response");
    }
    // Processing must not depend on callback/block size.
    pulsemix::Engine whole(44100), chunks(44100);
    p.low_db = 5; p.width = 1.7f;
    whole.set_parameters(p); chunks.set_parameters(p);
    std::vector<float> x(4096, 0.2f), y(4096, -0.1f), cx = x, cy = y;
    whole.process(x.data(), y.data(), x.size());
    for (std::size_t i = 0; i < x.size(); i += 128) chunks.process(cx.data() + i, cy.data() + i, 128);
    for (std::size_t i = 0; i < x.size(); ++i) {
      near(cx[i], x[i], "Block-size independent left"); near(cy[i], y[i], "Block-size independent right");
    }
    std::cout << "DSP invariants passed\n";
    return 0;
  } catch (const std::exception& e) { std::cerr << e.what() << '\n'; return 1; }
}
