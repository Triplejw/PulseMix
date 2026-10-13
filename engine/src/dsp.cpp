#include "pulsemix/dsp.hpp"
#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace pulsemix {
namespace {
constexpr double pi = 3.14159265358979323846;
double gain(float db) { return std::pow(10.0, db / 20.0); }
float bounded(float value, float low, float high) {
  return std::isfinite(value) ? std::clamp(value, low, high) : 0.0f;
}
// RBJ cookbook: low shelf, peaking EQ, high shelf. Shelf slope = 1; Q = sqrt(1/2).
std::array<double, 5> eq(int band, float db, float sample_rate) {
  const double frequency = std::min(band == 0 ? 150.0 : band == 1 ? 1000.0 : 4000.0,
                                    sample_rate * 0.4);
  const double w = 2 * pi * frequency / sample_rate;
  const double c = std::cos(w), s = std::sin(w), a = std::pow(10.0, db / 40.0);
  const double alpha = s / std::sqrt(2.0), beta = 2 * std::sqrt(a) * alpha;
  double b0, b1, b2, a0, a1, a2;
  if (band == 1) {
    b0 = 1 + alpha * a; b1 = -2 * c; b2 = 1 - alpha * a;
    a0 = 1 + alpha / a; a1 = -2 * c; a2 = 1 - alpha / a;
  } else if (band == 0) {
    b0 = a * ((a + 1) - (a - 1) * c + beta);
    b1 = 2 * a * ((a - 1) - (a + 1) * c);
    b2 = a * ((a + 1) - (a - 1) * c - beta);
    a0 = (a + 1) + (a - 1) * c + beta;
    a1 = -2 * ((a - 1) + (a + 1) * c);
    a2 = (a + 1) + (a - 1) * c - beta;
  } else {
    b0 = a * ((a + 1) + (a - 1) * c + beta);
    b1 = -2 * a * ((a - 1) + (a + 1) * c);
    b2 = a * ((a + 1) + (a - 1) * c - beta);
    a0 = (a + 1) - (a - 1) * c + beta;
    a1 = 2 * ((a - 1) - (a + 1) * c);
    a2 = (a + 1) - (a - 1) * c - beta;
  }
  return {b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0};
}
}  // namespace

Engine::Engine(float sample_rate) : sample_rate_(sample_rate) {
  if (!std::isfinite(sample_rate) || sample_rate < 8000 || sample_rate > 192000)
    throw std::invalid_argument("Sample rate must be between 8000 and 192000 Hz");
  smoothing_ = 1 - std::exp(-1.0 / (0.01 * sample_rate));
  set_parameters(parameters_);
  reset();
}

void Engine::set_parameters(const Parameters& p) {
  parameters_ = p;
  target_ = {gain(bounded(p.master_db, -60, 12)), gain(bounded(p.left_db, -60, 6)),
             gain(bounded(p.right_db, -60, 6)), bounded(p.balance, -1, 1),
             bounded(p.width, 0, 2), p.bypass ? 0.0 : 1.0, p.limiter ? 1.0 : 0.0};
  filters_[0].target = eq(0, bounded(p.low_db, -12, 12), sample_rate_);
  filters_[1].target = eq(1, bounded(p.mid_db, -12, 12), sample_rate_);
  filters_[2].target = eq(2, bounded(p.high_db, -12, 12), sample_rate_);
}

void Engine::reset() {
  current_ = target_;
  for (auto& filter : filters_) {
    filter.coefficients = filter.target;
    filter.z1.fill(0);
    filter.z2.fill(0);
  }
}

float Engine::Biquad::tick(float sample, int channel) {
  const auto& c = coefficients;
  const double out = c[0] * sample + z1[channel];
  z1[channel] = c[1] * sample - c[3] * out + z2[channel];
  z2[channel] = c[2] * sample - c[4] * out;
  // Avoid denormal slowdowns after long silence.
  if (std::abs(z1[channel]) < 1e-20) z1[channel] = 0;
  if (std::abs(z2[channel]) < 1e-20) z2[channel] = 0;
  return static_cast<float>(out);
}

void Engine::Biquad::advance(double smoothing) {
  for (std::size_t i = 0; i < coefficients.size(); ++i)
    coefficients[i] += smoothing * (target[i] - coefficients[i]);
}

void Engine::process(float* left, float* right, std::size_t frames) {
  for (std::size_t i = 0; i < frames; ++i) {
    for (std::size_t j = 0; j < current_.size(); ++j)
      current_[j] += smoothing_ * (target_[j] - current_[j]);
    const float dry_l = std::isfinite(left[i]) ? left[i] : 0;
    const float dry_r = std::isfinite(right[i]) ? right[i] : 0;
    const double mid = (dry_l + dry_r) * 0.5;
    const double side = (dry_l - dry_r) * 0.5 * current_[4];
    float l = static_cast<float>(mid + side), r = static_cast<float>(mid - side);
    for (auto& filter : filters_) {
      filter.advance(smoothing_);
      l = filter.tick(l, 0);
      r = filter.tick(r, 1);
    }
    l *= current_[0] * current_[1] * (1 - std::max(0.0, current_[3]));
    r *= current_[0] * current_[2] * (1 + std::min(0.0, current_[3]));
    // Linked instantaneous peak guard: keeps stereo balance; not a mastering limiter.
    const double peak = std::max(std::abs(l), std::abs(r));
    const double protection = peak > 1 ? 1 + current_[6] * (1 / peak - 1) : 1;
    l *= protection; r *= protection;
    left[i] = static_cast<float>(dry_l + current_[5] * (l - dry_l));
    right[i] = static_cast<float>(dry_r + current_[5] * (r - dry_r));
  }
}
}  // namespace pulsemix
