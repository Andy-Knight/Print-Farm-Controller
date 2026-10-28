# Camera fixture

`x1c-blue.h264` is a generated two-frame, 64x64 solid-blue H.264 clip used by the
loopback RTSPS integration test. It contains no printer/customer footage or
decoder executable. Generated in the disposable Debian FFmpeg test environment:

```text
ffmpeg -hide_banner -f lavfi -i color=c=blue:s=64x64:r=1 -t 2 -c:v libx264 -threads 1 -f h264 -y x1c-blue.h264
```

libx264 is used only to generate this fixture. The controller uses FFmpeg's H.264
decoder and MJPEG encoder; it does not require a libx264-enabled runtime build.
