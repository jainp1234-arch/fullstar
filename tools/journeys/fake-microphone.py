"""Plan 9.5: espeak-ng's WAV (22 kHz) as 48 kHz 16-bit mono, the format Chromium's fake microphone
(--use-file-for-fake-audio-capture) plays reliably. Runs in the reading-checker test image (PyAV).

    python fake-microphone.py IN.wav OUT.wav
"""

import sys
import wave

import av


def main(source: str, target: str) -> None:
    resampler = av.AudioResampler(format="s16", layout="mono", rate=48000)
    pcm = bytearray()
    with av.open(source) as container:
        for frame in container.decode(audio=0):
            for out in resampler.resample(frame):
                pcm += out.to_ndarray().tobytes()
    for out in resampler.resample(None):
        pcm += out.to_ndarray().tobytes()
    with wave.open(target, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(48000)
        wav.writeframes(bytes(pcm))
    print(f"{target}: {len(pcm) / 2 / 48000:.1f} s at 48 kHz")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
