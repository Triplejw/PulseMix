#pragma once
#include <array>
#include <cstddef>

namespace pulsemix {
struct Parameters {
  float master_db = 0;
  float left_db = 0;
  float right_db = 0;
  float balance = 0;
  float width = 1;
  float low_db = 0;
  float mid_db = 0;
  float high_db = 0;
  bool bypass = false;
  bool limiter = true;
};

// No allocation, locks, or I/O in process(). One engine belongs to one audio thread.
class Engine {
 public:
  explicit Engine(float sample_rate);
  void set_parameters(const Parameters& parameters);
  void reset();
  void process(float* left, float* right, std::size_t frames);

 private:
  struct Biquad {
    std::array<double, 5> target{1, 0, 0, 0, 0};
    std::array<double, 5> coefficients{1, 0, 0, 0, 0};
    std::array<double, 2> z1{}, z2{};
    float tick(float sample, int channel);
    void advance(double smoothing);
  };
  float sample_rate_;
  double smoothing_;
  Parameters parameters_;
  // Linear gains, balance, width, wet amount, peak-guard amount.
  std::array<double, 7> target_{1, 1, 1, 0, 1, 1, 1};
  std::array<double, 7> current_ = target_;
  std::array<Biquad, 3> filters_;
};
}  // namespace pulsemix
