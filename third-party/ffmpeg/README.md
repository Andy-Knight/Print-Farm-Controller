# FFmpeg corresponding source

`source.tar.xz` is the unmodified official FFmpeg source release pinned in
`scripts/ffmpeg-source.json`. Its SHA-256 is verified before every decoder build.
Vendoring this source keeps packaging independent of upstream download outages
and ensures the matching source accompanies every shipped decoder.

All upstream copyright/licence files are retained inside the archive and copied
beside the decoder with the source archive, build arguments and reproduction
recipe. `scripts/ffmpeg-build.sh` selects a minimal LGPL configuration, with no
GPL or nonfree components, and rejects other resulting licence configurations.
The controller remains a separate program communicating through standard pipes.

For updates, download a reviewed release from the official URL, verify it, replace
the source archive and pin together, rebuild each target and rerun the RTSPS
fixture on the exact packaged decoder. Review applicable licence and patent
obligations separately; the LGPL build does not establish H.264 patent clearance.
