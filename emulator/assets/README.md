# Simulator camera assets

`x1c-test-frame.h264` is derived from the existing repository `test-frame.jpg`.
It is a five-FPS baseline H.264 intra-frame image repeated by the X1C RTSPS
endpoint with matching RTP timing. Generate it with a development encoder:

```text
ffmpeg -loop 1 -framerate 5 -i test-frame.jpg -frames:v 1 -vf scale=640:-2,format=yuv420p -c:v libx264 -preset veryfast -tune zerolatency -profile:v baseline -g 1 -f h264 x1c-test-frame.h264
```

libx264 is used only to create this asset, not shipped in the controller decoder.
The other printer simulators retain their existing JPEG camera protocols.
