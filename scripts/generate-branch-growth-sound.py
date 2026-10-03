#!/usr/bin/env python3

import sys
import wave
from pathlib import Path

import numpy as np
from scipy.signal import butter, sosfilt


SAMPLE_RATE = 48_000
DEFAULT_OUTPUT = Path(__file__).resolve().parents[1] / "assets" / "audio" / "branch-growth-preview.wav"


def filtered_noise(rng, low, high, samples):
    noise = rng.standard_normal(samples)
    sos = butter(3, [low, high], btype="bandpass", fs=SAMPLE_RATE, output="sos")
    return sosfilt(sos, noise)


def window(time, start, end, attack=0.03, release=0.08):
    rise = np.clip((time - start) / attack, 0, 1)
    fall = np.clip((end - time) / release, 0, 1)
    return np.sin(rise * np.pi / 2) ** 2 * np.sin(fall * np.pi / 2) ** 2


def main():
    rng = np.random.default_rng()
    duration = rng.uniform(1.08, 1.24)
    output = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else DEFAULT_OUTPUT
    samples = int(SAMPLE_RATE * duration)
    time = np.arange(samples) / SAMPLE_RATE

    soil = filtered_noise(rng, rng.uniform(52, 70), rng.uniform(180, 260), samples)
    soil_end = duration * rng.uniform(0.48, 0.58)
    soil *= np.exp(-rng.uniform(3.5, 4.7) * np.maximum(time - 0.1, 0))
    soil *= window(time, 0.0, soil_end, rng.uniform(0.14, 0.2), rng.uniform(0.22, 0.3))

    growth_start = rng.uniform(0.1, 0.15)
    progress = np.clip((time - growth_start) / (duration * rng.uniform(0.64, 0.72)), 0, 1)
    growth_envelope = window(
        time,
        rng.uniform(0.045, 0.075),
        duration * rng.uniform(0.89, 0.95),
        rng.uniform(0.15, 0.21),
        rng.uniform(0.23, 0.3),
    )
    wood_low = filtered_noise(rng, rng.uniform(105, 145), rng.uniform(520, 680), samples)
    wood_mid = filtered_noise(rng, rng.uniform(360, 480), rng.uniform(1_250, 1_650), samples)
    pressure = filtered_noise(rng, rng.uniform(3.5, 5.5), rng.uniform(13, 19), samples)
    pressure /= max(np.max(np.abs(pressure)), 1e-9)
    pressure = rng.uniform(0.68, 0.76) + rng.uniform(0.2, 0.28) * pressure
    wood = (
        (1 - progress) * wood_low * rng.uniform(0.64, 0.76)
        + progress * wood_mid * rng.uniform(0.18, 0.25)
    )
    wood *= growth_envelope * pressure

    sprout_source = filtered_noise(rng, rng.uniform(480, 620), rng.uniform(1_650, 2_250), samples)
    sprouts = np.zeros(samples)
    pulse_count = int(rng.integers(5, 9))
    moments = np.sort(rng.uniform(0.2, duration * 0.78, pulse_count))
    for moment, size in zip(moments, rng.uniform(0.45, 1.0, pulse_count)):
        offset = np.maximum(time - moment, 0)
        pop = (1 - np.exp(-offset * rng.uniform(120, 180)))
        pop *= np.exp(-offset * rng.uniform(28, 44)) * (time >= moment)
        sprouts += size * sprout_source * pop

    fibers = filtered_noise(rng, rng.uniform(420, 560), rng.uniform(1_500, 2_100), samples)
    fibers *= growth_envelope * (0.25 + 0.75 * progress)
    fibers *= 0.7 + 0.3 * np.clip(pressure, 0, 1)

    mono = (
        rng.uniform(0.19, 0.27) * soil
        + rng.uniform(0.48, 0.57) * wood
        + rng.uniform(0.045, 0.075) * fibers
        + rng.uniform(0.055, 0.085) * sprouts
    )
    mono *= window(time, 0.0, duration, rng.uniform(0.15, 0.21), rng.uniform(0.23, 0.31))
    soft_filter = butter(4, rng.uniform(3_200, 4_100), btype="lowpass", fs=SAMPLE_RATE, output="sos")
    mono = sosfilt(soft_filter, mono)
    mono = np.tanh(mono * rng.uniform(1.3, 1.6))

    side = filtered_noise(rng, rng.uniform(220, 310), rng.uniform(1_350, 1_950), samples)
    side *= window(time, 0.06, duration * 0.97, 0.14, 0.22)
    stereo_width = rng.uniform(0.003, 0.006)
    delay = int(rng.integers(3, 12))
    left = mono + stereo_width * side
    right = np.roll(mono, delay) - stereo_width * side
    right[:delay] = 0
    stereo = np.column_stack([left, right])
    stereo /= max(np.max(np.abs(stereo)), 1e-9)
    stereo *= rng.uniform(0.66, 0.74)

    output.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(output), "wb") as audio:
        audio.setnchannels(2)
        audio.setsampwidth(2)
        audio.setframerate(SAMPLE_RATE)
        audio.writeframes((stereo * 32767).astype("<i2").tobytes())

    print(output)


if __name__ == "__main__":
    main()
