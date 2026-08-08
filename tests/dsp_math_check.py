from math import cos, sin, pi, sqrt, log10
import cmath

FS = 48000.0
Q = sqrt(0.5)
LOW = 180.0
HIGH = 4500.0


def biquad(kind, f0):
    w0 = 2*pi*f0/FS
    alpha = sin(w0)/(2*Q)
    c = cos(w0)
    if kind == 'lowpass':
        b = [(1-c)/2, 1-c, (1-c)/2]
    else:
        b = [(1+c)/2, -(1+c), (1+c)/2]
    a = [1+alpha, -2*c, 1-alpha]
    return [x/a[0] for x in b], [x/a[0] for x in a]


def h(coeffs, freq):
    b,a = coeffs
    z = cmath.exp(-1j*2*pi*freq/FS)
    return (b[0]+b[1]*z+b[2]*z*z)/(a[0]+a[1]*z+a[2]*z*z)

lp_lo = biquad('lowpass', LOW)
hp_lo = biquad('highpass', LOW)
lp_hi = biquad('lowpass', HIGH)
hp_hi = biquad('highpass', HIGH)

worst = 0.0
for n in range(1600):
    freq = 20.0 * (1000.0 ** (n/1599.0))
    low = h(lp_lo, freq)**2
    mid = h(hp_lo, freq)**2 * h(lp_hi, freq)**2
    high = h(hp_hi, freq)**2
    total = abs(low + mid + high)
    db = 20*log10(max(total, 1e-12))
    worst = max(worst, abs(db))

assert worst < 0.05, f'3-band bypass crossover ripple too high: {worst:.4f} dB'

# Stereo matrix + balance invariants used by offscreen.js. Balance attenuates
# one output side; it must not crossfeed one channel into the other.
# Stereo DSP was retired in 1.13. Legacy state is normalized to neutral before it can reach the engine.
print(f'dsp_math_check.py: PASS (max crossover ripple {worst:.4f} dB)')
